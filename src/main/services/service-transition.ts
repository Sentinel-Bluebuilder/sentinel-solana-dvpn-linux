// ─── The VPN service is changing state: no verdicts until it has settled (Q0518 class, Q0520–Q0522) ───
// Owner laptop 2026-11-11 23:34Z: an Apply restarted the service mid-session and for ~20 s the app read the
// half-stopped service as real trouble: "Internet may be blocked by the kill switch" (it was off), then "Sign
// out of Windows", then (DVPN-WIN, same build) "not answering… Install service". Every one was the restart.
// A transition starts when the service stops answering after it had answered, when a session ends with
// "daemon stopping", or while any process (the app OR the CLI) applies settings (marker file). It ends when the
// service has answered again for SETTLE_MS with no apply running, or CAP_MS after it began with no apply running
// (then a real problem is shown).
// While it lasts: no leftover / blocked / sign-out / install verdicts. When it ends: one check (onTransitionSettled).
import fs from 'node:fs';
import { daemonInfo, linkStopping, onDaemonChange, reattachSoon, setTransitionProbe } from '../daemon/manager';
import { storePath } from '../store';
import { log } from '../logger';

export const SETTLE_MS = 4_000;
// A service that drops by itself (crash, outside restart) gets at most 20 s of quiet: a normal restart is
// back by then, and a real block (kill switch holding after a crash) must not hide longer (Linux KSM7: ~13-18 s).
// An apply in any process keeps the quiet for as long as it runs (marker, up to MARKER_MAX_MS).
export const CAP_MS = 20_000;
/** Written by whichever process applies service settings (services/daemon-apply.ts), read by every process. */
export const APPLY_MARKER = 'apply-running.json';
export const MARKER_MAX_MS = 120_000;
export { RESTARTING_COPY } from '../../core/daemon/link-copy';

let now = (): number => Date.now();
/** Tests only: a fake clock. */
export function setTransitionClock(f: () => number): void { now = f; }

let since: number | null = null;
let reason = '';
let lastReachable: boolean | null = null;
let upSince: number | null = null;
/** The cap counts from the later of: the transition's start, the last moment an apply was running. */
let capFrom: number | null = null;
let timer: NodeJS.Timeout | null = null;
const settledFns = new Set<() => void>();

const beganFns = new Set<() => void>();
/** Runs each time a transition begins, so the screen says "restarting" at once (Agent M Mac T3/T4 r2: begin
 *  emitted nothing, the screen kept "Not connected"/"Protected" with service "up" for the whole guard). */
export function onTransitionBegan(fn: () => void): () => void { beganFns.add(fn); return () => beganFns.delete(fn); }

/** Runs once each time a transition ends (the one leftover/blocked check, a fresh daemon view). */
export function onTransitionSettled(fn: () => void): () => void { subscribe(); settledFns.add(fn); return () => settledFns.delete(fn); }

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists but belongs to another user (the CLI elevated): alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** An apply is running in this or another process (fresh marker whose process is alive). */
export function applyMarkerFresh(): boolean {
  let p: string;
  try { p = storePath(APPLY_MARKER); } catch (err) { log.warn('apply marker: no store yet', { err: (err as Error).message }); return false; }
  if (!fs.existsSync(p)) return false;
  try {
    const m = JSON.parse(fs.readFileSync(p, 'utf8')) as { pid?: number; startedAt?: number };
    return typeof m.startedAt === 'number' && now() - m.startedAt < MARKER_MAX_MS && typeof m.pid === 'number' && pidAlive(m.pid);
  } catch (err) {
    log.warn('apply marker unreadable; ignoring it', { err: (err as Error).message });
    return false;
  }
}

export function writeApplyMarker(): void {
  try { fs.writeFileSync(storePath(APPLY_MARKER), JSON.stringify({ pid: process.pid, startedAt: now() })); } catch (err) { log.warn('could not write the apply marker', { err: (err as Error).message }); }
  beginServiceTransition('a settings change is being applied');
}

export function clearApplyMarker(): void {
  if (since !== null) capFrom = now(); // the restart may still be finishing: the cap starts now
  try { fs.rmSync(storePath(APPLY_MARKER), { force: true }); } catch (err) { log.warn('could not remove the apply marker', { err: (err as Error).message }); }
  if (since !== null) arm();
}

