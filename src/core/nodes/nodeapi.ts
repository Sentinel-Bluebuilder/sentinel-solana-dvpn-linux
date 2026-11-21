// ─── HTTPS to node / provider daemons + signed-message checks ───
// Ported from sentinel-node-tester-solana lib/nodeapi.js (mirrors
// sentinel-go-sdk/auth byte for byte). The app only READS from daemons: signed
// metadata (signature over domain32 ‖ sha256(payload bytes)), plan rosters. Session
// credentials (vouchers, ticket requests) are the client daemon's job.
//
// TLS: daemons use self-signed certs and advertise a sha256 pin in their signed
// metadata (payload.api.tls_sha256). With a pin the handshake is torn down on
// mismatch BEFORE any request byte is sent.
import https from 'node:https';
import { createHash, createPublicKey, verify as edVerify } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';

/** Domain as dvpnd cf4c372+ builds it: sha256(tag) (sentinel-go-sdk/auth NewDomain). */
export function domain(tag: string): Buffer {
  return createHash('sha256').update(tag, 'utf8').digest();
}

/** Domain as dvpnd dfe36c7 built it: the tag zero-padded to 32 bytes. Nodes on that build still run. */
export function legacyDomain(tag: string): Buffer {
  if (Buffer.byteLength(tag) > 32) throw new Error(`domain ${tag} exceeds 32 bytes`); // copy:internal
  const d = Buffer.alloc(32);
  d.write(tag, 'utf8');
  return d;
}

// Each list = the current domain first, then the one older nodes sign with (tag renamed for providers).
export const DOMAIN_NODE_METADATA: readonly Buffer[] = [domain('sentinel-dvpn/node-metadata/v1'), legacyDomain('sentinel-dvpn/node-metadata/v1')];
export const DOMAIN_PROVIDER_METADATA: readonly Buffer[] = [domain('sentinel-dvpn/provider-metadata/v1'), legacyDomain('sentinel-dvpn/provider-meta/v1')];

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** ed25519 verify of (dom ‖ msg) by a base58 Solana pubkey, via node:crypto. */
export function verifyDomain(pubkey: string, dom: Buffer, msg: Buffer, sig: Buffer): boolean {
  const raw = new PublicKey(pubkey).toBuffer();
  const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
  return edVerify(null, Buffer.concat([dom, msg]), key, sig);
}

// ─── C31-1 (rc9-f2, M): the payload that is verified is the payload that is read ───
// Before, the signature was checked over the first `"payload"` text anywhere in the body, while discovery and plans
// read JSON.parse's member (the LAST duplicate). A body with two payload keys (the first signed, the second forged)
// passed signatureValid with forged claims, api.tls_sha256 included. Now only the body's own top-level members are
// read (keys decoded, so "payload" counts), a second top-level payload refuses the body, and callers read
// signedPayload(text): the exact text the signature covers.

/** Index just past the JSON string that starts at text[i] (a '"'), or -1. */
function stringEnd(text: string, i: number): number {
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === '\\') j += 1;
    else if (text[j] === '"') return j + 1;
  }
  return -1;
}

/** Index just past the JSON value that starts at text[i], or -1. */
function valueEnd(text: string, i: number): number {
  const c = text[i];
  if (c === '"') return stringEnd(text, i);
  if (c === '{' || c === '[') {
    let depth = 0;
    for (let j = i; j < text.length; j++) {
      const d = text[j];
      if (d === '"') {
        const e = stringEnd(text, j);
        if (e < 0) return -1;
        j = e - 1;
      } else if (d === '{' || d === '[') depth += 1;
      else if (d === '}' || d === ']') {
        depth -= 1;
        if (depth === 0) return j + 1;
      }
    }
    return -1;
  }
  let j = i;
  while (j < text.length && !/[\s,}\]]/.test(text[j])) j += 1;
  return j > i ? j : -1;
}

/** The raw text (byte-exact) of the body's single top-level `payload` object; null when absent, not an object,
 *  given twice, or the body is not one JSON object. */
export function rawPayload(text: string): string | null {
  let i = 0;
  const ws = (): void => { while (i < text.length && /\s/.test(text[i])) i += 1; };
  ws();
  if (text[i] !== '{') return null;
  i += 1;
  ws();
  if (text[i] === '}') return null;
  let found: string | null = null;
  for (;;) {
    ws();
    if (text[i] !== '"') return null;
    const ke = stringEnd(text, i);
    if (ke < 0) return null;
    let key: unknown;
    try {
      key = JSON.parse(text.slice(i, ke));
    } catch (err) {
      console.warn(`[nodeapi] signed body has an unreadable key: ${(err as Error).message}`);
      return null;
    }
    i = ke;
    ws();
    if (text[i] !== ':') return null;
    i += 1;
    ws();
    const ve = valueEnd(text, i);
    if (ve < 0) return null;
    if (key === 'payload') {
      if (found !== null) {
        console.warn('[nodeapi] signed body has more than one "payload" key: refused');
        return null;
      }
      if (text[i] !== '{') return null;
      found = text.slice(i, ve);
    }
    i = ve;
    ws();
    if (text[i] === ',') { i += 1; continue; }
    if (text[i] === '}') return found;
    return null;
  }
}

