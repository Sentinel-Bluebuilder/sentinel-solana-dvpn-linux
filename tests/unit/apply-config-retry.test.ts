import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Linux matrix 2026-10-22: a valid kill-switch change was rolled back because dvpnd's start-up RPC
// check hit a 429. The apply step must retry that case before rolling back, and say why if it gives up.
describe('apply-daemon-config.sh: busy RPC at start', () => {
  const s = readFileSync(join(__dirname, '../../resources/scripts/apply-daemon-config.sh'), 'utf8');
  it('retries only when the journal of THIS start shows the RPC check failed', () => {
    expect(s).toMatch(/for wait in 5 10 20; do/);
    expect(s).toMatch(/--since "@\$t0".*grep -qE "\$RPC_FAIL" \|\| break/);
  });
  it('RPC_FAIL matches both journal shapes of a busy endpoint, not a config error', () => {
    const m = s.match(/RPC_FAIL='([^']+)'/);
    expect(m).not.toBeNull();
    const re = new RegExp(m![1]);
    expect(re.test('error: preflight failed: rpc: getHealth: 429 Too Many Requests')).toBe(true);
    // arm64 Debian 12, 2026-10-22: the websocket dial after the preflight got the 429
    expect(re.test('error: connecting rpc: connecting websocket wss://api.devnet.solana.com: new ws client: dial: websocket: bad handshake, status: 429 Too Many Requests')).toBe(true);
    expect(re.test('error: invalid config: dns_mode "netsh" not supported')).toBe(false);
  });
  it('rolls back with RPC wording, not "failed to start with the new settings"', () => {
    const rpc = s.indexOf('could not reach the Solana RPC endpoint');
    const generic = s.indexOf('failed to start with the new settings');
    expect(rpc).toBeGreaterThan(0);
    expect(generic).toBeGreaterThan(rpc);
  });
});
