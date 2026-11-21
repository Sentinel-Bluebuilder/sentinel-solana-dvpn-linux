// ─── New key-file wallet (Q0490: wallet create --keyfile <new path>) ───
// A machine with no unlocked keyring (an SSH login, a server) could not get a wallet from this app at all:
// `wallet create` needs the keyring, and a --keyfile wallet is read-only. This writes a NEW solana-keygen
// JSON key file instead: never over an existing file (one atomic 'wx' open), parent folder 0700, file 0600.
// The caller prints the address only; the key stays in the file.
// WIN-W1 (the agent kit rc.9, review audit W-1): on Windows the modes are a no-op and the file inherited its folder's ACL
// (C:\, ProgramData, Temp: every local user could read it). There the empty file is locked to this user + SYSTEM +
// Administrators with inheritance cut, the lock is read back, and only then is the secret written. Any failure
// removes the file: a key file other users can read is never left behind.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Keypair } from '@solana/web3.js';

export class KeyfileExistsError extends Error {}

/** Runs one Windows tool (whoami, icacls) with argv, no shell; returns stdout. Injected in tests. */
export type WinRunner = (cmd: string, args: string[]) => string;
const runWin: WinRunner = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] });

export interface CreateKeyfileOpts { platform?: string; run?: WinRunner }

const SYSTEM_SID = 'S-1-5-18';
const ADMINS_SID = 'S-1-5-32-544';
// Allow ACEs for the groups every local account is in (names, or the bare SIDs icacls prints when unresolved).
const OPEN_ACE = /(?:^|\s)(BUILTIN\\Users|Everyone|NT AUTHORITY\\Authenticated Users|NT AUTHORITY\\INTERACTIVE|\*?S-1-5-32-545|\*?S-1-1-0|\*?S-1-5-11|\*?S-1-5-4):((?:\([^)]*\))+)/gi;

function lockFailed(abs: string, why: string): Error {
  return Object.assign(new Error(`Could not make ${abs} readable by this account only (${why}). Nothing was written: no key file was left.`), {
    code: 'keyfile-lock-failed',
    action: 'devnet-dvpn wallet create --keyfile "$HOME\\agent-key.json" --yes (a path in your own profile folder)',
  });
}

/** This account's SID from `whoami /user /fo csv /nh` ("domain\name","S-1-5-21-…"). */
function currentSid(run: WinRunner): string {
  const m = /"(S-1-[0-9-]+)"/.exec(run('whoami', ['/user', '/fo', 'csv', '/nh']));
  if (!m) throw new Error('No SID in the whoami /user output.');
  return m[1];
}

/** icacls <target> /inheritance:r /grant:r *me:F *SYSTEM:F *Administrators:F, then read back: no open group may stay. */
function lockWin(target: string, sid: string, dir: boolean, run: WinRunner): void {
  const p = dir ? '(OI)(CI)F' : 'F';
  run('icacls', [target, '/inheritance:r', '/grant:r', `*${sid}:${p}`, `*${SYSTEM_SID}:${p}`, `*${ADMINS_SID}:${p}`]);
  const back = run('icacls', [target]);
  for (const m of back.matchAll(OPEN_ACE)) {
    if (!/\(DENY\)/i.test(m[2])) throw new Error(`Other users can still read it (${m[1]}:${m[2]}).`);
  }
}

export function createKeyfile(file: string, gen: () => Keypair = () => Keypair.generate(), opts: CreateKeyfileOpts = {}): { address: string; path: string } {
  const platform = opts.platform ?? process.platform;
  const run = opts.run ?? runWin;
  const abs = path.resolve(file);
  if (fs.existsSync(abs)) {
    throw new KeyfileExistsError(`${abs} already exists, so nothing was written: a key file is never replaced. Choose a new path, or use this file with --keyfile to sign in with it.`);
  }
  const madeDir = fs.mkdirSync(path.dirname(abs), { recursive: true, mode: 0o700 });
  const kp = gen();
  const secret = JSON.stringify(Array.from(kp.secretKey));
  if (platform !== 'win32') {
    try {
      fs.writeFileSync(abs, secret, { mode: 0o600, flag: 'wx' });
    } catch (err) {
      // Created by someone else between the check and the open: same answer as above, nothing replaced.
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new KeyfileExistsError(`${abs} already exists, so nothing was written: a key file is never replaced.`);
      throw new Error(`Could not write the key file ${abs}: ${(err as Error).message}`);
    }
    return { address: kp.publicKey.toBase58(), path: abs };
  }
  // Windows: create it EMPTY (still one atomic 'wx' open), lock it, then write the secret into the locked file.
  try {
    fs.writeFileSync(abs, '', { flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new KeyfileExistsError(`${abs} already exists, so nothing was written: a key file is never replaced.`);
    throw new Error(`Could not write the key file ${abs}: ${(err as Error).message}`);
  }
  try {
    const sid = currentSid(run);
    if (madeDir) lockWin(madeDir, sid, true, run);
    lockWin(abs, sid, false, run);
    fs.writeFileSync(abs, secret, { flag: 'r+' });
  } catch (err) {
    fs.rmSync(abs, { force: true });
    throw lockFailed(abs, (err as Error).message.split('\n')[0].replace(/\.$/, ''));
  }
  return { address: kp.publicKey.toBase58(), path: abs };
}
