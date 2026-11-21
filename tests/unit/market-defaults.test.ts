// ─── R7 market-aware defaults (the agent kit, owner 2026-11-20): price fixtures from the live devnet read ───
import { describe, it, expect } from 'vitest';
import { readMarket, defaultCap, defaultLimitBase, fundingAsk, solNeeded, MARKET_MIN_NODES, SOL_BEFORE_SETUP, SOL_AFTER_SETUP } from '../../src/core/session/market-defaults';
import { keyfileModeProblem } from '../../src/cli/keystore';

const T = (n: number): string => String(Math.round(n * 1_000_000)); // tDVPN → base units (6 decimals)

// 2026-11-20 11:25Z shape: 3 cheap GB nodes, the rest at ~50, one at 78.
const LIVE = [0.0015, 0.0015, 0.002, ...Array(30).fill(50), 78, 60].map(T);

describe('readMarket', () => {
  it('reads p50 / p75 of the live shape', () => {
    const m = readMarket(LIVE)!;
    expect(m.p50).toBe(T(50));
    expect(m.p75).toBe(T(50));
    expect(m.nodes).toBe(35);
    expect(m.outliers).toBe(0);
  });
  it('a cheap market reads cheap', () => {
    const m = readMarket([T(0.001), T(0.002), T(0.003), T(0.004)])!;
    expect(m.p50).toBe(T(0.002));
    expect(m.p75).toBe(T(0.003));
  });
  it('drops an outlier above 10 x the median', () => {
    const m = readMarket([T(1), T(1), T(2), T(2), T(5000)])!;
    expect(m.outliers).toBe(1);
    expect(m.p75).toBe(T(2));
  });
  it('leaves out unpriced and malformed prices', () => {
    expect(readMarket(['0', '', null, 'abc', '1.5', T(1), T(2)])).toBeNull();
  });
  it(`fewer than ${MARKET_MIN_NODES} priced nodes: null (the fixed values apply)`, () => {
    expect(readMarket([T(1), T(2)])).toBeNull();
  });
});

describe('defaultCap', () => {
  const limit150 = BigInt(T(150));
  it('live market: cap = p75 x units (50), not the fixed 15', () => {
    const d = defaultCap(limit150, readMarket(LIVE), 1);
    expect(d).toMatchObject({ priceCapBase: T(50), source: 'market' });
  });
  it('never above the Settings limit (the owner ceiling)', () => {
    const d = defaultCap(BigInt(T(50)), readMarket(LIVE), 3);
    expect(d.priceCapBase).toBe(T(50));
  });
  it('a cheap market keeps the fixed limit / 10 (never below it)', () => {
    const d = defaultCap(limit150, readMarket([T(0.001), T(0.002), T(0.003)]), 1);
    expect(d).toMatchObject({ priceCapBase: T(15), source: 'fixed' });
  });
  it('thin market: the fixed cap, with the reason', () => {
    const d = defaultCap(limit150, null, 1);
    expect(d).toMatchObject({ priceCapBase: T(15), source: 'fixed', market: null });
    expect(d.reason).toMatch(/fewer than 3 priced nodes/);
  });
  it('unreadable setting: no cap, and says why', () => {
    expect(defaultCap(null, readMarket(LIVE), 1)).toMatchObject({ priceCapBase: null, source: 'fixed' });
  });
});

describe('defaultLimitBase / fundingAsk / solNeeded', () => {
  it('limit: 3 deposits at p75, never below the fixed one', () => {
    expect(defaultLimitBase(BigInt(T(50)), readMarket(LIVE), 1)).toBe(BigInt(T(150)));
    expect(defaultLimitBase(BigInt(T(50)), null, 1)).toBe(BigInt(T(50)));
  });
  it('funds below one deposit: the exact shortfall plus a recommended amount covering a reconnect', () => {
    const a = fundingAsk(BigInt(T(50)), BigInt(T(10)), readMarket(LIVE), 1);
    expect(a.needBase).toBe(BigInt(T(40)));
    expect(a.recommendBase).toBe(BigInt(T(90)));
  });
  it('funded: nothing needed', () => {
    const a = fundingAsk(BigInt(T(0.002)), BigInt(T(200)), readMarket(LIVE), 1);
    expect(a).toEqual({ needBase: 0n, recommendBase: 0n });
  });
  it('SOL: the device float before setup, fees after', () => {
    expect(solNeeded(false)).toBe(SOL_BEFORE_SETUP);
    expect(solNeeded(true)).toBe(SOL_AFTER_SETUP);
    expect(SOL_BEFORE_SETUP).toBe(60_000_000);
  });
});

describe('R3 gap 1: keyfileModeProblem', () => {
  it('group/other bits on a POSIX key file: refused with the mode', () => {
    expect(keyfileModeProblem('/k.json', 'linux', 0o100644)).toEqual({ path: '/k.json', mode: '644' });
  });
  it('600, Windows, or no key file: no problem (negative controls)', () => {
    expect(keyfileModeProblem('/k.json', 'linux', 0o100600)).toBeNull();
    expect(keyfileModeProblem('C:/k.json', 'win32', 0o100666, () => 'C:/k.json DESKTOP-1\\me:(F)\n          NT AUTHORITY\\SYSTEM:(F)\n')).toBeNull(); // K-WIN (rc.9): the ACL decides
    expect(keyfileModeProblem(undefined, 'linux')).toBeNull();
  });
});

describe('R2: cliErr + deviceNext (next on every answer)', () => {
  it('cliErr carries the code and the next as action', async () => {
    const { cliErr } = await import('../../src/cli/cli-fail');
    const e = cliErr('no-plan', 'devnet-dvpn plans list', 'No plan X.');
    expect(e).toMatchObject({ message: 'No plan X.', code: 'no-plan', action: 'devnet-dvpn plans list' });
  });
  it('device setup: service missing → daemon install; running → agent up', async () => {
    const { deviceNext } = await import('../../src/cli/cli-fail');
    expect(deviceNext('no-service')).toBe('devnet-dvpn daemon install --yes');
    expect(deviceNext('failed')).toBe('devnet-dvpn daemon install --yes');
    expect(deviceNext('started')).toBe('devnet-dvpn agent up --yes');
    expect(deviceNext(undefined)).toBe('devnet-dvpn agent up --yes');
  });
});

describe('R2 (S5): every coded failure links its CODES.md row', () => {
  it('docUrl on a coded failure; none when the code is null', async () => {
    const { errorOutput } = await import('../../src/cli/error-out');
    const coded = JSON.parse(errorOutput(Object.assign(new Error('x'), { code: 'no-plan', action: 'devnet-dvpn plans list' }), true, 'plans').text);
    expect(coded.docUrl).toBe('https://github.com/Sentinel-Bluebuilder/agentic-privacy-solana-devnet/blob/main/docs/CODES.md#code-no-plan');
    expect(coded.next).toBe('devnet-dvpn plans list');
    const bare = JSON.parse(errorOutput(new Error('y'), true, 'plans').text);
    expect(bare.docUrl).toBeUndefined();
  });
});
