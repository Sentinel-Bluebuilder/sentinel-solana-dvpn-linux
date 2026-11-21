// ─── A10 (review audit, rc9-c): Ctrl+C in `connect --follow` with a disconnect that rejects ends with a coded line ───
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const st = vi.hoisted(() => ({ fail: true }));
vi.mock('../../src/main/services/connection', async (orig) => ({
  ...(await orig<object>()),
  disconnect: async () => { if (st.fail) throw new Error('daemon not reachable'); return { ok: true }; },
}));
vi.mock('../../src/main/app-state', async (orig) => ({
  ...(await orig<object>()),
  snapshot: () => ({ session: { id: 'S1', rxBytes: 0, txBytes: 0, spent: '0' }, conn: { title: 'Connected' } }),
}));

const { setHost } = await import('../../src/main/host');
setHost({ name: 'cli', resourcesDir: '', dataDir: mkdtempSync(join(tmpdir(), 'a10-')), keyStore: {} as never, emit: () => undefined });
const { follow } = await import('../../src/cli/commands');
const o = { json: true, print: () => undefined } as never;

describe('A10: follow + Ctrl+C', () => {
  it('a rejecting disconnect: follow rejects with disconnect-failed and next = agent status (no unhandled rejection)', async () => {
    st.fail = true;
    const p = follow(o);
    process.emit('SIGINT');
    const err = await p.then(() => null, (e: Error & { code?: string; action?: string }) => e);
    expect(err?.code).toBe('disconnect-failed');
    expect(err?.action).toBe('devnet-dvpn agent status --json');
    expect(err?.message).toMatch(/daemon not reachable/);
  });
  it('control: a disconnect that works resolves', async () => {
    st.fail = false;
    const p = follow(o);
    process.emit('SIGINT');
    await expect(p).resolves.toBeUndefined();
  });
});
