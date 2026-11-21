// ─── Activity: refunds (F12), spend (F13.4), history (F13.5), service records (F13.1–F13.3) ───
import { useEffect, useState } from 'react';
import { HELP, refundLine } from '../../../core/session/refund-copy';
import { settleToast, topUpToast } from '../../../shared/money-toast';
import { call, useApp } from '../lib/store';
import { ConfirmModal, CopyAddr, PageHeader, Section, Skeleton, StatCell, StatStrip, Help } from '../components/ui';
import { useKept } from '../lib/use-kept';
import { when } from '../lib/when';
import { ProtocolList, ProtocolTag } from '../components/ProtocolMark';
import { tdvpn, formatTdvpn, formatTdvpnShort, short, formatBytes, formatCountdown, closeReasonCopy } from '../../../shared/format';
import type { AppSnapshot, HistoryEntry, PendingSettlement, LiveSession } from '../../../shared/types';
import type { DaemonChannel, DaemonTicket } from '../../../core/daemon/client';
import type { Screen } from '../App';
import { tr, trPlural } from '../../../shared/i18n';

const STATUS_COPY = (): Record<PendingSettlement['status'], string> => ({
  'in-use': tr('In use'),
  open: tr('Refund starts soon'),
  closing: 'Refunding',
  ready: tr('Refund ready'),
});

/** The VPN service's status words, in plain ones (UI-049). An unknown one is shown as it is. */
const RECORD_STATUS = (): Record<string, string> => (Object.fromEntries([
  ['active', tr('In use')], ['connected', tr('In use')], ['connecting', 'Connecting'], ['pending', 'Starting'], ['open', 'Open'],
  ['closing', 'Refunding'], ['closed', 'Closed'], ['ended', 'Ended'], ['failed', 'Problem'], ['error', 'Problem'], ['expired', 'Expired'],
]));

interface Lists { sessions: LiveSession[]; channels: DaemonChannel[]; tickets: DaemonTicket[]; error: string | null }
interface Summary { sessions: number; spent: string; bytes: string; last30Spent: string }
type Tab = 'history' | 'sessions' | 'channels' | 'tickets';

/** One deposit: server (protocol logo when the server is known), status, refund; Top up while open. */
function RefundRow({ s, now, onTopUp, onRefund }: { s: PendingSettlement; now: number; onTopUp?: () => void; onRefund?: () => void }) {
  const line = refundLine(s.status, BigInt(s.refundable || '0'), s.readyAt, now, s.mode === 1);
  const node = useApp((st) => st.nodes.find((n) => n.address === s.node));
  return (
    <div className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-2 last:border-0" data-refund={s.channel}>
      <div className="min-w-0 flex-[1_1_14rem]">
        {/* mode 0 = voucher (per GB), 1 = stream (per hour) — chain/idl MODE_* */}
        <div className="flex flex-wrap items-center gap-x-2 text-sm">{s.mode === 0 ? tr('Per-GB deposit to') : tr('Per-hour deposit to')} {node?.protocolNames?.length ? <ProtocolList names={node.protocolNames} /> : null}<span className="mono text-fg-muted">{short(s.node)}</span></div>
        <div className="text-meta text-fg-muted" data-refund-status={s.status}>{line.text}</div>
        {/* rc.3.1 F1: opened by an earlier device of this wallet; it still refunds to this wallet. */}
        {s.device && <div className="text-meta text-fg-muted" data-other-device-row={s.device} title={tr('This deposit was made by a device this wallet used before. It is refunded to this wallet.')}>{tr('From another device ({device})', { device: short(s.device) })}</div>}
        {s.unverified && s.status === 'open' && <div className="text-meta text-fg-muted" data-refund-skipped>{tr('That device can still spend, so Refund all skips it. Refund it by itself.')}</div>}
      </div>
      {/* Amount, then the row's action at the very end (actions line up down the list). */}
      <div className="num ms-auto w-36 shrink-0 text-end text-sm">{formatTdvpn(s.refundable)} tDVPN<div className="text-meta text-fg-muted">{tr('of {escrow} tDVPN', { escrow: tdvpn(s.escrow) })}</div></div>
      <div className="flex w-36 shrink-0 items-center justify-end gap-1.5">
        {line.action && onRefund && <><button className="btn-ghost btn-sm" data-refund-action={s.channel} onClick={onRefund}>{line.action.label}</button><Help text={line.action.help} /></>}
        {!line.action && onTopUp && s.status === 'in-use' && <button className="btn-ghost btn-sm" onClick={onTopUp}>{tr('Top up')}</button>}
      </div>
    </div>
  );
}

