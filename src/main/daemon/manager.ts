// ─── Daemon manager (D1, D5, F1, F4.5) — Linux ───
// The app runs as the desktop user; sentinel-dvpnd runs as root under systemd as the cb33 template
// instance `sentinel-dvpnd@c0` (unit + socket written by `sentinel-dvpnd service install`). systemd
// owns the control socket <home>/daemon.sock (0660, group sentinel-dvpn); setup adds the user to that
// group (plus an ACL for this login), so the app dials the socket directly. cb33 keeps the instance
// folder 0750 and everything in it 0600/0700 (doctor flags anything looser), so the app reads a
// root-refreshed copy of config.toml and the device address next to the folder, never inside it.
// No bridge process: the link is a health probe that re-attaches when the socket comes back.
import { parseUnitsShow, unitPair, type UnitPair } from '../../core/daemon/linux-unit';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DaemonClient, DaemonError, pipeTarget, type DaemonVersion } from '../../core/daemon/client';
import { MINT, PROGRAM_ID } from '../../core/chain/idl';
import type { DaemonInfo } from '../../shared/types';
import { readJson, writeJson } from '../store';
import { runElevated, insideAppImage, stageForRoot, type ElevatedResult } from '../system/elevate';
import { log } from '../logger';
import { getHost } from '../host';
import {
  linkFault, OS_STATE_UNKNOWN, retryDelayMs, serviceView, serviceViewFor,
  type LinkFault, type OsServiceState, type ServiceFacts, type ServiceView,
} from '../../core/daemon/service-state';
import { carrySettingsInto, patchToml } from '../../core/daemon/config';
import { DAEMON_GROUP, SOCKET_FILE, daemonBinaryName, doctorArgs, initArgs, instanceDir, keyListArgs, legacyHome, operatorKey, serviceName } from '../../core/daemon/layout';
import { levelFromSeverity, type CheckLevel } from '../../shared/check-level';

/** The cb33 client instance folder (c0). */
export const DEFAULT_DAEMON_HOME = process.env.DVPN_DAEMON_HOME || instanceDir('linux');
/** The pre-cb33 home (config.toml + client/config.toml), migrated once into c0. */
export const LEGACY_DAEMON_HOME = legacyHome('linux');
/** The group systemd gives the control socket; setup adds the desktop user to it. */
export const SOCKET_GROUP = DAEMON_GROUP;
/** The systemd template instance `sentinel-dvpnd service install` sets up. */
export const SERVICE_NAME = serviceName('linux');
/** The unit the pre-cb33 builds wrote (removed by the migration). */
export const LEGACY_SERVICE_NAME = 'dvpnd-client';

/** Next to the instance folder: <state root>/<tag>.<name> (outside the folder cb33 keeps 0600/0700). */
const besideHome = (home: string, name: string): string => path.join(path.dirname(home), `${path.basename(home)}.${name}`);
/** The app-readable copy of <home>/config.toml (root:sentinel-dvpn 0640 + the user's read ACL), refreshed by every root step. */
export const configMirrorPath = (home: string): string => besideHome(home, 'config.toml');
const DEVICE_FILE = 'device.json';
const HEALTH_MS = 15_000;

// ─── Paths ───
export function resourcesDir(): string {
  return getHost().resourcesDir;
}
export const binPath = (name: string): string => path.join(resourcesDir(), 'bin', name);
export const scriptPath = (name: string): string => path.join(resourcesDir(), 'scripts', name);
export const protoPath = (): string => path.join(resourcesDir(), 'daemon.proto');
/** An installed build: resources under /opt/ (deb, rpm) or inside an AppImage mount (/tmp/.mount_<id>/). Exported for tests. */
export function packagedBuild(res: string = resourcesDir()): boolean {
  return /^\/opt\//.test(res) || /\/\.mount_[^/]+(\/|$)/.test(res);
}
/**
 * The dvpnd binary. DVPND_BIN is a dev/test override only (port of the macOS app 14691cfd1): setup-daemon.sh installs this
 * binary as the root service, so in an installed build an env var must never choose it. Exported for tests.
 */
export function dvpndPathFor(env: NodeJS.ProcessEnv, res: string, exists: (p: string) => boolean = fs.existsSync): string {
  const bundled = path.join(res, 'bin', daemonBinaryName('linux'));
  if (!env.DVPND_BIN) return bundled;
  if (packagedBuild(res)) { log.warn('DVPND_BIN is ignored in an installed build', { bin: env.DVPND_BIN }); return bundled; }
  return exists(env.DVPND_BIN) ? env.DVPND_BIN : bundled;
}
export function dvpndPath(): string {
  return dvpndPathFor(process.env, resourcesDir());
}

// dvpnd finds V2Ray/Xray/Hysteria2 only on PATH (go-sdk service.LookPath). Each lives in its own
// folder because V2Ray and Xray ship different geoip/geosite files under the same names. The
// service gets these on its own PATH (systemd Environment=, setup-daemon.sh); the doctor too.
export const PROTOCOL_BIN_DIRS = ['v2ray', 'xray', 'hysteria2'];
export const protocolBinDirs = (): string[] => PROTOCOL_BIN_DIRS.map((d) => binPath(d)).filter((d) => fs.existsSync(d));
const withProtocolPath = (): NodeJS.ProcessEnv => {
  const extra = protocolBinDirs();
  return extra.length ? { ...process.env, PATH: [process.env.PATH ?? '', ...extra].join(path.delimiter) } : process.env;
};

interface DeviceRecord { device: string; home: string; owner: string; at: number }

// ─── State ───
let client: DaemonClient | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let healthTimer: NodeJS.Timeout | null = null;
/** Failed link attempts in a row; decides the wait before the next one (core/daemon/service-state retryDelayMs). */
let attempts = 0;
let stopping = false;
const info: DaemonInfo = { reachable: false, bridge: 'stopped', version: null, networkOk: null, error: null, home: null, device: null };
const listeners = new Set<() => void>();

export const onDaemonChange = (fn: () => void): (() => void) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (): void => { for (const l of listeners) l(); };

export function daemonInfo(): DaemonInfo {
  const d = readJson<DeviceRecord | null>(DEVICE_FILE, null);
  return { ...info, home: d?.home ?? null, device: d?.device ?? null, service: serviceNow() };
}

export function deviceRecord(): DeviceRecord | null {
  return readJson<DeviceRecord | null>(DEVICE_FILE, null);
}

/** The connected gRPC client, or a clear error the UI can show. */
export function daemon(): DaemonClient {
  if (!client || !info.reachable) {
    const said = serviceNow().sentence || serviceView('stopped').sentence;
    throw new DaemonError(Object.assign(new Error(said), { code: 14, details: said }) as Error, 'daemon');
  }
  return client;
}

// ─── Service state (the Windows app UI pass rows 119-142, port of 490af3e / baff369 / 26ce11f / 18a8c1f / 4f9b697) ───
// The facts behind the one sentence: how the last link attempt failed, what systemd says about the unit,
// and when it was last started. The sentence itself comes from core/daemon/service-state.ts.
let lastFault: LinkFault = 'unknown';
let osState: OsServiceState = { ...OS_STATE_UNKNOWN };
let startedAt: number | null = null;
let transitionProbe: () => boolean = () => false;
/** services/service-transition.ts tells the link whether a restart is in progress (it imports this module). */
export function setTransitionProbe(fn: () => boolean): void { transitionProbe = fn; }

export function serviceFacts(): ServiceFacts {
  let transition = false;
  try { transition = transitionProbe(); } catch (err) { log.warn('service state: the restart check failed', { err: (err as Error).message }); }
  return {
    answered: info.reachable, networkOk: info.networkOk, transition,
    installed: osState.installed, running: osState.running, startPending: osState.startPending,
    link: info.reachable ? 'none' : lastFault,
    startedAgoMs: startedAt === null ? null : Date.now() - startedAt,
  };
}

