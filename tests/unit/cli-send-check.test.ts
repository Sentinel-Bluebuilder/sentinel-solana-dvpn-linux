// ─── W-A2 (the agent kit rc.8, T-A money audit ta2-c1): wallet send refuses before the preview ───
import { describe, it, expect } from 'vitest';
import { sendCheck, badRecipient, allowanceCheck, SYSTEM_PROGRAM, MIN_SOL_AFTER_LAMPORTS } from '../../src/cli/send-check';
import { exitCodeFor } from '../../src/cli/exit-codes';
import { moneyNote } from '../../src/cli/money-note';
import { PROGRAM_ID, MINT } from '../../src/core/chain/idl';

const OWNER = 'Own1111111111111111111111111111111111111111';
const DEVICE = 'Dev1111111111111111111111111111111111111111';
const PEER = 'Peer111111111111111111111111111111111111111';
const base = { to: PEER, tdvpnBase: 0n, lamports: 0n, owner: OWNER, ownerLamports: 100_000_000n, ownerTdvpnBase: 5_000_000n, device: DEVICE, programId: PROGRAM_ID.toBase58(), mint: MINT.toBase58(), allowEmpty: false };

describe('W-A2: refusals, each before needsConfirm', () => {
  it('tDVPN above the balance: insufficient-funds, exit 4, nothing sent', () => {
    const r = sendCheck({ ...base, tdvpnBase: 6_000_000n });
    expect(r).toMatchObject({ ok: false, code: 'insufficient-funds' });
    expect(exitCodeFor('insufficient-funds')).toBe(4);
    expect(moneyNote('insufficient-funds', 'wallet')).toBe('Nothing was sent or signed.');
  });
  it('SOL + fee above the balance: insufficient-funds', () => {
    expect(sendCheck({ ...base, lamports: 100_000_000n })).toMatchObject({ ok: false, code: 'insufficient-funds' });
  });
  it('the system program, the programId, the mint: bad-recipient, exit 5, naming what it is', () => {
    for (const [to, what] of [[SYSTEM_PROGRAM, 'system program'], [PROGRAM_ID.toBase58(), 'on-chain program'], [MINT.toBase58(), 'tDVPN mint']] as const) {
      const r = sendCheck({ ...base, to, tdvpnBase: 1n });
      expect(r).toMatchObject({ ok: false, code: 'bad-recipient' });
      expect((r as { message: string }).message).toContain(what);
      expect(badRecipient(to, base.programId, base.mint)).toContain(what);
    }
    expect(exitCodeFor('bad-recipient')).toBe(5);
  });
  it('a SOL send leaving < 0.01 SOL: low-sol-after, exit 5; --allow-empty lets it through', () => {
    const lamports = base.ownerLamports - MIN_SOL_AFTER_LAMPORTS; // leaves 0.01 - fee
    expect(sendCheck({ ...base, lamports })).toMatchObject({ ok: false, code: 'low-sol-after' });
    expect(exitCodeFor('low-sol-after')).toBe(5);
    expect(sendCheck({ ...base, lamports, allowEmpty: true })).toMatchObject({ ok: true });
  });
});

describe('W-A2: the preview', () => {
  it('adds feeLamports + balanceAfter', () => {
    const r = sendCheck({ ...base, lamports: 10_000_000n, tdvpnBase: 1_000_000n });
    expect(r).toEqual({ ok: true, feeLamports: '5000', rentLamports: '0', balanceAfter: { lamports: String(100_000_000 - 10_000_000 - 5000), tdvpnBase: '4000000' }, notes: [] });
  });
  it('own address and own device: notes, not refusals', () => {
    expect((sendCheck({ ...base, to: OWNER, tdvpnBase: 1n }) as { notes: string[] }).notes[0]).toMatch(/your own address: only the fee/);
    expect((sendCheck({ ...base, to: DEVICE, lamports: 1_000_000n }) as { notes: string[] }).notes[0]).toMatch(/device: its SOL pays the fees/);
  });
  it('negative controls: a normal send is fine; a tDVPN-only send never trips low-sol-after', () => {
    expect(sendCheck({ ...base, tdvpnBase: 5_000_000n })).toMatchObject({ ok: true });
    expect(sendCheck({ ...base, ownerLamports: 6000n, tdvpnBase: 1n })).toMatchObject({ ok: true });
    expect(badRecipient(PEER, base.programId, base.mint)).toBeNull();
  });
});

describe('W-A3: device plan/setup --allowance', () => {
  it('above the wallet balance: allowance-above-balance, exit 4, nothing sent; --force lets it through', () => {
    const r = allowanceCheck(6_000_000n, 5_000_000n, false);
    expect(r).toMatchObject({ ok: false, code: 'allowance-above-balance' });
    expect((r as { message: string }).message).toMatch(/above this wallet's 5 tDVPN.*--force\. Nothing was sent or signed\.$/);
    expect(exitCodeFor('allowance-above-balance')).toBe(4);
    expect(moneyNote('allowance-above-balance', 'device')).toBe('Nothing was sent or signed.');
    expect(allowanceCheck(6_000_000n, 5_000_000n, true)).toEqual({ ok: true, warning: null });
  });
  it('--allowance 0: a warning that 0 blocks every deposit', () => {
    expect((allowanceCheck(0n, 5_000_000n, false) as { warning: string }).warning).toMatch(/0 blocks every deposit/);
  });
  it('negative controls: at or under the balance is fine; an unread balance never refuses', () => {
    expect(allowanceCheck(5_000_000n, 5_000_000n, false)).toEqual({ ok: true, warning: null });
    expect(allowanceCheck(9_000_000n, null, false)).toEqual({ ok: true, warning: null });
  });
});
