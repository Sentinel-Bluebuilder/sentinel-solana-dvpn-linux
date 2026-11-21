// ─── Node test (rows 143–156): a real session on each chosen server ───
// Own tab, own service; shares nothing with the Connect flow except the VPN service, which
// runs one session at a time, so testing is off while you are connected. The server count
// is the shared census (lib/use-census), the same one Home and Servers show. Every rule
// (stages, result codes, batches, resume, history) is in core/nodetest; this page only shows it.
import { useEffect, useMemo, useState } from 'react';
import { call, useApp } from '../lib/store';
import { ConfirmModal, CopyAddr, PageHeader, Section, StatCell, StatStrip, Flag, Banner } from '../components/ui';
import { Icon } from '../components/Icon';
import { when } from '../lib/when';
import { useCensus, rowStatus } from '../lib/use-census';
import { useSettled } from '../lib/use-settled';
import { ProtocolList, ProtocolTag } from '../components/ProtocolMark';
import { tdvpn, toBaseUnits, short } from '../../../shared/format';
import type { AppSnapshot } from '../../../shared/types';
import { historyLine, historyParts, selectServers, serverSummary, type PlanReply, type RunRow, type ServerHistory, type TestProgress, type TestRun } from '../../../core/nodetest/plan';
import type { NodeTestPreview } from '../../../core/nodetest/fixtures';
import { protocolLabel } from '../../../shared/protocols';
import { SLOW_BELOW_MBPS, STAGES, STAGE_DOING, STAGE_LABEL, RESULT_CODES, resultSentence, tally, type ServerTestResult, type TestVerdict } from '../../../core/nodetest/stages';
import { verdictText } from '../../../core/nodetest/text';
import { tr, trPlural } from '../../../shared/i18n';

interface HistoryReply { runs: RunRow[]; run: TestRun | null; running: TestRun | null; history?: ServerHistory }

const VERDICT_CLASS: Record<TestVerdict, string> = { working: 'text-ok', slow: 'text-warn', failed: 'text-bad', 'not-tested': 'text-fg-muted', stopped: 'text-fg-muted' };
const VERDICT_WORD = (): Record<TestVerdict, string> => verdictText();
const FILTERS: Array<TestVerdict | 'all'> = ['all', 'working', 'slow', 'failed', 'not-tested'];
// Server picker columns: box, flag, country, protocols, address, last result, response (header and rows share it).
const PICK_COLS = 'grid grid-cols-[16px_20px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,0.8fr)] items-center gap-3';
const RESULT_COLS = 'grid min-h-12 w-full grid-cols-[84px_minmax(0,140px)_minmax(0,120px)_minmax(0,120px)_minmax(0,1fr)] items-center gap-3 px-4 py-2 text-start text-sm hover:bg-bg-hover';

// A duration (an amount of time), placed in sentences as {time}.
const minutes = (seconds: number): string => (seconds < 90 ? tr('about {n} min', { n: 1 }) : seconds < 5400 ? tr('about {n} min', { n: Math.round(seconds / 60) }) : tr('about {n} h', { n: Math.round(seconds / 360) / 10 }));

/** "3 of 10 tested. Now testing Germany over WireGuard (AbC…xyz)." One whole sentence per case. */
function progressLine(p: TestProgress, place: string | undefined): string {
  const v = { done: p.done, total: p.total };
  if (!p.server) return tr('{done} of {total} tested', v);
  const w = { ...v, address: short(p.server), place: place ?? '', protocol: p.protocol ? protocolLabel(p.protocol) : '' };
  if (place && p.protocol) return tr('{done} of {total} tested. Now testing {place} over {protocol} ({address})', w);
  if (place) return tr('{done} of {total} tested. Now testing {place} ({address})', w);
  if (p.protocol) return tr('{done} of {total} tested. Now testing a server over {protocol} ({address})', w);
  return tr('{done} of {total} tested. Now testing a server ({address})', w);
}

function stepText(p: TestProgress): string {
  if (p.step === 'baseline') return tr('Measuring your speed without VPN…');
  if (p.step === 'closing-deposits') return tr('Closing the test deposits…');
  if (p.step === 'waiting-for-refunds') return tr('Waiting for refunds before the next batch…');
  return STAGE_DOING()[p.step];
}

