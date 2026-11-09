// ─── Browser through the VPN (F16.2) — Linux ───
// Starts Chrome, Chromium or Edge in its OWN profile with every request sent to the session's
// SOCKS endpoint and name lookups done by the node (no DNS from this computer for that window).
// The user's normal browser windows are not touched. Only V2Ray / Xray sessions expose a
// SOCKS endpoint today.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { storePath } from '../store';
import { log } from '../logger';

export type BrowserName = 'chrome' | 'chromium' | 'edge';
export const BROWSERS: BrowserName[] = ['chrome', 'chromium', 'edge'];
export const BROWSER_TITLES: Record<BrowserName, string> = { chrome: 'Google Chrome', chromium: 'Chromium', edge: 'Microsoft Edge' };

/** Command names each browser installs on Linux (deb/rpm/snap/flatpak-export), first match wins. */
export const BROWSER_COMMANDS: Record<BrowserName, string[]> = {
  chrome: ['google-chrome-stable', 'google-chrome'],
  chromium: ['chromium', 'chromium-browser'],
  edge: ['microsoft-edge-stable', 'microsoft-edge'],
};

/** Full paths to try for `name` along PATH (exported for tests). */
export function browserCandidates(name: BrowserName, env: NodeJS.ProcessEnv = process.env): string[] {
  const dirs = (env.PATH ?? '/usr/bin:/bin').split(':').filter(Boolean);
  for (const extra of ['/usr/bin', '/usr/local/bin', '/snap/bin', '/var/lib/flatpak/exports/bin']) if (!dirs.includes(extra)) dirs.push(extra);
  return BROWSER_COMMANDS[name].flatMap((cmd) => dirs.map((d) => path.join(d, cmd)));
}

export function findBrowser(name: BrowserName, exists: (p: string) => boolean = fs.existsSync): string | null {
  return browserCandidates(name).find((p) => exists(p)) ?? null;
}

/** Command-line flags. Exported for tests: the DNS rule is what keeps lookups off this computer. */
export function browserArgs(endpoint: string, profileDir: string, url: string): string[] {
  if (!/^127\.0\.0\.1:\d{2,5}$/.test(endpoint)) throw new Error(`"${endpoint}" is not a local SOCKS endpoint.`);
  return [
    `--proxy-server=socks5://${endpoint}`,
    // Chrome resolves names itself unless every host is mapped away; with this rule the SOCKS5
    // proxy (the node) resolves them. 127.0.0.1 is kept so the proxy itself is reachable.
    '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-quic', // QUIC is UDP; a SOCKS5 proxy here carries TCP only.
    '--new-window',
    url,
  ];
}

export interface LaunchResult { browser: BrowserName; exe: string; endpoint: string; profileDir: string }

export interface SnapProbe { realpath: (p: string) => string; readHead: (p: string) => string }
const realProbe: SnapProbe = {
  realpath: (p) => { try { return fs.realpathSync(p); } catch (err) { log.warn('browser path unresolved', { p, err: (err as Error).message }); return p; } },
  readHead: (p) => {
    try { const fd = fs.openSync(p, 'r'); try { const b = Buffer.alloc(4096); const n = fs.readSync(fd, b, 0, b.length, 0); return b.subarray(0, n).toString('latin1'); } finally { fs.closeSync(fd); } }
    catch (err) { log.warn('browser file unreadable', { p, err: (err as Error).message }); return ''; }
  },
};

/**
 * The snap a browser command runs, or null. Snap browsers are confined: they cannot write to
 * hidden folders in the home directory (`~/.config/...`), so a profile there makes Chromium exit
 * at once ("SingletonLock: Permission denied", exit 21). Ubuntu ships Chromium ONLY as a snap:
 * `/snap/bin/chromium` (a link to /usr/bin/snap) or the `/usr/bin/chromium-browser` wrapper script.
 */
export function snapName(exe: string, probe: SnapProbe = realProbe): string | null {
  const p = exe.replace(/\\/g, '/');
  const m = /^\/snap\/bin\/([a-z0-9][a-z0-9-]*)$/.exec(p);
  if (m) return m[1];
  if (probe.realpath(exe).replace(/\\/g, '/') === '/usr/bin/snap') return path.basename(p);
  const head = probe.readHead(exe);
  if (head.startsWith('#!')) { const s = /\/snap\/bin\/([a-z0-9][a-z0-9-]*)/.exec(head); if (s) return s[1]; }
  return null;
}

/** Where the browser's own profile lives: the app's store, or the snap's writable folder. */
export function profileDirFor(name: BrowserName, exe: string, home = process.env.HOME ?? '', probe: SnapProbe = realProbe): string {
  const snap = snapName(exe, probe);
  return snap && home ? path.join(home, 'snap', snap, 'common', 'devnet-dvpn-browser') : storePath(`browser-${name}`);
}

/** A browser that exits with an error within this window did not open (bad profile, no display …). */
const EARLY_EXIT_MS = 3000;

/** Launch the first installed browser (or the one asked for) through `endpoint`. */
export async function launchBrowser(endpoint: string, want?: BrowserName, url = 'https://api.ipify.org'): Promise<LaunchResult> {
  const order = want ? [want] : BROWSERS;
  for (const name of order) {
    const exe = findBrowser(name);
    if (!exe) continue;
    const profileDir = profileDirFor(name, exe);
    fs.mkdirSync(profileDir, { recursive: true });
    const child = spawn(exe, browserArgs(endpoint, profileDir, url), { detached: true, stdio: 'ignore' });
    // A second launch on the same profile hands the URL to the running window and exits 0: fine.
    const early = await new Promise<string | null>((resolve) => {
      const t = setTimeout(() => resolve(null), EARLY_EXIT_MS);
      child.once('error', (err) => { clearTimeout(t); resolve(err.message); });
      child.once('exit', (code, signal) => { clearTimeout(t); resolve(code === 0 ? null : `exit ${code ?? signal}`); });
    });
    child.unref();
    if (early) {
      log.error('browser closed right after starting', { exe, profileDir, why: early });
      throw new Error(`${BROWSER_TITLES[name]} closed right after starting (${early}). Nothing is using the VPN proxy.`);
    }
    log.info('browser launched through the VPN', { browser: name, endpoint, profileDir });
    return { browser: name, exe, endpoint, profileDir };
  }
  throw new Error(want ? `${BROWSER_TITLES[want]} is not installed on this computer.` : 'None of Google Chrome, Chromium or Microsoft Edge is installed on this computer.');
}

/** Tests / diagnostics: the browser's own version line (`google-chrome --version`). */
export function browserVersion(exe: string): string {
  try { return execFileSync(exe, ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim(); } catch (err) { log.warn('browser version unreadable', { exe, err: (err as Error).message }); return ''; }
}