/** The service's state now: one title, one sentence, one action. */
export function serviceNow(): ServiceView { return serviceViewFor(serviceFacts()); }

/** The service was just asked to start (this app, an install, a grant): link failures inside the grace read "starting". */
export function noteServiceStarting(): void { startedAt = Date.now(); }

const setError = (): void => { info.error = serviceNow().sentence || null; };

/** `systemctl show <unit> -p LoadState -p ActiveState` -> the OS facts (no root). Anything else = unknown. Pure, for tests. */
export function parseSystemctlShow(stdout: string): OsServiceState {
  const v = (k: string): string | null => {
    const m = new RegExp(`^${k}=(.*)$`, 'm').exec(String(stdout ?? ''));
    return m ? m[1].trim() : null;
  };
  const load = v('LoadState');
  const active = v('ActiveState');
  if (load === null || active === null) return { ...OS_STATE_UNKNOWN };
  if (load === 'not-found') return { installed: false, running: false, startPending: false };
  if (load !== 'loaded') return { ...OS_STATE_UNKNOWN };
  return { installed: true, running: active === 'active' || active === 'reloading', startPending: active === 'activating' };
}

// ─── the agent kit T-C rows 16/17 (RC8 W47): the service AND its socket, for status/up/doctor (no root) ───
export const NO_UNITS: UnitPair = { installed: null, serviceActive: false, socketActive: false };
/** `systemctl show <svc> <sock>` -> the pair. A test daemon (DVPN_DAEMON_TARGET / DVPN_DAEMON_SOCKET) is not the unit. */
export function linuxUnits(): Promise<UnitPair> {
  if (process.platform !== 'linux' || process.env.DVPN_DAEMON_TARGET || process.env.DVPN_DAEMON_SOCKET) return Promise.resolve({ ...NO_UNITS });
  return new Promise((resolve) => {
    execFile('systemctl', ['show', `${SERVICE_NAME}.service`, `${SERVICE_NAME}.socket`, '-p', 'Id', '-p', 'LoadState', '-p', 'ActiveState'], { timeout: 10_000 }, (err, stdout) => {
      if (err) log.debug('systemctl show (service + socket) failed', { err: err.message });
      resolve(unitPair(parseUnitsShow(String(stdout)), SERVICE_NAME));
    });
  });
}

let osBusy = false;
/** Ask systemd about the unit. A test daemon (DVPN_DAEMON_TARGET / DVPN_DAEMON_SOCKET) is not the unit: unknown. */
async function refreshOsState(): Promise<void> {
  if (osBusy || process.env.DVPN_DAEMON_TARGET || process.env.DVPN_DAEMON_SOCKET) return;
  osBusy = true;
  try {
    const out = await new Promise<string>((resolve) => {
      execFile('systemctl', ['show', SERVICE_NAME, '-p', 'LoadState', '-p', 'ActiveState'], { timeout: 10_000 }, (err, stdout) => {
        if (err) log.debug('systemctl show failed', { err: err.message });
        resolve(String(stdout));
      });
    });
    osState = parseSystemctlShow(out);
  } finally {
    osBusy = false;
  }
}

/** Row 139: the same failure every second is one log line, then one a minute, kept per kind of failure.
 *  A service that is not installed, off, starting or restarting is not a fault of the link: one info line. */
const lastLogged = new Map<string, number>();
function logLinkFailure(what: string, raw: string): void {
  const state = serviceNow().state;
  const key = `${what}:${linkFault(raw)}:${state}`;
  const t = Date.now();
  if (t - (lastLogged.get(key) ?? 0) < 60_000) return;
  lastLogged.set(key, t);
  if (lastLogged.size > 64) for (const [k, at] of lastLogged) if (t - at > 60_000) lastLogged.delete(k);
  const expected = state === 'not-installed' || state === 'stopped' || state === 'starting' || state === 'restarting';
  log[expected ? 'info' : 'warn'](what, { err: raw.slice(0, 1500), state, attempts });
}

/** A link attempt failed: record how, say the state at once, then ask systemd and say it again if that changed it. */
function linkFailed(raw: string): void {
  lastFault = linkFault(raw);
  info.reachable = false;
  setError();
  void refreshOsState().then(() => {
    if (info.reachable) return;
    const before = info.error;
    setError();
    if (info.error !== before) emit();
    autoStart();
  }).catch((err) => log.warn('could not ask systemd about the VPN service', { err: (err as Error).message }));
}

// ─── The app starts a stopped service by itself (rows 120, 125) ───
// Once per stop: a service that will not stay up is not started in a loop (it refuses to start until the device
// has a spending permission), and the "off" sentence with its Start button shows instead.
let autoStarted = false;
/** An install or reinstall of the service is running (its root step): nothing else starts the service meanwhile. */
let installing = 0;
export const serviceInstallRunning = (): boolean => installing > 0;
function autoStart(): void {
  if (autoStarted || stopping || installing > 0 || !watching || serviceNow().state !== 'stopped') return;
  autoStarted = true;
  log.info('the VPN service is installed but stopped; starting it');
  void startServiceIfStopped().then((r) => {
    log.info('automatic service start', { result: r });
    if (r === 'started' || r === 'running') { setError(); emit(); }
  }).catch((err) => log.warn('automatic service start failed', { err: (err as Error).message }));
}

// ─── Retry speed (row 121) ───
// Someone is looking at the app or waiting on a button: try the link every second. Otherwise back off.
let watching = false;
let watchers = 0;
/** The window is visible (true) or hidden/minimised to the tray (false). */
export function setLinkWatching(v: boolean): void {
  const was = watching || watchers > 0;
  watching = v;
  if (v && !was) retryNow();
}
/** Run `fn` with the fast retry on (Connect, Restore network, Diagnostics waiting for the service). */
export async function withLinkWatch<T>(fn: () => Promise<T>): Promise<T> {
  watchers += 1;
  if (watchers === 1 && !watching) retryNow();
  try { return await fn(); } finally { watchers -= 1; }
}
const nextDelay = (): number => retryDelayMs(attempts, watching || watchers > 0);

/** Tests only. */
export function resetLinkState(): void {
  attempts = 0; lastFault = 'unknown'; osState = { ...OS_STATE_UNKNOWN }; startedAt = null;
  autoStarted = false; watching = false; watchers = 0; lastLogged.clear();
  transitionProbe = () => false;
}

/** A button was pressed that needs the service: a waiting retry runs now. */
export function retryNow(): void {
  if (stopping || info.reachable || !retryTimer) return;
  clearTimeout(retryTimer);
  retryTimer = null;
  startDaemonLink();
}

// ─── Link lifecycle ───
/** DVPN_DAEMON_SOCKET overrides the control socket (a foreground test daemon). */
export const daemonSocket = (): string =>
  process.env.DVPN_DAEMON_SOCKET || path.join(deviceRecord()?.home ?? DEFAULT_DAEMON_HOME, SOCKET_FILE);

/** Resolves once the first attach attempt finished (success or not). */
let firstAttach: Promise<void> = Promise.resolve();
let resolveFirst: (() => void) | null = null;
export const daemonReady = (timeoutMs = 10_000): Promise<void> => Promise.race([firstAttach, new Promise<void>((r) => setTimeout(r, timeoutMs).unref())]);

const settleFirst = (): void => { if (resolveFirst) { resolveFirst(); resolveFirst = null; } };

export function startDaemonLink(): void {
  stopping = false;
  firstAttach = new Promise((r) => { resolveFirst = r; });
  // DVPN_DAEMON_TARGET=host:port — a TCP-bridged daemon (netns test rig). Test/dev only.
  if (process.env.DVPN_DAEMON_TARGET) {
    info.bridge = 'running';
    void attach(process.env.DVPN_DAEMON_TARGET);
    return;
  }
  const sock = daemonSocket();
  if (!fs.existsSync(sock)) {
    info.bridge = 'missing';
    const raw = `connect ENOENT ${sock}`;
    linkFailed(raw);
    logLinkFailure('daemon socket missing', raw);
    emit();
    settleFirst();
    scheduleRetry();
    return;
  }
  info.bridge = 'running';
  void attach(pipeTarget(sock));
}

