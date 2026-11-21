import { describe, it, expect } from 'vitest';
import { redactRpcUrl } from '../../src/core/daemon/config';

// FMC-M6: a user-set RPC URL can carry a gate token. The `daemon set` confirm echo and the
// readable `daemon settings` print both route rpcUrl/rpcWsUrl through redactRpcUrl, so the token
// must never reach the terminal or logs — while scheme+host stay visible for verification.
describe('redactRpcUrl (FMC-M6)', () => {
  it('masks a query-param gate token but keeps the host', () => {
    const out = redactRpcUrl('https://devnet.example-rpc.test/?api-key=SUPERSECRET');
    expect(out).not.toContain('SUPERSECRET');
    expect(out).toContain('api-key=***');
    expect(out).toContain('devnet.example-rpc.test');
  });

  it('masks basic-auth userinfo credentials', () => {
    const out = redactRpcUrl('https://user:SUPERSECRET@rpc.example.test/');
    expect(out).not.toContain('SUPERSECRET');
    expect(out).toContain('rpc.example.test');
  });

  it('masks a long opaque path-segment API key (Alchemy/Helius style)', () => {
    const out = redactRpcUrl('https://solana-devnet.g.alchemy.com/v2/ABCDEFGHIJKLMNOP0123456789');
    expect(out).not.toContain('ABCDEFGHIJKLMNOP0123456789');
    expect(out).toContain('alchemy.com');
    expect(out).toContain('/v2/***');
  });

  it('masks every query token, not just the first', () => {
    const out = redactRpcUrl('https://rpc.test/?token=AAA&gate=BBB');
    expect(out).not.toContain('AAA');
    expect(out).not.toContain('BBB');
  });

  it('leaves a plain token-free URL unchanged (no normalisation surprises)', () => {
    expect(redactRpcUrl('https://api.devnet.solana.com')).toBe('https://api.devnet.solana.com');
    expect(redactRpcUrl('wss://api.devnet.solana.com')).toBe('wss://api.devnet.solana.com');
  });

  it('never returns a token even when the URL does not parse', () => {
    const out = redactRpcUrl('not-a-url://?api-key=SUPERSECRET');
    expect(out).not.toContain('SUPERSECRET');
  });
});
