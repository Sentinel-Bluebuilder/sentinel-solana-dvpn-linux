// A sent tx whose status reads are rate-limited must still be reported as landed (ddv-win-2,
// 2026-10-21: device setup landed, two 429 reads, user told "failed").
import { afterEach, describe, expect, it, vi } from 'vitest';

const rpcCall = vi.fn();
vi.mock('../../src/core/chain/rpc', async (orig) => {
  const real = await orig<typeof import('../../src/core/chain/rpc')>();
  return { ...real, rpcCall: (...a: unknown[]) => rpcCall(...a) };
});

import { confirmSignature } from '../../src/core/chain/tx';
import { RPC_UNAVAILABLE, isTransportError } from '../../src/core/chain/rpc';

const exhausted = (): Error => {
  const e = new Error('x:status: all RPC endpoints failed:\n  https://api.devnet.solana.com/: 429 Too Many Requests');
  e.name = RPC_UNAVAILABLE;
  return e;
};

describe('confirmSignature', () => {
  afterEach(() => { vi.useRealTimers(); rpcCall.mockReset(); });

  it('pool exhaustion is a transport error (its first line has no 429)', () => {
    expect(isTransportError(exhausted())).toBe(true);
  });

  it('keeps polling through rate-limited reads and returns the landed tx', async () => {
    vi.useFakeTimers();
    rpcCall
      .mockRejectedValueOnce(exhausted())
      .mockRejectedValueOnce(exhausted())
      .mockResolvedValue({ value: [{ confirmationStatus: 'confirmed', err: null, slot: 7 }] });
    const p = confirmSignature('sig', 10_000, 'device_setup');
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(p).resolves.toEqual({ ok: true, signature: 'sig', slot: 7 });
  });

  it('a program error from the chain still fails at once', async () => {
    rpcCall.mockResolvedValue({ value: [{ confirmationStatus: 'confirmed', err: { InstructionError: [0, { Custom: 6046 }] }, slot: 7 }] });
    await expect(confirmSignature('sig', 10_000, 'x')).rejects.toThrow(/PermissionNotGranted/);
  });

  // CODE-AUDIT L-21: landed in one of the last valid blocks, not yet 'confirmed' when the height passed.
  const byMethod = (status: () => unknown, height: number) => async (fn: (c: unknown) => unknown) => fn({
    getSignatureStatuses: async () => ({ value: [status()] }),
    getBlockHeight: async () => height,
  });
  it('height past but the chain knows the tx: reported landed, never expired', async () => {
    vi.useFakeTimers();
    let reads = 0;
    rpcCall.mockImplementation(byMethod(() => (++reads <= 4 ? null /* rounds 1-4; round 4 then reads the height */ : { confirmationStatus: 'confirmed', err: null, slot: 9 }), 20_000));
    const p = confirmSignature('sig', 10_000, 'send');
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(p).resolves.toEqual({ ok: true, signature: 'sig', slot: 9 });
  });
  it('negative control: height past and still unknown after the second read: expired', async () => {
    vi.useFakeTimers();
    rpcCall.mockImplementation(byMethod(() => null, 20_000));
    const p = confirmSignature('sig', 10_000, 'send');
    const assertion = expect(p).rejects.toThrow(/expired before confirmation/);
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
  });

  it('times out with "sent, may still land", not "failed"', async () => {
    vi.useFakeTimers();
    rpcCall.mockImplementation(async () => { throw exhausted(); });
    const p = confirmSignature('sig', 10_000, 'device_setup');
    const assertion = expect(p).rejects.toThrow(/sent but not confirmed.*may still land/);
    await vi.advanceTimersByTimeAsync(70_000);
    await assertion;
  });
});
