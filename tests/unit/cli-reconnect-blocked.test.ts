// ─── E-41 (C, Linux rc.3): reconnecting under the kill switch names the way out ───
// status --json and agent status said "Reconnecting — internet blocked to protect you" with restoreNetwork:false and no
// next. Now both name daemon restore-network; a reconnect that goes direct (kill switch off) adds nothing.
import { describe, it, expect, vi } from 'vitest';
import { viewFor, reconnectingView, RECONNECTING_TITLE } from '../../src/core/session/state';

vi.mock('../../src/main/app-state', () => ({ snapshot: () => ({}), patch: () => undefined }));
const { reconnectBlockedNext, RECONNECT_BLOCKED_NEXT } = await import('../../src/cli/status-cmd');
const { statusNext } = await import('../../src/cli/agent-cmd');

describe('E-41: reconnecting with the internet held', () => {
  it('the blocked reconnect names restore-network, then agent up or agent down', () => {
    const v = viewFor('reconnecting');
    expect(v.title).toBe(RECONNECTING_TITLE().blocked);
    expect(reconnectBlockedNext(v)).toBe('devnet-dvpn daemon restore-network'); // E-87: one runnable command; the rest is alsoNext
  });
  it('agent status gives the same next, ahead of the live-session next', () => {
    const base = { owner: 'Own1', wallet: null, live: true, reachable: true, device: 'Dev1' };
    expect(statusNext({ ...base, reconnectNext: reconnectBlockedNext(viewFor('reconnecting')) })).toBe(RECONNECT_BLOCKED_NEXT);
    expect(statusNext(base)).not.toBe(RECONNECT_BLOCKED_NEXT);
  });
  it('negative controls: a direct reconnect (kill switch off), connected, idle or no view add nothing', () => {
    expect(reconnectBlockedNext(reconnectingView(viewFor('reconnecting'), true))).toBeNull();
    expect(reconnectBlockedNext(viewFor('connected'))).toBeNull();
    expect(reconnectBlockedNext(viewFor('idle'))).toBeNull();
    expect(reconnectBlockedNext(undefined)).toBeNull();
  });
  it('status prints it as text and --json next (source check)', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/cli/status-cmd.ts', 'utf8');
    expect(src).toContain("if (reconnectNext) lines.push(`Next     ${reconnectNext}`, `Also     ${RECONNECT_BLOCKED_ALSO}`);");
    expect(src).toContain('...(reconnectNext ? { next: reconnectNext, alsoNext: RECONNECT_BLOCKED_ALSO } : {})');
  });
});
