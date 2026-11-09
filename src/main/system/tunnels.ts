// ─── Leftover tunnels (F14.3, UPSTREAM-GAPS #24 / #29 / #32) — Linux ───
// A dvpnd that died (SIGKILL, crash, power loss) can leave its tunnel link up and its
// protocol process running: the default route still points into the dead tunnel, and the
// kill switch table `inet sentinel-dvpn-c0` (cb33; `inet dvpnd` before) may still drop everything (sentinel-solana docs 25 §3).
// "Restore network" removes only ours; a user's own tunnels are never touched.
// Detection is unelevated: links from `ip -o link`, processes from /proc. (Listing the nft
// table needs root, so it is checked and removed by the elevated step.)
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../logger';
import { runElevated } from './elevate';
import { binPath, scriptPath } from '../daemon/manager';

/** Links dvpnd creates for a client session (go-sdk wireguard/amneziawg/hysteria2/openvpn). */
// dvpn-hy2-client / dvpn-ovp-client are the names live dvpnd uses (journal, Fedora 44 2026-10-22);
// hy2-client / ovpn-client are older builds'.
// cb33 (sentinel-dvpnd): one link per instance, dvpn-c0, for every protocol.
const OUR_LINKS = /^(dvpn-c0|dvpn-wg-client|dvpn-awg-client|dvpn-hy2-client|dvpn-ovp-client|hy2-client|ovpn-client)$/;

/** Parse `ip -o link show`: our tunnel links that exist now. Exported for tests. */
export function parseTunnelLinks(ipOutput: string): string[] {
  const out: string[] = [];
  for (const line of ipOutput.split(/\r?\n/)) {
    const name = /^\d+:\s+([^:@\s]+)/.exec(line)?.[1];
    if (name && OUR_LINKS.test(name)) out.push(name);
  }
  return out;
}

/** Our tunnel links that exist now ([] when `ip` fails). */
export function runningTunnelServices(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile('ip', ['-o', 'link', 'show'], { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) { log.warn('ip link failed; cannot look for leftover tunnels', { err: err.message }); resolve([]); return; }
      resolve(parseTunnelLinks(String(stdout)));
    });
  });
}

/** Remove our leftover tunnels, kill switch table and orphaned protocol processes (one administrator prompt). Call only with no live session. */
export async function removeTunnelServices(): Promise<{ ok: boolean; detail: string }> {
  const r = await runElevated(scriptPath('remove-tunnels.sh'), { BinRoot: path.dirname(binPath('x')) }, 120_000);
  log.info('leftover tunnels', { status: r.status, detail: r.detail });
  return { ok: r.status === 'ok', detail: r.detail };
}

// ─── Orphaned protocol processes (UPSTREAM-GAPS #32) ───
// When dvpnd dies, its hysteria2 / v2ray / xray child can keep running and keep the tunnel
// (and, for per-hour channels, the bill) going. Ours = run from the app's own bin folder;
// openvpn = run with dvpnd's config under /var/lib/sentinel-dvpn (cb33) or /var/lib/dvpnd (before).
export interface ProcInfo { pid: number; comm: string; exe: string; cmdline: string }

/** Pure filter, exported for tests. */
export function orphanProcesses(procs: ProcInfo[], appBinDir: string): string[] {
  const out: string[] = [];
  for (const p of procs) {
    const ours = (/^(hysteria2|v2ray|xray)$/.test(p.comm) && (p.exe.startsWith(appBinDir + path.sep) || p.exe.startsWith('/opt/devnet-dvpn/') || p.exe.startsWith('/usr/local/lib/devnet-dvpn/')))
      || (p.comm === 'openvpn' && (p.cmdline.includes('/var/lib/sentinel-dvpn/') || p.cmdline.includes('/var/lib/dvpnd/')));
    if (ours) out.push(`${p.comm}:${p.pid}`);
  }
  return out;
}

