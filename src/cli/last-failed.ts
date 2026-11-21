// ─── agent up: skip the server that just failed (approved queue item) ───
// A failed connect leaves no history row (history.ts records a session only once it starts), so the quick pick
// chose the same broken server again on the next `agent up`. When a connect fails on the server itself (a node-* code
// or a dead tunnel), its address is kept here for 10 minutes; `agent up` without --node leaves it out and says so.
// --node always wins. A successful connect clears it. Holds no key or wallet: a server address, a code, a time.
import fs from 'node:fs';
import path from 'node:path';
import { getHost } from '../main/host';
import { log } from '../main/logger';

export const LAST_FAILED_FILE = 'agent-last-failed.json';
export const SKIP_WINDOW_MS = 10 * 60_000;

export interface LastFailed { node: string; code: string; at: number }

/** Codes that say the node itself failed (not the wallet, the service, or this computer). */
export function serverFailed(code: string | undefined): boolean {
  return !!code && (code.startsWith('node-') || code === 'tunnel-failed' || code === 'tunnel-dead');
}

function file(dir?: string): string | null {
  try {
    return path.join(dir ?? getHost().dataDir, LAST_FAILED_FILE);
  } catch (err) {
    log.warn('agent up: no data dir for the last failed node', { err: (err as Error).message });
    return null;
  }
}

export function recordFailed(node: string, code: string, dir?: string, now = Date.now()): void {
  const p = file(dir);
  if (!p) return;
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ node, code, at: now } satisfies LastFailed));
  } catch (err) {
    log.warn('agent up: last failed node not written', { err: (err as Error).message });
  }
}

/** The node that failed within the window, else null (an unreadable or old file is ignored). */
export function recentFailed(dir?: string, now = Date.now()): LastFailed | null {
  const p = file(dir);
  if (!p || !fs.existsSync(p)) return null;
  try {
    const r = JSON.parse(fs.readFileSync(p, 'utf8')) as LastFailed;
    return typeof r.node === 'string' && typeof r.at === 'number' && now - r.at >= 0 && now - r.at < SKIP_WINDOW_MS ? r : null;
  } catch (err) {
    log.warn('agent up: last failed node unreadable; not skipping', { err: (err as Error).message });
    return null;
  }
}

export function clearFailed(dir?: string): void {
  const p = file(dir);
  if (!p) return;
  try {
    fs.rmSync(p, { force: true });
  } catch (err) {
    log.warn('agent up: last failed node not cleared', { err: (err as Error).message });
  }
}

/** The pool without the node that just failed, unless it is the only one left (then nothing is skipped). */
export function withoutFailed<T extends { address: string }>(pool: T[], failed: LastFailed | null): { pool: T[]; skipped: LastFailed | null } {
  if (!failed) return { pool, skipped: null };
  const rest = pool.filter((n) => n.address !== failed.node);
  return rest.length && rest.length < pool.length ? { pool: rest, skipped: failed } : { pool, skipped: null };
}

export function skippedNote(s: LastFailed, now = Date.now()): string {
  const min = Math.max(1, Math.round((now - s.at) / 60_000));
  return `skipped ${s.node}: it failed ${min} min ago (${s.code}); --node ${s.node} tries it anyway`;
}
