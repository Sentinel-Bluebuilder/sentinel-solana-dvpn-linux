import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { createKeyfile, KeyfileExistsError } from '../../src/core/wallet/new-keyfile';

// Q0490 (the Linux app hunt H1, Linux 0.1.21): with no unlocked keyring (SSH, a server) the app had no way to make a
// wallet. `wallet create --keyfile <new path>` writes a new solana-keygen key file, never over an existing one.
const dirs: string[] = [];
const tmp = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ddv-kf-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('wallet create --keyfile <new path> (Q0490)', () => {
  it('writes a solana-keygen key file whose key matches the printed address, creating the folder', () => {
    const file = path.join(tmp(), 'nested', 'keys', 'wallet.json');
    const r = createKeyfile(file);
    const secret = Uint8Array.from(JSON.parse(fs.readFileSync(file, 'utf8')) as number[]);
    expect(secret.length).toBe(64);
    expect(Keypair.fromSecretKey(secret).publicKey.toBase58()).toBe(r.address);
    expect(r.path).toBe(path.resolve(file));
  });

  it('returns the address and path only, never the key', () => {
    const kp = Keypair.generate();
    const r = createKeyfile(path.join(tmp(), 'w.json'), () => kp);
    expect(Object.keys(r).sort()).toEqual(['address', 'path']);
    expect(JSON.stringify(r)).not.toContain(String(kp.secretKey[0]) + ',' + String(kp.secretKey[1]));
  });

  // Negative control: an existing file is refused and left byte for byte as it was.
  it('refuses an existing path and leaves that file untouched', () => {
    const file = path.join(tmp(), 'wallet.json');
    fs.writeFileSync(file, 'keep me');
    expect(() => createKeyfile(file)).toThrow(KeyfileExistsError);
    expect(fs.readFileSync(file, 'utf8')).toBe('keep me');
  });

  it('two creates at one path: the second is refused, the first key stays', () => {
    const file = path.join(tmp(), 'wallet.json');
    const first = createKeyfile(file);
    expect(() => createKeyfile(file)).toThrow(/already exists/);
    const secret = Uint8Array.from(JSON.parse(fs.readFileSync(file, 'utf8')) as number[]);
    expect(Keypair.fromSecretKey(secret).publicKey.toBase58()).toBe(first.address);
  });
});
