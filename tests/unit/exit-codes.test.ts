// S4 (the agent kit rc.6): a failure's class is its exit code, so an agent can branch before it reads text.
import { describe, expect, it } from 'vitest';
import { EXIT, exitCodeFor } from '../../src/cli/exit-codes';
import { errorOutput } from '../../src/cli/error-out';

describe('exit codes by failure class', () => {
  it('needs you or your operator = 4', () => {
    for (const c of ['not-funded', 'spending-limit', 'no-wallet']) expect(exitCodeFor(c)).toBe(EXIT.needsHuman);
  });
  it('refused for safety = 5', () => {
    for (const c of ['kill-switch', 'kill-switch-held', 'kill-switch-failed']) expect(exitCodeFor(c)).toBe(5);
  });
  it('network / RPC, retry later = 6', () => {
    for (const c of ['rpc-busy', 'rpc-unavailable', 'rpc-ws']) expect(exitCodeFor(c)).toBe(6);
    // a deposit may be open after these (money class open): never "retry later", exit 1 and read money
    for (const c of ['rpc-timeout', 'rpc-quota', 'rpc-network', 'timeout']) expect(exitCodeFor(c)).toBe(1);
  });
  it('negative controls: no code, unknown or another code stay 1; 0/2/3 are never returned for a failure', () => {
    for (const c of [null, undefined, '', 'unknown', 'node-refused', 'connect-failed']) expect(exitCodeFor(c)).toBe(1);
  });
  it('errorOutput hands back the code it printed, so index.ts maps the same one', () => {
    const o = errorOutput(Object.assign(new Error('Not enough funds.'), { code: 'not-funded' }), true, 'agent');
    expect(o.code).toBe('not-funded');
    expect(JSON.parse(o.text).code).toBe('not-funded');
    expect(errorOutput(new Error('x'), false, 'status').code).toBeNull();
  });
});
