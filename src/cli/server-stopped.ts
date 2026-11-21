// ─── The server stopped serving (hub docs/BAND-M-RESULTS.md: E-35 / E-36 / E-37, Linux rc.3) ───
// After the daemon logged "session ended" / "stopped working", `agent status` and `agent up` still answered
// connected:true with exitIp == the direct address (the agent thought it was tunnelled), and a later answer said
// connected:false with no word why. A refusal after the deposit answered "unknown" while `agent status` showed
// no deposit. These pure helpers decide "the traffic is NOT going through the server" and word the answer.
import type { PendingSettlement } from '../shared/types';
import { tdvpn } from '../core/chain/amounts';

const CLI = 'devnet-dvpn';

export interface ExitIp { ip: string; directIp?: string | null; viaProxy?: boolean }

/** The measured exit address is the computer's own: the session is up on paper only. */
export function exitIsDirect(ip: ExitIp | null | undefined, home: string | null | undefined): boolean {
  // Only against the address read before the session (home-ip.json). `directIp === ip` through SOCKS is NOT a sign:
  // a whole-device session exits both ways by the node (Windows rc2). Unknown home: cannot tell, so alive.
  return !!ip?.ip && !!home && ip.ip === home;
}

/** dvpnd's own words for a session the node ended (daemon log: "the connection to this server stopped working"). */
export function stoppedReason(reason: string | null | undefined): boolean {
  return !!reason && /stopped working|connection (to this server )?(was )?lost|node api refused|server stopped/i.test(reason);
}

export const SERVER_STOPPED_MESSAGE = 'The node stopped serving; your traffic is NOT going through it.';
export const SERVER_STOPPED_NEXT = `${CLI} agent up --yes`;
export const SERVER_STOPPED_ALSO = `${CLI} agent down --yes`;

/** Deposit-safe sentence: what happens to the money, and when it is back. */
export function depositSafe(rows: PendingSettlement[], now = Date.now()): string {
  const due = rows.filter((x) => x.status === 'open' || x.status === 'ready' || x.status === 'closing' || x.status === 'in-use');
  if (!due.length) return 'No deposit is open.';
  const total = due.reduce((t, x) => t + BigInt(x.refundable || '0'), 0n);
  const readyAt = due.reduce((t, x) => Math.max(t, x.readyAt ?? 0), 0);
  const when = readyAt && readyAt * 1000 > now ? `after ${new Date(readyAt * 1000).toISOString()}` : 'now';
  return `Your deposit is safe: ${CLI} agent down --yes closes it and the unused ${tdvpn(total)} tDVPN is refunded (${when}).`;
}

/** One line per deposit for `agent status`; closing ones carry readyAt. */
export function depositRows(rows: PendingSettlement[]): Array<{ channel: string; node: string; status: string; refundable: string; readyAt: number | null }> {
  return rows
    .filter((x) => x.status === 'open' || x.status === 'ready' || x.status === 'closing' || x.status === 'in-use')
    .map((x) => ({ channel: x.channel, node: x.node, status: x.status, refundable: tdvpn(x.refundable), readyAt: x.readyAt ?? null }));
}

/** `agent status` next when no session is live and a deposit is still on chain (never "agent up", which opens a second one). */
export function depositNext(rows: PendingSettlement[]): string | null {
  const refundNow = rows.some((x) => x.status === 'open' || x.status === 'ready');
  if (refundNow) return `${CLI} agent down --yes`;
  const closing = rows.filter((x) => x.status === 'closing');
  if (!closing.length) return null;
  const readyAt = closing.reduce((t, x) => Math.max(t, x.readyAt ?? 0), 0);
  // W15 (the agent kit rc.8, T-A A8 + T-C CE1): the same line `agent down` prints, so the two answers never disagree.
  return readyAt ? `${CLI} settle run --yes after ${new Date(readyAt * 1000).toISOString()} (a closing deposit waits 2 h), then ${CLI} settle withdraw --yes` : `${CLI} settle list`;
}
