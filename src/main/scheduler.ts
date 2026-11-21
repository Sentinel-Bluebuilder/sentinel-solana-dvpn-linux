// ─── Root scheduler (F5, D9) — the only place timers live ───
// Live session data comes from the WatchSession stream (services/connection).
// Everything else is polled here; non-session polls pause while hidden.
import { getRpcState } from '../core/chain/rpc';
import { refreshWallet } from './services/wallet';
import { refreshNodes, nodesAge, findNode, recheckDue } from './services/nodes';
import { sessionsKnown, adoptRunningSession, checkLeftoverBlock, connectRunningElsewhere, reconcileShownSession } from './services/connection';
import { autoRefundIdle, readSettlements } from './services/settlement';
import { refreshSubscriptions, refreshPlans } from './services/plans';
import { daemonInfo, onDaemonChange } from './daemon/manager';
import { onTransitionBegan, onTransitionSettled, serviceInTransition } from './services/service-transition';
import { patch, snapshot, setIpChecksOff } from './app-state';
import { loadHomeIp, saveHomeIp } from './home-ip';
import { log } from './logger';
import { publicIp } from '../core/quality/quality';
import { getSettings } from './system/settings';
import { systemProxyLive } from './system/proxy';
import { getDaemonSettings, splitExcludedRoutes } from './daemon/settings';
import { dnsLabel } from '../core/daemon/dns-presets';
import { DEFAULT_POLL, type PollJob } from '../shared/poll';
import { isAndroid } from '../shared/is-android';

