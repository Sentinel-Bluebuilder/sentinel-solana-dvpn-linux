import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { redact, scanPayload } from '../../scripts/payload-secret-scan.mjs';

// ─── Release payload api-key scan ───
const dirs: string[] = [];
function tree(files: Record<string, string | Buffer>): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pss-'));
  dirs.push(d);
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, name)), { recursive: true });
    fs.writeFileSync(path.join(d, name), body);
  }
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('payload-secret-scan', () => {
  it('finds a key in a config default and never prints its value', () => {
    const d = tree({ 'resources/app/config.json': '{"rpc":"https://rpc.example/?api-key=SECRET123&x=1"}' });
    const hits = scanPayload([d]);
    expect(hits).toHaveLength(1);
    expect(hits[0].hit).toBe('api-key=<REDACTED>');
    expect(JSON.stringify(hits)).not.toContain('SECRET123');
  });

  it('finds a key baked into a binary', () => {
    const bin = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 1]), Buffer.from('url=https://h/?api_key:abcDEF'), Buffer.from([0, 0xff])]);
    const hits = scanPayload([tree({ 'resources/bin/sentinel-dvpnd': bin })]);
    expect(hits.map((h) => h.hit)).toEqual(['api_key:<REDACTED>']);
  });

  it('passes a clean tree and an empty placeholder', () => {
    const d = tree({ 'a.js': 'const url = "https://api.devnet.solana.com";', 'b.md': 'set api_key= in your own config' });
    expect(scanPayload([d])).toEqual([]);
  });

  it('redacts every form', () => {
    expect(redact('x?apikey=1&api-key:2 api_key=3')).toBe('x?apikey=<REDACTED>&api-key:<REDACTED> api_key=<REDACTED>');
  });
});