function listProcs(): ProcInfo[] {
  const out: ProcInfo[] = [];
  let dirs: string[] = [];
  try { dirs = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)); } catch (err) { log.warn('cannot read /proc', { err: (err as Error).message }); return out; }
  for (const d of dirs) {
    try {
      const comm = fs.readFileSync(`/proc/${d}/comm`, 'utf8').trim();
      if (!/^(hysteria2|v2ray|xray|openvpn)$/.test(comm)) continue;
      let exe = '';
      try {
        exe = fs.readlinkSync(`/proc/${d}/exe`);
      } catch (err) {
        // A root-owned process hides its exe link (EACCES); its cmdline is still readable.
        if ((err as NodeJS.ErrnoException).code !== 'EACCES') log.warn('cannot read process exe', { pid: d, err: (err as Error).message });
      }
      const cmdline = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8').replace(/\0/g, ' ');
      if (!exe) exe = cmdline.split(' ')[0] ?? '';
      out.push({ pid: Number(d), comm, exe, cmdline });
    } catch (err) {
      // ENOENT/ESRCH: the process ended while we looked. Anything else is worth a line.
      if (!['ENOENT', 'ESRCH'].includes((err as NodeJS.ErrnoException).code ?? '')) log.warn('cannot read process', { pid: d, err: (err as Error).message });
    }
  }
  return out;
}

/** Our protocol processes running now (unelevated). */
export function runningProtocolProcesses(): Promise<string[]> {
  return Promise.resolve(orphanProcesses(listProcs(), path.dirname(binPath('x'))));
}

// ─── Another VPN holding the default route (Cosmos lesson D6, #31 07a8144) — Linux ───
// Two VPNs fight over the same traffic: routes conflict and the second tunnel often carries
// nothing. On Linux a VPN shows up as the 0.0.0.0/1 + 128.0.0.0/1 pair (OpenVPN def1, many
// clients) or as a default route on a tunnel-type link, in main or in its own table (wg-quick
// puts it in table 51820 behind a rule). Our own links are skipped.
const VPN_LINK = /^(wg|tun|tap|ppp|nordlynx|nordtun|proton|pvpn|mullvad|tailscale|zt|ipsec|vti|cscotun|gpd|utun|wt\d|expressvpn|surfshark|windscribe)/i;

/** Parse `ip -o -4 route show table all`: other VPNs' link names. Exported for tests. */
export function parseRivalRoutes(text: string): string[] {
  const out = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const f = line.trim().split(/\s+/);
    const dest = f[0] === 'unicast' ? f[1] : f[0];
    const at = f.indexOf('dev');
    const dev = at >= 0 ? f[at + 1] : undefined;
    if (!dev || OUR_LINKS.test(dev) || /^dvpn-/.test(dev) || dev === 'lo') continue;
    const half = dest === '0.0.0.0/1' || dest === '128.0.0.0/1';
    const vpnDefault = (dest === 'default' || dest === '0.0.0.0/0') && VPN_LINK.test(dev);
    if (half || vpnDefault) out.add(dev);
  }
  return [...out];
}

/** Other VPNs holding the default route now (unelevated; [] when `ip` fails). */
export function rivalVpns(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile('ip', ['-o', '-4', 'route', 'show', 'table', 'all'], { timeout: 10_000 }, (err, stdout) => {
      if (err && !stdout) { log.warn('route query failed; cannot look for another VPN', { err: err.message }); resolve([]); return; }
      resolve(parseRivalRoutes(String(stdout)));
    });
  });
}

/** Doctor row: ok when no other VPN holds the default route, warn with plain copy when one does. */
export async function rivalVpnRow(): Promise<{ name: string; ok: boolean; level: 'ok' | 'warn'; detail: string }> {
  const rivals = await rivalVpns();
  if (rivals.length === 0) return { name: 'other_vpn', ok: true, level: 'ok', detail: 'No other VPN is active.' };
  return {
    name: 'other_vpn', ok: true, level: 'warn',
    detail: `Another VPN is on (${rivals.join(', ')}). Turn it off before you connect: two VPNs fight over the same traffic and yours may carry nothing.`,
  };
}

/** Everything a dead or failed session can leave holding the network: tunnel links + protocol processes. */
export async function leftoverTunnels(): Promise<string[]> {
  const [links, proc] = await Promise.all([runningTunnelServices(), runningProtocolProcesses()]);
  return [...links, ...proc];
}