/** The job's cadence from settings (read live, so a change applies on the next tick). */
export function pollMs(name: PollJob): number {
  return (getSettings().poll?.[name] ?? DEFAULT_POLL[name]) * 1000;
}
const IP_LOOK_MS = 5000;
/** The IPv4 literal in a node's https://host:port uri, or null for a name. */
export function hostOf(uri: string): string | null {
  const m = /^https?:\/\/(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?/.exec(uri);
  return m ? m[1] : null;
}
/** Hidden in the tray, refunds still get settled, just less often (each read is a program scan). */
export const HIDDEN_MIN_MS = 15 * 60_000;
/** No deposits and no session: nothing can come due, so the deposit scan slows down. */
export const IDLE_SETTLE_MIN_MS = 10 * 60_000;
/** A job returns this when it looked and had nothing to do: not reported as a run. */
const SKIPPED = Symbol('skipped');
/** While another process connects, the session job runs every second, so its dvpnd tunnel check
 *  ("Checking the connection…", a few seconds) shows here too, not only for a connect started in the
 *  app (Q0357, DIR: TAN saw it missing on a CLI connect). */
export const ELSEWHERE_SESSION_MS = 1000;
export function sessionEveryMs(baseMs: number, connectingElsewhere: boolean): number {
  return connectingElsewhere ? Math.min(baseMs, ELSEWHERE_SESSION_MS) : baseMs;
}

function everyMs(j: Job): number {
  if (j.name === 'ip') return IP_LOOK_MS;
  let ms = pollMs(j.name);
  if (j.name === 'session') ms = sessionEveryMs(ms, connectRunningElsewhere());
  const s = snapshot();
  if (j.name === 'settlements' && !s.session && (s.settlements?.length ?? 0) === 0) ms = Math.max(ms, IDLE_SETTLE_MIN_MS);
  if (hidden && j.whenHidden) ms = Math.max(ms, HIDDEN_MIN_MS);
  return ms;
}

export interface JobRun { name: PollJob; at: number; ms: number; ok: boolean; error?: string }
const runListeners = new Set<(r: JobRun) => void>();
/** Every finished job run (CLI "poll watch", tests). Returns an unsubscribe. */
export function onJobRun(fn: (r: JobRun) => void): () => void {
  runListeners.add(fn);
  return () => runListeners.delete(fn);
}

let ipForSession: string | null | undefined;
let lastVpnIp: string | null = null; // never taken as the user's own IP (routes settle after a disconnect)
let ipSettleCheck: string | null = null; // session still owed its 10-second re-check

interface Job { name: PollJob; whenHidden: boolean; run: () => Promise<unknown>; last: number; busy: boolean }

const jobs: Job[] = [
  { name: 'wallet', whenHidden: false, run: refreshWallet, last: 0, busy: false },
  { name: 'nodes', whenHidden: false, run: () => refreshNodes(), last: 0, busy: false },
  { name: 'plans', whenHidden: false, run: refreshPlans, last: 0, busy: false },
  { name: 'subscriptions', whenHidden: false, run: refreshSubscriptions, last: 0, busy: false },
  { name: 'settlements', whenHidden: true, run: async () => { await readSettlements(); await autoRefundIdle(); }, last: 0, busy: false },
  {
    // F5.9: public IP every poll.ip s while connected (and right after a session changes), once when idle.
    // The job itself is looked at every 5 s; it decides whether a check is due.
    name: 'ip', whenHidden: false, last: 0, busy: false,
    run: async () => {
      const off = !getSettings().thirdPartyChecks;
      setIpChecksOff(off);
      if (off) { if (snapshot().publicIp) patch({ publicIp: null }); return SKIPPED; }
      loadHomeIp();
      const s = snapshot();
      const sid = s.session?.id ?? null;
      const age = s.publicIp ? Date.now() - s.publicIp.at : Infinity;
      // Re-check 10 s into a session too: routes may still be settling at the first check.
      const settling = sid !== null && ipSettleCheck === sid && age >= 10_000;
      if (!settling && sid === ipForSession && (sid ? age < pollMs('ip') : s.publicIp !== null)) return SKIPPED;
      ipSettleCheck = settling ? null : sid;
      ipForSession = sid;
      // Proxy (V2Ray/Xray) sessions leave system traffic direct: measure the VPN exit
      // through the session's SOCKS endpoint, which is the IP sites see for proxied apps.
      // Android: every app is inside the tunnel (tun2socks); the probe socket measures it (D-A4).
      const socks = isAndroid() ? undefined : s.session?.proxyEndpoint || undefined;
      // Exclude split: never ask an IP service the split leaves out (it would answer with the user's own IP and the
      // screen would say the VPN is not used; the Linux app VM 2026-10-22). Platform export on every OS ([] when no exclude split).
      const avoid = sid && !socks ? splitExcludedRoutes(s.session?.service) : [];
      // Q0387: with a session shown, Android measures only through the tunnel; mid-redial that is no
      // answer ("checking…"), never the phone's own IP labelled "Sites see".
      // Also the direct exit for proxy sessions: apps that ignore the proxy leave by that IP. Started together
      // with the proxy check and NOT awaited before the first patch (Q0527, Mac KSM13: with the kill switch on,
      // the direct probe waits out its 6 s timeout, so `status`, whose IP check gets 2.5 s, said "Connected,
      // checking…" for every proxy session). The proxy answer alone decides proxy coverage (core/session/coverage).
      const directRead = socks
        ? publicIp(6000).catch((err: unknown) => { log.warn('direct IP check failed', { err: (err as Error).message }); return { error: (err as Error).message } as const; })
        : null;
      const r = await publicIp(6000, socks, avoid, { tunnelOnly: isAndroid() && sid !== null });
      const directIp = null as string | null;
      // Not connected: this is the user's own IP, the reference for "is traffic really going
      // through the VPN" (core/session/coverage). Kept on disk for sessions adopted at start.
      if (sid && 'ip' in r && r.ip !== snapshot().homeIp) lastVpnIp = r.ip;
      // Only once the app knows no session is running: an app started during a tunnel must
      // not take the node's IP for the user's own (VM proof 2026-10-22, WireGuard adopt).
      if (!sid && 'ip' in r && r.ip !== lastVpnIp && sessionsKnown() && !snapshot().session) saveHomeIp(r.ip);
      const nodeIp = s.session ? hostOf(findNode(s.session.node)?.uri ?? '') : null;
      patch({ publicIp: 'ip' in r ? { ip: r.ip, source: r.source, at: Date.now(), viaProxy: !!socks, directIp, sid, nodeIp } : null });
      if (!directRead || !('ip' in r)) return;
      const dr = await directRead;
      const now = snapshot().publicIp;
      // Only onto the same reading (a newer check or a session change wins).
      if ('ip' in dr && now && now.sid === sid && now.ip === r.ip) patch({ publicIp: { ...now, directIp: dr.ip } });
    },
  },
  {
    // A proxy session never touches system DNS, nor does a daemon set to dns = 'none'.
    name: 'dns', whenHidden: false, last: 0, busy: false, // two small file reads
    run: async () => {
      const d = getDaemonSettings().settings;
      patch({ dns: snapshot().session?.proxyEndpoint || d.dnsMode === 'none' ? 'System' : dnsLabel(d.dnsServers) });
    },
  },
  {
    // A session started elsewhere (the CLI, another window) while the app is open: without this
    // the screen kept "Connect" until the app restarted (found by the Android app Android grid A5, a5a6972).
    // Only while the app is idle — never during its own connect/disconnect — and one local
    // daemon call; a session the app already shows is followed by its own stream instead.
    name: 'session', whenHidden: false, last: 0, busy: false,
    run: async () => {
      const s = snapshot();
      // Q0351: the proxy can be turned off (or on again) outside the app; follow the live setting.
      if (s.session) {
        try {
          const live = await systemProxyLive();
          if (live !== s.proxyActive) patch({ proxyActive: live });
        } catch (err) {
          log.warn('reading the system proxy failed', { err: (err as Error).message });
        }
      }
      // Q0361/Q0366 (FAN fc10fc1): a shown session is checked against dvpnd's list; its stream can miss
      // the end, and the app stayed on Connected or Reconnecting after dvpnd gave up.
      if (s.session) return daemonInfo().reachable && await reconcileShownSession() ? undefined : SKIPPED;
      if (!daemonInfo().reachable || (s.conn.phase !== 'idle' && s.conn.phase !== 'error')) return SKIPPED;
      // startedElsewhere: its deposit stays open when it ends, as the CLI intends (reuse, the Android app F9.2).
      // Android: no system proxy (every protocol runs inside the VpnService).
      await adoptRunningSession({ applyProxy: !isAndroid(), startedElsewhere: true });
      // AND-34 KSM13 blk × ks-off, CLI arm: kill switch Off applied from ANOTHER process (the CLI) restarts the
      // service in ~2 s with no session here, so this app saw no transition and its blocked view stayed up for
      // good. While a blocked view is shown, every session poll asks again (it is taken down once the block is gone).
      const after = snapshot();
      if (!after.session && after.conn.phase === 'error' && after.conn.restoreNetwork) await checkLeftoverBlock();
    },
  },
  {
    name: 'rpc', whenHidden: false, last: 0, busy: false,
    run: async () => {
      const s = await getRpcState();
      // UI-169: a private endpoint over its limit is said once (Settings, Diagnostics), not silently worked around.
      patch({ rpc: { serving: s.serving ?? null, healthy: s.slot !== null, publicOnly: !!s.publicOnly, privateOverLimit: !!s.privateOverLimit, inUse: s.inUse ?? 'public', since: s.overLimitSince ?? null } });
    },
  },
];

const TICK_MS = 1000; // fine enough for the shortest cadence; each job keeps its own
let timer: NodeJS.Timeout | null = null;
let hidden = false;

/** A session started (new id): its deposit belongs in the list now, not at the next poll (Q0339). */
export function newSessionStarted(prev: string | null, next: string | null): boolean {
  return next !== null && next !== prev;
}
let settleForSession: string | null = null;
/** A session ended: its deposit is no longer "in use" and the Connect dialog must see it as reusable now. */
export function sessionEnded(prev: string | null, next: string | null): boolean {
  return prev !== null && next === null;
}

async function tick(): Promise<void> {
  const now = Date.now();
  // Q0339: connect, then open Activity: the new deposit (and its Top up) was missing for up to 60 s.
  const sid = snapshot().session?.id ?? null;
  if (newSessionStarted(settleForSession, sid) || sessionEnded(settleForSession, sid)) { const s = jobs.find((x) => x.name === 'settlements'); if (s) s.last = 0; }
  settleForSession = sid;
  // Row 145 (UI-SCREENS): a server check that has aged out (10 min) is redone within a minute while the window
  // is visible, and at most once a minute when the network read keeps failing.
  const recheck = recheckDue(now);
  if (recheck) { const n = jobs.find((x) => x.name === 'nodes'); if (n && !n.busy && now - n.last > 60_000) n.last = 0; }
  for (const j of jobs) {
    const every = everyMs(j);
    if (j.busy || now - j.last < every || (hidden && !j.whenHidden)) continue;
    if (j.name === 'nodes' && nodesAge() < every && !recheck) { j.last = now; continue; }
    j.busy = true;
    j.last = now;
    const started = Date.now();
    let error: string | undefined;
    let skipped = false;
    j.run()
      .then((v) => { skipped = v === SKIPPED; })
      .catch((err) => { error = (err as Error).message; log.warn(`scheduler: ${j.name} failed`, { err: error }); })
      .finally(() => {
        j.busy = false;
        if (skipped) return;
        const r: JobRun = { name: j.name, at: started, ms: Date.now() - started, ok: error === undefined, ...(error ? { error } : {}) };
        for (const fn of runListeners) fn(r);
      });
  }
}

export function startScheduler(): void {
  if (timer) return;
  // The screens show 'restarting' (not 'not answering… Install service' or 'sign out') while it restarts (Q0520/Q0521).
  const daemonView = (): void => patch({ daemon: { ...daemonInfo(), transition: serviceInTransition() } });
  onDaemonChange(daemonView);
  onTransitionBegan(daemonView);
  onTransitionSettled(daemonView);
  daemonView();
  timer = setInterval(() => void tick(), TICK_MS);
  void tick();
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export function setHidden(h: boolean): void {
  hidden = h;
}

/** Run named jobs now (after a transaction, on login). */
export function refreshNow(...names: string[]): void {
  for (const j of jobs) if (!names.length || names.includes(j.name)) j.last = 0;
  void tick();
}

/** Each job, its cadence now and whether it keeps running while the window is hidden. */
export function jobInfo(): Array<{ name: PollJob; everyMs: number; whenHidden: boolean; last: number }> {
  return jobs.map((j) => ({ name: j.name, everyMs: pollMs(j.name), whenHidden: j.whenHidden, last: j.last }));
}

/** Run one job now and wait for it (CLI "poll run"). */
export async function runJobNow(name: PollJob): Promise<JobRun> {
  const j = jobs.find((x) => x.name === name);
  if (!j) throw new Error(`No background job "${name}" (the session poll runs only during a session).`);
  const started = Date.now();
  try {
    await j.run();
    j.last = started;
    return { name, at: started, ms: Date.now() - started, ok: true };
  } catch (err) {
    return { name, at: started, ms: Date.now() - started, ok: false, error: (err as Error).message };
  }
}
