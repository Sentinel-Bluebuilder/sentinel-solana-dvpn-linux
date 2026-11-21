// ─── Plans + subscriptions service (F10) ───
// Subscribing pays the plan price up front; cancelling refunds nothing (UI says
// so before purchase). Expected terms ride the instruction so a price change
// between view and sign fails on chain (PlanTermsChanged) instead of overcharging.
import type { PlanRecord, Result, SubscriptionRecord } from '../../shared/types';
import { listPlans, markProviderAnswering, planRoster, providerApi, subscriptionsOf, type ProviderProbeEntry, type RosterEntry } from '../../core/plans/plans';
import { openSubscription, closeSubscription } from '../../core/chain/builders';
import { pda } from '../../core/chain/program';
import { signAndSend } from '../../core/app/signer';
import { describeInstructionError } from '../../core/chain/errors';
import { ownerAddress, ownerSigner } from '../wallet/vault';
import { patch } from '../app-state';
import { findNode } from './nodes';
import { log } from '../logger';
import { tr } from '../../shared/i18n';

let plans: PlanRecord[] = [];

const PROBE_MS = 4_000;
const probeCache = new Map<string, ProviderProbeEntry>();

// UI-172 (laptop log 2026-11-15, L27): 387 "plan provider not answering" lines; every provider was asked again
// every 10 minutes for good, 188 times one whose listed address is 127.0.0.1 (this computer itself) and 179 times
// one on a server that no longer exists. A provider that does not answer is now asked again after 10 min, 20 min,
// 40 min … up to 6 h; one whose listed address is this computer goes straight to 6 h. One log line per try.
export const PROVIDER_RETRY_MS = 10 * 60_000;
export const PROVIDER_RETRY_MAX_MS = 6 * 60 * 60_000;
const LOOPBACK_RE = /\b(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost)\b|\[?::1\]?(?::\d+)?\b/i;
const notAnswering = new Map<string, { fails: number; nextAt: number }>();
/** How long a provider that failed `fails` times in a row is left alone (ms). Exported for tests. */
export function providerRetryAfter(fails: number, loopback: boolean): number {
  if (loopback) return PROVIDER_RETRY_MAX_MS;
  return Math.min(PROVIDER_RETRY_MAX_MS, PROVIDER_RETRY_MS * 2 ** Math.max(0, fails - 1));
}
/** Tests: forget every provider's failures. */
export const resetProviderBackoff = (): void => notAnswering.clear();

/** W2: a provider is "answering" when its signed metadata verifies within a few seconds. */
async function providerAnswers(provider: string): Promise<boolean> {
  const held = notAnswering.get(provider);
  if (held && Date.now() < held.nextAt) return false; // still left alone: not asked, not logged
  try {
    await Promise.race([
      providerApi(provider, { timeoutMs: PROBE_MS }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('probe timed out')), PROBE_MS + 1_000).unref?.()),
    ]);
    notAnswering.delete(provider);
    return true;
  } catch (err) {
    const msg = (err as Error).message.split('\n')[0];
    const fails = (held?.fails ?? 0) + 1;
    const wait = providerRetryAfter(fails, LOOPBACK_RE.test(msg));
    notAnswering.set(provider, { fails, nextAt: Date.now() + wait });
    log.info('plan provider not answering', { provider, err: msg, tries: fails, nextTryInMin: Math.round(wait / 60_000) });
    return false;
  }
}

export async function refreshPlans(): Promise<PlanRecord[]> {
  plans = await markProviderAnswering(await listPlans(), providerAnswers, probeCache);
  return plans;
}

export const cachedPlans = (): PlanRecord[] => plans;

export async function refreshSubscriptions(): Promise<SubscriptionRecord[]> {
  const owner = ownerAddress();
  if (!owner) return [];
  try {
    const subs = await subscriptionsOf(owner);
    patch({ subscriptions: subs });
    return subs;
  } catch (err) {
    log.warn('subscriptions refresh failed', { err: (err as Error).message });
    return [];
  }
}

