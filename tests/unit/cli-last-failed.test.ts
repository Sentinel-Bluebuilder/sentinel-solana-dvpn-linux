// ─── agent up: the last failed server, kept for 10 minutes (file side) ───
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { recordFailed, recentFailed, clearFailed, serverFailed, withoutFailed, skippedNote, SKIP_WINDOW_MS, LAST_FAILED_FILE } from '../../src/cli/last-failed';

const dir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'lf-'));

describe('last failed server', () => {
  it('kept for 10 min, then forgotten; cleared on success', () => {
    const d = dir();
    recordFailed('NodeX', 'node-offline', d, 1_000_000);
    expect(recentFailed(d, 1_000_000 + 60_000)).toEqual({ node: 'NodeX', code: 'node-offline', at: 1_000_000 });
    expect(recentFailed(d, 1_000_000 + SKIP_WINDOW_MS)).toBeNull();
    clearFailed(d);
    expect(fs.existsSync(path.join(d, LAST_FAILED_FILE))).toBe(false);
    expect(recentFailed(d, 1_000_000)).toBeNull();
  });
  it('an unreadable file is ignored (nothing skipped), never a throw', () => {
    const d = dir();
    fs.writeFileSync(path.join(d, LAST_FAILED_FILE), '{not json');
    expect(recentFailed(d)).toBeNull();
  });
  it('only server failures count', () => {
    for (const c of ['node-offline', 'node-identity', 'node-error', 'tunnel-failed', 'tunnel-dead']) expect(serverFailed(c)).toBe(true);
    for (const c of ['dns-apply', 'spending-limit', 'rpc-quota', 'kill-switch-held', undefined]) expect(serverFailed(c)).toBe(false);
  });
  it('the pool drops it, unless it is the only server left', () => {
    const f = { node: 'B', code: 'node-offline', at: 0 };
    expect(withoutFailed([{ address: 'A' }, { address: 'B' }], f)).toEqual({ pool: [{ address: 'A' }], skipped: f });
    expect(withoutFailed([{ address: 'B' }], f)).toEqual({ pool: [{ address: 'B' }], skipped: null });
    expect(withoutFailed([{ address: 'A' }], f)).toEqual({ pool: [{ address: 'A' }], skipped: null });
    expect(withoutFailed([{ address: 'A' }], null)).toEqual({ pool: [{ address: 'A' }], skipped: null });
  });
  it('the note names the server, the minutes and the way to try it anyway', () => {
    expect(skippedNote({ node: 'B', code: 'tunnel-failed', at: 0 }, 7 * 60_000)).toBe('skipped B: it failed 7 min ago (tunnel-failed); --node B tries it anyway');
  });
});