export function beginServiceTransition(why: string): void {
  subscribe();
  if (since === null) {
    since = now();
    reason = why;
    log.info('service transition', { reason: why });
    // The event that began this ("daemon stopping", a dropped link) is newer than the link state: the
    // platform health checks see a restarted service late (Mac/Linux every 15 s, Windows 2 missed 10 s
    // heartbeats), so an "up since" from before the stop would settle at once (Mac T3 kickstart: settled
    // in 3 ms, then "Not connected" for 7 s while blocked). The service proves itself again from here.
    if (upSince !== null) upSince = since;
    arm();
    for (const fn of beganFns) {
      try { fn(); } catch (err) { log.warn('at the start of a service transition: a listener failed', { err: (err as Error).message }); }
    }
    return;
  }
  arm();
}

function end(why: 'settled' | 'cap'): void {
  if (since === null) return;
  log.info('service transition over', { why, reason, ms: now() - since });
  since = null;
  capFrom = null;
  if (timer) { clearTimeout(timer); timer = null; }
  for (const fn of settledFns) {
    try { fn(); } catch (err) { log.warn('after the service transition: a check failed', { err: (err as Error).message }); }
  }
}

function arm(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  if (since === null) return;
  const t = now();
  const applying = applyMarkerFresh();
  if (applying) capFrom = t;
  if (!applying && t - (capFrom ?? since) >= CAP_MS) { end('cap'); return; }
  if (upSince !== null && !applying && t - upSince >= SETTLE_MS) { end('settled'); return; }
  const wait = upSince !== null && !applying ? SETTLE_MS - (t - upSince) : 1_000;
  timer = setTimeout(() => {
    timer = null;
    // Agent M Mac T3 r6: reattach each second while the link is down, so the settle clock starts when the
    // service is back, not when the next backoff step happens to fire.
    // While up, the link is asked again (a stale 'up' would settle the guard on a dead service).
    {
      try { reattachSoon(); } catch (err) { log.warn('service transition: reattach failed', { err: (err as Error).message }); }
    }
    sync(); arm();
  }, Math.max(50, wait));
  timer.unref?.();
}

let closingWarned = false;
/** The app is closing its own link (quit). A link with no such answer (a test's partial stand-in) is not closing. */
function appClosingLink(): boolean {
  try {
    return linkStopping();
  } catch (err) {
    if (!closingWarned) { closingWarned = true; log.warn('service transition: could not ask whether the app is closing its link', { err: (err as Error).message }); }
    return false;
  }
}

/** Follow the service link: answering -> not answering starts a transition; answering again starts the settle clock. */
function sync(): void {
  const r = daemonInfo().reachable;
  const was = lastReachable;
  // Record the link state BEFORE starting a transition: begin() arms the settle check, which read the old
  // "up since" and ended the transition the moment it began (found by the fuzz test below).
  if (r && was !== true) upSince = now();
  if (!r) upSince = null;
  lastReachable = r;
  // UI-166: the app closing its own link at quit is not the service restarting (the log said "service transition").
  if (was === true && !r && !appClosingLink()) beginServiceTransition('the service stopped answering');
}

/** True while the service is restarting/applying: callers make no leftover, blocked, sign-out or install verdict. */
export function serviceInTransition(): boolean {
  subscribe();
  sync();
  if (since === null && applyMarkerFresh()) beginServiceTransition('a settings change is being applied');
  if (since !== null) arm();
  return since !== null;
}

// Subscribed on first use, not at import: a module that only imports this one (and a test with a partial
// manager mock) gets no side effect.
let subscribed = false;
function subscribe(): void {
  if (subscribed) return;
  subscribed = true;
  // The link's own state ("restarting") reads this module's clock, not serviceInTransition(), which reads the link.
  // Its own try: a link that cannot take the probe must still be followed below.
  try {
    setTransitionProbe(() => since !== null);
  } catch (err) {
    log.warn('service transition: the link does not take a restart probe', { err: (err as Error).message });
  }
  try {
    onDaemonChange(() => { sync(); if (since !== null) arm(); });
  } catch (err) {
    log.warn('service transition: no service link to follow', { err: (err as Error).message });
  }
}

/** Tests only. */
export function resetServiceTransition(): void {
  since = null; reason = ''; lastReachable = null; upSince = null; capFrom = null;
  if (timer) { clearTimeout(timer); timer = null; }
}
