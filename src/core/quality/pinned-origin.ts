// ─── Our own speed origin, reached by pinned key (row 148) ───
// Ported from sentinel-node-tester-solana lib/speed-method.js (`pinOk`, the /d/<seed>.bin request)
// as our own code. The origin serves any number of bytes per request with no 25 MB limit, so a
// fast server reaches a steady state instead of reading as a floor. It is identified by the
// SHA-256 of its public key (the format curl --pinnedpubkey uses), not by a certificate
// authority: a server on the path cannot answer in its place. Address and pin are public
// values; empty = the public speed hosts are used (core/quality/steady-download.ts).
import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import type { Duplex } from 'node:stream';
import { socks5Connect } from './socks';
import { dialHost, probeEndpointNow } from './quality';
import { PIN_MISMATCH, type SpeedSource, type StreamFetch } from './steady-download';

import { parseSpeedOrigin, type SpeedOrigin } from './speed-origin';

export { parseSpeedOrigin, type SpeedOrigin };

/** "sha256//<base64>" of a DER SubjectPublicKeyInfo. */
export function pinOf(spkiDer: Uint8Array): string {
  return `sha256//${createHash('sha256').update(spkiDer).digest('base64')}`;
}

function pinOfSocket(socket: unknown): string | null {
  const raw = (socket as tls.TLSSocket | undefined)?.getPeerCertificate?.(false)?.raw;
  if (!raw || !raw.length) return null;
  return pinOf(new X509Certificate(raw).publicKey.export({ type: 'spki', format: 'der' }));
}

/**
 * One download from the origin. The certificate chain is not checked (the origin has its own key,
 * no authority signs it); the key must hash to `pin` or the request fails with PIN_MISMATCH before
 * a byte is counted. Never resumes a TLS session: a resumed one carries no certificate to check.
 */
export function pinnedGet(pin: string): StreamFetch {
  return (url, idleTimeoutMs, onBytes, socks, maxMs) => new Promise((resolve, reject) => {
    const t0 = Date.now();
    let settled = false;
    const done = (fn: () => void): void => { if (!settled) { settled = true; fn(); } };
    const u = new URL(url);
    const host = dialHost(u);
    const through = socks ?? probeEndpointNow() ?? undefined; // a proxy session, or Android's tunnel probe
    const agent = new https.Agent({ keepAlive: false, maxCachedSessions: 0 });
    if (through) {
      (agent as unknown as { createConnection: (o: unknown, cb: (err: Error | null, s: Duplex) => void) => undefined }).createConnection = (_opts, cb) => {
        socks5Connect(through, host, Number(u.port) || 443, idleTimeoutMs)
          .then((raw) => cb(null, tls.connect({ socket: raw, rejectUnauthorized: false, ...(net.isIP(host) ? {} : { servername: host }) })))
          .catch((err: Error) => cb(err, undefined as unknown as Duplex));
        return undefined;
      };
    }
    const req = https.get(url, { timeout: idleTimeoutMs, rejectUnauthorized: false, agent, headers: { 'User-Agent': 'devnet-dvpn' } }, (res) => {
      if (pinOfSocket(res.socket) !== pin) {
        done(() => reject(new Error(PIN_MISMATCH)));
        req.destroy();
        return;
      }
      let bytes = 0;
      res.on('data', (c: Buffer) => {
        bytes += c.length;
        onBytes(bytes);
        if (!settled && Date.now() - t0 >= maxMs) {
          done(() => resolve({ status: res.statusCode ?? 0, bytes }));
          req.destroy();
        }
      });
      res.on('end', () => done(() => resolve({ status: res.statusCode ?? 0, bytes })));
      res.on('error', (err) => done(() => reject(err)));
    });
    req.on('timeout', () => req.destroy(new Error(`timeout after ${idleTimeoutMs}ms`)));
    req.on('error', (err) => done(() => reject(err)));
  });
}

/** The origin as a speed source: a new random seed per request, no 25 MB limit per request. */
export function originSource(o: SpeedOrigin, fetch: StreamFetch = pinnedGet(o.pin), seed: () => string = () => randomBytes(8).toString('hex')): SpeedSource {
  return {
    name: new URL(o.origin).host,
    url: (bytes) => { const s = seed(); return `${o.origin}/d/${s}.bin?s=${s}&n=${bytes}`; },
    maxRequestBytes: 2_000_000_000,
    pinned: true,
    fetch,
  };
}
