// ─── VPN-service settings: ONE draft for every screen, applied with one administrator prompt ───
// Shared by Settings, Kill switch and Split tunnelling. Applying restarts the service (ends a session).
// Q0508 F3 (owner 2026-11-12: toggling apps, the kill switch and settings "broke everything"): each screen
// had its own draft, so an edit not yet applied vanished on navigation and two screens could show different
// "current" values. The draft now lives in one store: edits made on any of the three screens survive
// navigation, every Apply sends all of them, and every Apply button is disabled while one runs.
import { useEffect } from 'react';
import { create } from 'zustand';
import { call, useApp } from './store';
import type { DaemonSettings } from '../../../core/daemon/config';
import { changedKeys, editedSince, mergeLoaded, pendingAreas } from '../../../core/daemon/draft';
import { tr } from '../../../shared/i18n';

/** empty (Q0544): the service is installed but the copy this app reads is empty. */
export interface DaemonState { readable: boolean; empty?: boolean; settings: Partial<DaemonSettings> }

interface DraftStore {
  daemon: DaemonState | null;
  draft: Partial<DaemonSettings>;
  /** Keys the user edited since the last read: a re-read keeps them instead of overwriting them. */
  touched: Set<string>;
  applying: boolean;
}

export const useDaemonDraft = create<DraftStore>(() => ({ daemon: null, draft: {}, touched: new Set(), applying: false }));

/** Read the service settings; keepEdits keeps every key the user touched (on any screen). */
export async function loadDaemonSettings(opts: { keepEdits?: boolean; keepKeys?: string[] } = {}): Promise<DaemonState> {
  const d = await call<DaemonState>(window.api.IPC.DAEMON_SETTINGS_GET);
  useDaemonDraft.setState((st) => {
    // keepKeys (after an Apply): only the edits made while it ran survive, as unapplied edits.
    if (opts.keepKeys) return { daemon: d, draft: mergeLoaded(d.settings, st.draft, opts.keepKeys), touched: new Set(opts.keepKeys) };
    return {
      daemon: d,
      draft: opts.keepEdits ? mergeLoaded(d.settings, st.draft, st.touched) : d.settings,
      touched: opts.keepEdits ? st.touched : new Set(),
    };
  });
  return d;
}

/** Unapplied edits exist (any screen). */
export function draftDirty(st: Pick<DraftStore, 'daemon' | 'draft'>): boolean {
  return !!st.daemon && JSON.stringify({ ...st.daemon.settings, ...st.draft }) !== JSON.stringify(st.daemon.settings);
}

export async function applyDaemonDraft(): Promise<boolean> {
  const st = useDaemonDraft.getState();
  if (!st.daemon || st.applying) return false;
  useDaemonDraft.setState({ applying: true });
  try {
    const sent = { ...st.daemon.settings, ...st.draft };
    const r = await call<{ sessionEnded?: boolean } | undefined>(window.api.IPC.DAEMON_SETTINGS_APPLY, sent);
    // KSM12 k12a: an edit made while this Apply ran stays as an unapplied edit (its Apply bar shows), not lost.
    await loadDaemonSettings({ keepKeys: editedSince(sent, useDaemonDraft.getState().draft) });
    useApp.getState().toast('success', r?.sessionEnded ? tr('VPN service settings applied. The session ended with the restart: connect again.') : tr('VPN service settings applied.'));
    return true;
  } catch (err) {
    // call() already showed the error; the draft is kept so nothing the user chose is lost.
    console.warn('apply failed', err);
    return false;
  } finally {
    useDaemonDraft.setState({ applying: false });
  }
}

export function resetDaemonDraft(): void {
  const { daemon } = useDaemonDraft.getState();
  if (daemon) useDaemonDraft.setState({ draft: daemon.settings, touched: new Set() });
}

export function useDaemonSettings() {
  const daemon = useDaemonDraft((s) => s.daemon);
  const draft = useDaemonDraft((s) => s.draft);
  const applying = useDaemonDraft((s) => s.applying);
  const setDraft = (next: Partial<DaemonSettings>): void => {
    useDaemonDraft.setState((st) => {
      const touched = new Set(st.touched);
      for (const k of changedKeys(st.draft, next)) touched.add(k);
      return { draft: next, touched };
    });
  };
  useEffect(() => {
    // Every screen open re-reads (another screen, the CLI or a restart may have changed the service) but
    // keeps the user's unapplied edits from any screen.
    loadDaemonSettings({ keepEdits: true }).catch((err) => {
      console.warn('daemon settings read failed', err);
      useDaemonDraft.setState((st) => ({ daemon: st.daemon ?? { readable: false, settings: {} } }));
    });
  }, []);
  const dirty = draftDirty({ daemon, draft });
  const pending = daemon ? pendingAreas(daemon.settings, draft) : [];
  return { daemon, draft, setDraft, dirty, pending, applying, apply: applyDaemonDraft, reset: resetDaemonDraft };
}
