// ─── Renderer state: one snapshot pushed by main (F5) + small UI state ───
// Components never poll; main's scheduler owns every timer.
import { create } from 'zustand';
import type { AppSnapshot, NodeView, ProbeResult, AppSettings, Result } from '../../../shared/types';
import type { IpcChannel } from '../../../shared/ipc';
import { lockdownView } from '../../../core/session/state';
import { dismissNote, expireNotes, pushNote, type Note, type NoteInput } from '../../../core/app/notify-rules';
import { tr } from '../../../shared/i18n';

/** The system's "Block connections without VPN" setting (Android only; false elsewhere or unreadable). */
const lockdownOn = (): boolean => {
  try {
    return window.api?.android?.vpnSystemState().lockdown === true;
  } catch (err) {
    console.warn('vpn system state unreadable', err);
    return false;
  }
};

/** A notification. Rules (one per event, errors stay, three visible) live in core/app/notify-rules. */
export type Toast = Note;
export type ToastOptions = Omit<NoteInput, 'kind' | 'message'>;

interface UiState {
  snap: AppSnapshot | null;
  nodes: NodeView[];
  probeProgress: { done: number; total: number } | null;
  settings: AppSettings | null;
  toasts: Toast[];
  setSnap(s: AppSnapshot): void;
  /** A connect was just confirmed: show its first step now, never the last attempt's result. */
  connectAsked(): void;
  setNodes(n: NodeView[]): void;
  setProbe(addr: string, p: ProbeResult, done: number, total: number): void;
  setSettings(s: AppSettings): void;
  toast(kind: Toast['kind'], message: string, opts?: ToastOptions): void;
  dismiss(id: number): void;
  /** Drops notifications whose time is up; `paused` while the pointer is over them. Called by <Toasts>. */
  expireToasts(paused: boolean): void;
  /** The screen on show, so a notification never repeats what that screen already says. */
  screen: string | null;
  setScreen(s: string | null): void;
}

let toastId = 0;

// Check results arrive one per server, up to dozens a second: applied together once per frame (UI-014).
const probeBuffer = new Map<string, ProbeResult>();
let probeFrame = 0;
let probeTally: { done: number; total: number } | null = null;

export const useApp = create<UiState>((set) => ({
  snap: null,
  nodes: [],
  probeProgress: null,
  settings: null,
  toasts: [],
  // Android lockdown holds traffic while reconnecting whatever the kill switch says (the OS, not dvpnd).
  setSnap: (snap) => set({ snap: { ...snap, conn: lockdownView(snap.conn, lockdownOn()) } }),
  // UI-188 (owner 2026-11-15): the moment you confirm a connect, every screen shows the first step.
  // Without this the Connect page opened on the PREVIOUS attempt's failure for a moment, until the
  // app's first progress message arrived. Only from rest (not connected, or a failure showing); the
  // next real state from the app replaces it, whatever it is.
  connectAsked: () => set((s) => {
    if (!s.snap || s.snap.session || (s.snap.conn.phase !== 'idle' && s.snap.conn.phase !== 'error')) return s;
    return { snap: { ...s.snap, lastConnectError: null, conn: { ...s.snap.conn, phase: 'preflight', title: tr('Getting ready…'), detail: tr('Checking the server and your balance…'), closeMessage: null } } };
  }),
  setNodes: (nodes) => { probeBuffer.clear(); probeTally = null; set({ nodes, probeProgress: null }); },
  setProbe: (addr, p, done, total) => {
    probeBuffer.set(addr, p);
    probeTally = { done, total };
    if (probeFrame) return;
    const flush = (): void => {
      probeFrame = 0;
      if (!probeBuffer.size || !probeTally) return;
      const batch = new Map(probeBuffer);
      const tally = probeTally;
      probeBuffer.clear();
      set((s) => ({
        nodes: s.nodes.map((n) => { const hit = batch.get(n.address); return hit ? { ...n, probe: hit } : n; }),
        probeProgress: tally.done >= tally.total ? null : tally,
      }));
    };
    probeFrame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(flush) : (setTimeout(flush, 16) as unknown as number);
  },
  setSettings: (settings) => set({ settings }),
  screen: null,
  setScreen: (screen) => set({ screen }),
  toast: (kind, message, opts) => set((s) => {
    const toasts = pushNote(s.toasts, { ...opts, kind, message }, ++toastId, Date.now(), s.screen) as Toast[];
    return toasts === s.toasts ? s : { toasts };
  }),
  dismiss: (id) => set((s) => ({ toasts: dismissNote(s.toasts, id) as Toast[] })),
  expireToasts: (paused) => set((s) => {
    const toasts = expireNotes(s.toasts, Date.now(), paused) as Toast[];
    return toasts === s.toasts ? s : { toasts };
  }),
}));

/** invoke + unwrap Result; failures become an error toast and a thrown Error carrying code/action. */
export async function call<T = unknown>(channel: IpcChannel, payload?: unknown, { quiet = false } = {}): Promise<T> {
  const r = await window.api.invoke<Result<T> | T>(channel, payload);
  if (r && typeof r === 'object' && 'ok' in (r as object)) {
    const res = r as Result<T>;
    if (!res.ok) {
      if (!quiet) useApp.getState().toast('error', res.error ?? tr('Something went wrong.'));
      throw Object.assign(new Error(res.error ?? 'failed'), { code: res.code, action: res.action });
    }
    return res.data as T;
  }
  return r as T;
}

export function bindEvents(): () => void {
  const { EVENTS } = window.api;
  const offs = [
    window.api.on<AppSnapshot>(EVENTS.STATE, (s) => useApp.getState().setSnap(s)),
    window.api.on<NodeView[]>(EVENTS.NODES, (n) => useApp.getState().setNodes(n)),
    window.api.on<{ address: string; probe: ProbeResult; done: number; total: number }>(EVENTS.PROBE, (e) => useApp.getState().setProbe(e.address, e.probe, e.done, e.total)),
    // Main may send title, action, key and sticky with a notification; older senders send kind and message only.
    window.api.on<NoteInput>(EVENTS.TOAST, (t) => useApp.getState().toast(t.kind, t.message, { title: t.title, action: t.action, key: t.key, sticky: t.sticky })),
  ];
  return () => offs.forEach((o) => o());
}
