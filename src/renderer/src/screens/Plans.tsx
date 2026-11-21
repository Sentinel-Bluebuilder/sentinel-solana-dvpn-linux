// ─── Plans & subscriptions (F10) ───
// Subscribe directly to any provider's plan; connect to any node on its roster.
import { useEffect, useState } from 'react';
import { call, useApp } from '../lib/store';
import { ConfirmModal, CopyAddr, PageHeader, Section, Sheet, Skeleton, Flag } from '../components/ui';
import { ProtocolList } from '../components/ProtocolMark';
import { ConnectSheet } from '../components/ConnectSheet';
import { tdvpn, formatTdvpn, formatTdvpnShort, short, formatCountdown, plural, formatPeriod as duration, planLength } from '../../../shared/format';
import type { AppSnapshot, PlanRecord, NodeView, SubscriptionRecord } from '../../../shared/types';

import type { RosterEntry } from '../../../core/plans/plans';
import { tr, trPlural } from '../../../shared/i18n';


export function Plans({ snap }: { snap: AppSnapshot }) {
  const nodes = useApp((s) => s.nodes);
  const [plans, setPlans] = useState<PlanRecord[] | null>(null);
  const [confirm, setConfirm] = useState<PlanRecord | null>(null);
  const [closing, setClosing] = useState<SubscriptionRecord | null>(null);
  const [roster, setRoster] = useState<{ sub: SubscriptionRecord; list: RosterEntry[] | null; held: string[]; error?: string } | null>(null);
  const [sheet, setSheet] = useState<{ node: NodeView; sub: SubscriptionRecord } | null>(null);
  const [showEnded, setShowEnded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const now = Math.floor(Date.now() / 1000);

  useEffect(() => { call<PlanRecord[]>(window.api.IPC.PLANS_LIST).then(setPlans, () => setPlans([])); }, []);
  // Q0319: a subscription made in the CLI or on another device shows now, not at the next 600 s poll.
  const refreshSubs = async (quiet = false): Promise<void> => {
    setRefreshing(true);
    try { await call(window.api.IPC.SUBSCRIPTIONS_REFRESH, undefined, { quiet }); } catch (err) { console.warn('subscriptions refresh failed', err); } finally { setRefreshing(false); }
  };
  useEffect(() => { void refreshSubs(true); }, []); // on open: quiet; the Refresh button shows a failure

  const openRoster = async (sub: SubscriptionRecord): Promise<void> => {
    setRoster({ sub, list: null, held: [] });
    // Tickets the service holds for this plan: a plan's server limit counts them until they expire.
    const held = await call<{ tickets: Array<{ node: string; subscription: string; expiresAt: string }> }>(window.api.IPC.ACTIVITY_LISTS, undefined, { quiet: true })
      .then((l) => l.tickets.filter((t) => t.subscription === sub.address && Number(t.expiresAt) * 1000 > Date.now()).map((t) => t.node), () => [] as string[]);
    try { setRoster({ sub, held, list: await call<RosterEntry[]>(window.api.IPC.PLAN_ROSTER, { provider: sub.provider, plan: sub.plan }, { quiet: true }) }); } catch (err) { setRoster({ sub, held, list: [], error: (err as Error).message }); }
  };

  // Ended subscriptions fold into one line: they only need a Remove now and then.
  const live = snap.subscriptions.filter((s) => s.active && s.expiresAt - now > 0);
  const ended = snap.subscriptions.filter((s) => !(s.active && s.expiresAt - now > 0));
  const subRow = (s: SubscriptionRecord): JSX.Element => {
    const left = s.expiresAt - now;
    return (
      <div key={s.address} className="flex min-h-14 items-center gap-4 border-t border-line px-4 py-2 first:border-t-0">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{tr('Plan')} <CopyAddr text={s.plan} /></div>
          <div className="text-meta text-fg-muted">{tr('Provider {provider}:', { provider: short(s.provider) })} {s.active && left > 0 ? `${formatCountdown(left)} left` : 'expired'}</div>
        </div>
        {s.active && left > 0 && <button data-roster={s.address} className="btn-primary btn-sm" onClick={() => void openRoster(s)}>{tr('Servers')}</button>}
        <button className="btn-ghost btn-sm" onClick={() => setClosing(s)}>{left > 0 ? tr('Cancel') : tr('Remove')}</button>
      </div>
    );
  };

  return (
    <div>
      <PageHeader title={tr('Plans')} subtitle={tr('Subscribe once, then use any of its servers.')} />

      <Section title={tr('Your subscriptions')} right={<button className="btn-ghost btn-sm" data-plans-refresh disabled={refreshing} onClick={() => void refreshSubs()}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>}>
        <div className={snap.subscriptions.length ? 'card overflow-hidden p-0' : ''}>
          {!snap.subscriptions.length && <div className="empty-box">{tr('No subscriptions yet. Pick a plan below: you pay once and can use any of its servers until it ends.')}</div>}
          {live.map(subRow)}
          {ended.length > 0 && (
            <button className={`flex h-12 w-full items-center gap-2 px-4 text-start text-sm text-fg-dim hover:bg-bg-hover ${live.length ? 'border-t border-line' : ''}`} aria-expanded={showEnded} onClick={() => setShowEnded(!showEnded)}>
              <svg viewBox="0 0 24 24" className={`h-4 w-4 text-fg-muted transition-transform ${showEnded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
              <span className="num">{plural(ended.length, 'ended subscription')}</span>
            </button>
          )}
          {showEnded && ended.map(subRow)}
        </div>
      </Section>

      <Section title={tr('Available plans')}>
        {!plans ? <Skeleton rows={3} /> : !plans.filter((p) => p.listed).length ? <div className="empty-box">{tr('No plans are listed on devnet right now.')}</div> : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {plans.filter((p) => p.listed).map((p) => (
              // The original layout, styled (owner 2026-11-12): length and price on top, what is included
              // in one line, provider and Subscribe at the foot behind a divider.
              <div key={p.address} className="card flex min-w-0 flex-col gap-3 p-5 transition-colors hover:border-line-strong" data-plan-card={p.address}>
                <div className="flex items-baseline justify-between gap-4">
                  <div className="truncate font-display text-section leading-tight">{planLength(p.durationSeconds)}</div>
                  <div className="num shrink-0 whitespace-nowrap font-display text-value font-semibold leading-tight">{BigInt(p.price || '0') === 0n ? tr('Free') : <>{formatTdvpnShort(p.price)} <span className="text-meta font-normal text-fg-muted">tDVPN</span></>}</div>
                </div>
                <div className="flex flex-wrap gap-2 text-sm" data-plan-facts>
                  <span className="rounded-md border border-line bg-bg-input px-2 py-0.5 text-fg-dim">{p.dataCapGb ? `${p.dataCapGb} GB` : tr('Unlimited data')}</span>
                  <span className="rounded-md border border-line bg-bg-input px-2 py-0.5 text-fg-dim">{p.maxConnections ? trPlural({ one: '{count} server', other: '{count} servers' }, p.maxConnections, { count: p.maxConnections }) : tr('Any number of servers')}</span>
                </div>
                <div className="mt-auto flex items-center justify-between gap-4 border-t border-line pt-3">
                  <span className="min-w-0 truncate text-meta text-fg-muted">{tr('Provider')} <CopyAddr text={p.provider} />{!p.providerListed ? <span className="text-warn"> {tr('(not listed)')}</span> : p.providerAnswering === false ? <span className="text-warn"> {tr('(offline)')}</span> : null}</span>
                  <button className="btn-primary btn-sm shrink-0" disabled={!p.providerListed} onClick={() => setConfirm(p)}>{tr('Subscribe')}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {confirm && (
        <ConfirmModal
          title={tr('Subscribe to plan')}
          lines={[`Pay ${tdvpn(confirm.price)} tDVPN from your wallet now.`, `Valid for ${duration(confirm.durationSeconds)} from now. Plans don't renew; you can buy again after it ends.`, 'Cancelling early does not refund the price.', 'Network: Solana devnet (test tokens).']}
          confirmLabel={tr('Pay {price} tDVPN', { price: tdvpn(confirm.price) })}
          onConfirm={async () => { await call(window.api.IPC.SUBSCRIBE, { plan: confirm.address, shownPrice: String(confirm.price), confirmed: true }); }}
          onClose={() => setConfirm(null)}
        />
      )}
      {closing && (
        <ConfirmModal
          title={closing.expiresAt > now ? tr('Cancel subscription') : tr('Remove subscription')}
          danger={closing.expiresAt > now}
          lines={closing.expiresAt > now
            ? ['Access ends now and the price is not refunded.', 'If you buy this plan again, servers you already used count toward its server limit until your access to them ends (up to a day).']
            : ['Removes the ended subscription. The small network fee paid when it was made is returned to your wallet.']}
          confirmLabel={closing.expiresAt > now ? tr('Cancel subscription') : tr('Remove')}
          onConfirm={async () => { await call(window.api.IPC.SUBSCRIBE, { close: closing.address, confirmed: true }); }}
          onClose={() => setClosing(null)}
        />
      )}
      {roster && (
        // UI-027: the same dialog shell as every other dialog (Esc, click outside, focus, scroll lock).
        <Sheet title={tr('Servers on this plan')} width="max-w-lg" onClose={() => setRoster(null)} data-plan-roster={roster.sub.address}>
            {roster.sub.maxConnections > 0 && (
              <p className="mb-4 text-meta text-fg-dim">
                {trPlural({ one: 'This plan gives access on {count} server. Access to a server lasts until the plan ends.', other: 'This plan gives access on {count} servers. Access to a server lasts until the plan ends.' }, roster.sub.maxConnections, { count: roster.sub.maxConnections })}
                {new Set(roster.held).size >= roster.sub.maxConnections ? <> {tr('All of it is in use, so only the servers marked “Your access” can be used.')}</> : null}
              </p>
            )}
            {!roster.list ? <Skeleton rows={3} /> : roster.error ? <p className="text-sm text-bad">{roster.error}</p> : !roster.list.length ? <p className="text-sm text-fg-dim">{tr('The provider lists no servers for this plan.')}</p> : (
              <div className="space-y-1">
                {roster.list.map((r) => {
                  const n = nodes.find((x) => x.address === r.node);
                  return (
                    <div key={r.node} className="flex min-h-12 items-center gap-3 rounded px-2 py-2 hover:bg-bg-hover">
                      {n && <Flag code={n.countryCode} />}
                      <span className="min-w-0 flex-1 truncate"><span className="mono">{short(r.node, 8)}</span> <span className="text-meta text-fg-muted">{n && <ProtocolList names={n.protocolNames} />}</span></span>
                      {roster.held.includes(r.node) && <span className="pill">{tr('Your access')}</span>}
                      {!r.live && <span className="text-meta text-fg-muted" title={tr('The plan\'s provider is not answering right now, so new access to this server cannot be given.')}>{tr('provider offline')}</span>}
                      <button data-plan-connect={r.node} className="btn-primary btn-sm" disabled={!n?.probe?.ok || r.listed === false || !snap.conn.canConnect || (!roster.held.includes(r.node) && roster.sub.maxConnections > 0 && new Set(roster.held).size >= roster.sub.maxConnections)} onClick={() => { if (n) { setSheet({ node: n, sub: roster.sub }); setRoster(null); } }}>{!n?.probe?.ok ? tr('Offline') : r.listed === false ? tr('Not listed now') : !roster.held.includes(r.node) && roster.sub.maxConnections > 0 && new Set(roster.held).size >= roster.sub.maxConnections ? tr('Limit reached') : tr('Connect')}</button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="mt-4 text-end"><button className="btn-ghost" onClick={() => setRoster(null)}>{tr('Close')}</button></div>
        </Sheet>
      )}
      {sheet && <ConnectSheet node={sheet.node} snap={snap} subscription={{ provider: sheet.sub.provider, subscription: sheet.sub.address }} onClose={() => setSheet(null)} />}
    </div>
  );
}
