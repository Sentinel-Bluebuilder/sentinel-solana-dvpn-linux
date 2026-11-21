// ─── Q0508 F3: Settings, Kill switch and Split tunnelling share ONE service-settings draft ───
import { beforeEach, describe, expect, it, vi } from 'vitest';

const live: Record<string, unknown> = { killSwitch: 'off', dnsServers: ['1.1.1.1'], split: { mode: 'off', apps: [], routes: [] } };
const sent: Record<string, unknown>[] = [];
const toast = vi.fn();
(globalThis as unknown as { window: unknown }).window = { api: { IPC: { DAEMON_SETTINGS_GET: 'get', DAEMON_SETTINGS_APPLY: 'apply' } } };
vi.mock('../../src/renderer/src/lib/store', () => ({
  call: async (ch: string, payload?: Record<string, unknown>) => {
    if (ch === 'get') return { readable: true, settings: JSON.parse(JSON.stringify(live)) };
    sent.push(payload!);
    Object.assign(live, payload);
    return { sessionEnded: false };
  },
  useApp: { getState: () => ({ toast }) },
}));

// A non-literal path: tsconfig.node types tests, and the renderer hook needs the DOM lib (vitest runs it fine).
const HOOK: string = '../../src/renderer/src/lib/use-daemon-settings';
const { useDaemonDraft, loadDaemonSettings, applyDaemonDraft, resetDaemonDraft, draftDirty } = await import(HOOK);
const { pendingAreas } = await import('../../src/core/daemon/draft');

// What each screen's setDraft does (use-daemon-settings.ts), without React.
const edit = (patch: Record<string, unknown>): void => {
  const st = useDaemonDraft.getState();
  const touched = new Set(st.touched);
  for (const k of Object.keys(patch)) touched.add(k);
  useDaemonDraft.setState({ draft: { ...st.draft, ...patch }, touched });
};

describe('one shared draft', () => {
  beforeEach(async () => {
    Object.assign(live, { killSwitch: 'off', dnsServers: ['1.1.1.1'], split: { mode: 'off', apps: [], routes: [] } });
    sent.length = 0;
    useDaemonDraft.setState({ daemon: null, draft: {}, touched: new Set(), applying: false });
    await loadDaemonSettings();
  });

  it('an edit on Kill switch survives opening Split and Settings (each re-reads with keepEdits), and one Apply sends both', async () => {
    edit({ killSwitch: 'persist' });                       // Kill switch screen
    await loadDaemonSettings({ keepEdits: true });         // Split screen opens
    edit({ split: { mode: 'include', apps: ['A'], routes: [] } });
    await loadDaemonSettings({ keepEdits: true });         // Settings opens
    edit({ dnsServers: ['9.9.9.9'] });
    expect(pendingAreas(useDaemonDraft.getState().daemon!.settings, useDaemonDraft.getState().draft)).toEqual(expect.arrayContaining(['Kill switch', 'Split tunnelling', 'DNS']));
    expect(await applyDaemonDraft()).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ killSwitch: 'persist', split: { mode: 'include', apps: ['A'] }, dnsServers: ['9.9.9.9'] });
    expect(draftDirty(useDaemonDraft.getState())).toBe(false);
  });

  it('a change made elsewhere (CLI) shows on the next screen open, and untouched keys follow it', async () => {
    edit({ dnsServers: ['9.9.9.9'] });
    live.killSwitch = 'persist';                           // `daemon set --kill-switch persist` from the CLI
    await loadDaemonSettings({ keepEdits: true });
    expect(useDaemonDraft.getState().draft).toMatchObject({ killSwitch: 'persist', dnsServers: ['9.9.9.9'] });
  });

  it('Reset drops every screen\'s unapplied edit', () => {
    edit({ killSwitch: 'persist', dnsServers: ['9.9.9.9'] });
    resetDaemonDraft();
    expect(draftDirty(useDaemonDraft.getState())).toBe(false);
  });

  it('negative control: while one apply runs, a second is not sent', async () => {
    edit({ killSwitch: 'persist' });
    useDaemonDraft.setState({ applying: true });
    expect(await applyDaemonDraft()).toBe(false);
    expect(sent).toHaveLength(0);
  });
});
