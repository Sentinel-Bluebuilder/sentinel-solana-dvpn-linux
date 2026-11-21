// ─── An edit made while an Apply runs is kept as unapplied, not lost (DVPN-WIN KSM12 k12a, hunt 2026-11-13) ───
// Kill switch page: On + Apply, then Off clicked while that Apply ran. The reload after the Apply replaced the whole
// draft with the service's settings: the page went back to "On · Current", no Apply bar, the Off choice gone.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { editedSince, mergeLoaded, pendingAreas } from '../../src/core/daemon/draft';

const BEFORE = { killSwitch: 'off', allowLan: false, dnsServers: ['1.1.1.1'], split: { mode: 'off', apps: [] as string[], routes: [] as string[] } };
const SENT = { ...BEFORE, killSwitch: 'persist' };
const AFTER_APPLY = { ...SENT }; // what the service reads back once the Apply landed

describe('settings draft: edits made during an Apply', () => {
  it('names only what changed after the Apply was sent', () => {
    expect(editedSince(SENT, { killSwitch: 'off' })).toEqual(['killSwitch']);
    expect(editedSince(SENT, { killSwitch: 'persist' })).toEqual([]);
    expect(editedSince(SENT, { ...SENT })).toEqual([]);
    expect(editedSince(SENT, { dnsServers: ['8.8.8.8'] })).toEqual(['dnsServers']);
  });
  it('k12a: Off clicked during the On Apply stays as the draft and shows as unapplied', () => {
    const draftNow = { ...SENT, killSwitch: 'off' };
    const keep = editedSince(SENT, draftNow);
    const draft = mergeLoaded(AFTER_APPLY, draftNow, keep);
    expect(draft.killSwitch).toBe('off');
    expect(pendingAreas(AFTER_APPLY, draft)).toEqual(['Kill switch']);
  });
  it('negative control: the old reload (draft = loaded settings) loses the Off choice and shows nothing pending', () => {
    const old = { ...AFTER_APPLY };
    expect(old.killSwitch).toBe('persist');
    expect(pendingAreas(AFTER_APPLY, old)).toEqual([]);
  });
  it('no edit during the Apply: the draft is the applied settings, nothing pending', () => {
    const draft = mergeLoaded(AFTER_APPLY, { ...SENT }, editedSince(SENT, { ...SENT }));
    expect(draft).toEqual(AFTER_APPLY);
    expect(pendingAreas(AFTER_APPLY, draft)).toEqual([]);
  });
  it('the hook reloads after an Apply keeping only the keys edited since it was sent', () => {
    const src = readFileSync('src/renderer/src/lib/use-daemon-settings.ts', 'utf8');
    expect(src).toContain('const sent = { ...st.daemon.settings, ...st.draft };');
    expect(src).toContain('await loadDaemonSettings({ keepKeys: editedSince(sent, useDaemonDraft.getState().draft) });');
    expect(src).not.toMatch(/DAEMON_SETTINGS_APPLY[^\n]*\n\s*await loadDaemonSettings\(\);/);
  });
});
