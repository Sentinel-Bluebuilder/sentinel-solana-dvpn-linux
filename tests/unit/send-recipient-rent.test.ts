// ─── A22 (rc9-c2, review src/cli read): a tDVPN send pays the recipient's token account rent when it is missing ───
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { sendCheck, MIN_SOL_AFTER_LAMPORTS, BASE_FEE_LAMPORTS } from '../../src/cli/send-check';
import { recipientTokenRent } from '../../src/main/services/wallet';
import { PROGRAM_ID, MINT } from '../../src/core/chain/idl';

const OWNER = 'Own1111111111111111111111111111111111111111';
const PEER = 'Peer111111111111111111111111111111111111111';
const RENT = 2_074_080n; // Token-2022 account with the tDVPN mint's extensions (~0.00207 SOL)
const base = { to: PEER, tdvpnBase: 1_000_000n, lamports: 0n, owner: OWNER, ownerLamports: 100_000_000n, ownerTdvpnBase: 5_000_000n, device: null, programId: PROGRAM_ID.toBase58(), mint: MINT.toBase58(), allowEmpty: false };
const REAL = '9enW4xCJ1HAa6hB2ieWDVmQCTzRDqJj2ZEaHkJEv3BrF';

describe('A22: sendCheck with the recipient rent', () => {
  it('account exists (rent 0): fee only', () => {
    expect(sendCheck({ ...base, recipientRentLamports: 0n })).toMatchObject({ ok: true, feeLamports: '5000', rentLamports: '0', balanceAfter: { lamports: String(100_000_000n - BASE_FEE_LAMPORTS) }, notes: [] });
  });
  it('account missing: fee + rent in balanceAfter, and the preview says who pays', () => {
    const r = sendCheck({ ...base, recipientRentLamports: RENT });
    expect(r).toMatchObject({ ok: true, feeLamports: '5000', rentLamports: String(RENT), balanceAfter: { lamports: String(100_000_000n - BASE_FEE_LAMPORTS - RENT) } });
    expect((r as { notes: string[] }).notes[0]).toBe("This creates the recipient's tDVPN token account (rent 0.00207408 SOL, paid by you).");
  });
  it('low-sol-after fires at the new boundary for a tDVPN-only send', () => {
    const edge = MIN_SOL_AFTER_LAMPORTS + BASE_FEE_LAMPORTS + RENT;
    expect(sendCheck({ ...base, ownerLamports: edge, recipientRentLamports: RENT })).toMatchObject({ ok: true });
    expect(sendCheck({ ...base, ownerLamports: edge - 1n, recipientRentLamports: RENT })).toMatchObject({ ok: false, code: 'low-sol-after' });
    expect(sendCheck({ ...base, ownerLamports: edge - 1n, recipientRentLamports: RENT, allowEmpty: true })).toMatchObject({ ok: true });
    // control: the same balance with the account present never trips it (fee only, as before)
    expect(sendCheck({ ...base, ownerLamports: edge - 1n, recipientRentLamports: 0n })).toMatchObject({ ok: true });
  });
  it('fee + rent above the balance: insufficient-funds naming the rent', () => {
    const r = sendCheck({ ...base, ownerLamports: RENT, recipientRentLamports: RENT });
    expect(r).toMatchObject({ ok: false, code: 'insufficient-funds' });
    expect((r as { message: string }).message).toMatch(/token account rent need 0\.00207908/);
  });
  it('a SOL-only send never counts a token account', () => {
    expect(sendCheck({ ...base, tdvpnBase: 0n, lamports: 1_000_000n, recipientRentLamports: RENT })).toMatchObject({ ok: true, rentLamports: '0' });
  });
});

describe('A22: recipientTokenRent', () => {
  it('exists → 0, never reads the mint', async () => {
    let read = 0;
    expect(await recipientTokenRent(REAL, { exists: async () => true, accountLen: async () => { read++; return 0; } })).toBe(0n);
    expect(read).toBe(0);
  });
  it('missing → the rent for the mint-sized account', async () => {
    expect(await recipientTokenRent(REAL, { exists: async () => false, accountLen: async () => 182, rentFor: async (len) => (len === 182 ? Number(RENT) : -1) })).toBe(RENT);
  });
  it('a failed read throws (no preview on a guess)', async () => {
    await expect(recipientTokenRent(REAL, { exists: async () => { throw new Error('all RPC endpoints failed'); } })).rejects.toThrow(/all RPC endpoints failed/);
  });
  it('the CLI passes it to sendCheck and shows it in the preview', () => {
    const c = fs.readFileSync(path.resolve('src/cli/commands.ts'), 'utf8');
    expect(c).toMatch(/const recipientRentLamports = sendBase > 0n \? await recipientTokenRent\(to\) : 0n;/);
    expect(c).toMatch(/recipientRentLamports, to, tdvpnBase: sendBase/);
    expect(c).toMatch(/SOL token account rent/);
  });
});
