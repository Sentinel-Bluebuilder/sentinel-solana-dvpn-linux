// rc.4 E-22 (other fleet, Windows rc.3): with this computer's clock a few minutes off, the deposit opened and
// the server then answered "unauthorized" (go-sdk auth.MaxRequestSkew = 60 s). Now the chain's time is read
// at preflight and a wrong clock is refused with code 'clock-skew', its minutes in the sentence, before paying.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const st = vi.hoisted(() => ({ blockTime: 0 as number | null, slotAsked: '' }));
vi.mock('../../src/core/chain/rpc', () => ({
  rpcCall: async (fn: (c: unknown) => Promise<unknown>) => fn({
    getSlot: async (c: string) => { st.slotAsked = c; return 123; },
    getBlockTime: async () => st.blockTime,
  }),
}));

const { skewSeconds, clockSkewBlocker, chainClockSkew, CLOCK_SKEW_REFUSE_S, MAX_REQUEST_SKEW_S } = await import('../../src/core/chain/clock');
const { CONNECT_CODES } = await import('../../src/core/session/state');
const { CONNECT_CODE_TO_RESULT } = await import('../../src/core/nodetest/connect-codes');
const { skewMinutes } = await import('../../src/cli/agent-cmd');

describe('clock against the chain', () => {
  it('refuses a clock 7 minutes ahead, naming the minutes the CLI reads', () => {
    const b = clockSkewBlocker(skewSeconds(1_000_000, (1_000_000 + 7 * 60) * 1000));
    expect(b?.code).toBe('clock-skew');
    expect(b?.action).toBe('Fix the clock');
    expect(b?.error).toMatch(/about 7 min ahead/);
    expect(b?.error).toMatch(/Nothing was paid\.$/);
    expect(skewMinutes(b?.error)).toBe(7);
  });
  it('behind is said as behind', () => {
    expect(clockSkewBlocker(-200)?.error).toMatch(/about 3 min behind/);
  });
  it('negative control: inside the limit passes (block time trails real time a few seconds)', () => {
    expect(clockSkewBlocker(0)).toBeNull();
    expect(clockSkewBlocker(CLOCK_SKEW_REFUSE_S)).toBeNull();
    expect(clockSkewBlocker(-CLOCK_SKEW_REFUSE_S)).toBeNull();
    expect(clockSkewBlocker(CLOCK_SKEW_REFUSE_S + 1)).not.toBeNull();
    expect(CLOCK_SKEW_REFUSE_S).toBeLessThan(MAX_REQUEST_SKEW_S);
  });
  it('reads the confirmed slot\'s block time, as dvpnd\'s own preflight does', async () => {
    st.blockTime = 1_000_000;
    expect(await chainClockSkew(() => 1_000_090_000)).toBe(90);
    expect(st.slotAsked).toBe('confirmed');
    st.blockTime = null;
    expect(await chainClockSkew(() => 0)).toBeNull(); // no block time: skipped, never a refusal
  });
  it('is a known connect code and never counts against the server', () => {
    expect(CONNECT_CODES).toContain('clock-skew');
    expect(CONNECT_CODE_TO_RESULT['clock-skew']).toBe('SERVICE_NOT_READY');
  });
});

describe('wiring: refused before any deposit, with its own code', () => {
  const checks = readFileSync('src/main/services/connect-checks.ts', 'utf8');
  const conn = readFileSync('src/main/services/connection.ts', 'utf8');
  it('preflight checks the clock before plan access and before the funding check', () => {
    const at = checks.indexOf('clockSkewBlocker(skew)');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(checks.indexOf('if (req.subscription) return null;'));
    expect(at).toBeLessThan(checks.indexOf('fundingBlocker(funding)'));
  });
  it('an unreadable chain time skips the check (logged), it does not refuse', () => {
    expect(checks).toMatch(/chainClockSkew\(\)\.catch\(/);
    expect(checks).toMatch(/clock check skipped/);
  });
  it('connect() keeps the code on both paths (user connect and server test)', () => {
    expect(conn).toContain("fail(blocker.error, blocker.code ?? 'preflight'");
    expect(conn).toContain('refused.code ?? preflightCode(refused.error)');
  });
});
