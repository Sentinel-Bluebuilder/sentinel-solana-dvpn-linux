// ─── Desktop system proxy for per-app split (F16a) — Linux ───
// Current user, no root. The user's previous proxy settings are saved to disk BEFORE we change
// them, so a crash is undone on the next start (restoreProxyOnStartup). Only V2Ray/Xray
// sessions expose a SOCKS endpoint.
// Backends:
//   gnome — gsettings org.gnome.system.proxy[.socks|.http|.https|.ftp]. GNOME, Unity, Budgie,
//           Cinnamon, MATE and Chromium/Chrome/Firefox ("use system proxy") read these.
//   kde   — ~/.config/kioslaverc [Proxy Settings] via kreadconfig/kwriteconfig 5|6.
// Values are kept in their own text form (GVariant text for gsettings) and written back
// verbatim through execFile argument arrays: no shell, nothing is re-quoted.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { readJson, writeJson, storePath } from '../store';
import { log } from '../logger';
import { patch } from '../app-state';
import { checkSocks5 } from '../../core/quality/socks-check';

const BACKUP = 'proxy-backup.json';

export type ProxyBackend = 'gnome' | 'kde';
/** Raw values keyed `schema key` (gnome) or `Proxy Settings key` (kde). */
export interface ProxyState { backend: ProxyBackend; values: Record<string, string> }

interface Saved { state: ProxyState; ours: string }

export interface ProxyRunner {
  backend(): Promise<ProxyBackend | null>;
  query(backend: ProxyBackend): Promise<ProxyState>;
  set(s: ProxyState): Promise<ProxyState>;
}

// ─── GNOME keys we read, save and restore ───
export const GNOME_KEYS: Array<[string, string]> = [
  ['org.gnome.system.proxy', 'mode'],
  ['org.gnome.system.proxy', 'autoconfig-url'],
  ['org.gnome.system.proxy', 'ignore-hosts'],
  ['org.gnome.system.proxy', 'use-same-proxy'],
  ['org.gnome.system.proxy.socks', 'host'],
  ['org.gnome.system.proxy.socks', 'port'],
  ['org.gnome.system.proxy.http', 'host'],
  ['org.gnome.system.proxy.http', 'port'],
  ['org.gnome.system.proxy.http', 'enabled'],
  ['org.gnome.system.proxy.https', 'host'],
  ['org.gnome.system.proxy.https', 'port'],
  ['org.gnome.system.proxy.ftp', 'host'],
  ['org.gnome.system.proxy.ftp', 'port'],
];
export const KDE_KEYS = ['ProxyType', 'socksProxy', 'httpProxy', 'httpsProxy', 'ftpProxy', 'NoProxyFor', 'Proxy Config Script'];

const run = (cmd: string, args: string[]): Promise<string> => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: 15_000 }, (err, stdout, stderr) => {
    if (err) reject(new Error(`${cmd} ${args.slice(0, 3).join(' ')}: ${String(stderr).trim().split('\n')[0] || err.message}`));
    else resolve(String(stdout).replace(/\n$/, ''));
  });
});
const has = (cmd: string): Promise<boolean> => run('sh', ['-c', `command -v ${cmd}`]).then(() => true, () => false);
const kdeTool = async (kind: 'read' | 'write'): Promise<string | null> => {
  for (const v of ['6', '5']) if (await has(`k${kind}config${v}`)) return `k${kind}config${v}`;
  return null;
};

/** What we set: SOCKS for every proxy-aware app, loopback direct. */
export function oursFor(endpoint: string, backend: ProxyBackend): ProxyState {
  const [host, port] = endpoint.split(':');
  if (backend === 'kde') {
    return { backend, values: { ProxyType: '1', socksProxy: `socks://${host} ${port}`, httpProxy: '', httpsProxy: '', ftpProxy: '', NoProxyFor: 'localhost,127.0.0.1,::1', 'Proxy Config Script': '' } };
  }
  return {
    backend,
    values: {
      'org.gnome.system.proxy mode': "'manual'",
      'org.gnome.system.proxy autoconfig-url': "''",
      'org.gnome.system.proxy ignore-hosts': "['localhost', '127.0.0.0/8', '::1']",
      'org.gnome.system.proxy use-same-proxy': 'false',
      'org.gnome.system.proxy.socks host': `'${host}'`,
      'org.gnome.system.proxy.socks port': port,
      'org.gnome.system.proxy.http host': "''",
      'org.gnome.system.proxy.http port': '0',
      'org.gnome.system.proxy.http enabled': 'false',
      'org.gnome.system.proxy.https host': "''",
      'org.gnome.system.proxy.https port': '0',
      'org.gnome.system.proxy.ftp host': "''",
      'org.gnome.system.proxy.ftp port': '0',
    },
  };
}