/** The payload exactly as signed (parsed from rawPayload), or null. Read the claims from this, never from json. */
export function signedPayload(text: string): Record<string, unknown> | null {
  const raw = rawPayload(text);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    console.warn(`[nodeapi] signed payload is not JSON: ${(err as Error).message}`);
    return null;
  }
}

export interface SignedBody { payload?: Record<string, unknown>; signature?: string; signer?: string }

export function verifySignedMetadata(text: string, json: SignedBody | null, doms: readonly Buffer[] = DOMAIN_NODE_METADATA): boolean {
  const raw = rawPayload(text);
  if (!raw || !json || !json.signature || !json.signer) return false;
  const digest = createHash('sha256').update(Buffer.from(raw, 'utf8')).digest();
  try {
    const sig = Buffer.from(json.signature, 'base64');
    const signer = json.signer;
    return doms.some((d) => verifyDomain(signer, d, digest, sig));
  } catch (err) {
    console.warn(`[nodeapi] signature check threw: ${(err as Error).message}`);
    return false;
  }
}

export interface HttpsResult {
  status: number;
  text: string;
  json: SignedBody & Record<string, unknown> | null;
  certSha256: string | null;
  latencyMs: number;
}

/** Audit U-4: most a server's answer may be (signed metadata is a few kB). More is cut off, so no server can fill memory. */
export const MAX_BODY_BYTES = 1_000_000;

/**
 * Collect a response body up to `max` bytes. Past it: `onTooBig` is called (the caller tears the request down)
 * and the promise rejects, so a server sending without end never grows the app's memory.
 */
export function collectBody(res: NodeJS.ReadableStream, max: number, onTooBig: (err: Error) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    res.on('data', (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > max) {
        done = true;
        const err = new Error(`answer larger than ${max} bytes`);
        onTooBig(err);
        reject(err);
        return;
      }
      chunks.push(c);
    });
    res.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    res.on('error', (err) => { if (!done) { done = true; reject(err); } });
  });
}

export class TlsPinError extends Error {
  code = 'tls-pin-mismatch';
}

export function httpsRequest(url: string, opts: { method?: string; pinSha256?: string | null; timeoutMs?: number; captureCert?: boolean } = {}): Promise<HttpsResult> {
  const { method = 'GET', pinSha256 = null, timeoutMs = 10_000, captureCert = false } = opts;
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    let certSha256: string | null = null;
    const started = Date.now();
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method,
      rejectUnauthorized: false, // self-signed daemon certs; trust comes from the signed pin
      agent: false, // fresh connection so the handshake hook always runs
      timeout: timeoutMs,
    }, (res) => {
      collectBody(res, MAX_BODY_BYTES, (err) => req.destroy(err)).then((body) => {
        const text = body.toString('utf8');
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch (err) {
          console.warn(`[nodeapi] ${u.host}${u.pathname}: body is not JSON (${(err as Error).message})`);
        }
        resolve({ status: res.statusCode ?? 0, text, json, certSha256, latencyMs: Date.now() - started });
      }, reject);
    });
    req.on('socket', (socket) => {
      socket.once('secureConnect', () => {
        const tls = socket as import('node:tls').TLSSocket;
        const cert = tls.getPeerCertificate();
        const got = cert && cert.raw ? createHash('sha256').update(cert.raw).digest('hex') : '';
        if (captureCert) certSha256 = got || null;
        if (pinSha256 && got.toLowerCase() !== pinSha256.toLowerCase()) {
          const e = new TlsPinError(`TLS certificate of ${u.hostname} does not match its signed pin`);
          socket.destroy(e);
          req.destroy(e);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`request to ${u.host} timed out after ${timeoutMs}ms`)));
    req.on('error', reject);
    req.end();
  });
}

export function parseUri(uri: string): { host: string; port: number; origin: string } | null {
  try {
    const u = new URL(uri);
    const port = Number(u.port) || 443;
    return { host: u.hostname, port, origin: `https://${u.hostname}:${port}` };
  } catch (err) {
    console.warn(`[nodeapi] not a URL: ${uri} (${(err as Error).message})`);
    return null;
  }
}
