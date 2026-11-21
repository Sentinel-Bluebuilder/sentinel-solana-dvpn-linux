// ─── rc9-f2 TX-LAND (H): a send whose reply was lost is confirmed by its signature, never reported failed ───
// Before: every send attempt failing on the transport threw at once, and the app's second Send signed a NEW
// transfer (a double transfer) when the first had landed.
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';

const rpcCall = vi.fn();
vi.mock('../../src/core/chain/rpc', async (orig) => {
  const real = await orig<typeof import('../../src/core/chain/rpc')>();
  return { ...real, rpcCall: (...a: unknown[]) => rpcCall(...a) };
});

const { sendSigned } = await import('../../src/core/chain/tx');
const { RPC_UNAVAILABLE } = await import('../../src/core/chain/rpc');
const { b58encode } = await import('../../src/core/chain/b58');
const { moneyOf, moneyNote } = await import('../../src/cli/money-note');

function signed(): VersionedTransaction {
  const kp = Keypair.generate();
  const msg = new TransactionMessage({ payerKey: kp.publicKey, recentBlockhash: '11111111111111111111111111111111', instructions: [SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })] }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([kp]);
  return tx;
}
const lostReply = (): Error => Object.assign(new Error('transfer:send: all RPC endpoints failed:\n  a: fetch failed'), { name: RPC_UNAVAILABLE });
const chain = (status: () => unknown, height: number) => async (fn: (c: unknown) => unknown) => fn({
  sendRawTransaction: async () => { throw lostReply(); },
  getSignatureStatuses: async () => ({ value: [status()] }),
  getBlockHeight: async () => height,
});

describe('TX-LAND: sendSigned after a lost send reply', () => {
  afterEach(() => { vi.useRealTimers(); rpcCall.mockReset(); });

  it('the tx landed: ok, with its own signature (it threw before)', async () => {
    vi.useFakeTimers();
    const tx = signed();
    rpcCall.mockImplementation(chain(() => ({ confirmationStatus: 'confirmed', err: null, slot: 11 }), 5));
    const p = sendSigned(tx, { lastValidBlockHeight: 10_000, label: 'transfer' });
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(p).resolves.toEqual({ ok: true, signature: b58encode(tx.signatures[0]), slot: 11 });
  });
  it('expired and unknown to the chain: tx-not-landed, money none', async () => {
    vi.useFakeTimers();
    rpcCall.mockImplementation(chain(() => null, 20_000));
    const p = sendSigned(signed(), { lastValidBlockHeight: 10_000, label: 'transfer' });
    const assertion = expect(p).rejects.toMatchObject({ code: 'tx-not-landed' });
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(moneyOf('tx-not-landed')).toBe('none');
  });
  it('the chain cannot be read until the deadline: tx-unknown, "not known, read the balances"', async () => {
    vi.useFakeTimers();
    rpcCall.mockImplementation(async (fn: (c: unknown) => unknown, o: { label: string }) => {
      if (o.label.endsWith(':send')) throw lostReply();
      throw Object.assign(new Error('x:status: all RPC endpoints failed'), { name: RPC_UNAVAILABLE });
    });
    const p = sendSigned(signed(), { lastValidBlockHeight: 10_000, label: 'transfer' });
    const assertion = expect(p).rejects.toMatchObject({ code: 'tx-unknown' });
    await vi.advanceTimersByTimeAsync(200_000);
    await assertion;
    expect(moneyOf('tx-unknown')).toBe('unclear');
    expect(moneyNote('tx-unknown', 'wallet')).toMatch(/^It is not known whether the transaction went through/);
  });
  it('negative control: a rejected send (the node answered) is still a program error at once, never polled', async () => {
    rpcCall.mockImplementation(async () => { throw Object.assign(new Error('Transaction simulation failed: insufficient funds'), { name: 'SendTransactionError', transactionLogs: [] }); });
    await expect(sendSigned(signed(), { lastValidBlockHeight: 10_000, label: 'transfer' })).rejects.not.toMatchObject({ code: 'tx-unknown' });
    expect(rpcCall).toHaveBeenCalledTimes(1);
  });
});

describe('TX-LAND: wallet send and the app', () => {
  it('wallet send keeps tx-unknown / tx-not-landed and re-reads the balances on tx-unknown', () => {
    const s = fs.readFileSync('src/main/services/wallet.ts', 'utf8');
    expect(s).toContain("code: code === 'tx-unknown' || code === 'tx-not-landed' ? code : 'send-failed'");
    expect(s).toMatch(/if \(code === 'tx-unknown'\) await refreshWallet\(\)/);
  });
  it('the app\'s Send offers no "Try again" on tx-unknown (the modal closes, the amount is cleared)', () => {
    const w = fs.readFileSync('src/renderer/src/screens/Wallet.tsx', 'utf8');
    const at = w.indexOf("{modal === 'send' && (");
    expect(at).toBeGreaterThan(-1);
    const send = w.slice(at, at + 1500);
    expect(send).toMatch(/catch \(err\) \{[\s\S]*?=== 'tx-unknown'\) \{ setAmt\(''\); return; \}\s+throw err;/);
  });
});
