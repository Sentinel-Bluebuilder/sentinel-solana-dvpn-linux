// ─── Daemon manager (D1, D5, F1, F4.5) — Linux ───
// The app runs as the desktop user; sentinel-dvpnd runs as root under systemd as the cb33 template
// instance `sentinel-dvpnd@c0` (unit + socket written by `sentinel-dvpnd service install`). systemd
// owns the control socket <home>/daemon.sock (0660, group sentinel-dvpn); setup adds the user to that
// group (plus an ACL for this login), so the app dials the socket directly. cb33 keeps the instance
// folder 0750 and everything in it 0600/0700 (doctor flags anything looser), so the app reads a
// root-refreshed copy of config.toml and the device address next to the folder, never inside it.
// No bridge process: the link is a health probe that re-attaches when the socket comes back.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DaemonClient, DaemonError, SOCKET_FILE, socketTarget, type DaemonVersion } from '../../core/daemon/client';
import { MINT, PROGRAM_ID } from '../../core/chain/idl';
import type { DaemonInfo } from '../../shared/types';
import { readJson, writeJson } from '../store';
import { runElevated, insideAppImage, stageForRoot, type ElevatedResult } from '../system/elevate';
import { log } from '../logger';
import { getHost } from '../host';
import { daemonLinkCopy } from '../../core/daemon/link-copy';
import { carrySettingsInto } from '../../core/daemon/config';
import { DAEMON_GROUP, daemonBinaryName, doctorArgs, initArgs, instanceDir, keyListArgs, legacyHome, operatorKey, serviceName } from '../../core/daemon/layout';

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
export function dvpndPath(): string {
  return process.env.DVPND_BIN && fs.existsSync(process.env.DVPND_BIN) ? process.env.DVPND_BIN : binPath(daemonBinaryName('linux'));
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
let backoffMs = 2000;
let stopping = false;
const info: DaemonInfo = { reachable: false, bridge: 'stopped', version: null, networkOk: null, error: null, home: null, device: null };
const listeners = new Set<() => void>();

export const onDaemonChange = (fn: () => void): (() => void) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (): void => { for (const l of listeners) l(); };

export function daemonInfo(): DaemonInfo {
  const d = readJson<DeviceRecord | null>(DEVICE_FILE, null);
  return { ...info, home: d?.home ?? null, device: d?.device ?? null };
}

export function deviceRecord(): DeviceRecord | null {
  return readJson<DeviceRecord | null>(DEVICE_FILE, null);
}

/** The connected gRPC client, or a clear error the UI can show. */
export function daemon(): DaemonClient {
  if (!client || !info.reachable) throw new DaemonError(Object.assign(new Error(info.error ?? 'The VPN service is not running.'), { code: 14, details: info.error ?? 'The VPN service is not running.' }) as Error, 'daemon');
  return client;
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
    info.reachable = false;
    info.error = 'The VPN service is not running.';
    emit();
    settleFirst();
    scheduleRetry();
    return;
  }
  info.bridge = 'running';
  void attach(socketTarget(sock));
}

function scheduleRetry(): void {
  if (retryTimer || stopping) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    startDaemonLink();
  }, backoffMs);
  retryTimer.unref(); // the CLI must be able to exit while the service is down
  backoffMs = Math.min(backoffMs * 2, 30_000);
}

