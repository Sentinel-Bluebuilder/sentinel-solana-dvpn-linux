// Row 151: no error text decides a result. Every code the app's connect can answer with has one
// test result code; a code added to the connect path without a mapping fails here.
import { describe, it, expect } from 'vitest';
import { CONNECT_CODES } from '../../src/core/session/state';
import { CONNECT_CODE_TO_RESULT, connectResultCode } from '../../src/core/nodetest/connect-codes';
import { RESULT_CODES, verdictOf } from '../../src/core/nodetest/stages';

describe('connect code → test result code', () => {
  it('every connect code is mapped (only "unknown" falls through)', () => {
    expect(CONNECT_CODES.length).toBeGreaterThan(40); // positive control: the list is the real one
    expect(CONNECT_CODES.filter((c) => c !== 'unknown' && !CONNECT_CODE_TO_RESULT[c])).toEqual([]);
  });

  it('every mapping names a real result code', () => {
    for (const code of Object.values(CONNECT_CODE_TO_RESULT)) expect(RESULT_CODES()[code]).toBeDefined();
  });

  it('an unknown code: ours before payment, the server\'s after it', () => {
    expect(connectResultCode('unknown', false)).toBe('PAYMENT_FAILED');
    expect(connectResultCode(undefined, false)).toBe('PAYMENT_FAILED');
    expect(connectResultCode('something-new', true)).toBe('CONNECT_FAILED');
  });

  it('our side, the Solana network and the user\'s money never count against the server', () => {
    const notTheServer = ['daemon-unavailable', 'test-running', 'session-active', 'rpc-busy', 'rpc-timeout', 'not-enough-tdvpn', 'spending-limit', 'device-sol', 'preflight', 'driver-missing', 'kill-switch-held', 'peer_limit_reached', 'deposits-unread'];
    for (const c of notTheServer) expect([c, verdictOf(connectResultCode(c, false), null, null)]).toEqual([c, 'not-tested']);
    const theServer = ['timeout', 'tunnel-failed', 'tunnel-dead', 'node-error', 'node-identity', 'terms_rejected', 'node-offline', 'node-gone', 'node-stale'];
    for (const c of theServer) expect([c, verdictOf(connectResultCode(c, true), null, null)]).toEqual([c, 'failed']);
    expect(verdictOf(connectResultCode('cancelled', false), null, null)).toBe('stopped');
  });
});
