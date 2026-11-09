// ─── Is DNS really left over after a session? (F15, UPSTREAM-GAPS #25) — Linux ───
// dvpnd's resolvectl backend sets the VPN's DNS servers on the TUNNEL link (with the `~.`
// routing domain); when the link is removed systemd-resolved drops them with it. The
// resolvconf backend writes them into /etc/resolv.conf and puts the old file back on stop.
// Before alarming the user about dns_revert_failed, look: a real leftover is one of the VPN's
// DNS servers still set on a live, non-VPN link, or still in /etc/resolv.conf.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { log } from '../logger';

export interface AdapterDns { alias: string; servers: string[] }

/** Pure decision, exported for tests. */
export function leftoverDns(adapters: AdapterDns[], vpnServers: string[]): AdapterDns[] {
  const ours = new Set(vpnServers.map((s) => s.trim().toLowerCase()).filter(Boolean));
  if (!ours.size) return [];
  return adapters.filter((a) => !/^(dvpn-|hy2-client$|ovpn-client$|tun\d)/i.test(a.alias) && a.servers.some((s) => ours.has(s.toLowerCase())));
}

/**
 * Parse `resolvectl dns`:
 *   Global: 1.1.1.1
 *   Link 2 (ens4): 169.254.169.254
 *   Link 7 (dvpn-wg-client): 10.8.0.1 fd00::1
 * plus /etc/resolv.conf (as alias "resolv.conf"). Exported for tests.
 */
export function parseAdapterDns(resolvectlOut: string, resolvConf = ''): AdapterDns[] {
  const rows: AdapterDns[] = [];
  for (const line of resolvectlOut.split(/\r?\n/)) {
    const m = /^\s*(?:Link \d+ \(([^)]+)\)|(Global)):\s*(.*)$/.exec(line);
    if (!m) continue;
    const servers = m[3].trim().split(/\s+/).filter(Boolean).map((s) => s.replace(/#.*$/, '').replace(/%.*$/, ''));
    if (servers.length) rows.push({ alias: m[1] ?? 'Global', servers });
  }
  const rc = [...resolvConf.matchAll(/^\s*nameserver\s+(\S+)/gm)].map((x) => x[1]);
  // 127.0.0.53 = systemd-resolved's stub: the real servers are the rows above.
  const real = rc.filter((s) => s !== '127.0.0.53' && s !== '127.0.0.54');
  if (real.length) rows.push({ alias: 'resolv.conf', servers: real });
  return rows;
}

function adapterDns(): Promise<AdapterDns[]> {
  let rc = '';
  try { rc = fs.readFileSync('/etc/resolv.conf', 'utf8'); } catch (err) { log.warn('cannot read /etc/resolv.conf', { err: (err as Error).message }); }
  return new Promise((resolve) => {
    execFile('resolvectl', ['dns'], { timeout: 15_000 }, (err, stdout) => {
      if (err) log.warn('resolvectl dns failed; checking resolv.conf only', { err: err.message });
      resolve(parseAdapterDns(err ? '' : String(stdout), rc));
    });
  });
}

/**
 * true = the VPN's DNS is still set somewhere (tell the user), false = the daemon's
 * report was a false alarm. Unknown (no servers, check failed) = true.
 */
export async function dnsReallyLeftOver(vpnServers: string[] | undefined): Promise<boolean> {
  if (!vpnServers?.length) return true;
  try {
    const left = leftoverDns(await adapterDns(), vpnServers);
    if (left.length) log.warn('VPN DNS still set', { adapters: left.map((a) => a.alias) });
    else log.info('dns_revert_failed was a false alarm: no link keeps the VPN DNS');
    return left.length > 0;
  } catch (err) {
    log.warn('DNS leftover check failed', { err: (err as Error).message });
    return true;
  }
}

/**
 * Drop systemd-resolved's cache after a tunnel comes up or goes down: answers (and failures)
 * cached on the old path are wrong for the new one. Same as `resolvectl flush-caches`.
 * Fire and forget, logged. No resolved (resolvconf systems) = nothing cached system-wide.
 */
export function flushDnsCache(): void {
  execFile('resolvectl', ['flush-caches'], { timeout: 10_000 }, (err) => {
    if (err) log.warn('flushing the DNS cache failed', { err: err.message });
  });
}
