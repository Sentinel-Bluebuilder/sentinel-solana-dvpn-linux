// ─── dvpnd config files (decision D4) ───
// Kill switch, DNS, LAN access, price basis, escrow/prepay and the RPC URL live
// only in dvpnd's TOML files, not in gRPC. The app edits a COPY: it patches the
// allow-listed keys below in place (comments and unknown keys survive), stages
// the result in its own folder, and a fixed elevated script copies it over and
// restarts the service. Config text never passes through a shell string.
//
// Layout written by `dvpnd init --role client` (upstream cf4c372, verified 2026-10-21):
//   <home>/config.toml         [daemon] endpoint/role/socket_group · [rpc] url/ws_url · [tx] · [log]
//   <home>/client/config.toml  basis, escrow_base_units, prepay_*, max_prepay_*, services · [key]
//                              · [network] allow_lan/dns_backend/dns_servers/kill_switch
// Older builds wrote `escrow` and `dns`; dvpnd now IGNORES those, so we read them only as a
// fallback and rename them on write (resources/scripts/migrate-daemon-config.ps1 does the same
// at install time).
//
// cb33 layout (sentinel-dvpnd, instance c0; see layout.ts): ONE <instance dir>/config.toml holds
// both sets (client keys at the top level, [network], [split], [key], then [daemon] role, [log],
// [rpc], [tx]); no socket_group. Same key names, so renderConfig / parseConfig patch and read the
// one file with the functions below, and carrySettingsInto moves an old home's settings into it.

export type KillSwitch = 'off' | 'on' | 'persist';
export type Basis = 'per_gb' | 'per_hour';
export type SplitMode = 'off' | 'include' | 'exclude';

/** dvpnd [split] (ddv11+): include = only these use the VPN; exclude = all but these. Apps: V2Ray/Xray only. */
export interface SplitSettings {
  mode: SplitMode;
  apps: string[];   // absolute paths to .exe files
  routes: string[]; // CIDR, e.g. 10.0.0.0/8
}

export interface DaemonSettings {
  killSwitch: KillSwitch;
  allowLan: boolean;
  dnsServers: string[];
  /** How the daemon sets DNS for a session: 'resolvectl' (systemd-resolved), 'resolvconf', or 'none' = never touch system DNS */
  dnsMode?: string;
  basis: Basis;
  escrow: string; // base units
  prepayBytes: string;
  prepaySeconds: string;
  rpcUrl: string;
  rpcWsUrl: string;
  /** Split tunnelling; undefined = leave the file as it is. */
  split?: SplitSettings;
}

export class ConfigError extends Error {
  code = 'invalid-daemon-setting';
}

