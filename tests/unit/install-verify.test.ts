import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false }, safeStorage: {} }));

import { settleTimedOut } from '../../src/main/system/elevate';
import { pollUntil } from '../../src/main/daemon/manager';

// ─── L6: a timed-out admin step is judged by the real service state ───
describe('settleTimedOut (L6)', () => {
  const timeoutErr = { status: 'error' as const, detail: 'The administrator step did not finish within 120 s.' };
  it('replaces the timeout error when verification says the work is done', async () => {
    const r = await settleTimedOut(timeoutErr, true, async () => ({ status: 'ok', detail: 'running' }));
    expect(r.status).toBe('ok');
  });
  it('keeps the error when verification has nothing or throws', async () => {
    expect(await settleTimedOut(timeoutErr, true, async () => null)).toBe(timeoutErr);
    expect(await settleTimedOut(timeoutErr, true, async () => { throw new Error('x'); })).toBe(timeoutErr);
  });
  it('never verifies when the step did not time out', async () => {
    const verify = vi.fn(async () => ({ status: 'ok' as const, detail: '' }));
    expect(await settleTimedOut(timeoutErr, false, verify)).toBe(timeoutErr);
    expect(verify).not.toHaveBeenCalled();
  });
});

describe('pollUntil (L6)', () => {
  it('returns true as soon as the probe passes', async () => {
    let n = 0;
    const sleeps: number[] = [];
    expect(await pollUntil(async () => ++n === 3, 30_000, 2_000, async (ms) => { sleeps.push(ms); })).toBe(true);
    expect(sleeps).toEqual([2_000, 2_000]);
  });
  it('gives up after the bounded wait', async () => {
    let n = 0;
    expect(await pollUntil(async () => { n++; return false; }, 6_000, 2_000, async () => {})).toBe(false);
    expect(n).toBe(4);
  });
});

// ─── L7: first start under a busy public RPC ───
describe('setup-daemon.sh: busy RPC at first start (L7)', () => {
  const s = readFileSync(join(__dirname, '../../resources/scripts/setup-daemon.sh'), 'utf8');
  it('waits for active + socket and retries 5/10/20 s on an RPC failure of THIS start', () => {
    expect(s).toMatch(/up\(\) \{.*is-active -q "\$SERVICE\.service"/);
    expect(s).toMatch(/for wait in 5 10 20; do/);
    expect(s).toMatch(/--since "@\$t0".*grep -qE "\$RPC_FAIL" \|\| break/);
  });
  it('no longer dies on the restart exit code alone', () => {
    expect(s).not.toMatch(/systemctl restart "\$SERVICE" \|\| die/);
  });
  it('names the busy RPC when it gives up', () => {
    expect(s).toContain('could not reach the Solana RPC endpoint');
  });
});
