// UI-169 (owner laptop 2026-11-11 to 11-15): the keyed Solana endpoint answered 429 "max usage reached" on
// every read; the app benched it for 8 s, tried again, fell back to the public endpoint, and never said so.
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_RPC_URLS, OVER_LIMIT_COOLDOWN_MS, benchMs, isOverLimit, overLimitState, rpcCall, setRpcUrls } from '../../src/core/chain/rpc';

const PRIVATE = 'https://rpc.private.example/?api-key=not-a-real-key';
const PUBLIC = 'https://api.devnet.solana.com';
// the body the laptop log shows, as web3.js words it
const OVER = '429 Too Many Requests: {"jsonrpc":"2.0","error":{"code":-32429,"message":"max usage reached"}}';

describe('a private endpoint over its usage limit', () => {
  afterEach(() => { setRpcUrls([...DEFAULT_RPC_URLS]); });

  it('is told apart from a momentary rate limit', () => {
    expect(isOverLimit(new Error(OVER))).toBe(true);
    expect(isOverLimit(new Error('429 Too Many Requests'))).toBe(false);
    expect(isOverLimit(new Error('fetch failed'))).toBe(false);
    expect(benchMs(new Error(OVER))).toBe(OVER_LIMIT_COOLDOWN_MS);
    expect(benchMs(new Error('429 Too Many Requests'))).toBeLessThan(60_000);
  });

  it('the read still works on the public endpoint, the state says so, and the private one is left alone for 10 minutes', async () => {
    setRpcUrls([PRIVATE, PUBLIC]);
    expect(overLimitState()).toMatchObject({ privateOverLimit: false, overLimitSince: null });
    const hits: string[] = [];
    const read = (_c: unknown, url: string): Promise<number> => {
      hits.push(url);
      return url === PRIVATE ? Promise.reject(new Error(OVER)) : Promise.resolve(5);
    };
    const t0 = Date.now();
    expect(await rpcCall(read, { label: 'ui169:a' })).toBe(5);
    const s = overLimitState();
    expect(s.privateOverLimit).toBe(true);
    expect(s.inUse).toBe('public');
    expect(s.overLimitSince).toBeGreaterThanOrEqual(t0);
    // the next reads go straight to the public endpoint: the private one is not asked again each time
    expect(await rpcCall(read, { label: 'ui169:b' })).toBe(5);
    expect(await rpcCall(read, { label: 'ui169:c' })).toBe(5);
    expect(hits.filter((u) => u === PRIVATE).length).toBe(1);
    expect(overLimitState().overLimitSince).toBe(s.overLimitSince); // "since" does not move
  });

  it('a plain 429 on a private endpoint is not "over the limit"', async () => {
    const other = 'https://rpc.second.example/?api-key=not-a-real-key'; // its own address: the state is kept per endpoint
    setRpcUrls([other, PUBLIC]);
    await rpcCall((_c, url) => (url === other ? Promise.reject(new Error('429 Too Many Requests')) : Promise.resolve(1)), { label: 'ui169:plain' });
    expect(overLimitState().privateOverLimit).toBe(false);
  });

  it('it clears when that endpoint answers again', async () => {
    const third = 'https://rpc.third.example/?api-key=not-a-real-key';
    setRpcUrls([third]); // the only endpoint, so it is asked again although benched
    let over = true;
    const read = (): Promise<number> => (over ? Promise.reject(new Error(OVER)) : Promise.resolve(7));
    await rpcCall(read, { label: 'ui169:clear-a', attempts: 1, fallback: 0 });
    expect(overLimitState().privateOverLimit).toBe(true);
    over = false;
    expect(await rpcCall(read, { label: 'ui169:clear-b', attempts: 2, timeoutMs: 500, deadlineMs: 4000 })).toBe(7);
    expect(overLimitState()).toMatchObject({ privateOverLimit: false, overLimitSince: null, inUse: 'private' });
  });

  it('the public endpoint saying the same thing is not a private endpoint over its limit', async () => {
    setRpcUrls([PUBLIC, 'https://rpc.other.example']);
    await rpcCall((_c, url) => (url === PUBLIC ? Promise.reject(new Error(OVER)) : Promise.resolve(1)), { label: 'ui169:public' });
    expect(overLimitState().privateOverLimit).toBe(false);
    expect(overLimitState().inUse).toBe('private');
  });

  it('an endpoint removed in Settings is forgotten', async () => {
    setRpcUrls([PRIVATE, PUBLIC]);
    await rpcCall((_c, url) => (url === PRIVATE ? Promise.reject(new Error(OVER)) : Promise.resolve(1)), { label: 'ui169:gone' });
    expect(overLimitState().privateOverLimit).toBe(true);
    setRpcUrls([PUBLIC]);
    expect(overLimitState().privateOverLimit).toBe(false);
  });
});