// ─── TOML value rendering (only the shapes we write) ───
function tomlString(s: string): string {
  if (/['\n\r]/.test(s)) throw new ConfigError(`value contains a quote or newline: ${JSON.stringify(s)}`); // copy:internal
  return `'${s}'`;
}

function tomlValue(v: string | boolean | string[] | bigint): string {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return `[${v.map(tomlString).join(', ')}]`;
  return tomlString(v);
}

/**
 * Set `key = value` inside `[section]` (or the top level when section is '').
 * Replaces the existing line if present, else appends it to the section.
 */
export function patchToml(text: string, section: string, key: string, value: string | boolean | string[] | bigint): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const rendered = `${key} = ${tomlValue(value)}`;
  let current = '';
  let sectionEnd = -1;
  let sectionFound = section === '';
  const keyRe = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`);
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i].match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      if (current === section && sectionFound) sectionEnd = i;
      current = header[1].trim();
      if (current === section) sectionFound = true;
      continue;
    }
    if (current === section && keyRe.test(lines[i])) {
      lines[i] = rendered;
      return lines.join('\n');
    }
  }
  if (!sectionFound) {
    const tail = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
    return [...tail, '', `[${section}]`, rendered, ''].join('\n');
  }
  // Insert before the next section header (or at the end), after the last non-blank line.
  let at = sectionEnd === -1 || current === section ? lines.length : sectionEnd;
  while (at > 0 && lines[at - 1].trim() === '') at--;
  lines.splice(at, 0, rendered);
  return lines.join('\n');
}

/** Read `key` from `[section]` — enough for strings, booleans, numbers and string arrays. */
export function readToml(text: string, section: string, key: string): string | boolean | string[] | null {
  let current = '';
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) { current = header[1].trim(); continue; }
    if (current !== section) continue;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (!m || m[1] !== key) continue;
    const raw = m[2];
    if (raw === 'true' || raw === 'false') return raw === 'true';
    if (raw.startsWith('[')) return [...raw.matchAll(/'([^']*)'|"([^"]*)"/g)].map((x) => x[1] ?? x[2]);
    const s = raw.match(/^'([^']*)'$|^"([^"]*)"$/);
    if (s) return s[1] ?? s[2];
    return raw;
  }
  return null;
}

// ─── validation ───
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-fA-F:]+$/;
const DIGITS = /^\d+$/;
/** dvpnd DNS backends on Linux (config.DNSBackends): resolvectl, resolvconf, none. */
export const DNS_MODES = ['resolvectl', 'resolvconf', 'none'];
/** The group dvpnd chowns its control socket to (setup adds the user to it). */
export const SOCKET_GROUP = 'dvpn';

/** storedRpc: the RPC values are the ones already in the service config (not typed now), so an http:// / ws:// gate
 *  written there by a lab or by hand is kept; quotes, spaces and a bad host are still refused (Q0478, Mac Q0468:
 *  re-checking https on the STORED value made every `daemon set` fail, so the kill switch never persisted). */
export function validateSettings(s: DaemonSettings, opts: { storedRpc?: boolean } = {}): void {
  if (!['off', 'on', 'persist'].includes(s.killSwitch)) throw new ConfigError('Kill switch must be off, on or persist.');
  if (!['per_gb', 'per_hour'].includes(s.basis)) throw new ConfigError('Basis must be per_gb or per_hour.');
  if (s.dnsMode !== undefined && !DNS_MODES.includes(s.dnsMode)) throw new ConfigError(`DNS mode must be one of ${DNS_MODES.join(', ')}`);
  if (!Array.isArray(s.dnsServers) || s.dnsServers.length < 1 || s.dnsServers.length > 4) throw new ConfigError('DNS needs 1 to 4 servers.');
  for (const d of s.dnsServers) if (!IPV4.test(d) && !(d.includes(':') && IPV6.test(d))) throw new ConfigError(`${d} is not an IP address.`);
  // Prepay 0 = dvpnd uses the node's minimum block; `dvpnd init` writes 0, so refusing it made every
  // `daemon set` on a fresh install fail (VM 2026-10-22). Escrow must stay positive.
  if (!DIGITS.test(s.escrow) || BigInt(s.escrow) === 0n || BigInt(s.escrow) > 2n ** 64n - 1n) throw new ConfigError('The deposit must be a positive whole number.');
  for (const [k, v] of [['prepay bytes', s.prepayBytes], ['prepay seconds', s.prepaySeconds]] as const) {
    if (!DIGITS.test(v) || BigInt(v) > 2n ** 64n - 1n) throw new ConfigError(`${k} must be a whole number (0 = the node's minimum)`);
  }
  if (s.split !== undefined) validateSplit(s.split);
  for (const [k, v, proto] of [['RPC url', s.rpcUrl, 'https:'], ['RPC websocket url', s.rpcWsUrl, 'wss:']] as const) {
    // new URL() quietly percent-encodes quotes and spaces and turns a backslash into "/", so a
    // value with a quote, a newline and "kill_switch = off" passed and the service sat on a dead
    // RPC (u2404 fuzz 2026-10-22).
    if (/[\s"'\\<>`\u0000-\u001f\u007f]/.test(v)) throw new ConfigError(`${k} has characters a URL cannot hold (spaces, quotes, backslashes)`);
    let u: URL;
    try {
      u = new URL(v);
    } catch (err) {
      throw new ConfigError(`${k} is not a URL: ${(err as Error).message}`);
    }
    const loose = proto === 'https:' ? 'http:' : 'ws:';
    if (u.protocol !== proto && !(opts.storedRpc && u.protocol === loose)) throw new ConfigError(`${k} must use ${proto}//.`);
    if (!validHost(u.hostname)) throw new ConfigError(`${k} needs a real host name, got "${u.hostname}"`);
  }
}

const CIDR4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}\/(3[0-2]|[12]?\d)$/;
const CIDR6 = /^[0-9a-fA-F:]+\/(12[0-8]|1[01]\d|[1-9]?\d)$/;

/** Same rules as dvpnd's Split.Validate, so a bad value never reaches the service. */
export function validateSplit(s: SplitSettings): void {
  if (!['off', 'include', 'exclude'].includes(s.mode)) throw new ConfigError('Split mode must be off, include or exclude.');
  if (!Array.isArray(s.apps) || !Array.isArray(s.routes)) throw new ConfigError('Split apps and routes must be lists.');
  if (s.apps.length > 64 || s.routes.length > 256) throw new ConfigError('Too many split apps or routes (64 apps, 256 routes).');
  for (const a of s.apps) {
    if (/['"\n\r]/.test(a)) throw new ConfigError(`Split app path contains a quote or newline: ${JSON.stringify(a)}`);
    const windows = /^[A-Za-z]:[\\/]|^\\\\/.test(a);
    if (!windows && !a.startsWith('/')) throw new ConfigError(`Split app must be a full path: ${a}`);
    if (windows && !/\.exe$/i.test(a)) throw new ConfigError(`Split app must be an .exe file: ${a}`);
  }
  for (const r of s.routes) if (!CIDR4.test(r) && !(r.includes(':') && CIDR6.test(r))) throw new ConfigError(`Split route must be an IP address or range like 10.0.0.0/8, not a name (sites behind a CDN change addresses): ${r}`);
  if (s.mode !== 'off' && !s.apps.length && !s.routes.length) throw new ConfigError('Split include/exclude needs at least one app or route.');
}

/** Drop `key = …` from `[section]` (used to retire a renamed key). */
export function removeTomlKey(text: string, section: string, key: string): string {
  let current = '';
  const keyRe = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`);
  return text.replace(/\r\n/g, '\n').split('\n').filter((line) => {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) { current = header[1].trim(); return true; }
    return !(current === section && keyRe.test(line));
  }).join('\n');
}

/**
 * The kill switch mode written to dvpnd. "on" is written as "persist": dvpnd's "on" lifts the
 * block whenever the service stops (a restart or an update sends traffic direct), and the two
 * differ only there (session.go: a user disconnect releases both, a lost connection keeps both).
 * So the app has one "On" (= persist) and never writes "on". The same rename runs on existing
 * configs in migrate-daemon-config.sh before the service starts.
 */
export function writtenKillSwitch(k: KillSwitch): KillSwitch {
  return k === 'on' ? 'persist' : k;
}

/** Apply settings to the two files' text (pre-cb33 layout). Returns new text for both. */
export function renderConfigs(rootToml: string, clientToml: string, s: DaemonSettings): { root: string; client: string } {
  validateSettings(s, { storedRpc: true }); // new RPC values are checked strictly before they get here
  const root = patchToml(renderRootPart(rootToml, s), 'daemon', 'socket_group', SOCKET_GROUP);
  return { root, client: renderClientPart(clientToml, s) };
}

/**
 * cb33 layout: apply settings to the ONE instance config.toml. Its root sections ([rpc]) and client
 * keys (top level, [network], [split]) never share a name, so both parts patch the same text. cb33 has
 * no socket_group (the service unit sets the socket group): a value left from an old home is dropped.
 */
export function renderConfig(text: string, s: DaemonSettings): string {
  validateSettings(s, { storedRpc: true }); // new RPC values are checked strictly before they get here
  return renderClientPart(removeTomlKey(renderRootPart(text, s), 'daemon', 'socket_group'), s);
}

/** cb33 layout: the settings in the one instance config.toml. */
export function parseConfig(text: string): Partial<DaemonSettings> {
  return parseSettings(text, text);
}

function renderRootPart(rootToml: string, s: DaemonSettings): string {
  let root = rootToml;
  root = patchToml(root, 'rpc', 'url', s.rpcUrl);
  root = patchToml(root, 'rpc', 'ws_url', s.rpcWsUrl);
  return root;
}

function renderClientPart(clientToml: string, s: DaemonSettings): string {
  let client = clientToml;
  client = patchToml(client, '', 'basis', s.basis);
  client = removeTomlKey(client, '', 'escrow');
  client = patchToml(client, '', 'escrow_base_units', BigInt(s.escrow));
  client = patchToml(client, '', 'prepay_bytes', BigInt(s.prepayBytes));
  client = patchToml(client, '', 'prepay_seconds', BigInt(s.prepaySeconds));
  client = patchToml(client, 'network', 'allow_lan', s.allowLan);
  client = patchToml(client, 'network', 'dns_servers', s.dnsServers);
  const legacyDns = readToml(client, 'network', 'dns');
  client = removeTomlKey(client, 'network', 'dns');
  const dnsMode = s.dnsMode ?? (typeof legacyDns === 'string' ? legacyDns : undefined);
  if (dnsMode !== undefined) client = patchToml(client, 'network', 'dns_backend', dnsMode);
  client = patchToml(client, 'network', 'kill_switch', writtenKillSwitch(s.killSwitch));
  if (s.split !== undefined) {
    client = patchToml(client, 'split', 'mode', s.split.mode);
    client = patchToml(client, 'split', 'apps', s.split.apps);
    client = patchToml(client, 'split', 'routes', s.split.routes);
  }
  return client;
}

export function parseSettings(rootToml: string, clientToml: string): Partial<DaemonSettings> {
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  return {
    killSwitch: str(readToml(clientToml, 'network', 'kill_switch')) as KillSwitch | undefined,
    allowLan: readToml(clientToml, 'network', 'allow_lan') === true,
    // An old Handshake list (2 servers) reads as today's preset, so the next save writes 3 (Q0267).
    dnsServers: upgradeDnsServers((readToml(clientToml, 'network', 'dns_servers') as string[] | null) ?? undefined),
    dnsMode: str(readToml(clientToml, 'network', 'dns_backend')) ?? str(readToml(clientToml, 'network', 'dns')),
    basis: str(readToml(clientToml, '', 'basis')) as Basis | undefined,
    escrow: str(readToml(clientToml, '', 'escrow_base_units')) ?? str(readToml(clientToml, '', 'escrow')),
    prepayBytes: str(readToml(clientToml, '', 'prepay_bytes')),
    prepaySeconds: str(readToml(clientToml, '', 'prepay_seconds')),
    rpcUrl: str(readToml(rootToml, 'rpc', 'url')),
    rpcWsUrl: str(readToml(rootToml, 'rpc', 'ws_url')),
    split: parseSplit(clientToml),
  };
}

function parseSplit(clientToml: string): SplitSettings | undefined {
  const mode = readToml(clientToml, 'split', 'mode');
  if (mode === null) return undefined;
  const list = (k: string): string[] => { const v = readToml(clientToml, 'split', k); return Array.isArray(v) ? v : []; };
  const apps = list('apps');
  const routes = list('routes');
  // dvpnd treats an unknown mode or an empty list as off; read it the same way so Settings can still save.
  const known = ['include', 'exclude'].includes(String(mode)) && (apps.length > 0 || routes.length > 0);
  return { mode: (known ? mode : 'off') as SplitMode, apps, routes };
}

export { DNS_PRESETS } from './dns-presets';import { validHost } from '../net/host';
import { upgradeDnsServers } from './dns-presets';


// ─── Carry settings to a new device home (fleet-bugs W3) ───
// A wallet switch makes a fresh `dvpnd init` home with dvpnd's defaults, so a user who had turned
// the kill switch off (or set DNS, LAN, split, RPC, payment limits) silently got the defaults back.
// Copies only the user-set keys present in the old files; owner, device and paths stay new.
const CARRIED_CLIENT: ReadonlyArray<[string, string]> = [
  ['', 'basis'], ['', 'escrow_base_units'], ['', 'prepay_bytes'], ['', 'prepay_seconds'],
  ['network', 'kill_switch'], ['network', 'allow_lan'], ['network', 'dns_servers'], ['network', 'dns_backend'],
  ['split', 'mode'], ['split', 'apps'], ['split', 'routes'],
];
const NUMERIC = new Set(['escrow_base_units', 'prepay_bytes', 'prepay_seconds']);
const CARRIED_ROOT: ReadonlyArray<[string, string]> = [['rpc', 'url'], ['rpc', 'ws_url']];

function carryKeys(from: string, into: string, keys: ReadonlyArray<[string, string]>): string {
  let out = into;
  for (const [section, key] of keys) {
    const v = readToml(from, section, key);
    if (v === null) continue;
    // Numbers come back as bare strings; patchToml would quote them (renderConfigs passes BigInt).
    out = patchToml(out, section, key, NUMERIC.has(key) && typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : v);
  }
  return out;
}

export function carrySettings(old: { root: string; client: string }, fresh: { root: string; client: string }): { root: string; client: string } {
  let client = carryKeys(old.client, fresh.client, CARRIED_CLIENT);
  // An old home still on the legacy `dns` key: carry it as dns_backend, like renderConfigs does.
  const legacy = readToml(old.client, 'network', 'dns');
  if (readToml(old.client, 'network', 'dns_backend') === null && typeof legacy === 'string') client = patchToml(client, 'network', 'dns_backend', legacy);
  return { root: carryKeys(old.root, fresh.root, CARRIED_ROOT), client };
}

/**
 * cb33 layout: the user's settings from an old home into the ONE config.toml of a fresh instance.
 * `old` is either the pre-cb33 pair (config.toml + client/config.toml) or a cb33 file passed as both.
 * The kill switch goes through writtenKillSwitch, so an old "on" arrives as persist (Q0426).
 */
export function carrySettingsInto(old: { root: string; client: string }, fresh: string): string {
  const both = carrySettings(old, { root: fresh, client: fresh });
  // carrySettings patched the same text twice: take the client result and lay the root keys on it.
  let out = carryKeys(old.root, both.client, CARRIED_ROOT);
  const ks = readToml(out, 'network', 'kill_switch');
  if (ks === 'on') out = patchToml(out, 'network', 'kill_switch', writtenKillSwitch('on'));
  return removeTomlKey(out, 'daemon', 'socket_group');
}
