// ─── This computer's clock against the chain's (rc.4 E-22) ───
// Servers refuse a signed request whose time is more than 60 s from theirs (go-sdk auth.MaxRequestSkew),
// answered as "unauthorized" AFTER the deposit opened (other fleet, Windows rc.3). dvpnd's own preflight
// compares local time with the block time of the confirmed slot (internal/preflight/chain.go checkClockSkew);
// the app does the same before any deposit so nothing is paid into a start that will be refused.
import { rpcCall } from './rpc';
import { tr } from '../../shared/i18n';

/** go-sdk auth.MaxRequestSkew. */
export const MAX_REQUEST_SKEW_S = 60;
/** Refuse a little inside the server's limit: the confirmed block's time trails real time by a few seconds. */
export const CLOCK_SKEW_REFUSE_S = 50;

/** Seconds this computer is ahead (+) or behind (-) the chain. */
export function skewSeconds(blockTimeS: number, nowMs: number): number {
  return Math.round(nowMs / 1000 - blockTimeS);
}

/** Whole minutes for the sentence (at least 1, so "about 1 min" for 50-89 s). */
export function skewMinutesOf(skewS: number): number {
  return Math.max(1, Math.round(Math.abs(skewS) / 60));
}

export function clockSkewCopy(skewS: number): string {
  const minutes = skewMinutesOf(skewS);
  return skewS > 0
    ? tr('This computer\'s clock is about {minutes} min ahead of the network\'s time, so servers would refuse the connection. Set the date and time to automatic, then connect again. Nothing was paid.', { minutes })
    : tr('This computer\'s clock is about {minutes} min behind the network\'s time, so servers would refuse the connection. Set the date and time to automatic, then connect again. Nothing was paid.', { minutes });
}

/** The refusal for `skewS`, or null inside the limit. */
export function clockSkewBlocker(skewS: number): { error: string; action: string; code: 'clock-skew' } | null {
  if (Math.abs(skewS) <= CLOCK_SKEW_REFUSE_S) return null;
  return { error: clockSkewCopy(skewS), action: 'Fix the clock', code: 'clock-skew' };
}

/** Skew against the chain now, or null when the chain's time could not be read (the check is then skipped). */
export async function chainClockSkew(now: () => number = Date.now): Promise<number | null> {
  const blockTime = await rpcCall(async (c) => c.getBlockTime(await c.getSlot('confirmed')), { label: 'clock', attempts: 2 });
  return blockTime === null ? null : skewSeconds(blockTime, now());
}
