// ─── CODE-AUDIT M13 (A): one blocked view for the app and for a CLI `status` process ───
// LEAD the agent kit's Windows kill-switch test: ~60 s after the tunnel was lost (persist), `status --json` said idle /
// "Not connected" / restoreNetwork false while the block was still on. The CLI half uses this export.
import fs from 'node:fs';
import { describe, it, expect, vi } from 'vitest';

const st = vi.hoisted(() => ({ ks: 'persist' }));
vi.mock('../../src/main/daemon/settings', () => ({ getDaemonSettings: () => ({ settings: { killSwitch: st.ks, dnsServers: [] } }), serviceUsesTun: () => false, splitForSession: vi.fn() }));
vi.mock('../../src/main/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { blockedNoSessionView, BLOCKED_TITLE, BLOCKED_HELD_DESKTOP } = await import('../../src/main/services/connection');

describe('blockedNoSessionView', () => {
  it('kill switch on: blocked, Restore network offered, never "Not connected"', () => {
    const v = blockedNoSessionView();
    expect(v.phase).toBe('error');
    expect(v.restoreNetwork).toBe(true);
    expect(v.title).toBe(BLOCKED_TITLE());
    expect(v.detail).toContain(BLOCKED_HELD_DESKTOP());
    expect(`${v.title} ${v.detail}`).not.toMatch(/Not connected/);
  });
  it('kill switch off: still Restore network, with the no-session sentence', () => {
    st.ks = 'off';
    const v = blockedNoSessionView();
    expect(v.restoreNetwork).toBe(true);
    expect(v.detail).not.toContain(BLOCKED_HELD_DESKTOP());
    st.ks = 'persist';
  });
  it("the app's leftover check builds its view from the same export", () => {
    const src = fs.readFileSync('src/main/services/connection.ts', 'utf8');
    const at = src.indexOf('export async function checkLeftoverBlock(');
    const body = src.slice(at, src.indexOf('\n}\n', at));
    expect(body).toContain('patch({ conn: blockedNoSessionView(endedCopy) });');
  });
});
