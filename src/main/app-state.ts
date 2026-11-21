// ─── One snapshot of everything the UI shows (F5: one owner for all state) ───
// Services mutate pieces through `patch`; every change is pushed through the host
// coalesced to one message per tick, so polls never cause render storms.
import { EVENTS } from '../shared/ipc';
import type { AppSnapshot } from '../shared/types';
import { reconnectingView, viewFor } from '../core/session/state';
import { coverageCopy, coverageOf, type CoverageScope } from '../core/session/coverage';
import { isAndroid } from '../shared/is-android';
import { splitGet } from './android/split-apps';
import { getHost } from './host';
import { agentAttached } from './services/agent-marker';
import { log } from './logger';
import { tr } from '../shared/i18n';

const state: AppSnapshot = {
  hasWallet: false,
  owner: null,
  signerKind: null,
  wallet: null,
  daemon: { reachable: false, bridge: 'stopped', version: null, networkOk: null, error: null, home: null, device: null },
  conn: viewFor('idle'),
  session: null,
  settlements: [],
  subscriptions: [],
  rpc: { serving: null, healthy: false, publicOnly: true },
  lastCloseMessage: null,
  lastConnectError: null,
  proxyActive: false,
  publicIp: null,
  homeIp: null,
  coverage: null,
  dns: null,
};

let pending = false;

export function snapshot(): AppSnapshot {
  return state;
}

/** The server test's progress for the status card (written only by main/services/node-test.ts; null = no run). */
export function setNodeTestProgress(v: { done: number; total: number; server: string } | null): void {
  const was = state.nodeTest ?? null;
  if (was === v || (was && v && was.done === v.done && was.total === v.total && was.server === v.server)) return;
  patch({ nodeTest: v });
}

let ipChecksOff = false;
let splitInEffect: 'include' | 'exclude' | null = null;
/** Split tunnelling dvpnd applies to the live session (set at connect/adopt, cleared at the end). */
export function setSplitInEffect(mode: 'include' | 'exclude' | null): void {
  splitInEffect = mode;
}
let wholeDeviceInEffect = false;
/** The live V2Ray/Xray session runs whole-device (TUN): every app is in it, system proxy or not. */
export function setWholeDeviceInEffect(on: boolean): void {
  wholeDeviceInEffect = on;
}
// ─── Following a reconnect onto a new session (DIR/FWX 10-30, FLX2 wg lift) ───
// dvpnd brought the session back as a new one: it shows "Reconnecting" until its first IP check
// settles what it covers (or REDIAL_HOLD_MS), never a green "Protected" before that, never a timer reset.
const REDIAL_HOLD_MS = 30_000;
let redial: { id: string; since: number; held: boolean } | null = null;
export function setRedialFollow(id: string | null): void {
  redial = id ? { id, since: Date.now(), held: false } : null;
}
/** The IP job tells us when third-party IP checks are off: "connected" can then not be confirmed. */
export function setIpChecksOff(off: boolean): void {
  ipChecksOff = off;
}

// Android applies the per-app / per-address split when a session starts, so it is read once per session.
// Empty on the desktop: there the split is the dvpnd split flag (splitInEffect).
let splitFor: { sid: string; split: CoverageScope['split'] } | null = null;
let splitFetching = '';
function sessionScope(sid: string): CoverageScope {
  if (!isAndroid()) return {};
  if (splitFor?.sid !== sid && splitFetching !== sid) {
    splitFetching = sid;
    splitGet()
      .then((sp) => { splitFor = { sid, split: { mode: sp.mode, count: sp.packages.length, routeMode: sp.routeMode, routeCount: sp.routes.length } }; patch({}); })
      .catch((err: unknown) => { console.warn('[app-state] split read failed', err); splitFor = { sid, split: null }; });
  }
  return { place: 'this phone', split: splitFor?.sid === sid ? splitFor.split : null };
}

/**
 * A connected session is titled by what it really covers (core/session/coverage), never just
 * "Protected": every screen, the tray and the CLI read conn.title. Only an IP measured during
 * THIS session counts (an IP from before the connect is the user's own).
 */
