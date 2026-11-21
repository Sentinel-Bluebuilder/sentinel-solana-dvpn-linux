// ─── rc9-f2 C31-1 (M): a body with two payload keys never passes as signed ───
import fs from 'node:fs';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { DOMAIN_NODE_METADATA, rawPayload, signedPayload, verifySignedMetadata } from '../../src/core/nodes/nodeapi';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const signer = new PublicKey(publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)).toBase58();
const GOOD = '{"node":"N","api":{"tls_sha256":"aa"}}';
const FORGED = '{"node":"N","api":{"tls_sha256":"ff"}}';
const signature = sign(null, Buffer.concat([DOMAIN_NODE_METADATA[0], createHash('sha256').update(GOOD).digest()]), privateKey).toString('base64');
const body = (members: string): string => `{${members},"signature":"${signature}","signer":"${signer}"}`;
const check = (text: string): boolean => verifySignedMetadata(text, JSON.parse(text));

describe('C31-1: the verified payload is the read payload', () => {
  it('control: one signed payload verifies, and signedPayload is that payload', () => {
    const t = body(`"payload":${GOOD}`);
    expect(check(t)).toBe(true);
    expect(signedPayload(t)).toEqual(JSON.parse(GOOD));
  });
  it('a duplicate payload key (signed first, forged last) is refused', () => {
    const t = body(`"payload":${GOOD},"payload":${FORGED}`);
    expect(JSON.parse(t).payload.api.tls_sha256).toBe('ff'); // what JSON.parse hands the readers
    expect(rawPayload(t)).toBeNull();
    expect(check(t)).toBe(false);
  });
  it('an escaped duplicate key ("pay\\u006coad") is refused too', () => {
    expect(check(body(`"payload":${GOOD},"pay\\u006coad":${FORGED}`))).toBe(false);
  });
  it('a nested "payload" before the real one is not what is verified', () => {
    const t = body(`"x":{"payload":${GOOD}},"payload":${FORGED}`);
    expect(rawPayload(t)).toBe(FORGED);
    expect(check(t)).toBe(false);
  });
  it('discovery and plans read signedPayload(res.text), never res.json.payload', () => {
    for (const f of ['src/core/nodes/discovery.ts', 'src/core/plans/plans.ts']) {
      const s = fs.readFileSync(f, 'utf8');
      expect(s, f).toContain('const m = (signedPayload(res.text) ?? {}) as Record<string, any>;');
      expect(s, f).not.toMatch(/const m = \(?res\.json\.payload/);
    }
  });
});