/** True from the moment the app closes its own link (quit): a link going down then is not a service restart. */
export function linkStopping(): boolean { return stopping; }

function scheduleRetry(): void {
  if (retryTimer || stopping) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    startDaemonLink();
  }, nextDelay());
  retryTimer.unref(); // the CLI must be able to exit while the service is down
  attempts += 1;
}

/** While attached, re-check every 15 s: a restarted service gets a new socket, a stopped one none. */
function startHealth(): void {
  if (healthTimer) return;
  healthTimer = setInterval(() => {
    const c = client;
    if (!c || stopping) return;
    c.getVersion().catch((err: Error) => {
      if (client !== c) return;
      log.warn('daemon stopped answering', { err: err.message });
      detach();
      info.bridge = 'stopped';
      linkFailed(err.message);
      emit();
      scheduleRetry();
    });
  }, HEALTH_MS);
  healthTimer.unref();
}

async function attach(target: string): Promise<void> {
  detach();
  client = new DaemonClient(target, protoPath());
  try {
    const v = await client.getVersion();
    info.reachable = true;
    info.version = v.tag || v.commit || 'unknown';
    info.networkOk = networkMatches(v);
    lastFault = 'none';
    osState = { installed: true, running: true, startPending: false };
    setError();
    attempts = 0;
    autoStarted = false;
    lastLogged.clear();
    log.info('daemon attached', { version: info.version, network: v.network, networkOk: info.networkOk });
    startHealth();
  } catch (err) {
    info.bridge = 'error';
    linkFailed((err as Error).message);
    logLinkFailure('daemon attach failed', (err as Error).message);
    // Service did not answer (slow start): retry; the wait follows retryDelayMs (row 121).
    scheduleRetry();
  }
  emit();
  settleFirst();
}

export function networkMatches(v: Pick<DaemonVersion, 'programId' | 'mint'>): boolean {
  return v.programId === PROGRAM_ID.toBase58() && v.mint === MINT.toBase58();
}

function detach(): void {
  if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
  if (client) {
    client.close();
    client = null;
  }
  info.reachable = false;
}

export function stopDaemonLink(): void {
  stopping = true;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  detach();
  info.bridge = 'stopped';
}

/** Agent M Mac T3 r6 (the Windows app 1b591b0): during a service restart the backoff left the app unattached up to ~4 s after
 *  the service was ready. The transition guard calls this each second while the link is down: a WAITING retry
 *  runs now (one already in flight is left alone). the Windows app 3af3c39: a link that still reads up is asked again now. */
let verifying = false;
export function reattachSoon(): void {
  if (stopping) return;
  if (info.reachable) {
    const c = client;
    if (!c || verifying) return;
    verifying = true;
    c.getVersion().then(
      () => { verifying = false; },
      (err: Error) => {
        verifying = false;
        if (client !== c || !info.reachable || stopping) return;
        log.warn('daemon did not answer during a service transition', { err: err.message });
        detach();
        info.bridge = 'stopped';
        linkFailed(err.message);
        emit();
        scheduleRetry();
      },
    );
    return;
  }
  retryNow();
}

// ─── Service copies vs this app (the Windows app 470bac7) ───
/** Where setup-daemon.sh puts the root-owned copies the service runs (root:root, go-w: readable by everyone). */
export const SERVICE_LIB = '/usr/local/lib/devnet-dvpn';
const sha256 = (file: string): string => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sameFile = (a: string, b: string): boolean => {
  const sa = fs.statSync(a);
  const sb = fs.statSync(b);
  return sa.size === sb.size && sha256(a) === sha256(b);
};
/** Pairs of [name, this app's copy, the service's copy]: dvpnd, each protocol's program (its data files only by
 *  size) and the host firewall script the unit runs. Missing on this app's side = not shipped here, skipped. */
export function serviceCopyPairs(bin: string, scripts: string, lib = SERVICE_LIB): Array<[string, string, string, boolean]> {
  const pairs: Array<[string, string, string, boolean]> = [
    ['sentinel-dvpnd', path.join(bin, daemonBinaryName('linux')), path.join(lib, 'sentinel-dvpnd'), true],
    ['host-firewall.sh', path.join(scripts, 'host-firewall.sh'), path.join(lib, 'host-firewall.sh'), true],
  ];
  for (const d of PROTOCOL_BIN_DIRS) {
    const dir = path.join(bin, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) pairs.push([`${d}/${f}`, path.join(dir, f), path.join(lib, d, f), f === d]);
  }
  return pairs;
}
/** The service files that differ from this app's copies (empty = up to date, or no service installed).
 *  deb / rpm / pacman: the postinst copies dvpnd, the protocols and host-firewall.sh into SERVICE_LIB and rewrites
 *  the units on every upgrade (after-install.sh, 1f3d6e4f), so this is empty there. An AppImage has no postinst:
 *  a new AppImage updates only the app, and the service keeps the copies from its last "Install service" (the
 *  Mac dmg drag-over case). The root scripts themselves run from the app (dvpn-helper), never from SERVICE_LIB. */
export function serviceStaleNames(bin = path.dirname(binPath('x')), scripts = path.dirname(scriptPath('x')), lib = SERVICE_LIB): string[] {
  if (process.env.DVPND_BIN || !fs.existsSync(path.join(lib, 'sentinel-dvpnd'))) return [];
  const stale: string[] = [];
  for (const [name, mine, theirs, hash] of serviceCopyPairs(bin, scripts, lib)) {
    if (!fs.existsSync(mine)) continue;
    if (!fs.existsSync(theirs)) { stale.push(name); continue; }
    const same = hash ? sameFile(mine, theirs) : fs.statSync(mine).size === fs.statSync(theirs).size;
    if (!same) stale.push(name);
  }
  return stale;
}

/** Re-probe now (after setup or a settings restart). */
export function relinkDaemon(): void {
  attempts = 0;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  stopping = false;
  startDaemonLink();
}

// ─── Doctor (F1.6) ───
// dvpnd reports advisories as OK=true with a Detail (e.g. a protocol binary missing): that is a warning.
export interface DoctorCheck { name: string; ok: boolean; level: CheckLevel; detail: string }
/** dvpnd's real advisories (OK=true + Detail): a protocol program or adapter missing, plan delegate. */
const ADVISORY = /^(service_|delegate$)/;

/**
 * `dvpnd doctor` runs as the desktop user, who by design cannot read the device key
 * (root 0700) or the service's database. When the service is up and answering it has
 * already loaded both, so those two denials are not failures (exported for tests).
 * Same for DNS mode resolvconf (no systemd-resolved, EL9): the user cannot write
 * /etc/resolv.conf, the root service can.
 */
export function doctorForUser(rows: DoctorCheck[], serviceAnswers: boolean, isRoot: boolean): DoctorCheck[] {
  if (isRoot || !serviceAnswers) return rows;
  const denied = /permission denied|unable to open database/i;
  return rows.map((r) => {
    // Q0547 on Linux (hunt 11-13, also alice/zoe 11-12): cb33 keeps <home>/config.toml root:root 0600, so a user's
    // `sentinel-dvpnd doctor` stops at loading it ("finding instance: stat …" / "reading …: permission denied")
    // before any check, and 6.10's per-check skips never run. The service that answers loaded it as root.
    if (r.name === 'doctor' && /config\.toml: permission denied/i.test(r.detail)) {
      return { name: 'service_checks', ok: true, level: 'skip', detail: 'run by the service itself (its settings are readable by root only); it is running, so they passed' };
    }
    if (['key', 'kill_switch'].includes(r.name) && denied.test(r.detail)) {
      // Q0547: not checked here (root only), so neither a tick nor a cross
      return { ...r, ok: true, level: 'skip', detail: 'held by the running service (readable by root only)' };
    }
    if (r.name === 'dns_backend' && /resolvconf.*resolv\.conf is not writable.*permission denied/i.test(r.detail)) {
      return { ...r, ok: true, level: 'skip', detail: 'resolvconf: the running service (root) writes /etc/resolv.conf during a session' };
    }
    return r;
  });
}