function deriveCoverage(): void {
  const s = state;
  const following = redial !== null && redial.id === s.session?.id;
  // our own "Reconnecting" hold reads as connected underneath (dvpnd says connected; patch() clears held on dvpnd's word)
  const connected = s.conn.phase === 'connected' || (following && redial!.held && s.conn.phase === 'reconnecting');
  if (!s.session || !connected) { s.coverage = null; return; }
  const ip = s.publicIp && s.publicIp.sid === s.session.id ? s.publicIp : null;
  const directIp = ip ? (ip.viaProxy ? ip.directIp ?? null : ip.ip) : null;
  // Android: V2Ray/Xray/Hysteria2 carry every app through tun2socks, so the session covers the whole
  // phone like WireGuard; their SOCKS inbound is internal there. Android's app/address split is a scope.
  const c = coverageOf({ proxyEndpoint: isAndroid() ? '' : s.session.proxyEndpoint, proxyActive: s.proxyActive, directIp, proxyIp: ip?.viaProxy ? ip.ip : null, homeIp: s.homeIp, nodeIp: ip?.nodeIp ?? null, split: splitInEffect, wholeDevice: wholeDeviceInEffect });
  if (following) {
    if (c === 'unchecked' && !ipChecksOff && Date.now() - redial!.since < REDIAL_HOLD_MS) {
      redial!.held = true;
      s.coverage = null;
      s.conn = viewFor('reconnecting', tr('Back on the server; checking the connection.'));
      return;
    }
    if (redial!.held) s.conn = viewFor('connected'); // our hold was the view: back to what dvpnd says
    redial = null; // measured (or the hold ran out): the session's own title from here on
  }
  const copy = coverageCopy(c, { vpnIp: ip?.ip ?? null, homeIp: s.homeIp, checksOff: ipChecksOff, scope: sessionScope(s.session.id) });
  s.coverage = c;
  s.conn = { ...s.conn, title: copy.title, detail: copy.detail };
}

// Whether the saved kill switch is off (set by the connection service, which reads dvpnd's config):
// the Reconnecting title claims a block only when one is there.
let killSwitchOff: () => boolean = () => false;
export function setKillSwitchOffCheck(fn: () => boolean): void { killSwitchOff = fn; }

// Q0523 screen journal: the log says what the screen showed, so an owner report is a timeline, not a guess
// (owner laptop 2026-11-11: the red banner had to be inferred from 'offering Restore network').
let lastScreen = '';
function journalScreen(): void {
  const c = state.conn;
  const view = { phase: c?.phase ?? null, title: c?.title ?? null, detail: (c?.detail ?? '').slice(0, 120) || null, restoreNetwork: !!c?.restoreNetwork, closeMessage: state.lastCloseMessage?.message ?? null, service: state.daemon ? (state.daemon.transition ? 'restarting' : state.daemon.reachable ? 'up' : 'down') : null };
  const key = JSON.stringify(view);
  if (key === lastScreen) return;
  lastScreen = key;
  // Q0541: the app and the CLI write the same app.log; the pid tells whose screen a line is.
  log.info('screen', { ...view, pid: process.pid });
}

// CODE-AUDIT L-15: whether `agent up` holds the live session. The marker is a small file; it is read when the
// session changes and at most every AGENT_READ_MS otherwise (patch runs on every traffic update).
const AGENT_READ_MS = 3000;
let agentRead = { sid: '' as string | null, at: 0 };
function deriveAgent(): void {
  const live = state.session ? { id: state.session.id, node: state.session.node } : null;
  const sid = live?.id ?? null;
  if (sid === agentRead.sid && Date.now() - agentRead.at < AGENT_READ_MS) return;
  agentRead = { sid, at: Date.now() };
  const attached = agentAttached(live);
  if ((state.agent?.attached ?? false) !== attached) state.agent = { attached };
}

export function patch(p: Partial<AppSnapshot>): void {
  if (p.conn?.phase === 'reconnecting') p = { ...p, conn: reconnectingView(p.conn, killSwitchOff()) };
  Object.assign(state, p);
  deriveAgent();
  if (p.conn || 'lastCloseMessage' in p || p.daemon) journalScreen();
  if (p.conn && redial) redial.held = false; // a view from dvpnd replaces our hold; deriveCoverage holds again if still unchecked
  if (!state.session) redial = null;
  deriveCoverage();
  if (pending) return;
  pending = true;
  setImmediate(() => {
    pending = false;
    getHost().emit(EVENTS.STATE, state);
  });
}

export function broadcast(channel: string, payload: unknown): void {
  getHost().emit(channel, payload);
}

export function toast(kind: 'info' | 'success' | 'warn' | 'error', message: string): void {
  log.info('screen toast', { kind, message: message.slice(0, 160) });
  broadcast(EVENTS.TOAST, { kind, message, at: Date.now() });
}
