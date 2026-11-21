// ─── One paying `agent up` at a time on this computer (B-UP, the agent kit rc.8, T-C edge pass) ───
// Two `agent up --yes` started together both saw no session: the second reached the service while the first was
// connecting, got session-active, and its next ("agent down --yes, then agent up --yes") ended the first one's
// session and paid a second deposit. The second now waits here (bounded); once the first is done it reads the live
// session and answers `reused: true` for a matching request. A lock whose holder is gone, or older than
// UP_LOCK_STALE_MS, is taken over. Exported for tests.
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../main/logger';

export const UP_LOCK = 'agent-up.lock';
export const UP_LOCK_WAIT_MS = 90_000;
export const UP_LOCK_STALE_MS = 5 * 60_000;
const POLL_MS = 500;

export interface UpLockDeps {
  dir: string;
  pid?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  alive?: (pid: number) => boolean;
  waitMs?: number;
}

/** A process that is still running (EPERM: it runs as another user, so it is alive). */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Take the lock, waiting while another live `agent up` holds it. null = the wait ran out (the holder is still busy). */
export async function takeUpLock(d: UpLockDeps): Promise<{ release: () => void; waitedMs: number } | null> {
  const file = path.join(d.dir, UP_LOCK);
  const pid = d.pid ?? process.pid;
  const now = d.now ?? Date.now;
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const alive = d.alive ?? pidAlive;
  const waitMs = d.waitMs ?? UP_LOCK_WAIT_MS;
  fs.mkdirSync(d.dir, { recursive: true });
  const start = now();
  for (;;) {
    try {
      fs.writeFileSync(file, JSON.stringify({ pid, at: now() }), { flag: 'wx' });
      return { release: () => releaseUpLock(file, pid), waitedMs: now() - start };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    const held = readHolder(file);
    // A holder that is gone or too old is taken over. A file just created and not yet written (held === 'torn') is
    // waited on like a live one, until it is older than the stale age.
    const age = held === 'torn' ? now() - fileTime(file) : held ? now() - held.at : Infinity;
    if (!held || (held !== 'torn' && !alive(held.pid)) || age > UP_LOCK_STALE_MS) {
      fs.rmSync(file, { force: true });
      continue;
    }
    if (now() - start >= waitMs) return null;
    await sleep(POLL_MS);
  }
}

function readHolder(file: string): { pid: number; at: number } | 'torn' | null {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null; // released between our two calls
    throw err;
  }
  try {
    const j = JSON.parse(text) as { pid?: unknown; at?: unknown };
    return typeof j.pid === 'number' && typeof j.at === 'number' ? { pid: j.pid, at: j.at } : 'torn';
  } catch (err) {
    log.info(`agent up lock: holder not readable yet (${(err as Error).message})`);
    return 'torn';
  }
}

function fileTime(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch (err) {
    log.info(`agent up lock: no mtime (${(err as Error).message})`);
    return 0;
  }
}

/** Removes the lock only while it is still this process's own (a takeover by another run is left alone). */
function releaseUpLock(file: string, pid: number): void {
  const held = readHolder(file);
  if (held && held !== 'torn' && held.pid === pid) fs.rmSync(file, { force: true });
  else log.info('agent up lock: not ours any more at release, left alone');
}