export async function runDoctor(home = deviceRecord()?.home ?? DEFAULT_DAEMON_HOME): Promise<DoctorCheck[]> {
  const rows = await rawDoctor(home);
  let answers = false;
  try {
    await daemon().getVersion();
    answers = true;
  } catch (err) {
    log.debug('doctor: service not answering', { err: (err as Error).message });
  }
  return doctorForUser(rows, answers, process.getuid?.() === 0);
}

/**
 * `dvpnd doctor` JSON rows. cf4c372 prints `name/ok/detail`; dfe36c7 printed `Name/OK/Detail`
 * (a v1 binary may still be on disk until the service is set up again). Exported for tests.
 */
export function parseDoctorRows(json: string): DoctorCheck[] {
  const rows = JSON.parse(json) as Array<Record<string, unknown>>;
  if (!Array.isArray(rows)) throw new Error('doctor output is not a list'); // copy:internal
  // Same row rules as the Windows app (shared doctor-parse test): cb33's severity decides; only the grant row is reworded.
  return rows.map((r) => {
    const ok = (r.ok ?? r.OK) === true;
    const name = String(r.name ?? r.Name ?? '?');
    let detail = String(r.detail ?? r.Detail ?? '');
    if (name === 'grant' && !ok) {
      log.info('doctor: device has no spending permission', { detail: detail.slice(0, 300) });
      detail = 'This computer has no spending limit yet. Set one: Wallet → Set spending limit, or devnet-dvpn device setup --yes.';
    }
    // "nothing held" is the normal kill-switch state, not a warning (the Windows app 09bcc19).
    if (name === 'kill_switch' && ok && /no persisted kill switch/i.test(detail)) detail = 'Nothing held: internet is not blocked.';
    // cb33 rows carry a severity (ok = severity != "error"): it decides, for every row.
    const sev = typeof r.severity === 'string' ? r.severity.toLowerCase() : null;
    // Q0547: 'skip' = needs the service's rights, checked by the service at its start (grey, never ✓ or ✗);
    // an unknown severity is a warning, never a silent green.
    if (sev) return { name, ok, level: levelFromSeverity(sev, ok), detail };
    // Pre-cb33 daemons: no severity.
    if (name === 'kill_switch' && ok) return { name, ok, level: /unpinned|unusable|leftover/i.test(detail) ? 'warn' : 'ok', detail };
    return { name, ok, level: !ok ? 'fail' : detail && ADVISORY.test(name) ? 'warn' : 'ok', detail };
  });
}

function rawDoctor(home: string): Promise<DoctorCheck[]> {
  return new Promise((resolve) => {
    const exe = dvpndPath();
    if (!fs.existsSync(exe)) { resolve([{ name: 'binary', ok: false, level: 'fail', detail: 'The VPN service program is not installed with this app.' }]); return; }
    execFile(exe, doctorArgs(home), { timeout: 60_000, env: withProtocolPath() }, (err, stdout, stderr) => {
      const text = String(stdout);
      const start = text.indexOf('[');
      if (start >= 0) {
        try {
          resolve(parseDoctorRows(text.slice(start)));
          return;
        } catch (parseErr) {
          log.warn('doctor output not JSON', { err: (parseErr as Error).message });
        }
      }
      resolve([{ name: 'doctor', ok: false, level: 'fail', detail: (err?.message ?? String(stderr)).slice(0, 300) }]);
    });
  });
}

// ─── First-run setup (F1.5) ───
// dvpnd will not start until its device key holds a grant, so setup is:
//   1. initDevice   — `dvpnd init` as the user into <data>/daemon-staging → device address
//   2. (owner signs device setup: delegate + grant + SOL — services/wallet.deviceSetup)
//   3. installService — ONE administrator prompt (pkexec): copy into /var/lib/sentinel-dvpn/c0, lock
//      keys, add the user to the sentinel-dvpn group, `sentinel-dvpnd service install`, start it.
//      An upgrade from a pre-cb33 home goes the same way with the old device key moved in.
export function stagingHome(): string {
  return path.join(getHost().dataDir, 'daemon-staging');
}

// ─── Wallet switch (rc.4 E-55) ───
// A switch to another wallet used to write device.json and the staging home FIRST, so any refusal after it
// (too little SOL, setup or install failing) left this computer recorded for the new wallet: the first
// wallet's deposits went unlisted and the next switch back stopped on "a half-finished setup". Now the new
// key is made in its own scratch folder, device.json and the staging home are never touched before the
// setup has landed AND the service runs the new key, and a failure leaves them byte-identical.
export function switchHome(): string {
  return path.join(getHost().dataDir, 'daemon-switch');
}
const SWITCH_FILE = 'switch.json';
interface SwitchRecord { device: string; owner: string; at: number }

/** The switch waiting in the scratch folder (its key may already hold a grant and fee SOL), or null. */
export function pendingSwitch(): SwitchRecord | null {
  try {
    const p = path.join(switchHome(), SWITCH_FILE);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) as SwitchRecord : null;
  } catch (err) {
    log.warn('unreadable wallet-switch record', { err: (err as Error).message });
    return null;
  }
}

/** A device key for `owner` in the scratch folder (reused when one is already there for it). Writes nothing else. */
export function stageSwitchDevice(owner: string): Promise<{ ok: boolean; device?: string; error?: string }> {
  const have = pendingSwitch();
  if (have && have.owner === owner) return Promise.resolve({ ok: true, device: have.device });
  if (have) return Promise.resolve({ ok: false, error: `A switch to another wallet (${have.owner.slice(0, 4)}…${have.owner.slice(-4)}) was started and not finished. Load that wallet to finish it, or remove the half-finished setup (Diagnostics, or: devnet-dvpn device discard-setup --yes). Nothing was paid.` });
  const exe = dvpndPath();
  if (!fs.existsSync(exe)) return Promise.resolve({ ok: false, error: 'The VPN service is missing from this install. Reinstall the app.' });
  const scratch = switchHome();
  if (fs.existsSync(scratch)) fs.rmSync(scratch, { recursive: true, force: true }); // a folder with no record holds no key anyone uses
  return new Promise((resolve) => {
    execFile(exe, initArgs(scratch, owner), { timeout: 60_000 }, (err, stdout, stderr) => {
      const text = String(stdout);
      const at = text.indexOf('{');
      if (err || at < 0) {
        fs.rmSync(scratch, { recursive: true, force: true });
        resolve({ ok: false, error: `Could not set up the VPN service for this wallet. Try again, or send the log from Diagnostics (${(err?.message ?? String(stderr)).slice(0, 300)}).` });
        return;
      }
      try {
        const init = JSON.parse(text.slice(at)) as { public_key: string };
        carryLiveSettings(scratch);
        wholeDeviceByDefault(scratch);
        fs.writeFileSync(path.join(scratch, SWITCH_FILE), JSON.stringify({ device: init.public_key, owner, at: Date.now() } satisfies SwitchRecord));
        log.info('wallet switch staged', { device: init.public_key });
        resolve({ ok: true, device: init.public_key });
      } catch (parseErr) {
        fs.rmSync(scratch, { recursive: true, force: true });
        resolve({ ok: false, error: `Could not set up the VPN service for this wallet. Try again, or send the log from Diagnostics (unreadable output: ${(parseErr as Error).message}).` });
      }
    });
  });
}

/**
 * A setup left half done that Diagnostics offers to remove (UI-SCREENS): a wallet switch waiting in the scratch
 * folder, or a staged install whose device record names another wallet than the loaded one (the rc.3 E-55 state).
 * A staged install for the loaded wallet is the normal "finish on the next Connect" and is not counted.
 */