/** W2: an unreachable provider and a TIMEOUT read the same to the user (exported for tests). */
export function rosterErrorText(msg: string): string {
  if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|timeout|timed out|fetch failed|socket hang up/i.test(msg)) {
    return tr('This plan\'s provider is not answering right now, so its server list can\'t be shown. Try again later or pick another plan.');
  }
  return tr('Could not read this plan\'s server list: {split}', { split: msg.split('\n')[0] });
}

/** The provider's own API lists the plan's servers; an offline provider is a normal state, not a crash. */
/** UI-179: mark each roster node with what this app's own server list says about its on-chain listing. Exported
 *  for tests. */
export function withListing(entries: RosterEntry[], find: (address: string) => { listingFresh?: boolean } | null): RosterEntry[] {
  return entries.map((e) => {
    const n = find(e.node);
    return n && typeof n.listingFresh === 'boolean' ? { ...e, listed: n.listingFresh } : e;
  });
}

export async function roster(provider: string, plan: string): Promise<RosterEntry[]> {
  try {
    return withListing(await planRoster(provider, plan), findNode);
  } catch (err) {
    const msg = (err as Error).message;
    log.warn('plan roster failed', { plan, err: msg });
    throw new Error(rosterErrorText(msg));
  }
}

export const PLAN_PRICE_CHANGED_COPY = (): string => tr('This plan\'s price changed since you opened it. Nothing was paid. Open the plan again to see the new price.');

/**
 * `shownPrice` (base units): the price the screen or CLI showed. CODE-AUDIT E11: the expected terms come from this
 * process's plan list, which refreshes on its own; without this check a price raised between the view and that
 * refresh was signed as the new price, never shown. No shownPrice = an old caller, allowed.
 */
export async function subscribe(req: { plan: string; confirmed: true; shownPrice?: string }): Promise<Result<{ signature: string; subscription: string }>> {
  if (req.confirmed !== true) return { ok: false, error: tr('Confirm the price first.'), code: 'not-confirmed' };
  const owner = ownerAddress();
  if (!owner) return { ok: false, error: tr('Set up a wallet first.') };
  const p = (plans.length ? plans : await refreshPlans()).find((x) => x.address === req.plan);
  if (!p) return { ok: false, error: tr('That plan is not listed any more.'), code: 'plan-gone' };
  if (!p.providerListed) return { ok: false, error: tr('This plan\'s provider is not active.'), code: 'provider-inactive' };
  if (req.shownPrice && /^\d+$/.test(req.shownPrice) && BigInt(p.price) > BigInt(req.shownPrice)) {
    log.info('plan price went up since it was shown; nothing paid', { plan: p.address, shown: req.shownPrice, now: p.price });
    return { ok: false, error: PLAN_PRICE_CHANGED_COPY(), code: 'price-changed' };
  }
  try {
    const ix = await openSubscription({ owner, plan: p.address, provider: p.provider, terms: { price: p.price, durationSeconds: p.durationSeconds, dataCapGb: p.dataCapGb, maxConnections: p.maxConnections } });
    const r = await signAndSend(ownerSigner(), [ix], 'open_subscription');
    await refreshSubscriptions();
    return { ok: true, data: { signature: r.signature, subscription: pda.subscription(owner, p.address).toBase58() } };
  } catch (err) {
    return { ok: false, error: describeInstructionError(err) ?? (err as Error).message, code: 'subscribe-failed' };
  }
}

/** Close an EXPIRED subscription to recover its rent (no refund of the price). */
export async function closeSub(subscription: string): Promise<Result<string>> {
  const owner = ownerAddress();
  if (!owner) return { ok: false, error: tr('Set up a wallet first.') };
  const s = (await refreshSubscriptions()).find((x) => x.address === subscription);
  if (!s) return { ok: false, error: tr('Subscription not found.') };
  try {
    const r = await signAndSend(ownerSigner(), [await closeSubscription({ owner, subscription, rentPayer: s.rentPayer })], 'close_subscription');
    await refreshSubscriptions();
    return { ok: true, data: r.signature };
  } catch (err) {
    return { ok: false, error: describeInstructionError(err) ?? (err as Error).message, code: 'close-sub-failed' };
  }
}
