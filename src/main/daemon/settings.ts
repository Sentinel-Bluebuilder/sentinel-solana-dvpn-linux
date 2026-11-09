// ─── Daemon settings (D4, F14, F15, F16b, F18) ───
// Kill switch, DNS, allow_lan, basis/escrow/prepay and the daemon's RPC URL live
// in the daemon's own TOML, not in gRPC. cb33 keeps the instance config.toml root-only (0600), so we
// read the copy every root step refreshes next to it (<state root>/c0.config.toml, root:sentinel-dvpn
// 0640 + a read ACL for the user who ran setup), render + validate the one file (core/daemon/config),
// stage it under userData, and apply with one administrator prompt + service restart.
import fs from 'node:fs';
import path from 'node:path';
import { parseSettings, readToml, renderConfig, validateSettings, type DaemonSettings } from '../../core/daemon/config';
import { splitNotApplied } from '../../core/session/state';
import { DEFAULT_DAEMON_HOME, SERVICE_NAME, configMirrorPath, daemonInfo, relinkDaemon, scriptPath } from './manager';
import { runElevated } from '../system/elevate';
import { log } from '../logger';
import { getHost } from '../host';

function home(): string {
  return DEFAULT_DAEMON_HOME;
}

// Set by readLive: the read failed because the file does not exist (ENOENT), so the service was never
// set up. Not existsSync: under /var/lib/sentinel-dvpn a user without access gets EACCES, which existsSync also
// reports as "absent", and would be told to set up a service that is installed.
let lastReadMissing = false;

/** The one config.toml (via its app-readable copy), given as both halves: its root ([rpc]) and client
 *  keys never share a name, so every reader below works on it unchanged. */
function readLive(): { root: string; client: string } | null {
  lastReadMissing = false;
  try {
    const text = fs.readFileSync(configMirrorPath(home()), 'utf8');
    return { root: text, client: text };
  } catch (err) {
    lastReadMissing = (err as NodeJS.ErrnoException).code === 'ENOENT';
    log.warn('daemon config not readable as this user', { err: (err as Error).message });
    return null;
  }
}

/**
 * True when this V2Ray/Xray session runs in whole-device mode (Windows TUN). Kept for parity with
 * #31; on Linux it is always false, so the app always sets the system proxy for V2Ray/Xray.
 */
export function serviceUsesTun(_service: string | null | undefined): boolean {
  return false; // Linux: dvpnd runs V2Ray/Xray as a SOCKS proxy only (whole-device TUN is Windows-only)
}

/**
 * The split tunnelling dvpnd applies to a session of this protocol: [split] from the client
 * config, filtered by what this dvpnd build does (splitNotApplied). null = full tunnel.
 */
export function splitForSession(service: string | null | undefined): 'include' | 'exclude' | null {
  const live = readLive();
  if (!live || !service) return null;
  const mode = readToml(live.client, 'split', 'mode');
  if (mode !== 'include' && mode !== 'exclude') return null;
  const list = (k: string): string[] => { const v = readToml(live.client, 'split', k); return Array.isArray(v) ? v : []; };
  const apps = list('apps');
  if (!apps.length && !list('routes').length) return null;
  const why = splitNotApplied({
    daemonVersion: daemonInfo().version,
    service,
    killSwitch: String(readToml(live.client, 'network', 'kill_switch') ?? 'on'),
    wholeDevice: ['v2ray', 'xray'].includes(service.toLowerCase()) ? serviceUsesTun(service) : undefined,
    hasApps: apps.length > 0,
    platform: process.platform,
  });
  if (why) log.info('split tunnelling not in effect for this session', { service, why });
  return why ? null : mode;
}

/** The routes an exclude split leaves out of this session's tunnel ([] when no exclude split applies). */
export function splitExcludedRoutes(service: string | null | undefined): string[] {
  if (splitForSession(service) !== 'exclude') return [];
  const live = readLive();
  const v = live ? readToml(live.client, 'split', 'routes') : null;
  return Array.isArray(v) ? v.map(String) : [];
}

/** missing = the service was never set up on this computer (no config file), not a permission problem. */
export function getDaemonSettings(): { readable: boolean; missing?: boolean; settings: Partial<DaemonSettings> } {
  const live = readLive();
  return live ? { readable: true, settings: parseSettings(live.root, live.client) } : { readable: false, missing: lastReadMissing, settings: {} };
}

/** systemd-resolved is running (its varlink socket exists only while it does). */
export function resolvedActive(): boolean {
  return fs.existsSync('/run/systemd/resolve/io.systemd.Resolve');
}

/**
 * "Use the VPN's DNS" on a system without systemd-resolved (EL9: NetworkManager owns
 * /etc/resolv.conf) cannot use dvpnd's resolvectl mode: it becomes resolvconf (dvpnd writes
 * resolv.conf for the session and restores it). Everything else is unchanged.
 */
export function hostDnsMode(mode: string | undefined, hasResolved = resolvedActive()): string | undefined {
  return mode === 'resolvectl' && !hasResolved ? 'resolvconf' : mode;
}

export async function applyDaemonSettings(next: DaemonSettings): Promise<{ ok: boolean; error?: string }> {
  // A new RPC must be https/wss; the one already stored is kept as it is (Q0478).
  const stored = getDaemonSettings().settings;
  validateSettings(next, { storedRpc: next.rpcUrl === stored.rpcUrl && next.rpcWsUrl === stored.rpcWsUrl });
  const dnsMode = hostDnsMode(next.dnsMode);
  if (dnsMode !== next.dnsMode) {
    log.info('DNS mode resolvectl → resolvconf (systemd-resolved is not running)');
    next = { ...next, dnsMode };
  }
  const live = readLive();
  if (!live) return { ok: false, error: 'This app cannot read the VPN service settings on this account. Log out and back in (setup added you to the sentinel-dvpn group), or re-run setup.' };
  const text = renderConfig(live.client, next);
  const out = { root: text, client: text };
  const staged = path.join(getHost().dataDir, 'staged');
  fs.mkdirSync(staged, { recursive: true });
  fs.writeFileSync(path.join(staged, 'config.toml'), text, 'utf8');
  fs.rmSync(path.join(staged, 'client.config.toml'), { force: true });
  const r = await runElevated(scriptPath('apply-daemon-config.sh'), { Staged: staged, DaemonHome: home(), Service: SERVICE_NAME });
  log.info('daemon settings apply', { status: r.status, detail: r.detail });
  relinkDaemon();
  if (r.status === 'ok') return { ok: true };
  // fleet bug #3: a slow administrator step can time out (or lose its result file) after the change went through
  if (appliedAnyway(readLive(), out)) {
    log.warn('daemon settings apply reported an error, but the live files are the new ones', { detail: r.detail });
    return { ok: true };
  }
  return { ok: false, error: r.detail };
}

/** The live config files equal what we staged. apply-daemon-config.sh restores the backup on any failure, so equal = applied. */
export function appliedAnyway(live: { root: string; client: string } | null, staged: { root: string; client: string }): boolean {
  return live !== null && live.root === staged.root && live.client === staged.client;
}