export function halfFinishedSetup(loaded: string | null): boolean {
  if (pendingSwitch()) return true;
  if (!installPending()) return false;
  const rec = deviceRecord();
  return !rec || !loaded || rec.owner !== loaded;
}

/** The snapshot's view of the device record for the loaded wallet (AppSnapshot.deviceOwner / halfFinishedSetup). */
export function deviceStateFor(loaded: string | null): { deviceOwner: string | null; halfFinishedSetup: boolean } {
  try {
    return { deviceOwner: deviceRecord()?.owner ?? null, halfFinishedSetup: halfFinishedSetup(loaded) };
  } catch (err) {
    log.warn('device state unreadable', { err: (err as Error).message });
    return { deviceOwner: null, halfFinishedSetup: false };
  }
}

/** After the service runs the switched key: record it and drop the scratch folder. */
export function commitSwitch(s: SwitchRecord): void {
  writeJson(DEVICE_FILE, { device: s.device, home: DEFAULT_DAEMON_HOME, owner: s.owner, at: Date.now() } satisfies DeviceRecord);
  fs.rmSync(switchHome(), { recursive: true, force: true });
  log.info('wallet switch done', { device: s.device, owner: s.owner });
}

/**
 * The real "remove the half-finished setup" (rc.4: the error named a Settings control that did not exist).
 * Removes the staging home and the switch scratch folder; device.json and the installed service are kept.
 * A switch key that already holds a grant is named in the log so its refund can be found.
 */
export function discardHalfFinishedSetup(): { removed: string[] } {
  const removed: string[] = [];
  const sw = pendingSwitch();
  if (sw) log.warn('discarding a half-finished wallet switch', { device: sw.device, owner: sw.owner });
  for (const dir of [stagingHome(), switchHome()]) {
    if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); removed.push(dir); }
  }
  return { removed };
}

/** The settings of an installed home as {root, client}: the c0 copy (one file, given as both), else a
 *  pre-cb33 pair (config.toml + client/config.toml). null when neither is readable. Exported for tests. */
export function readInstalledSettings(live = DEFAULT_DAEMON_HOME, legacy = LEGACY_DAEMON_HOME): { root: string; client: string } | null {
  try {
    const m = fs.readFileSync(configMirrorPath(live), 'utf8');
    // an empty copy (a write cut off by a power loss) is no settings to carry: fall through
    if (m.trim()) return { root: m, client: m };
    log.warn('installed settings copy is empty; not carrying it', { file: configMirrorPath(live) });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('installed settings copy unreadable', { err: (err as Error).message });
  }
  for (const h of [legacy, live]) {
    try {
      return { root: fs.readFileSync(path.join(h, 'config.toml'), 'utf8'), client: fs.readFileSync(path.join(h, 'client', 'config.toml'), 'utf8') };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('old service settings unreadable', { home: h, err: (err as Error).message });
    }
  }
  return null;
}

/**
 * fleet-bugs W3: a wallet switch installs this fresh home in place of the old one (setup-daemon.sh
 * W1), so copy the user's settings (kill switch, DNS, LAN, split, RPC, payment limits) from the
 * installed home (c0, or a pre-cb33 one) into its one config.toml first. Nothing installed yet, or
 * unreadable: dvpnd defaults stay (an "on" kill switch is written as persist either way, Q0426).
 */
export function carryLiveSettings(staging: string, live = DEFAULT_DAEMON_HOME, legacy = LEGACY_DAEMON_HOME): void {
  const old = readInstalledSettings(live, legacy);
  if (!old) return;
  try {
    const file = path.join(staging, 'config.toml');
    fs.writeFileSync(file, carrySettingsInto(old, fs.readFileSync(file, 'utf8')), 'utf8');
    log.info('settings carried to the new device home', { from: live });
  } catch (err) {
    log.warn('could not carry settings to the new device home; dvpnd defaults stay', { error: (err as Error).message });
  }
}

/**
 * Q0507 (release blocker): `dvpnd init` writes kill_switch = 'on', and setup's migrate-daemon-config.sh turns 'on'
 * into 'persist' (Q0426), so every FRESH install came up with the kill switch Always on: install, connect, reboot =
 * no internet. Decision (DIR 2026-11-12): a fresh install is off; an upgrade or wallet switch keeps the user's value
 * (carryLiveSettings). Returns true when it wrote 'off'. Exported for tests.
 */
export function freshInstallDefaults(staging: string, live = DEFAULT_DAEMON_HOME, legacy = LEGACY_DAEMON_HOME): boolean {
  if (readInstalledSettings(live, legacy)) return false;
  const file = path.join(staging, 'config.toml');
  try {
    fs.writeFileSync(file, patchToml(fs.readFileSync(file, 'utf8'), 'network', 'kill_switch', 'off'), 'utf8');
    log.info('fresh install: kill switch starts off', { file });
    return true;
  } catch (err) {
    log.warn('could not set the fresh kill switch to off', { error: (err as Error).message });
    return false;
  }
}

/** E-ST (the agent kit rc.9): what initDevice needs to adopt an installed service's key (injected in tests). */
export interface AdoptDeps { record: () => DeviceRecord | null; home: string; has: (file: string) => boolean; detect: (home: string) => Promise<{ ok: boolean; device?: string; error?: string }>; register: (device: string, owner: string, home: string) => void; serviceOwner?: (home: string) => string | null }

/** A computer with no device record whose service is installed uses the service's own key (recorded for `owner`).
 *  null = nothing to adopt (a record exists, no service home, or its key could not be read): mint as before. */
/** The wallet a dvpnd config.toml names (`owner = '...'`), else null. Pure (ADOPT-OWNER-LINUX). */
export function serviceOwnerFromSettings(text: string): string | null {
  return /^owner *= *['"]([1-9A-HJ-NP-Za-km-z]{32,44})['"]/m.exec(text)?.[1] ?? null;
}

/** The installed service's owner, from its world-readable settings copy beside the home (null = unknown). */
const installedServiceOwner = (home: string): string | null => {
  try { return serviceOwnerFromSettings(fs.readFileSync(configMirrorPath(home), 'utf8')); } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('device: the service settings copy is unreadable', { err: (err as Error).message });
    return null;
  }
};

/** The wallet the installed service runs for (rc9-d wallet-mismatch.ts; the Windows app reads config.toml, which only root can
 *  read here, so the Linux app reads its world-readable copy beside the home). null = no service or unknown. */
export function serviceOwner(home: string = DEFAULT_DAEMON_HOME): string | null {
  return installedServiceOwner(home);
}

export async function adoptInstalledDevice(owner: string, deps: AdoptDeps = { record: deviceRecord, home: DEFAULT_DAEMON_HOME, has: (f) => fs.existsSync(f), detect: detectDevice, register: registerDevice, serviceOwner: installedServiceOwner }): Promise<string | null> {
  if (deps.record() || !deps.has(path.join(deps.home, 'config.toml'))) return null;
  // ADOPT-OWNER-LINUX: setup-daemon.sh keeps config.toml `owner` for the same key, so a service another wallet
  // owns is never adopted: this wallet gets its own key and the install keeps the other home aside.
  const svcOwner = deps.serviceOwner?.(deps.home) ?? null;
  if (svcOwner && svcOwner !== owner) { log.info('device: the installed service belongs to another wallet; a new key is made', { svcOwner, owner }); return null; }
  const d = await deps.detect(deps.home);
  if (!d.ok || !d.device) { log.warn('device: the installed service key could not be read; a new key is made', { err: d.error }); return null; }
  deps.register(d.device, owner, deps.home);
  log.info('device: adopted the installed service key', { device: d.device, home: deps.home });
  return d.device;
}