// UI-185: the page opens at its full size. The last runs are kept for the app run and shown at once (then
// refreshed in place); the first visit shows rows of the real height where they go. The server list, the plan
// line and the progress card hold their place while their data comes.
const LAST: { hist: HistoryReply | null } = { hist: null };

/** `preview` = made-up data for the gallery (core/nodetest/fixtures.ts): nothing is loaded from or sent to the app. */
/** Past-run rows of the real height, while the history is read the first time. */
function RunRowsLoading() {
  return (
    <div aria-busy="true" aria-label={tr('Reading past runs')} data-runs-loading>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="flex h-12 items-center gap-4 border-b border-line px-4 last:border-0" aria-hidden>
          <span className="h-4 w-36 animate-pulse rounded bg-bg-hover" /><span className="h-4 w-48 animate-pulse rounded bg-bg-hover" />
        </div>
      ))}
    </div>
  );
}

export function NodeTest({ snap, preview }: { snap: AppSnapshot; preview?: NodeTestPreview }) {
  const liveNodes = useApp((s) => s.nodes);
  const nodes = preview?.nodes ?? liveNodes;
  const { c, byAddress, line } = useCensus(nodes);
  const [picked, setPicked] = useState<string[]>(preview?.picked ?? []);
  const [country, setCountry] = useState('');
  const [protocol, setProtocol] = useState('');
  const [failedLast, setFailedLast] = useState(false);
  const [neverTested, setNeverTested] = useState(false);
  const [plan, setPlan] = useState<PlanReply | null>(preview?.plan ?? null);
  const [limit, setLimit] = useState(preview?.limit ?? '');
  // The dialog keeps the plan it opened with; a failed plan reload shows an error instead of a silent null (Q0317).
  const [confirm, setConfirm] = useState<PlanReply | null>(null);
  const [resumeAsk, setResumeAsk] = useState(false);
  const [planError, setPlanError] = useState('');
  const [progress, setProgress] = useState<TestProgress | null>(preview?.progress ?? null);
  const [busy, setBusy] = useState(false);
  const [hist, setHistRaw] = useState<HistoryReply | null>(preview?.hist ?? LAST.hist);
  const setHist = (v: HistoryReply): void => { if (!preview) LAST.hist = v; setHistRaw(v); };
  const [filter, setFilter] = useState<TestVerdict | 'all'>('all');
  const [sort, setSort] = useState<'order' | 'speed'>('order');
  const [open, setOpen] = useState<string | null>(preview?.open ?? null);

  const load = (id?: string): void => { if (preview) return; call<HistoryReply>(window.api.IPC.NODE_TEST_HISTORY, id ? { id } : undefined, { quiet: true }).then(setHist, (err) => console.warn('node test history failed', err)); };
  useEffect(() => {
    if (preview) return undefined;
    load();
    return window.api.on<{ progress?: TestProgress; finished?: { ok: boolean; error?: string; data?: TestRun } }>(window.api.EVENTS.NODE_TEST, (e) => {
      if (e.progress) { setProgress(e.progress); setBusy(true); if (e.progress.result) load(); }
      if (e.finished) {
        setBusy(false); setProgress(null); load();
        // UI-111: this page is on screen and shows the result itself (tally, rows, the continue
        // banner), so a finished or stopped run needs no toast. A run that broke does.
        if (!e.finished.ok) useApp.getState().toast('error', e.finished.error ?? tr('The test run did not finish.'));
      }
    });
  }, []);
  useEffect(() => { if (hist?.running) setBusy(true); }, [hist?.running]);

  const history = useMemo<ServerHistory>(() => hist?.history ?? {}, [hist]);
  // Only servers on the network are listed; only ones that can be used right now can be ticked.
  const listed = useMemo(() => nodes.filter((n) => { const s = byAddress.get(n.address)?.state; return !!s && s !== 'listing-expired'; }), [nodes, byAddress]);
  const usable = useMemo(() => listed.filter((n) => byAddress.get(n.address)?.state === 'usable'), [listed, byAddress]);
  const shown = useMemo(
    () => selectServers(listed, { countries: country ? [country] : [], protocols: protocol ? [protocol] : [], failedLast, neverTested }, history),
    [listed, country, protocol, failedLast, neverTested, history],
  );
  const shownUsable = useMemo(() => shown.filter((n) => byAddress.get(n.address)?.state === 'usable'), [shown, byAddress]);
  const countries = useMemo(() => [...new Map(listed.map((n) => [n.countryCode, n.country])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [listed]);
  const protocols = useMemo(() => [...new Set(listed.flatMap((n) => n.protocolNames))].sort(), [listed]);

  const limitBase = (): string | null => {
    try { return limit.trim() ? toBaseUnits(limit.trim()) : null; } catch (err) { console.debug('deposit limit not a number yet', err); return null; }
  };
  useEffect(() => {
    if (preview) return undefined;
    if (!picked.length) { setPlan(null); setPlanError(''); return undefined; }
    const lim = limitBase();
    let stale = false;
    // The plan reads every picked server from the Solana network: wait until the typing stops.
    const t = setTimeout(() => {
      call<PlanReply>(window.api.IPC.NODE_TEST_PLAN, { nodes: picked, protocols: protocol ? [protocol] : undefined, limit: lim ?? undefined }, { quiet: true }).then(
        (p) => { if (stale) return; setPlan(p); setPlanError(''); if (!limit.trim()) setLimit(tdvpn(p.oneBatchLimit)); },
        (err) => { if (stale) return; console.warn('node test plan failed', err); setPlan(null); setPlanError((err as Error).message || tr('The deposits could not be worked out. Pick the servers again.')); },
      );
    }, 500);
    return () => { stale = true; clearTimeout(t); };
  }, [picked, protocol, limit]);

  // Audit U-5: busy before the request, never after it. A run the service refuses at once sends its `finished`
  // event before this call returns; setting busy after it left the Stop button on for a run that was not running.
  const startRun = async (req: Record<string, unknown>): Promise<void> => {
    setBusy(true);
    try {
      await call(window.api.IPC.NODE_TEST_RUN, req);
    } catch (err) {
      setBusy(false);
      throw err;
    }
  };
  const toggle = (a: string): void => setPicked((p) => (p.includes(a) ? p.filter((x) => x !== a) : [...p, a]));
  const run = hist?.running ?? hist?.run ?? null;
  const latest = hist?.runs[0];
  const canResume = !busy && !!latest?.resumable;
  const counts = tally(run?.results ?? []);
  const rows = useMemo(() => {
    const list = (run?.results ?? []).filter((r) => filter === 'all' || r.verdict === filter);
    return sort === 'speed' ? [...list].sort((a, b) => (b.mbps ?? -1) - (a.mbps ?? -1)) : list;
  }, [run, filter, sort]);
  const prevRun = hist && run ? hist.runs.find((r) => r.id < run.id) : undefined;
  const stepShown = useSettled(progress ? stepText(progress) : '');
  const stageIndex = progress && (STAGES as readonly string[]).includes(progress.step) ? (STAGES as readonly string[]).indexOf(progress.step) : -1;
  const runnable = !!plan && plan.batches.length > 0 && !snap.session;

  return (
    <div>
      <PageHeader title={tr('Node test')} subtitle={tr('Test servers one at a time with a real session.')} />
      {snap.session && <Banner kind="info">{tr('Disconnect first: the VPN service runs one session at a time, so testing waits until you are off the VPN.')}</Banner>}
      {canResume && latest && (
        <Banner kind="warn">
          <span data-test-resume>{latest.openDeposits
            ? trPlural({ one: 'The last test run did not finish: {left} of {total} tests left, {count} deposit still to close.', other: 'The last test run did not finish: {left} of {total} tests left, {count} deposits still to close.' }, latest.openDeposits, { left: latest.total - latest.done, total: latest.total, count: latest.openDeposits })
            : tr('The last test run did not finish: {left} of {total} tests left.', { left: latest.total - latest.done, total: latest.total })} </span>
          <button className="underline" disabled={!!snap.session} onClick={() => setResumeAsk(true)}>{tr('Continue the run')}</button>
        </Banner>
      )}

      <Section
        title={<>{tr('Servers to test')} <span className="num text-meta text-fg-muted" data-test-picked>{tr('{length} selected of {length2}', { length: picked.length, length2: listed.length })}</span></>}
        right={<>
          <button className="btn-ghost btn-sm" onClick={() => setPicked(shownUsable.map((n) => n.address))} disabled={busy || !shownUsable.length}>{tr('Select all shown')}</button>
          <button className="btn-ghost btn-sm" onClick={() => setPicked([])} disabled={busy || !picked.length}>{tr('Clear')}</button>
        </>}
      >
        <div className="mb-2 text-meta text-fg-muted" data-census-line>{tr('{usable} of {onNetwork} online. {line}.', { usable: c.usable, onNetwork: c.onNetwork, line })}</div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select className="input w-44" value={country} onChange={(e) => setCountry(e.target.value)} aria-label={tr('Country')} disabled={busy}>
            <option value="">{tr('All countries')}</option>
            {countries.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
          <select className="input w-44" value={protocol} onChange={(e) => setProtocol(e.target.value)} aria-label={tr('Connection type')} disabled={busy}>
            <option value="">{tr('All connection types')}</option>
            {protocols.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={failedLast} onChange={(e) => setFailedLast(e.target.checked)} disabled={busy} /> {tr('Failed last time')}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={neverTested} onChange={(e) => setNeverTested(e.target.checked)} disabled={busy} /> {tr('Never tested')}</label>
        </div>
        <div className="card overflow-hidden p-0">
          <div className={`${PICK_COLS} h-8 border-b border-line px-4 text-label uppercase text-fg-muted`} aria-hidden>
            <span /><span /><span>{tr('Country')}</span><span className="text-center">{tr('Connection')}</span><span className="text-center">{tr('Server')}</span><span>{tr('Last tests')}</span><span className="text-center">{tr('Response')}</span>
          </div>
          <div className="h-72 overflow-y-auto">
            {!shown.length ? <div className="empty-line">{listed.length ? tr('No server matches these filters.') : tr('No servers on the network yet. Open Servers to check them.')}</div> : shown.map((n) => {
              const e = byAddress.get(n.address);
              const st = rowStatus(e, n.probe?.latencyMs, false);
              const sum = serverSummary(history, n.address);
              const ok = e?.state === 'usable';
              return (
                <label key={n.address} data-server-state={e?.state} className={`${PICK_COLS} h-12 border-b border-line px-4 text-sm last:border-0 ${ok ? 'cursor-pointer hover:bg-bg-hover' : 'opacity-60'}`}>
                  <input type="checkbox" checked={picked.includes(n.address)} onChange={() => toggle(n.address)} disabled={busy || !ok} />
                  <Flag code={n.countryCode} />
                  <span className="truncate">{n.country}</span>
                  <span className="flex min-w-0 items-center justify-center gap-1 text-fg-dim"><ProtocolList names={n.protocolNames} /></span>
                  <span className="mono truncate text-center text-fg-muted">{short(n.address)}</span>
                  {/* UI-187: the last result, then the tally and speed on a second line; the whole sentence on hover. */}
                  {(() => {
                    const word = sum.lastVerdict ? VERDICT_WORD()[sum.lastVerdict] : tr('Tested');
                    const hp = historyParts(sum, word);
                    return (
                      <span className="min-w-0 text-meta leading-tight text-fg-dim" data-server-history title={historyLine(sum, word)}>
                        <span className={`block truncate ${sum.lastVerdict ? VERDICT_CLASS[sum.lastVerdict] : ''}`}>{hp.head}</span>
                        {hp.detail && <span className="block truncate text-fg-muted">{hp.detail}</span>}
                      </span>
                    );
                  })()}
                  <span className={`num text-center text-meta ${st.tone}`} title={st.title}>{st.label}</span>
                </label>
              );
            })}
          </div>
          {/* Footer bar of the list: what is on deposit at once, your limit, the run button. */}
          <div className="flex flex-wrap items-end gap-6 border-t border-line bg-bg-raised/40 px-4 py-3">
            <div>
              <div className="label">{tr('Most on deposit at once')}</div>
              <div className="num flex h-10 items-center font-display text-value" data-test-peak>{plan ? plan.estimateText : '—'}</div>
              {planError && <p className="text-sm text-bad" role="alert" data-plan-error>{planError}</p>}
            </div>
            <label className="block">
              <span className="label">{tr('Your deposit limit (tDVPN)')}</span>
              <input className="input num w-36" value={limit} onChange={(e) => setLimit(e.target.value)} disabled={busy} inputMode="decimal" />
            </label>
            <div className="ms-auto flex gap-2">
              {busy ? (
                <button className="btn-danger" onClick={() => void call(window.api.IPC.NODE_TEST_STOP)}>{tr('Stop')}</button>
              ) : (
                <button className="btn-primary" disabled={!runnable} onClick={() => setConfirm(plan)}>{tr('Run test')}</button>
              )}
            </div>
            {!busy && (
              <div className="w-full space-y-1 text-meta text-fg-muted" data-test-plan={plan ? 'ready' : 'none'}>
                <div className="min-h-[2lh]">{plan ? tr('Tests: {jobs}. Servers: {servers}. Time: {time}. A per-hour deposit is closed right after its server; a per-GB refund takes about 2 hours.', { jobs: plan.jobs, servers: plan.servers, time: minutes(plan.seconds) }) : picked.length ? tr('Working out the deposits…') : tr('Pick servers to see what the run holds on deposit and how long it takes.')}</div>
                {/* UI-194: the bar is said on the page, not hidden in the code. */}
                <div className="mt-1" data-slow-bar={SLOW_BELOW_MBPS}>{tr('A server counts as working at {SLOW_BELOW_MBPS} Mbps or more through it, and slow under that.', { SLOW_BELOW_MBPS })}</div>
                {plan && plan.waitSeconds > 0 && <div className="text-warn">{tr('With this limit the run waits {minutes} for refunds between {length} batches. A limit of {oneBatchLimit} tDVPN needs no waiting.', { minutes: minutes(plan.waitSeconds), length: plan.batches.length, oneBatchLimit: tdvpn(plan.oneBatchLimit) })}</div>}
                {plan && plan.overLimit.length > 0 && <div className="text-warn">{trPlural({ one: '{count} server needs a deposit over this limit and will not be tested. {limit} tDVPN fits every server.', other: '{count} servers need a deposit over this limit and will not be tested. {limit} tDVPN fits every server.' }, plan.overLimit.length, { count: plan.overLimit.length, limit: tdvpn(plan.smallestLimit) })}</div>}
                {plan && plan.unpriced.length > 0 && <div>{trPlural({ one: '{count} server lists no price: checked without paying.', other: '{count} servers list no price: checked without paying.' }, plan.unpriced.length, { count: plan.unpriced.length })}</div>}
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* A run seen before its first progress event (page opened mid-run) shows the card at once. */}
      {busy && !progress && <div className="card mb-6 text-sm text-fg-dim" aria-live="polite" data-test-progress="waiting"><div className="mb-2">{tr('Test running…')}</div><div className="mb-3 h-1.5 rounded bg-bg-raised" /><div className="min-h-[1lh]" /></div>}
      {progress && (
        <div className="card mb-6" aria-live="polite" data-test-progress>
          <div className="mb-2 flex justify-between text-sm">
            <span>{progressLine(progress, nodes.find((n) => n.address === progress.server)?.country)}</span>
            <span className="num text-fg-muted">{progress.done < progress.total ? `${minutes(progress.secondsLeft)} left` : ''}</span>
          </div>
          <div className="mb-3 h-1.5 overflow-hidden rounded bg-bg-raised"><div className="h-full bg-sol transition-all" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} /></div>
          {stageIndex >= 0 && (
            <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-meta" data-test-stages>
              {STAGES.map((s, i) => <span key={s} data-stage={s} data-stage-state={i < stageIndex ? 'done' : i === stageIndex ? 'now' : 'next'} className={`inline-flex items-center gap-1 ${i < stageIndex ? 'text-ok' : i === stageIndex ? 'text-fg' : 'text-fg-muted'}`}>{i < stageIndex && <Icon name="check" />}{STAGE_LABEL[s]}</span>)}
            </div>
          )}
          <div className="text-sm text-fg-dim" data-test-step>{stepShown}</div>
        </div>
      )}

      {run && (
        <>
          <StatStrip>
            <StatCell label={tr('Working')} value={counts.working} hint={tr('{SLOW_BELOW_MBPS} Mbps or more', { SLOW_BELOW_MBPS })} />
            <StatCell label={tr('Slow')} value={counts.slow} hint={tr('Under {SLOW_BELOW_MBPS} Mbps', { SLOW_BELOW_MBPS })} />
            <StatCell label={tr('Failed')} value={counts.failed} />
            <StatCell label={tr('Not tested')} value={counts.notTested + counts.stopped} />
            <StatCell label={tr('Without VPN')} value={run.baselineMbps ? `${run.baselineMbps} Mbps` : '—'} hint={when(run.baselineAt ?? run.startedAt)} />
          </StatStrip>
          <div className="mb-3 flex items-center gap-2">
            {FILTERS.map((v) => <button key={v} className={`tab ${filter === v ? 'tab-active' : ''}`} onClick={() => setFilter(v)}>{v === 'all' ? tr('All') : VERDICT_WORD()[v]}</button>)}
            <select className="input ms-auto w-40" value={sort} onChange={(e) => setSort(e.target.value as 'order' | 'speed')} aria-label={tr('Sort')}><option value="order">{tr('Test order')}</option><option value="speed">{tr('Fastest first')}</option></select>
            <button className="btn-ghost" onClick={() => void call(window.api.IPC.COPY, JSON.stringify(run, null, 2)).then(() => useApp.getState().toast('success', 'Results copied.'))} title={tr('Copies this run as text you can paste into a report.')}>{tr('Copy results')}</button>
          </div>
          <div className="card mb-6 overflow-hidden p-0">
            {!rows.length ? <div className="empty-line">{tr('Nothing to show for this filter.')}</div> : rows.map((r) => <ResultRow key={`${r.server}:${r.protocol}`} r={r} open={open === `${r.server}:${r.protocol}`} onToggle={() => setOpen(open === `${r.server}:${r.protocol}` ? null : `${r.server}:${r.protocol}`)} />)}
          </div>
        </>
      )}

      <Section title={tr('Past runs')}>
        <div className={hist?.runs.length !== 0 ? 'card overflow-hidden p-0' : ''}>
          {!hist ? <RunRowsLoading /> : !hist.runs.length ? <div className="empty-box">{tr('No test runs yet.')}</div> : hist.runs.map((r) => (
            <button key={r.id} data-test-run={r.id} className={`flex h-12 w-full items-center gap-4 border-b border-line px-4 text-start text-sm last:border-0 hover:bg-bg-hover ${run?.id === r.id ? 'bg-sol-soft' : ''}`} onClick={() => load(r.id)}>
              <span className="num w-36">{when(r.startedAt)}</span>
              <span className="num text-ok">{tr('Working {working}', { working: r.working })}</span><span className="num text-warn">{tr('Slow {slow}', { slow: r.slow })}</span><span className="num text-bad">{tr('Failed {failed}', { failed: r.failed })}</span>
              {r.notTested > 0 && <span className="num text-fg-muted">{tr('Not tested {notTested}', { notTested: r.notTested })}</span>}
              <span className="num ms-auto text-meta text-fg-muted">{r.resumable ? tr('Not finished: {done} of {total} tested', { done: r.done, total: r.total }) : r.stopped ? tr('Stopped after {done} of {total}', { done: r.done, total: r.total }) : tr('{done} of {total} tested', { done: r.done, total: r.total })}</span>
            </button>
          ))}
        </div>
        {prevRun && <div className="mt-2 text-meta text-fg-muted">{tr('Compare:')} <button className="underline" onClick={() => load(prevRun.id)}>{tr('open the run before ({when})', { when: when(prevRun.startedAt) })}</button></div>}
      </Section>

      {confirm && (
        <ConfirmModal
          title={trPlural({ one: 'Test {count} server?', other: 'Test {count} servers?' }, confirm.servers, { count: confirm.servers })}
          lines={[
            // an AMOUNT of tDVPN, not a count of deposits (two read-backs took it as a count)
            tr('One real session on each server, one at a time. Up to {amount} is held in deposits at once; the unused part of every deposit is refunded.', { amount: confirm.estimateText }),
            tr('A per-hour deposit is closed right after its server; a per-GB refund takes about 2 hours (Activity → Refunds).'),
            tr('Your internet goes through each server for about a minute while it is tested. The run takes {time}; you can stop it and continue later.', { time: minutes(confirm.seconds + confirm.waitSeconds) }),
          ]}
          confirmLabel={tr('Run test')}
          onConfirm={() => startRun({ nodes: picked, maxSpend: confirm.limit, protocols: protocol ? [protocol] : undefined, confirmed: true })}
          onClose={() => setConfirm(null)}
        />
      )}
      {resumeAsk && latest && (
        <ConfirmModal
          title={tr('Continue the last test run?')}
          lines={[
            tr('{left} of {total} tests are left. Deposits the run left open are closed first.', { left: latest.total - latest.done, total: latest.total }),
            tr('It uses the deposit limit you set when the run started.'),
          ]}
          confirmLabel={tr('Continue the run')}
          onConfirm={() => startRun({ nodes: [], maxSpend: '0', resume: true, confirmed: true })}
          onClose={() => setResumeAsk(false)}
        />
      )}
    </div>
  );
}

function ResultRow({ r, open, onToggle }: { r: ServerTestResult; open: boolean; onToggle: () => void }) {
  return (
    <div className="border-b border-line last:border-0" data-test-row={r.server} data-verdict={r.verdict} data-code={r.code}>
      <button className={RESULT_COLS} onClick={onToggle} aria-expanded={open}>
        <span className={`text-sm font-semibold ${VERDICT_CLASS[r.verdict]}`}>{VERDICT_WORD()[r.verdict]}</span>
        <span className="truncate">{r.country || '—'}</span>
        <span className="text-fg-dim">{r.protocol ? <ProtocolTag protocol={r.protocol} /> : '—'}</span>
        <span className="mono truncate text-fg-muted">{short(r.server)}</span>
        <span className="truncate text-end text-meta text-fg-dim">{resultSentence(r)}</span>
      </button>
      {open && (
        <div className="space-y-1 bg-bg-raised/40 px-4 pb-3 pt-1 text-meta text-fg-dim">
          <div>{resultSentence(r)}</div>
          {r.stages.map((s) => (
            <div key={s.stage} data-stage={s.stage} data-stage-ok={s.ok} className="flex flex-wrap items-center gap-1">
              <Icon name={s.ok ? 'check' : 'x'} className={s.ok ? 'text-ok' : 'text-bad'} label={s.ok ? tr('Passed') : tr('Did not pass')} /> {STAGE_LABEL[s.stage]}
              {/* UI-187: the stage, then what it found after a colon, then how long it took in brackets. */}
              {s.stage === 'exit-address' && r.exitIp ? <>: <span className="mono text-fg-muted">{r.exitIp}</span></> : null}
              {s.stage === 'speed' && r.mbps !== null ? <>: <span className="num text-fg-muted">{r.speedBasis === 'transfer' ? 'at least ' : ''}{tr('{mbps} Mbps', { mbps: r.mbps })}</span></> : null}
              {s.ms !== null && s.ms >= 100 ? <span className="num text-fg-muted">{tr('(took {ms} s)', { ms: Math.round(s.ms / 100) / 10 })}</span> : null}
            </div>
          ))}
          {r.closeCode && <div className="text-warn">{RESULT_CODES()[r.closeCode].sentence}</div>}
          {/* UI-187: label and value pairs, not one line of fragments. */}
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-0.5 pt-1" data-test-facts>
            <dt className="text-fg-muted">{tr('Server')}</dt><dd className="min-w-0"><CopyAddr text={r.server} /></dd>
            {r.basis && <><dt className="text-fg-muted">{tr('Paid')}</dt><dd>{r.basis === 'per_hour' ? tr('Per hour') : tr('Per GB')}</dd></>}
            {r.deposit && <><dt className="text-fg-muted">{tr('Deposit')}</dt><dd className="min-w-0"><CopyAddr text={r.deposit} /></dd></>}
            <dt className="text-fg-muted">{tr('Took')}</dt><dd className="num">{Math.round((r.endedAt - r.startedAt) / 1000)} s</dd>
            <dt className="text-fg-muted">{tr('Result code')}</dt><dd className="mono">{r.code}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}