/** A short marker of "ours", stored with the backup: `socks <host>:<port>`. */
export function oursMarker(endpoint: string): string {
  return `socks ${endpoint}`;
}

/** Is `s` exactly the SOCKS setting we made for `marker`? Exported for tests. */
export function isOurs(s: ProxyState, marker: string): boolean {
  const ep = marker.replace(/^socks /, '');
  const [host, port] = ep.split(':');
  if (s.backend === 'kde') return s.values.ProxyType === '1' && s.values.socksProxy === `socks://${host} ${port}`;
  return s.values['org.gnome.system.proxy mode'] === "'manual'"
    && s.values['org.gnome.system.proxy.socks host'] === `'${host}'`
    && s.values['org.gnome.system.proxy.socks port'] === port;
}

// ─── A leftover of ours (Q0281) ───
// With no backup, setSystemProxy saved whatever was on as "what the user had". When that was our own
// SOCKS left from a crash or a failed restore, every later restore put our dead proxy back. "Looks
// ours" = the shape we set (SOCKS only, on 127.0.0.1, other proxies blank), on any port.

/** Our SOCKS shape on loopback, any port. Exported for tests. */
export function looksOurs(s: ProxyState): boolean {
  const v = s.values;
  if (s.backend === 'kde') return v.ProxyType === '1' && /^socks:\/\/127\.0\.0\.1 \d{2,5}$/.test(v.socksProxy ?? '') && !v.httpProxy && !v.httpsProxy && !v.ftpProxy;
  return v['org.gnome.system.proxy mode'] === "'manual'" && v['org.gnome.system.proxy.socks host'] === "'127.0.0.1'"
    && v['org.gnome.system.proxy.http host'] === "''" && v['org.gnome.system.proxy.https host'] === "''" && v['org.gnome.system.proxy.ftp host'] === "''";
}

/** No proxy for that backend: what a leftover of ours is saved or restored as. Exported for tests. */
export function directFor(backend: ProxyBackend): ProxyState {
  return backend === 'kde' ? { backend, values: { ProxyType: '0' } } : { backend, values: { 'org.gnome.system.proxy mode': "'none'" } };
}

let runner: ProxyRunner = {
  async backend() {
    const desk = `${process.env.XDG_CURRENT_DESKTOP ?? ''}:${process.env.DESKTOP_SESSION ?? ''}`;
    if (/kde|plasma/i.test(desk) && await kdeTool('write')) return 'kde';
    if (await has('gsettings')) {
      try {
        await run('gsettings', ['get', 'org.gnome.system.proxy', 'mode']);
        return 'gnome';
      } catch (err) {
        log.warn('gsettings has no proxy schema', { err: (err as Error).message });
      }
    }
    return null;
  },
  async query(backend) {
    const values: Record<string, string> = {};
    if (backend === 'kde') {
      const tool = await kdeTool('read');
      if (!tool) throw new Error('The KDE settings tool (kreadconfig) is missing. Nothing was changed.');
      for (const k of KDE_KEYS) values[k] = await run(tool, ['--file', 'kioslaverc', '--group', 'Proxy Settings', '--key', k]);
      return { backend, values };
    }
    for (const [schema, key] of GNOME_KEYS) values[`${schema} ${key}`] = await run('gsettings', ['get', schema, key]);
    return { backend, values };
  },
  async set(s) {
    if (s.backend === 'kde') {
      const tool = await kdeTool('write');
      if (!tool) throw new Error('The KDE settings tool (kwriteconfig) is missing. Nothing was changed.');
      for (const [k, v] of Object.entries(s.values)) {
        if (v === '') await run(tool, ['--file', 'kioslaverc', '--group', 'Proxy Settings', '--key', k, '--delete']);
        else await run(tool, ['--file', 'kioslaverc', '--group', 'Proxy Settings', '--key', k, v]);
      }
      // Tell running KDE apps to re-read it (best effort: no session bus over SSH).
      await run('dbus-send', ['--type=signal', '/KIO/Scheduler', 'org.kde.KIO.Scheduler.reparseSlaveConfiguration', 'string:']).catch((err: Error) => log.warn('KIO reparse signal failed', { err: err.message }));
      return runner.query('kde');
    }
    // mode last: apps switch only once the host/port are already right
    const entries = Object.entries(s.values).sort(([a], [b]) => Number(a.endsWith(' mode')) - Number(b.endsWith(' mode')));
    for (const [k, v] of entries) {
      const at = k.lastIndexOf(' ');
      await run('gsettings', ['set', k.slice(0, at), k.slice(at + 1), v]);
    }
    return runner.query('gnome');
  },
};