export async function initDevice(owner: string): Promise<{ ok: boolean; device?: string; error?: string }> {
  const existing = deviceRecord();
  if (existing && existing.owner === owner) {
    if (!recordedHomeGone(existing, fs.existsSync(path.join(stagingHome(), 'config.toml')), legacyInstalled(), serviceHomePresent(DEFAULT_DAEMON_HOME))) {
      return { ok: true, device: existing.device };
    }
    // Its key went with the folder: a new device (installService names this case and points here).
    log.warn('device record points at a removed service home; creating a new device', { device: existing.device, home: existing.home });
  }
  // E-ST (the agent kit rc.9): never mint a staging key beside an installed service (wallet show then named the wrong device).
  if (!existing) {
    const adopted = await adoptInstalledDevice(owner);
    if (adopted) return { ok: true, device: adopted };
  }
  const exe = dvpndPath();
  if (!fs.existsSync(exe)) return Promise.resolve({ ok: false, error: 'The VPN service is missing from this install. Reinstall the app.' });
  const staging = stagingHome();
  if (fs.existsSync(path.join(staging, 'config.toml'))) {
    return Promise.resolve({ ok: false, error: 'A half-finished setup exists. Remove it in Diagnostics (or: devnet-dvpn device discard-setup --yes), then try again. Nothing was paid.' });
  }
  // --instance c0 = a client (cb33 has no --role). --home: a staging folder this user can write; init
  // gives a folder the socket group only under the state root, so no group change is needed here.
  const args = initArgs(staging, owner);
  return new Promise((resolve) => {
    execFile(exe, args, { timeout: 60_000 }, (err, stdout, stderr) => {
      const text = String(stdout);
      const at = text.indexOf('{');
      if (err || at < 0) { resolve({ ok: false, error: `Could not set up the VPN service. Try again, or send the log from Diagnostics (${(err?.message ?? String(stderr)).slice(0, 300)}).` }); return; }
      try {
        const init = JSON.parse(text.slice(at)) as { public_key: string };
        writeJson(DEVICE_FILE, { device: init.public_key, home: DEFAULT_DAEMON_HOME, owner, at: Date.now() } satisfies DeviceRecord);
        log.info('device initialised', { device: init.public_key });
        carryLiveSettings(staging);
        freshInstallDefaults(staging);
        resolve({ ok: true, device: init.public_key });
      } catch (parseErr) {
        resolve({ ok: false, error: `Could not set up the VPN service. Try again, or send the log from Diagnostics (unreadable output: ${(parseErr as Error).message}).` });
      }
    });
  });
}

/** The desktop user's login name (the elevated step adds it to the socket group). */
export function loginName(): string {
  // USER/LOGNAME are missing in some non-login sessions (docker exec -u, systemd-run, cron): the uid's own
  // name is the fallback, or setup gives nobody the socket (no group, no ACL) and the CLI says the service is down.
  let own = '';
  try { own = os.userInfo().username; } catch (e) { log.warn('no login name from the uid', { err: String(e) }); }
  const n = process.env.SUDO_USER || process.env.USER || process.env.LOGNAME || own;
  return /^[a-z_][a-z0-9_-]{0,31}\$?$/.test(n) ? n : '';
}

function unitActive(service: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('systemctl', ['is-active', service], { timeout: 10_000 }, (_err, stdout) => resolve(String(stdout).trim() === 'active'));
  });
}

