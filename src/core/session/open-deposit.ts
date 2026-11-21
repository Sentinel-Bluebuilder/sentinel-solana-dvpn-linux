// ─── Use an open deposit before paying a new one (owner 2026-11-12) ───
// A failed Connect had paid a per-hour deposit to a server; the next Connect, per GB, paid a second
// one and the first sat unused. The dialog now offers the open one, in its own pricing, first.
// The "enough left" rule is prepayFor, the same one connect() uses: the dialog asking for a full
// unit while connect() needed only the first 100 MB block sent a 39 tDVPN deposit unused.
import { prepayFor } from '../../shared/prepay-cap';
import type { NodeView, PendingSettlement } from '../../shared/types';

export interface OpenDeposit { channel: string; basis: 'per_gb' | 'per_hour'; left: string }
export interface ClosingDeposit { channel: string; left: string; readyAt: number | null }

type Priced = Pick<NodeView, 'address' | 'pricePerGb' | 'pricePerHour'>;

/**
 * The open deposit with the most left for this server, if at least the node's first block is left.
 * `liveChannel` = the deposit of the session running now. Any other deposit marked "in use" is from a
 * session that just ended and the list has not caught up: it is reusable (owner 2026-11-12).
 */
/**
 * CODE-AUDIT E7: a per-hour deposit is listed 'ready' (it closes in one step), never 'open', yet it is still open
 * and connect() reuses it (connect-checks reusableChannel). The dialog said "pay a new deposit" for it, or called
 * it closing.
 */
const perHourOpen = (s: PendingSettlement): boolean => s.mode === 1 && s.status === 'ready';

export function openDepositFor(settlements: PendingSettlement[], node: Priced, liveChannel: string | null = null): OpenDeposit | null {
  let best: OpenDeposit | null = null;
  for (const s of settlements) {
    const usable = s.status === 'open' || perHourOpen(s) || (s.status === 'in-use' && s.channel !== liveChannel);
    // CODE-AUDIT E3: the server refused to reuse it; offering it again would promise "nothing new is paid".
    // rc.3.1 F1: another device's deposit (s.device) cannot be reused by this computer's service.
    if (s.node !== node.address || !usable || s.reuseRefused || s.device) continue;
    const basis = s.mode === 1 ? 'per_hour' : 'per_gb';
    const left = BigInt(s.refundable || '0');
    if (left <= 0n || left < prepayFor(node, basis)) continue;
    if (!best || left > BigInt(best.left)) best = { channel: s.channel, basis, left: left.toString() };
  }
  return best;
}

/** A deposit with this server that is closing or waiting for its refund: it cannot be used again. */
export function closingDepositFor(settlements: PendingSettlement[], node: Pick<NodeView, 'address'>): ClosingDeposit | null {
  const s = settlements.find((x) => x.node === node.address && !x.device && (x.status === 'closing' || (x.status === 'ready' && !perHourOpen(x))) && BigInt(x.refundable || '0') > 0n);
  return s ? { channel: s.channel, left: s.refundable, readyAt: s.readyAt } : null;
}