/** Tests only: never touch the real proxy settings. */
export function setProxyRunner(r: ProxyRunner): void {
  runner = r;
}

let socksCheck: typeof checkSocks5 = checkSocks5;
/** Tests only: replace the SOCKS liveness check. */
export function setSocksCheck(c: typeof checkSocks5): void {
  socksCheck = c;
}

/** `endpoint` = the session's proxy_endpoint, e.g. "127.0.0.1:1080". */
export async function setSystemProxy(endpoint: string): Promise<void> {
  if (!/^127\.0\.0\.1:\d{2,5}$/.test(endpoint)) throw new Error(`refusing non-loopback proxy endpoint ${endpoint}`); // copy:internal
  // A dead proxy as the system proxy cuts every app's internet: prove it works here first.
  const live = await socksCheck(endpoint);
  if (!live.ok) throw new Error(`The VPN's SOCKS proxy is not answering on this computer (${live.reason}). Nothing was changed.`);
  const backend = await runner.backend();
  if (!backend) throw new Error(`This desktop has no system proxy setting this app can change (GNOME or KDE). Set SOCKS5 127.0.0.1 port ${endpoint.split(':')[1]} in your apps instead. Nothing was changed.`);
  const ours = oursFor(endpoint, backend);
  if (!fs.existsSync(storePath(BACKUP))) {
    const had = await runner.query(backend);
    // A leftover of ours is not what the user had: save it as no proxy (Q0281).
    if (looksOurs(had)) log.warn('system proxy: a SOCKS proxy of ours was on with no backup; saved as no proxy', { backend });
    const saved: Saved = { state: looksOurs(had) ? directFor(backend) : had, ours: oursMarker(endpoint) };
    writeJson(BACKUP, saved);
  } else {
    const prev = readJson<Saved | null>(BACKUP, null);
    if (prev) writeJson(BACKUP, { ...prev, ours: oursMarker(endpoint) });
  }
  const now = await runner.set(ours);
  if (!isOurs(now, oursMarker(endpoint))) throw new Error('The desktop did not accept the proxy setting. Nothing else was changed.');
  patch({ proxyActive: true });
  log.info('system proxy set', { endpoint, backend });
}

export function systemProxyActive(): boolean {
  return fs.existsSync(storePath(BACKUP));
}

/**
 * Put back exactly what the user had. No-op when we never set it. `orphan`: an explicit "proxy off"
 * (CLI + app switch) and a CLI disconnect with no session also clear a proxy of ours that has no
 * backup (Q0281); app start and session end skip that extra query.
 */
export async function clearSystemProxy(opts: { orphan?: boolean } = {}): Promise<void> {
  const saved = readJson<Saved | null>(BACKUP, null);
  if (!saved?.state?.backend) {
    if (fs.existsSync(storePath(BACKUP))) fs.rmSync(storePath(BACKUP), { force: true });
    if (!opts.orphan) return;
    const backend = await runner.backend();
    if (!backend) return;
    const now = await runner.query(backend);
    if (!looksOurs(now)) return;
    await runner.set(directFor(backend));
    patch({ proxyActive: false });
    log.info('system proxy: cleared a SOCKS proxy of ours left with no backup', { backend });
    return;
  }
  try {
    // Only undo if the value is still ours (the user may have changed it since); any port of ours counts.
    const now = await runner.query(saved.state.backend);
    const back = looksOurs(saved.state) ? directFor(saved.state.backend) : saved.state;
    if (isOurs(now, saved.ours) || looksOurs(now)) await runner.set(back);
    else log.info('system proxy changed by someone else since; left as it is', { backend: saved.state.backend });
    fs.rmSync(storePath(BACKUP), { force: true });
    patch({ proxyActive: false });
    log.info('system proxy restored');
  } catch (err) {
    log.error('system proxy restore failed', err);
    throw err;
  }
}

export const restoreProxyOnStartup = clearSystemProxy;
