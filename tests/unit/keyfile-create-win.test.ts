// ─── WIN-W1 (the agent kit rc.9, review audit W-1): `wallet create --keyfile` locks the new key file on Windows ───
// Node's mode 0o600 / 0o700 is a no-op on Windows: the key inherited its folder's ACL, so in C:\, ProgramData or
// Temp every local user could read the wallet key. Now: the empty file is locked (owner + SYSTEM + Administrators,
// no inheritance) BEFORE the secret is written, the lock is read back, and any failure leaves no file behind.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { createKeyfile } from '../../src/core/wallet/new-keyfile';

const SID = 'S-1-5-21-1111-2222-3333-1001';
const OWNER_ONLY = 'DESKTOP-1\\me:(F)\n NT AUTHORITY\\SYSTEM:(F)\n BUILTIN\\Administrators:(F)\n';
const dirs: string[] = [];
const tmp = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ddv-kfw-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

type Call = { cmd: string; args: string[]; content: string | null };
/** A fake Windows: whoami prints the user SID, icacls succeeds, and the read-back shows `readBack`. */
function fakeWin(file: string, readBack = OWNER_ONLY, failLock = false) {
  const calls: Call[] = [];
  const run = (cmd: string, args: string[]): string => {
    calls.push({ cmd, args, content: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null });
    if (cmd === 'whoami') return `"desktop-1\\me","${SID}"\r\n`;
    if (cmd === 'icacls' && args.length === 1) return `${args[0]} ${readBack}\nSuccessfully processed 1 files; Failed processing 0 files\n`;
    if (cmd === 'icacls' && failLock) throw new Error('icacls: Access is denied.');
    return 'processed file\nSuccessfully processed 1 files; Failed processing 0 files\n';
  };
  return { calls, run };
}

describe('WIN-W1: wallet create --keyfile on win32', () => {
  it('the fixtures carry real backslashes (positive control for the ACE regex)', () => {
    expect(OWNER_ONLY).toContain('NT AUTHORITY\u005cSYSTEM');
  });

  it('locks the empty file to this user + SYSTEM + Administrators before the secret is written', () => {
    const file = path.join(tmp(), 'agent-key.json');
    const w = fakeWin(file);
    const kp = Keypair.generate();
    const r = createKeyfile(file, () => kp, { platform: 'win32', run: w.run });
    const lock = w.calls.find((c) => c.cmd === 'icacls' && c.args.includes('/inheritance:r') && c.args[0] === path.resolve(file));
    expect(lock?.args).toEqual([path.resolve(file), '/inheritance:r', '/grant:r', `*${SID}:F`, '*S-1-5-18:F', '*S-1-5-32-544:F']);
    expect(lock?.content).toBe(''); // the secret was not in the file yet when it was locked
    const secret = Uint8Array.from(JSON.parse(fs.readFileSync(file, 'utf8')) as number[]);
    expect(Keypair.fromSecretKey(secret).publicKey.toBase58()).toBe(r.address);
  });

  it('a folder it creates is locked the same way, inherited by the file (OI)(CI)', () => {
    const base = tmp();
    const file = path.join(base, 'new', 'k.json');
    const w = fakeWin(file);
    createKeyfile(file, undefined, { platform: 'win32', run: w.run });
    const dirLock = w.calls.find((c) => c.cmd === 'icacls' && c.args[0] === path.join(base, 'new'));
    expect(dirLock?.args).toEqual([path.join(base, 'new'), '/inheritance:r', '/grant:r', `*${SID}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F']);
  });

  it('the lock fails: no file is left, the error has a code and a runnable next', () => {
    const file = path.join(tmp(), 'k.json');
    const w = fakeWin(file, undefined, true);
    let err: (Error & { code?: string; action?: string }) | null = null;
    try { createKeyfile(file, undefined, { platform: 'win32', run: w.run }); } catch (e) { err = e as Error & { code?: string; action?: string }; }
    expect(err?.code).toBe('keyfile-lock-failed');
    expect(err?.message).toMatch(/Nothing was written/);
    expect(err?.action).toContain('"$HOME\\agent-key.json"');
    expect(fs.existsSync(file)).toBe(false);
  });

  it('the read-back still shows BUILTIN\\Users: no file is left (never a key other users can read)', () => {
    for (const ace of ['BUILTIN\\Users:(I)(RX)', 'NT AUTHORITY\\Authenticated Users:(I)(M)', 'Everyone:(R)', '*S-1-5-32-545:(R)']) {
      const file = path.join(tmp(), 'k.json');
      const w = fakeWin(file, `DESKTOP-1\\me:(F)\n ${ace}\n`);
      expect(() => createKeyfile(file, undefined, { platform: 'win32', run: w.run }), ace).toThrow(/Other users can still read it \(/);
      expect(fs.existsSync(file)).toBe(false);
    }
  });

  it('a DENY ACE for Everyone is not an open file (negative control)', () => {
    const file = path.join(tmp(), 'k.json');
    const w = fakeWin(file, 'DESKTOP-1\\me:(F)\n Everyone:(DENY)(R)\n');
    expect(() => createKeyfile(file, undefined, { platform: 'win32', run: w.run })).not.toThrow();
  });

  it('negative control: off Windows nothing is run and the file is 0600', () => {
    const file = path.join(tmp(), 'k.json');
    const w = fakeWin(file);
    createKeyfile(file, undefined, { platform: 'linux', run: w.run });
    expect(w.calls).toEqual([]);
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });
});
