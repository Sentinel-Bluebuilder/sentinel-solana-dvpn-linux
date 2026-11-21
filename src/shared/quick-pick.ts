// ─── Quick connect pick: favourite → preferred country → lowest latency, online only ───
// Shared by the Connect screen and connect-on-launch so both choose the same server.
import { DEFAULT_SETTINGS, type Basis, type NodeView } from './types';

export function pickQuickNode(nodes: NodeView[], preferredCountry: string | null): NodeView | null {
  // UI-179: only servers Connect will accept: answering AND still listed on chain (connect on launch and
  // `agent up` offered one whose listing had lapsed, then the check before paying refused it). `!== false`:
  // a record without the field (older fixtures) is not taken for a lapsed one.
  const online = nodes.filter((n) => n.probe?.ok && n.listingFresh !== false);
  const fav = online.filter((n) => n.favourite);
  const pref = preferredCountry ? online.filter((n) => n.countryCode === preferredCountry) : [];
  const pool = fav.length ? fav : pref.length ? pref : online;
  return [...pool].sort((a, b) => (a.probe?.latencyMs ?? 9e9) - (b.probe?.latencyMs ?? 9e9))[0] ?? null;
}

/**
 * Quick connect on the Connect screen (owner 2026-11-15: not the same nearest server every time).
 * Same pool as above (your favourites, else your preferred country, else every server that answers),
 * but a random one from it. `current` is kept while it is still in the pool, so the offer does not
 * change under the pointer each time a server check comes back.
 */
/**
 * UI-195 (owner's session 2026-11-15: Quick connect paid a 50 tDVPN deposit): the random pick drew from every
 * server, and most charge 50 tDVPN/GB while a few charge 0.002, so a default 1 GB deposit was the device's whole
 * 50 tDVPN allowance. The pool is now the cheapest band: servers whose deposit for the default basis and amount is
 * at most QUICK_PRICE_BAND times the cheapest one's. Favourites are the user's own choice and are not filtered.
 * Exported for tests.
 */
export const QUICK_PRICE_BAND = 2n;
export function cheapestBand(pool: NodeView[], price: { basis: Basis; units: number }): NodeView[] {
  const unit = (n: NodeView): bigint => {
    const v = price.basis === 'per_gb' ? n.pricePerGb : n.pricePerHour;
    return /^\d+$/.test(String(v ?? '')) ? BigInt(v) : 0n; // a malformed price counts as unpriced
  };
  const priced = pool.filter((n) => unit(n) > 0n);
  if (!priced.length) return pool;
  const floor = priced.reduce((m, n) => (unit(n) < m ? unit(n) : m), unit(priced[0]));
  return priced.filter((n) => unit(n) <= floor * QUICK_PRICE_BAND);
}

export function pickRandomQuickNode(nodes: NodeView[], preferredCountry: string | null, current: string | null, rnd: () => number = Math.random, price: { basis: Basis; units: number } = { basis: DEFAULT_SETTINGS.defaultBasis, units: DEFAULT_SETTINGS.defaultGb }): NodeView | null {
  // Only servers Connect will accept: answering AND still listed on chain. A server that answers
  // but whose listing has lapsed is refused before paying ("has not checked in recently"), so
  // offering it made Quick connect fail on the spot (owner's laptop, 2026-11-15 16:48Z, three times).
  const online = nodes.filter((n) => n.probe?.ok && n.listingFresh);
  const fav = online.filter((n) => n.favourite);
  const pref = preferredCountry ? online.filter((n) => n.countryCode === preferredCountry) : [];
  const pool = fav.length ? fav : cheapestBand(pref.length ? pref : online, price);
  if (!pool.length) return null;
  return pool.find((n) => n.address === current) ?? pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))];
}
