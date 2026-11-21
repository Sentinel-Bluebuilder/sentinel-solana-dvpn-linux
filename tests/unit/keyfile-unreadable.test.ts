// ─── E-EP (the agent kit rc.9, review rc.8 edge check): an unreadable key file is keyfile-unreadable with a next ───
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readKeyfile, keyfileUnreadableNext, cliKeyStore } from '../../src/cli/keystore';
import { exitCodeFor } from '../../src/cli/exit-codes';
import { moneyOf } from '../../src/cli/money-note';
import { errorOutput } from '../../src/cli/error-out';

const denied = (code: string) => (): string => { throw Object.assign(new Error(`${code}: operation not permitted, open 'C:\\k.json'`), { code }); };

describe('E-EP: an unreadable key file', () => {
  it('review shape: EPERM → keyfile-unreadable, exit 4, money none, a next (never null)', () => {
    let err: unknown;
    try { readKeyfile('C:\\k.json', denied('EPERM')); } catch (e) { err = e; }
    expect(err).toMatchObject({ code: 'keyfile-unreadable', action: keyfileUnreadableNext('C:\\k.json') });
    expect(exitCodeFor('keyfile-unreadable')).toBe(4);
    expect(moneyOf('keyfile-unreadable')).toBe('none');
    const j = JSON.parse(errorOutput(err, true, 'wallet show').text);
    expect(j).toMatchObject({ ok: false, code: 'keyfile-unreadable' });
    expect(j.next).toMatch(/, then devnet-dvpn wallet show --json$/);
  });
  it('EACCES (Linux, macOS) is the same code', () => {
    expect(() => readKeyfile('/k.json', denied('EACCES'))).toThrow(expect.objectContaining({ code: 'keyfile-unreadable' }));
  });
  it('one command per OS', () => {
    expect(keyfileUnreadableNext('C:\\k.json', 'win32')).toMatch(/^icacls "C:\\k\.json" \/grant "[^%"]+:R", then devnet-dvpn wallet show --json$/); // KWIN-USER: no %USERNAME%
    expect(keyfileUnreadableNext('/k.json', 'linux')).toBe('sudo chown $(id -un) /k.json && chmod 600 /k.json, then devnet-dvpn wallet show --json');
    // A path with a space or a quote is ONE shell word in both places (same class as QUOTE-KEYFILE).
    expect(keyfileUnreadableNext("/home/u/edge dir/it's key.json", 'linux')).toBe(
      "sudo chown $(id -un) '/home/u/edge dir/it'\\''s key.json' && chmod 600 '/home/u/edge dir/it'\\''s key.json', then devnet-dvpn wallet show --json",
    );
  });
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('a real file this user may not read, through the key store', () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kf-')), 'k.json');
    fs.writeFileSync(f, '[1,2,3]');
    fs.chmodSync(f, 0o000);
    expect(() => cliKeyStore(os.tmpdir(), f).load()).toThrow(expect.objectContaining({ code: 'keyfile-unreadable' }));
  });
  it('negative controls: another read error is passed through; a readable file is read', () => {
    expect(() => readKeyfile('/k.json', denied('EISDIR'))).toThrow(expect.objectContaining({ code: 'EISDIR' }));
    expect(readKeyfile('/k.json', () => 'text')).toBe('text');
  });
});
