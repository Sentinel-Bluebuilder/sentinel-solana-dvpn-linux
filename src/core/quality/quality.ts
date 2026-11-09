// ─── Public IP + speed test (F19.1, F19.2) ───
// Third-party services, disclosed in Settings and switchable off. Each check
// walks a fallback chain (HNS recs §2.1–2.2) so one dead service never fails it.
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import type { Duplex } from 'node:stream';
import { socks5Connect } from './socks';

// Q0365: the first three need no DNS (Cloudflare's trace on its resolver IPs; the certificate covers
// them), so the check works while the session's DNS is still slow. All run at once; first answer wins.
export const IP_SERVICES = [
  'https://1.1.1.1/cdn-cgi/trace', 'https://1.0.0.1/cdn-cgi/trace', 'https://[2606:4700:4700::1111]/cdn-cgi/trace',
  'https://api.ipify.org?format=json', 'https://api64.ipify.org?format=json', 'https://ifconfig.co/json',
];
const SPEED_URLS = ['https://speed.cloudflare.com/__down?bytes=10000000', 'https://proof.ovh.net/files/10Mb.dat'];

/**
 * `socks` = a local SOCKS5 endpoint: the request then goes through it (TLS on top).
 * `timeoutMs` is an idle timeout (no bytes for that long). `maxMs` caps the whole download: past it the
 * transfer stops and resolves with what arrived (`capped`), so a slow but steady link can't run for
 * minutes (port of Android accff5a).
 */
function get(url: string, timeoutMs: number, onData?: (n: number) => void, socks?: string, maxMs?: number): Promise<{ status: number; body: string; bytes: number; ms: number; capped?: boolean }> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    let settled = false;
    const u = new URL(url);
    const host = unbracket(u.hostname); // an IPv6 literal comes bracketed
    // The request's own `createConnection` is ignored once an Agent is involved (agent:false
    // builds a fresh one), so the SOCKS dial lives on a dedicated Agent. Async form: return
    // nothing, hand the TLS socket to `cb` once SOCKS is up. No fallback to direct.
    // Always a fresh connection: Node's global agent keeps sockets alive, and a socket opened
    // before a full tunnel came up still leaves through the old route (shows the direct IP).
    let viaSocks: { agent: https.Agent } = { agent: new https.Agent({ keepAlive: false }) };
    if (socks) {
      const agent = new https.Agent({ keepAlive: false });
      // Agent.createConnection is real Node API (http.Agent) but missing from @types/node.
      (agent as unknown as { createConnection: (o: unknown, cb: (err: Error | null, s: Duplex) => void) => undefined }).createConnection = (_opts, cb) => {
        socks5Connect(socks, host, Number(u.port) || 443, timeoutMs)
          // SNI takes names only; an IP literal is checked against the certificate's IP entries.
          .then((raw) => cb(null, tls.connect({ socket: raw, ...(net.isIP(host) ? {} : { servername: host }) })))
          .catch((err: Error) => cb(err, undefined as unknown as Duplex));
        return undefined;
      };
      viaSocks = { agent };
    }
    const req = https.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'devnet-dvpn' }, ...viaSocks }, (res) => {
      let bytes = 0;
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => {
        bytes += c.length;
        if (onData) onData(bytes); else chunks.push(c);
        if (maxMs && !settled && Date.now() - t0 >= maxMs) {
          settled = true;
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), bytes, ms: Date.now() - t0, capped: true });
          req.destroy();
        }
      });
      res.on('end', () => { if (!settled) { settled = true; resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), bytes, ms: Date.now() - t0 }); } });
      res.on('error', (err) => { if (!settled) { settled = true; reject(err); } });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
    req.on('error', (err) => { if (!settled) { settled = true; reject(err); } });
  });
}