export function Activity({ snap, go }: { snap: AppSnapshot; go: (s: Screen) => void }) {
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [lists, setLists] = useState<Lists | null>(null);
  // UI-021: the open tab is kept when you leave and come back.
  const [tab, setTab] = useKept<Tab>('activity.tab', 'history');
  // UI-049: the VPN service's own records are for looking something up; they sit behind one switch.
  const [advanced, setAdvanced] = useKept('activity.advanced', false);
  const [confirm, setConfirm] = useState<{ channels?: string[] } | null>(null);
  const [fund, setFund] = useState<{ channel: string; amount: string } | null>(null);
  const now = Date.now();

  useEffect(() => {
    call<HistoryEntry[]>(window.api.IPC.HISTORY_LIST).then(setHistory, () => setHistory([]));
    call<Summary>(window.api.IPC.SPEND_SUMMARY).then(setSummary, () => setSummary(null));
  }, [snap.session?.id]);
  useEffect(() => {
    if (tab !== 'history') call<Lists>(window.api.IPC.ACTIVITY_LISTS).then(setLists, () => setLists(null));
  }, [tab, snap.session?.id]);

  // rc.3.1 F1: an open deposit whose device can still spend is refunded only when named, so Refund all skips it.
  const skippedByAll = snap.settlements.filter((s) => s.unverified && s.status === 'open');
  const actionable = snap.settlements.filter((s) => (s.status === 'ready' || s.status === 'open') && !skippedByAll.includes(s));
  const refundTotal = snap.settlements.reduce((a, s) => a + BigInt(s.refundable || '0'), 0n);
  const canTopUp = (s: PendingSettlement): boolean => s.status === 'open' || s.status === 'in-use';
  const worth = snap.settlements.filter((s) => BigInt(s.refundable || '0') > 0n || canTopUp(s));
  const spent = snap.settlements.filter((s) => !worth.includes(s));

  return (
    <div>
      <PageHeader title={tr('Activity')} subtitle={tr('Your sessions, spending and refunds.')} />

      <StatStrip>
        <StatCell label={tr('Sessions')} value={summary?.sessions ?? '—'} />
        <StatCell label={tr('Spent')} value={summary ? `${formatTdvpnShort(summary.spent)} tDVPN` : '—'} />
        <StatCell label={tr('Data')} value={summary ? formatBytes(summary.bytes) : '—'} />
        <StatCell help={HELP().comingBack} label={tr('Refunds on the way')} value={`${formatTdvpnShort(refundTotal)} tDVPN`} />
      </StatStrip>

      <Section title={<span className="inline-flex items-center gap-2">{tr('Refunds')} <Help text={HELP().refunds} /></span>} right={<button className="btn-ghost btn-sm" disabled={!actionable.length} onClick={() => setConfirm({})}>{tr('Refund all now')}</button>}>
      {!snap.settlements.length ? <div className="empty-box">{tr('Nothing to refund. What you do not use of a deposit is refunded automatically.')}</div> : (
        <div className="card overflow-hidden p-0">
          {/* Money first: deposits that still return something or can be topped up. The rest (fully
              used, they only close) fold into one line — 266 rows of "0 tDVPN" buried the 2 that mattered. */}
          <div data-refunds="open">
            {worth.length === 0 ? <div className="empty-line">{tr('Nothing to refund.')}</div> : worth.map((s) => <RefundRow key={s.channel} s={s} now={now} onTopUp={() => setFund({ channel: s.channel, amount: '1' })} onRefund={() => setConfirm({ channels: [s.channel] })} />)}
          </div>
          {spent.length > 0 && (
            <details className="border-t border-line" data-refunds="used">
              <summary className="disclosure flex h-12 cursor-pointer items-center px-4 text-sm text-fg-muted hover:bg-bg-hover">{trPlural({ one: '{count} fully used deposit: nothing is left to refund; it closes on its own', other: '{count} fully used deposits: nothing is left to refund; they close on their own' }, spent.length, { count: spent.length })}</summary>
              {spent.map((s) => <RefundRow key={s.channel} s={s} now={now} />)}
            </details>
          )}
        </div>
      )}
      </Section>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label={tr('Records')}>
          {((advanced || tab !== 'history' ? ['history', 'sessions', 'channels', 'tickets'] : ['history']) as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? 'tab-active' : ''}`} data-activity-tab={t} onClick={() => setTab(t)}>
              {t === 'history' ? tr('History') : t === 'sessions' ? tr('Sessions') : t === 'channels' ? tr('Deposits') : tr('Plan access')}
            </button>
          ))}
          <label className={`toggle-chip ${advanced ? 'toggle-chip-on' : ''}`} title={tr('Show what the VPN service itself has on record: its sessions, deposits and plan access.')}>
            <input type="checkbox" checked={advanced} data-activity-advanced onChange={(e) => { setAdvanced(e.target.checked); if (!e.target.checked) setTab('history'); }} /> {tr('Advanced')}
          </label>
        </div>
        {tab === 'history' && <button className="btn-ghost btn-sm" disabled={!history?.length} onClick={() => void call(window.api.IPC.HISTORY_EXPORT)}>{tr('Export CSV')}</button>}
      </div>

      {tab === 'history' && (!history?.length ? <div className="empty-box justify-between gap-4" data-empty-history>{tr('No sessions yet. Each one you connect shows here with its server, time, data and cost.')}<button className="btn-ghost btn-sm shrink-0" onClick={() => go('nodes')}>{tr('Find a server')}</button></div> : (
        <div className="card overflow-x-auto p-0">
          <table className="dtable">
            <thead>
              <tr><th>{tr('Started')}</th><th>{tr('Server')}</th><th>{tr('Protocol')}</th><th className="n">{tr('Data')}</th><th className="n">{tr('Spent (tDVPN)')}</th><th>{tr('Ended')}</th></tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="num whitespace-nowrap">{when(h.startedAt)}</td>
                  {/* Country on top, the server's address under it (owner: the usual two-line server cell). */}
                  <td><div className="leading-snug" data-history-country>{h.country || '—'}</div><div className="text-meta text-fg-muted"><CopyAddr text={h.node} /></div></td>
                  <td>{h.service ? <ProtocolTag protocol={h.service} /> : '—'}</td>
                  <td className="n">{formatBytes((BigInt(h.rxBytes || '0') + BigInt(h.txBytes || '0')).toString())}</td>
                  <td className="n">{formatTdvpn(h.spent)}</td>
                  <td className="text-meta text-fg-dim">{h.endedAt ? (h.closeReason ? closeReasonCopy(h.closeReason).message.replace(/\.$/, '') : 'ended') : 'active'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {tab !== 'history' && (
        !lists ? <Skeleton rows={3} /> : lists.error ? <div className="empty-box text-bad">{lists.error}</div> : (
          <div className="card overflow-hidden p-0">
            {tab === 'sessions' && (lists.sessions.length ? lists.sessions.map((s) => (
              <Row key={s.id} left={<>{short(s.node)} {s.service ? <ProtocolTag protocol={s.service} size={18} /> : '—'}</>} sub={`${RECORD_STATUS()[s.status] ?? s.status}${s.error ? `: ${closeReasonCopy(s.error).message}` : ''}`} right={`${tdvpn(s.spent)} tDVPN`} />
            )) : <Empty text={tr('The VPN service has no sessions on record.')} />)}
            {tab === 'channels' && (lists.channels.length ? lists.channels.map((c) => (
              <Row key={c.address} left={<CopyAddr text={c.address} />} sub={`${RECORD_STATUS()[c.status] ?? c.status}. Paid ${Number(c.mode) === 0 ? 'per GB' : 'per hour'} to server ${short(c.node)}.`} right={`${tdvpn(c.cumulative)} used of ${tdvpn(c.escrow)} tDVPN`} />
            )) : <Empty text={tr('The VPN service has no deposits on record.')} />)}
            {tab === 'tickets' && (lists.tickets.length ? lists.tickets.map((t) => (
              <Row key={t.hash} left={<span className="mono">{t.hash.slice(0, 16)}…</span>} sub={`Plan ${short(t.subscription)} on server ${short(t.node)}`} right={t.expiresAt && t.expiresAt !== '0' ? `until ${when(Number(t.expiresAt) * 1000)}` : ''} />
            )) : <Empty text={tr('No plan access on record.')} />)}
          </div>
        )
      )}

      {confirm && (
        <ConfirmModal
          title={confirm.channels ? tr('Refund now?') : tr('Refund all now?')}
          lines={['A ready refund goes straight to your wallet. Any other starts its 2-hour refund now.', 'Your wallet signs once. Without this, every refund still happens automatically.']}
          confirmLabel={tr('Refund now')}
          onConfirm={async () => {
            const sigs = await call<string[]>(window.api.IPC.SETTLE_RUN, { ...(confirm.channels ? { channels: confirm.channels } : {}), confirmed: true });
            const skipped = confirm.channels ? 0 : skippedByAll.length;
            useApp.getState().toast('success', skipped ? `${settleToast(sigs)} ${trPlural({ one: '{count} deposit was skipped: the device that made it can still spend. Refund it by itself.', other: '{count} deposits were skipped: the devices that made them can still spend. Refund each by itself.' }, skipped, { count: skipped })}` : settleToast(sigs));
          }}
          onClose={() => setConfirm(null)}
        />
      )}
      {fund && (
        <ConfirmModal
          title={tr('Top up deposit')}
          lines={[
            <label key="a" className="flex items-center gap-2">{tr('Add')} <input className="input w-28" inputMode="decimal" value={fund.amount} onChange={(e) => setFund({ ...fund, amount: e.target.value.replace(/[^0-9.]/g, '') })} aria-label={tr('Amount')} /> tDVPN</label>,
            'Lets the current deposit keep paying this server. What stays unused is refunded automatically.',
            'Network: Solana devnet (test tokens).',
          ]}
          confirmLabel={tr('Top up')}
          onConfirm={async () => { await call(window.api.IPC.CHANNEL_FUND, { channel: fund.channel, tdvpn: fund.amount, confirmed: true }); useApp.getState().toast('success', topUpToast(fund.amount)); }}
          onClose={() => setFund(null)}
        />
      )}
    </div>
  );
}

function Row({ left, sub, right }: { left: React.ReactNode; sub: string; right: string }) {
  return (
    <div className="flex min-h-14 items-center gap-4 border-b border-line px-4 py-2 text-sm last:border-0">
      <div className="min-w-0 flex-1"><div>{left}</div><div className="text-meta text-fg-muted">{sub}</div></div>
      <div className="num text-end text-fg-dim">{right}</div>
    </div>
  );
}

const Empty = ({ text }: { text: string }) => <div className="empty-line">{text}</div>;