/** While attached, re-check every 15 s: a restarted service gets a new socket, a stopped one none. */
function startHealth(): void {
  if (healthTimer) return;
  healthTimer = setInterval(() => {
    if (!client || stopping) return;
    client.getVersion().catch((err: Error) => {
      log.warn('daemon stopped answering', { err: err.message });
      detach();
      info.error = daemonLinkCopy(err.message);
      info.bridge = 'stopped';
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
    info.error = info.networkOk ? null : `The VPN service is set up for a different network (${v.network}). This app is devnet only.`;
    backoffMs = 2000;
    log.info('daemon attached', { version: info.version, network: v.network, networkOk: info.networkOk });
    startHealth();
  } catch (err) {
    info.reachable = false;
    info.bridge = 'error';
    info.error = daemonLinkCopy((err as Error).message);
    log.warn('daemon attach failed', { err: (err as Error).message, retryInMs: backoffMs });
    // Service did not answer (slow start): retry with backoff (#31 2169efe; Linux had this since the socket port).
    scheduleRetry();
  }
  emit();
  settleFirst();
}


export function networkMatches(v: Pick<DaemonVersion, 'programId' | 'mint'>): boolean {
  return v.programId === PROGRAM_ID.toBase58() && v.mint === MINT.toBase58();
}

function detach(): void {
  if (client) {
    client.close();
    client = null;
  }
  info.reachable = false;
}

export function stopDaemonLink(): void {
  stopping = true;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
  detach();
  info.bridge = 'stopped';
}

/** Re-probe now (after setup or a settings restart). */
export function relinkDaemon(): void {
  backoffMs = 2000;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  stopping = false;
  startDaemonLink();
}

// ─── Doctor (F1.6) ───
// dvpnd reports advisories as OK=true with a Detail (e.g. a protocol binary missing): that is a warning.
export interface DoctorCheck { name: string; ok: boolean; level: 'ok' | 'warn' | 'fail'; detail: string }
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
    if (['key', 'kill_switch'].includes(r.name) && denied.test(r.detail)) {
      return { ...r, ok: true, level: 'ok', detail: 'held by the running service (readable by root only)' };
    }
    if (r.name === 'dns_backend' && /resolvconf.*resolv\.conf is not writable.*permission denied/i.test(r.detail)) {
      return { ...r, ok: true, level: 'ok', detail: 'resolvconf: the running service (root) writes /etc/resolv.conf during a session' };
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
  return rows.map((r) => {
    const name = String(r.name ?? r.Name ?? '?');
    const ok = (r.ok ?? r.OK) === true;
    // cb33 adds severity (ok / warning / error; ok is false exactly for error): a warning row is ok but a warning.
    const sev = String(r.severity ?? '');
    let detail = String(r.detail ?? r.Detail ?? '');
    if (!ok && (name === 'grant' || name === 'mandate')) {
      log.info('doctor: device has no spending permission', { detail: detail.slice(0, 300) });
      detail = 'This device has no spending permission yet. Set it up: Wallet → "Let this device pay nodes", or `devnet-dvpn device setup`.';
    }
    // The kill-switch row is OK with a status note; "nothing held" is the normal state, not a
    // warning (#31 09bcc19: a healthy laptop showed it as "!").
    if (name === 'kill_switch' && ok) {
      if (/no persisted kill switch/i.test(detail)) detail = 'Nothing held: internet is not blocked.';
      // cb33 says it itself (severity); older builds only in the text
      const warn = sev ? sev === 'warning' : /unpinned|unusable|leftover/i.test(detail);
      return { name, ok, level: warn ? 'warn' : 'ok', detail };
    }
    return { name, ok, level: !ok ? 'fail' : sev === 'warning' || (detail && ADVISORY.test(name)) ? 'warn' : 'ok', detail };
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

/** The settings of an installed home as {root, client}: the c0 copy (one file, given as both), else a
 *  pre-cb33 pair (config.toml + client/config.toml). null when neither is readable. Exported for tests. */
export function readInstalledSettings(live = DEFAULT_DAEMON_HOME, legacy = LEGACY_DAEMON_HOME): { root: string; client: string } | null {
  try {
    const m = fs.readFileSync(configMirrorPath(live), 'utf8');
    return { root: m, client: m };
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

export function initDevice(owner: string): Promise<{ ok: boolean; device?: string; error?: string }> {
  const existing = deviceRecord();
  if (existing && existing.owner === owner) {
    if (!recordedHomeGone(existing, fs.existsSync(path.join(stagingHome(), 'config.toml')), legacyInstalled(), serviceHomePresent(DEFAULT_DAEMON_HOME))) {
      return Promise.resolve({ ok: true, device: existing.device });
    }
    // Its key went with the folder: a new device (installService names this case and points here).
    log.warn('device record points at a removed service home; creating a new device', { device: existing.device, home: existing.home });
  }
  const exe = dvpndPath();
  if (!fs.existsSync(exe)) return Promise.resolve({ ok: false, error: 'The VPN service is missing from this install. Reinstall the app.' });
  const staging = stagingHome();
  if (fs.existsSync(path.join(staging, 'config.toml'))) {
    return Promise.resolve({ ok: false, error: 'A half-finished setup exists. Remove it from Settings → Advanced and start again.' });
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
        resolve({ ok: true, device: init.public_key });
      } catch (parseErr) {
        resolve({ ok: false, error: `Could not set up the VPN service. Try again, or send the log from Diagnostics (unreadable output: ${(parseErr as Error).message}).` });
      }
    });
  });
}

/** The desktop user's login name (the elevated step adds it to the socket group). */
function loginName(): string {
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
export async function installService(): Promise<{ ok: boolean; error?: string }> {
  const rec = deviceRecord();
  if (!rec) return { ok: false, error: 'Initialise the device first.' };
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
  if (!fs.existsSync(path.join(stagingHome(), 'config.toml')) && legacyInstalled()) {
    const m = await stageMigration(rec.owner);
    if (!m.ok || !m.file) return { ok: false, error: m.error ?? 'Could not prepare the VPN service update.' };
    migrate = { Config: m.file, LegacyHome: LEGACY_DAEMON_HOME, Device: rec.device };
  }
  const home = DEFAULT_DAEMON_HOME;
  const gone = recordedHomeGone(rec, fs.existsSync(path.join(stagingHome(), 'config.toml')), Object.keys(migrate).length > 0, serviceHomePresent(home));
  if (gone) return { ok: false, error: gone };
  const r = await runElevated(scriptPath('setup-daemon.sh'), {
    Dvpnd: dvpnd, Staging: stagingHome(), DaemonHome: home, BinRoot: binRoot,
    Group: SOCKET_GROUP, Service: SERVICE_NAME, Owner: rec.owner, ...(user ? { User: user } : {}), ...migrate,
  }, 120_000, () => verifyInstalled(home));
  if (r.status === 'ok' && rec.home !== home) registerDevice(rec.device, rec.owner, home);
  relinkDaemon();
  return r.status === 'ok' ? { ok: true } : { ok: false, error: r.detail };
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
    if (r === 'started') relinkDaemon();
    else if (r !== 'no-right') log.warn('service start failed', { code: s.code, err: s.err.slice(0, 300) });
    return r;
  })();
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
