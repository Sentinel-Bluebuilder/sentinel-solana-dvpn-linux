// ─── Market-aware defaults (the agent kit R7, owner 2026-11-20) ───
// Fixed defaults (a 5 tDVPN cap, a 50 tDVPN limit, 10-20 tDVPN funding asks) refused most of the live market:
// on 2026-11-20 35 nodes were online, per GB p50 = p75 = 50 tDVPN, and only 3 were under the 5 cap (FRICTION-LOG F3/F4).
// The defaults are now sized from the online prices of the nodes that match the request. Flags always override,
// the owner's Settings limit stays the ceiling, and a raise past it still needs --raise-limit (S7). Pure; unit-tested.

/** Fewer matching priced nodes than this: the market is too thin to read, so the fixed defaults apply. */
export const MARKET_MIN_NODES = 3;
/** A price above this many times the median is an outlier and is left out of the market read. */
export const OUTLIER_FACTOR = 10n;
/** The fixed default cap divides the Settings limit by this (room for 10 deposits per raise). */
export const FIXED_CAP_DIVISOR = 10n;
/** The default spending limit covers this many deposits at the market p75 (a connect, a reconnect, one spare). */
export const LIMIT_DEPOSITS = 3n;
/** The recommended funding covers this many deposits at the market p75. */
export const FUNDING_DEPOSITS = 2n;
/** SOL the owner wallet needs before this computer is set up (0.05 device float + fees), and after (fees only). */
export const SOL_BEFORE_SETUP = 60_000_000;
export const SOL_AFTER_SETUP = 10_000_000;

export interface MarketRead {
  /** Base units per unit (GB or hour), as decimal strings. */
  p50: string;
  p75: string;
  /** Priced nodes the read used (outliers left out). */
  nodes: number;
  /** Priced nodes left out as outliers. */
  outliers: number;
}

export interface Defaults {
  /** The default deposit cap in base units (null = no cap could be set: Settings unreadable). */
  priceCapBase: string | null;
  source: 'market' | 'fixed';
  /** Why the fixed values apply (thin market), when they do. */
  reason?: string;
  market: MarketRead | null;
}

/** The value at fraction q (0..1) of an ascending list, nearest rank. */
function rank(sorted: bigint[], q: number): bigint {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i];
}

/** p50 / p75 of the priced nodes (price > 0, outliers above OUTLIER_FACTOR × median left out), or null when too thin. */
export function readMarket(prices: Array<string | bigint | null | undefined>): MarketRead | null {
  const priced = prices
    .map((p) => (typeof p === 'bigint' ? p : /^\d+$/.test(String(p ?? '')) ? BigInt(String(p)) : 0n))
    .filter((p) => p > 0n)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (priced.length < MARKET_MIN_NODES) return null;
  const median = rank(priced, 0.5);
  const kept = priced.filter((p) => p <= median * OUTLIER_FACTOR);
  if (kept.length < MARKET_MIN_NODES) return null;
  return { p50: rank(kept, 0.5).toString(), p75: rank(kept, 0.75).toString(), nodes: kept.length, outliers: priced.length - kept.length };
}

/** The default cap: max(Settings limit / 10, p75 × units), never above the Settings limit (the owner's ceiling). */
export function defaultCap(settingBase: bigint | null, market: MarketRead | null, units: number): Defaults {
  if (settingBase === null) return { priceCapBase: null, source: 'fixed', reason: 'the spending limit setting is unreadable', market };
  const fixed = settingBase / FIXED_CAP_DIVISOR;
  if (!market) return { priceCapBase: fixed.toString(), source: 'fixed', reason: `fewer than ${MARKET_MIN_NODES} priced nodes match`, market: null };
  const u = BigInt(Math.max(1, Math.floor(units)));
  const want = BigInt(market.p75) * u;
  const cap = want > fixed ? (want < settingBase ? want : settingBase) : fixed;
  return { priceCapBase: cap.toString(), source: cap === fixed ? 'fixed' : 'market', market };
}

/** The default spending limit for a new install: LIMIT_DEPOSITS deposits at the market p75, never below the fixed one. */
export function defaultLimitBase(fixedBase: bigint, market: MarketRead | null, units: number): bigint {
  if (!market) return fixedBase;
  const want = BigInt(market.p75) * BigInt(Math.max(1, Math.floor(units))) * LIMIT_DEPOSITS;
  return want > fixedBase ? want : fixedBase;
}

/** The funding to ask for: the exact shortfall for this deposit (needBase), and a recommended amount that also
 *  covers a reconnect (FUNDING_DEPOSITS deposits at the market p75, never below the deposit). Base units. */
export function fundingAsk(depositBase: bigint, haveBase: bigint, market: MarketRead | null, units: number): { needBase: bigint; recommendBase: bigint } {
  const needBase = depositBase > haveBase ? depositBase - haveBase : 0n;
  const per = market ? BigInt(market.p75) * BigInt(Math.max(1, Math.floor(units))) : depositBase;
  const target = (per > depositBase ? per : depositBase) * FUNDING_DEPOSITS;
  const recommendBase = target > haveBase ? target - haveBase : needBase;
  return { needBase, recommendBase: recommendBase > needBase ? recommendBase : needBase };
}

/** SOL the owner wallet needs for a connect: before setup the device float + fees, after it fees only. */
export function solNeeded(deviceReady: boolean): number {
  return deviceReady ? SOL_AFTER_SETUP : SOL_BEFORE_SETUP;
}