/** True when `ip` lies in one of `cidrs` (validated split-tunnelling routes). */
export function inRoutes(ip: string, cidrs: string[]): boolean {
  const list = new net.BlockList();
  for (const c of cidrs) {
    const [addr, bits] = c.split('/');
    list.addSubnet(addr, Number(bits), addr.includes(':') ? 'ipv6' : 'ipv4');
  }
  return list.check(ip, ip.includes(':') ? 'ipv6' : 'ipv4');
}

/**
 * Public IP; with `socks` (a proxy session's endpoint) it is the VPN exit IP.
 * `avoid` = routes split tunnelling leaves out of the VPN: a service at one of those addresses
 * would answer with the user's own IP by design, so it is skipped (else "not going through the VPN"
 * was shown for a working exclude split whose list held the IP service, VM 2026-10-22).
 */
export function publicIp(timeoutMs = 6000, socks?: string, avoid: string[] = []): Promise<{ ip: string; source: string } | { error: string }> {
  return firstIp(IP_SERVICES, async (url) => {
    if (avoid.length && !socks) {
      // An IP literal is checked as is (no DNS); a name is looked up first.
      const host = unbracket(new URL(url).hostname);
      const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
      if (addrs.some((a) => inRoutes(a, avoid))) throw new Error('Left out of the VPN by split tunnelling.');
    }
    return get(url, timeoutMs, undefined, socks);
  });
}

/** `[2606:…]` → `2606:…` (URL.hostname keeps an IPv6 literal's brackets). */
export function unbracket(host: string): string {
  return host.replace(/^\[|\]$/g, '');
}

/** The IP in a service's answer: JSON {ip} or Cloudflare trace lines (ip=…); null if none. */
export function ipFromBody(body: string): string | null {
  const trace = /^ip=(.+)$/m.exec(body)?.[1]?.trim();
  if (trace) return net.isIP(trace) ? trace : null;
  try {
    const ip = (JSON.parse(body) as { ip?: unknown }).ip;
    return typeof ip === 'string' && net.isIP(ip) ? ip : null;
  } catch (err) {
    console.debug('IP service answer is not JSON', (err as Error).message);
    return null;
  }
}

type Fetch = (url: string) => Promise<{ status: number; body: string }>;

/** Asks every service at once (Q0365, port of #31 528923d); the first valid IP wins, else every error. */
export async function firstIp(services: readonly string[], fetch: Fetch): Promise<{ ip: string; source: string } | { error: string }> {
  const errors: string[] = [];
  try {
    return await Promise.any(services.map(async (url) => {
      const host = new URL(url).host;
      try {
        const r = await fetch(url);
        const ip = r.status === 200 ? ipFromBody(r.body) : null;
        if (ip) return { ip, source: host };
        errors.push(`${host}: HTTP ${r.status}`);
      } catch (err) {
        errors.push(`${host}: ${(err as Error).message}`);
      }
      throw new Error(host);
    }));
  } catch (err) {
    console.debug('no IP service answered', (err as Error).message);
    return { error: `No IP service answered (${errors.join('; ')})` };
  }
}

/** `socks` = a proxy session's endpoint: the download then goes through the VPN. */
/** Longest a speed test downloads: a slow link reports its rate from what arrived by then. */
export const SPEED_MAX_MS = 45_000;

export async function speedTest(timeoutMs = 20_000, socks?: string, maxMs = SPEED_MAX_MS): Promise<{ mbps: number; bytes: number; ms: number; source: string } | { error: string }> {
  const errors: string[] = [];
  for (const url of SPEED_URLS) {
    try {
      const r = await get(url, timeoutMs, () => undefined, socks, maxMs);
      if (r.status !== 200 || r.bytes < 100_000) { errors.push(`${new URL(url).host}: HTTP ${r.status}`); continue; }
      return { mbps: Math.round((r.bytes * 8) / (r.ms / 1000) / 1e4) / 100, bytes: r.bytes, ms: r.ms, source: new URL(url).host };
    } catch (err) {
      errors.push(`${new URL(url).host}: ${(err as Error).message}`);
    }
  }
  return { error: `Speed test failed (${errors.join('; ')})` };
}
