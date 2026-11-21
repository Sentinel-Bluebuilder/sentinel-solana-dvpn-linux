// ─── An AI agent holds the live session (CODE-AUDIT L-15) ───
// `agent up` (src/cli/agent-cmd.ts, connect-64) writes this marker after a new connect and on reuse; `agent down`
// and `disconnect` delete it. The app reads it beside the DC1 connect marker (same data dir) and shows
// "Agentic connection is on" only while the marker names the live session. A marker for another session is
// stale (the session ended some other way) and whoever sees it stale deletes it.
import fs from 'node:fs';
import path from 'node:path';
import { getHost } from '../host';
import { log } from '../logger';

export const AGENT_MARKER = 'agent-session.json';

export interface AgentMarker { v: 1; session: string; node: string; protocol: string; pid: number; at: number }

let noDirWarned = false;
function markerPath(dir?: string): string | null {
  if (dir) return path.join(dir, AGENT_MARKER);
  try {
    return path.join(getHost().dataDir, AGENT_MARKER);
  } catch (err) {
    if (!noDirWarned) log.warn('agent marker: no data dir', { err: (err as Error).message });
    noDirWarned = true;
    return null;
  }
}

/** Written atomically (tmp + rename). Holds no key or wallet: only what `agent status` prints. */
export function writeAgentMarker(info: Omit<AgentMarker, 'v' | 'pid' | 'at'>, dir?: string, pid = process.pid, now = Date.now()): void {
  const p = markerPath(dir);
  if (!p) return;
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.${pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, ...info, pid, at: now } satisfies AgentMarker));
    fs.renameSync(tmp, p);
  } catch (err) {
    log.warn('agent marker not written', { err: (err as Error).message });
  }
}

export function clearAgentMarker(dir?: string): void {
  const p = markerPath(dir);
  if (!p) return;
  try {
    fs.rmSync(p, { force: true });
  } catch (err) {
    log.warn('agent marker not removed', { err: (err as Error).message });
  }
}

/** The marker, or null (missing, unreadable or the wrong shape: logged, never thrown). */
export function readAgentMarker(dir?: string): AgentMarker | null {
  const p = markerPath(dir);
  if (!p) return null;
  try {
    const m = JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<AgentMarker>;
    if (m?.v !== 1 || typeof m.session !== 'string' || !m.session) { log.warn('agent marker has an unknown shape; ignoring it'); return null; }
    return m as AgentMarker;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('agent marker unreadable', { err: (err as Error).message });
    return null;
  }
}

/**
 * Attached = the marker names the live session. dvpnd can bring a dropped session back as a NEW one on the same
 * server (app-state setRedialFollow), so the same node still counts. A live session on another server means the
 * agent's has ended: that marker is deleted. With no live session nothing is deleted (`agent up` may be between
 * its connect and the app's adopt).
 */
export function agentAttached(live: { id: string; node: string } | null, dir?: string): boolean {
  if (!live) return false;
  const m = readAgentMarker(dir);
  if (!m) return false;
  if (m.session === live.id || m.node === live.node) return true;
  clearAgentMarker(dir);
  return false;
}
