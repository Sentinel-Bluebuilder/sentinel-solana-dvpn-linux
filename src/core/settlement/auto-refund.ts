// ─── When an idle deposit is refunded on its own (owner 2026-11-12) ───
// A per-GB deposit costs nothing while you are disconnected, so it is kept for a day after its last
// session: reconnecting to that server uses it instead of locking a new one. A per-hour deposit is
// charged by the clock whether or not a session is up (streamOwed), so it is refunded quickly.
// Before: every deposit was refunded 10 min after its session, so a reconnect later than that always
// locked a new deposit (EMDjZ9 23:37 → refund 23:47 → new 53 tDVPN deposit at 00:33).

export const KEEP_PER_GB_S = 24 * 3600;
export const KEEP_PER_HOUR_S = 10 * 60;

export interface IdleDeposit {
  channel: string;
  status: 'open' | 'closing' | 'ready' | 'in-use';
  mode: number;
  /** Unix seconds the deposit was opened (0 = unknown). */
  openedAt?: number;
  /** The server refused to reuse it (CODE-AUDIT E3): it is never used again, so keeping it only locks the money. */
  reuseRefused?: boolean;
}

/** How long a deposit of this mode is kept after its last session, in seconds. */
export function keepFor(mode: number, streamMode: number): number {
  return mode === streamMode ? KEEP_PER_HOUR_S : KEEP_PER_GB_S;
}

/**
 * A deposit that can be refunded now and is not in use. readSettlements lists a per-hour deposit as 'ready'
 * (it closes in one step), never 'open' (CODE-AUDIT E1: filtering on 'open' alone left every per-hour deposit
 * to the in-memory 10-min timer, lost on an app restart, while the clock kept charging it to the full deposit).
 * A per-GB 'ready' deposit is past its close wait and dvpnd's own sweep closes it, so it is not included.
 */
export function idleCandidate(d: IdleDeposit, streamMode: number): boolean {
  return d.status === 'open' || (d.status === 'ready' && d.mode === streamMode);
}

/**
 * Deposits to refund now: open (not in use) and idle past their keep time. `lastActive` = the latest
 * session end per deposit, in unix seconds; a session still running counts as now.
 */
export function dueForAutoRefund(deposits: IdleDeposit[], lastActive: Map<string, number>, nowS: number, streamMode: number): string[] {
  const out: string[] = [];
  for (const d of deposits) {
    if (!idleCandidate(d, streamMode)) continue;
    if (d.reuseRefused) { out.push(d.channel); continue; } // E10: refunded now, not after a day's keep
    const last = Math.max(lastActive.get(d.channel) ?? 0, d.openedAt ?? 0);
    if (last === 0) continue; // nothing known about it yet: wait for the next look
    if (nowS - last >= keepFor(d.mode, streamMode)) out.push(d.channel);
  }
  return out;
}