/** L6: poll (bounded) until `probe` is true; probes and sleep are injectable (exported for tests). */
export async function pollUntil(
  probe: () => Promise<boolean>,
  waitMs = 30_000,
  stepMs = 2_000,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<boolean> {
  for (let waited = 0; ; waited += stepMs) {
    if (await probe()) return true;
    if (waited + stepMs > waitMs) return false;
    await sleep(stepMs);
  }
}

/** After the install step ran past its time limit: did the service come up anyway? */
async function verifyInstalled(home: string): Promise<ElevatedResult> {
  const up = await pollUntil(async () => (await unitActive(SERVICE_NAME)) && fs.existsSync(path.join(home, 'daemon.sock')));
  if (up) {
    log.info('install step timed out but the service is running', { service: SERVICE_NAME });
    return { status: 'ok', detail: 'service installed and running (the administrator step took longer than expected)' };
  }
  return { status: 'error', detail: 'The administrator step took too long and the VPN service is not running. Try again; if it keeps happening, send the log from Diagnostics.' };
}

/** Elevated: put the staged home (or the upgraded old one) in /var/lib/sentinel-dvpn/c0 and run it as the systemd service. Call after device setup. */
// ─── STAGING-MISSING (rc9-d, review live): nothing staged for a service that is already installed ───
// setup-daemon.sh needs a staged home (or a switch / an upgrade to carry in); without one it can only die
// "staging folder not found". Answer what is true before any root step. Pure; unit-tested.
export function stagingMissingAnswer(s: { staged: boolean; switching: boolean; migrating: boolean; installed: boolean }): { code: string; error: string } | null {
  if (s.staged || s.switching || s.migrating || !s.installed) return null;
  return { code: 'service-installed', error: 'The VPN service is already installed on this computer and nothing new is staged for it, so there is nothing to install. Nothing was paid.' };
}

export async function installService(staging = stagingHome()): Promise<{ ok: boolean; error?: string; code?: string; data?: { relogin: boolean } }> {
  const rec = deviceRecord();
  if (!rec) return { ok: false, error: 'Initialise the device first.' };
  // rc.4 E-55 on Linux: during a wallet switch device.json still names the OLD wallet (commitSwitch writes it
  // after this), but setup-daemon.sh inits the service home with --owner = Owner. Take the switch's owner.
  const sw = staging === switchHome() ? pendingSwitch() : null;
  if (staging === switchHome() && !sw) return { ok: false, error: 'No wallet switch is waiting. Connect again to start it. Nothing was paid.' };
  const owner = sw?.owner ?? rec.owner;
  const user = loginName();
  // AppImage: root cannot read the app's mount, so hand it copies (setup installs its own).
  let dvpnd = dvpndPath();
  let binRoot = path.dirname(binPath('x'));
  if (insideAppImage(binRoot)) {
    binRoot = stageForRoot(binRoot, 'bin');
    dvpnd = path.join(binRoot, daemonBinaryName('linux'));
  }
  // No staged home but a pre-cb33 service here: this is the upgrade. Stage the c0 config with the old
  // settings carried in; setup-daemon.sh moves the old device key in, so the device stays the same.
  let migrate: Record<string, string> = {};
  if (!sw && !fs.existsSync(path.join(staging, 'config.toml')) && legacyInstalled()) {
    const m = await stageMigration(rec.owner);
    if (!m.ok || !m.file) return { ok: false, error: m.error ?? 'Could not prepare the VPN service update.' };
    migrate = { Config: m.file, LegacyHome: LEGACY_DAEMON_HOME, Device: rec.device };
  }
  const home = DEFAULT_DAEMON_HOME;
  const missing = stagingMissingAnswer({ staged: fs.existsSync(path.join(staging, 'config.toml')), switching: !!sw, migrating: Object.keys(migrate).length > 0, installed: serviceHomePresent(home) });
  if (missing) { log.info('daemon install: service installed, nothing staged', { staging }); return { ok: false, ...missing }; }
  const gone = recordedHomeGone(rec, fs.existsSync(path.join(staging, 'config.toml')), Object.keys(migrate).length > 0, serviceHomePresent(home));
  if (gone) return { ok: false, error: gone };
  installing += 1; // nothing else starts the service while its root step runs (see autoStart)
  let r: ElevatedResult;
  try {
    r = await runElevated(scriptPath('setup-daemon.sh'), {
      Dvpnd: dvpnd, Staging: staging, DaemonHome: home, BinRoot: binRoot,
      Group: SOCKET_GROUP, Service: SERVICE_NAME, Owner: owner, ...(user ? { User: user } : {}), ...migrate,
    }, 120_000, () => verifyInstalled(home));
  } finally {
    installing -= 1;
  }
  if (r.status === 'ok') noteServiceStarting();
  if (r.status === 'ok' && !sw && rec.home !== home) registerDevice(rec.device, rec.owner, home); // a switch: commitSwitch records it
  relinkDaemon();
  // relogin is Windows' (pipe rights from the next sign-in); Linux gives this login the socket ACL at once.
  return r.status === 'ok' ? { ok: true, data: { relogin: false } } : { ok: false, error: r.detail };
}

// ─── Platform exports the shared code imports (the Windows app a2edc22 / 5b98716, port 2026-11-12) ───

/**
 * The service is installed but refuses this account (EACCES on the socket: a second login, or one that joined the
 * group after signing in; Q0491). One administrator step gives THIS account the socket now and after every socket
 * restart (grant-socket.sh grants only the uid that asked); no sign-out. Shared connection.ts calls it on RELOGIN_COPY.
 */
export async function grantPipeAccess(): Promise<{ ok: boolean; error?: string }> {
  const r = await runElevated(scriptPath('grant-socket.sh'), {}, 60_000);
  log.info('socket access grant', { status: r.status, detail: r.detail });
  relinkDaemon();
  return r.status === 'ok' ? { ok: true } : { ok: false, error: r.detail };
}

/**
 * In-app removal (shared IPC SERVICE_UNINSTALL / `daemon uninstall`, the macOS app): the package's own clean-up as one root step.
 * Ends any session, puts the desktop proxy, DNS and firewall back, removes the service and its tool copies. The device
 * key (/var/lib/sentinel-dvpn/c0) stays, so a reinstall is the same device.
 */
export async function uninstallService(): Promise<{ ok: boolean; error?: string; code?: string }> {
  const r = await runElevated(scriptPath('uninstall-cleanup.sh'), {}, 180_000);
  log.info('service uninstall', { status: r.status, detail: r.detail });
  relinkDaemon();
  return r.status === 'ok' ? { ok: true } : { ok: false, error: r.detail, ...(r.status === 'cancelled' ? { code: 'cancelled' } : {}) };
}

/** A device key made for a new wallet waits in the staging home until the service is (re)installed. */
export function installPending(): boolean {
  return fs.existsSync(path.join(stagingHome(), 'config.toml'));
}

/**
 * the Windows app 5b98716 (V2Ray/Xray use the whole computer on a new install): no-op on Linux. dvpnd has no V2Ray/Xray TUN
 * here, so whole computer is offered only for WireGuard/AmneziaWG/OpenVPN/Hysteria2, which are always whole-device.
 */
export function wholeDeviceByDefault(_staging: string, _live = DEFAULT_DAEMON_HOME): void {
  // Nothing to turn on: see above.
}

/**
 * The app's device record survives a reset that removed the service folder (TLX2, Debian 12, 0.1.11:
 * /var/lib/sentinel-dvpn moved aside, ~/.config kept). Then nothing is staged and there is no home to
 * install, and setup-daemon.sh failed with "nothing to install". Name what happened and the way out
 * before asking for the administrator password. Null when there is something to install. Pure, for tests.
 */
/** The service folder or its world-readable device.pub is there (the folder itself may be unreadable to this user). */
// An EMPTY folder is not a home: once the service is started without one, systemd creates its state folder empty
// (TLX 0.1.15 u22b: "device setup" tried to start it, then every "daemon install" got the root step's raw
// "nothing to install" again). A folder this user cannot read is taken as present (it may be a real 0750 home).
const serviceHomePresent = (home: string): boolean => homeLooksInstalled(fs.existsSync(home), readDevicePub(home) !== null, () => fs.readdirSync(home));

/** A service home is there: device.pub readable, or the folder has files, or it exists but cannot be listed. Pure. */
export function homeLooksInstalled(exists: boolean, devicePub: boolean, list: () => string[]): boolean {
  if (devicePub) return true;
  if (!exists) return false;
  try {
    return list().includes('config.toml');
  } catch (e) {
    log.info('service home not readable by this user; taking it as present', { error: (e as Error).message });
    return true;
  }
}

/** The "device record points at a removed service home" message for the current machine, else null. */
export function deviceHomeGone(): string | null {
  const rec = deviceRecord();
  if (!rec) return null;
  return recordedHomeGone(rec, fs.existsSync(path.join(stagingHome(), 'config.toml')), legacyInstalled(), serviceHomePresent(DEFAULT_DAEMON_HOME));
}

export function recordedHomeGone(rec: DeviceRecord, staged: boolean, migrating: boolean, serviceHomePresent: boolean): string | null {
  if (staged || migrating || serviceHomePresent) return null;
  return `This app remembers device ${rec.device} in ${rec.home}, but that VPN service folder is gone and no new one is prepared, so there is nothing to install. `
    + 'If you have a backup of that folder, put it back and try again. Otherwise create a new device key with "devnet-dvpn daemon init" (the old device cannot be recovered), then "device setup --yes" and "daemon install --yes". Nothing was changed.';
}

/** A pre-cb33 service home or unit is on this machine (exported for tests). */
export function legacyInstalled(legacy = LEGACY_DAEMON_HOME, unitDir = '/etc/systemd/system'): boolean {
  return fs.existsSync(path.join(legacy, 'config.toml')) || fs.existsSync(path.join(unitDir, `${LEGACY_SERVICE_NAME}.service`));
}

/**
 * The c0 config.toml for an upgrade: a fresh `init` as this user into a throwaway folder (its key is
 * deleted with it; root later runs init on the real folder with the OLD device key, which init keeps),
 * with the old home's settings carried in. Written to <data>/migrate/config.toml.
 */
export function stageMigration(owner: string): Promise<{ ok: boolean; file?: string; error?: string }> {
  const exe = dvpndPath();
  if (!fs.existsSync(exe)) return Promise.resolve({ ok: false, error: 'The VPN service is missing from this install. Reinstall the app.' });
  const tmp = path.join(getHost().dataDir, 'migrate-init');
  fs.rmSync(tmp, { recursive: true, force: true });
  return new Promise((resolve) => {
    execFile(exe, initArgs(tmp, owner), { timeout: 60_000 }, (err, _stdout, stderr) => {
      try {
        if (err) { resolve({ ok: false, error: `Could not prepare the VPN service update (${(err.message || String(stderr)).slice(0, 300)}).` }); return; }
        const fresh = fs.readFileSync(path.join(tmp, 'config.toml'), 'utf8');
        const text = carrySettingsInto(readInstalledSettings() ?? { root: '', client: '' }, fresh);
        const dir = path.join(getHost().dataDir, 'migrate');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, 'config.toml');
        fs.writeFileSync(file, text, 'utf8');
        log.info('service update staged: old settings carried into the c0 config');
        resolve({ ok: true, file });
      } catch (readErr) {
        resolve({ ok: false, error: `Could not prepare the VPN service update (${(readErr as Error).message}).` });
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  });
}

export type ServiceStart = 'running' | 'started' | 'no-service' | 'no-right' | 'failed';

/** What `systemctl start` printed / its exit code means for the caller (exported for tests). */
export function classifyServiceStart(code: number, stderr: string): ServiceStart {
  if (code === 0) return 'started';
  if (/not (be )?found|no such unit|not loaded/i.test(stderr)) return 'no-service';
  if (/interactive authentication required|access denied|not authorized|permission denied/i.test(stderr)) return 'no-right';
  return 'failed';
}

/**
 * Start the installed service if it is not running, without a password prompt. dvpnd refuses to
 * start until the device has a grant, so after an upgrade the unit sits in its restart backoff
 * (up to 5 min) until device setup; this starts it right away. The package's polkit rule lets
 * the `dvpn` group start/restart dvpnd-client.service only ('no-right' on an older install).
 */
/** `sudo -n systemctl start <unit>`: allowed by /etc/sudoers.d/devnet-dvpn where polkit has no JS rules. */
function sudoStart(service: string): Promise<ServiceStart> {
  return new Promise((resolve) => {
    execFile('sudo', ['-n', 'systemctl', 'start', service], { timeout: 30_000 }, (err, _out, stderr) => {
      if (!err) { resolve('started'); return; }
      const e = String(stderr);
      // no sudoers entry / a password needed / no sudo at all = still no right; anything else failed
      resolve(/password is required|not allowed|may not run|ENOENT|not found/i.test(e + String((err as NodeJS.ErrnoException).code ?? '')) ? 'no-right' : classifyServiceStart(1, e));
    });
  });
}

export function startServiceIfStopped(service = SERVICE_NAME): Promise<ServiceStart> {
  const run = (args: string[]) => new Promise<{ code: number; out: string; err: string }>((resolve) => {
    execFile('systemctl', args, { timeout: 30_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof (err as { code?: unknown }).code === 'number' ? Number((err as { code?: unknown }).code) : 1) : 0, out: String(stdout), err: String(stderr) });
    });
  });
  return (async () => {
    const load = await run(['show', service, '-p', 'LoadState', '--value']);
    if (load.out.trim() !== 'loaded') return 'no-service';
    if ((await run(['is-active', service])).out.trim() === 'active') return 'running';
    // No home to run: starting would make systemd create the state folder empty, which then hides the gone home (Q0431).
    if (service === SERVICE_NAME && deviceHomeGone()) { log.warn('not starting the service: its home is gone', { service }); return 'failed'; }
    const s = await run(['start', '--no-ask-password', service]);
    let r = classifyServiceStart(s.code, s.err);
    // polkit 0.105 (Ubuntu 22.04) has no JS rules: the package grants the same right in sudoers
    if (r === 'no-right') r = await sudoStart(service);
    if (r === 'started') { noteServiceStarting(); relinkDaemon(); }
    else if (r !== 'no-right') log.warn('service start failed', { code: s.code, err: s.err.slice(0, 300) });
    return r;
  })();
}

// ─── The one button (the Windows app UI pass rows 119-142) ───
/** Wait (with the fast retry on) until the service answers, at most maxMs. */
async function waitAnswer(maxMs: number): Promise<boolean> {
  return withLinkWatch(async () => {
    const until = Date.now() + maxMs;
    while (!info.reachable && Date.now() < until) await new Promise((r) => setTimeout(r, 250));
    return info.reachable;
  });
}

export interface FixResult { ok: boolean; error?: string; code?: string; data?: { did: string; state: string } }

/**
 * Do the one action of the state the service is in now, then wait for it to answer. The screens' single
 * button calls this (IPC DAEMON_INIT step 'fix'), so the button never does something the sentence did not say.
 * install / reinstall / finish-setup ask for the administrator password once (dvpn-helper via pkexec / sudo -n);
 * start does not (the package's polkit rule or sudoers line); repair asks only when re-linking alone did not
 * help and the socket refuses this account (grant-socket.sh).
 */
export async function fixService(): Promise<FixResult> {
  const v = serviceNow();
  const done = (did: string): FixResult => {
    const now = serviceNow();
    return now.state === 'ready' ? { ok: true, data: { did, state: now.state } } : { ok: false, error: now.sentence, code: now.code ?? 'daemon-unavailable', data: { did, state: now.state } };
  };
  log.info('service fix', { state: v.state, action: v.action });
  if (v.state === 'ready') return { ok: true, data: { did: 'none', state: v.state } };
  if (v.action === null) { // starting, restarting: nothing to press, wait for it
    retryNow();
    await waitAnswer(30_000);
    return done('wait');
  }
  if (v.action === 'start') {
    const r = await startServiceIfStopped();
    if (r === 'no-service') { osState = { installed: false, running: false, startPending: false }; setError(); emit(); return done('start'); }
    if (r === 'failed') return { ok: false, error: 'The VPN service did not start. Open Diagnostics and run the check to see why.', code: 'service-start-failed', data: { did: 'start', state: v.state } };
    if (r === 'no-right') {
      // An older install without the start right (polkit rule / sudoers line): the setup step writes it.
      const i = await installService();
      if (!i.ok) return { ok: false, error: i.error, code: 'service-install-failed', data: { did: 'install', state: v.state } };
    }
    await waitAnswer(30_000);
    return done('start');
  }
  if (v.action === 'install' || v.action === 'reinstall') {
    const i = await installService();
    if (!i.ok) return { ok: false, error: i.error, code: 'service-install-failed', data: { did: v.action, state: v.state } };
    await waitAnswer(30_000);
    return done(v.action);
  }
  if (v.action === 'finish-setup') {
    const g = await grantPipeAccess();
    if (!g.ok) return { ok: false, error: g.error ?? v.sentence, code: 'daemon-relogin', data: { did: 'finish-setup', state: v.state } };
    await waitAnswer(30_000);
    return done('finish-setup');
  }
  // repair: a fresh link first (no password); only if the socket then refuses this account, the grant.
  relinkDaemon();
  if (!await waitAnswer(10_000) && serviceNow().state === 'no-permission') {
    const g = await grantPipeAccess();
    if (!g.ok) return { ok: false, error: g.error ?? serviceNow().sentence, code: 'daemon-relogin', data: { did: 'repair', state: serviceNow().state } };
    await waitAnswer(30_000);
  }
  return done('repair');
}

/** Public half only, written world-readable by setup-daemon.sh (the key folder is root 0700). Pre-cb33: <home>/device.pub. */
export const DEVICE_PUB_FILE = 'device.pub';
/** cb33: next to the instance folder, <state root>/c0.device.pub (inside it, every file must be 0600). */
export const devicePubPath = (home: string): string => besideHome(home, DEVICE_PUB_FILE);

/** The device address a home publishes, or null (exported for tests). */
export function readDevicePub(home: string): string | null {
  for (const file of [devicePubPath(home), path.join(home, DEVICE_PUB_FILE)]) {
    try {
      const v = fs.readFileSync(file, 'utf8').trim();
      return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v) ? v : null;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'EACCES') log.warn('device.pub unreadable', { file, err: (err as Error).message });
    }
  }
  return null;
}

/**
 * The device public key of an existing home: device.pub first (no secret needed), else
 * `sentinel-dvpnd key list --instance c0`, which only works when the key folder is readable (e.g. as root).
 */
export function detectDevice(home = DEFAULT_DAEMON_HOME): Promise<{ ok: boolean; device?: string; error?: string }> {
  const pub = readDevicePub(home);
  if (pub) return Promise.resolve({ ok: true, device: pub });
  const exe = dvpndPath();
  if (!fs.existsSync(exe)) return Promise.resolve({ ok: false, error: 'The VPN service is missing from this install. Reinstall the app.' });
  return new Promise((resolve) => {
    execFile(exe, keyListArgs(home), { timeout: 20_000 }, (err, stdout, stderr) => {
      const text = String(stdout);
      const at = text.indexOf('[');
      if (err || at < 0) { resolve({ ok: false, error: `Could not read the service's device key (${(err?.message ?? String(stderr)).trim().slice(0, 160)}). Enter its address instead.` }); return; }
      try {
        const keys = JSON.parse(text.slice(at)) as Array<{ name: string; public_key: string }>;
        const dev = operatorKey(keys);
        resolve(dev ? { ok: true, device: dev.public_key } : { ok: false, error: 'The service home has no device key.' });
      } catch (parseErr) {
        resolve({ ok: false, error: `Could not read the service's device key (unreadable output: ${(parseErr as Error).message}). Enter its address instead.` });
      }
    });
  });
}

/** Record an already-initialised daemon's device key (e.g. service set up by an admin). */
export function registerDevice(device: string, owner: string, home = DEFAULT_DAEMON_HOME): void {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(device)) throw new Error('The device must be a Solana address (base58).');
  writeJson(DEVICE_FILE, { device, home, owner, at: Date.now() } satisfies DeviceRecord);
}

/**
 * Android: the app restarts its own VPN engine (Restore network when dvpnd does not answer). On Linux dvpnd is the
 * systemd service (Restore network starts it via startServiceIfStopped), so this is never reached (connection.ts
 * calls it only on isAndroid()); the export keeps that shared file identical on every OS.
 */
export async function restartAndroidDaemon(): Promise<{ ok: boolean; error?: string }> {
  return { ok: false, error: 'Only the Android app restarts its own VPN engine.' };
}
