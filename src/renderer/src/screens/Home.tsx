// ─── Connect / status (F9, F11, F12, F14, F16a) ───
import { recentlyConnected } from '../../../core/nodes/recent-order';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { HELP } from '../../../core/session/refund-copy';
import { call, useApp } from '../lib/store';
import { RestoreNetworkButton } from '../components/RestoreNetworkButton';
import { Term } from '../components/Term';
import { Banner, BannerStack, Flag, HiddenIp, PageHeader, Section, StatCell, StatStrip } from '../components/ui';
import { ProtocolList, ProtocolTag } from '../components/ProtocolMark';
import { ConnectSheet } from '../components/ConnectSheet';
import { formatBytes, formatDuration, formatTdvpn, formatTdvpnShort, tdvpn, short, countryName } from '../../../shared/format';
import type { AppSnapshot, NodeView } from '../../../shared/types';
import type { Screen } from '../App';
import { pickRandomQuickNode } from '../../../shared/quick-pick';
import { BuiltOnSentinel } from '../components/BuiltOnSentinel';
import { protocolLabel } from '../../../shared/protocols';

/** The server Quick connect is offering now; kept across page visits, cleared when a session ends. */
let QUICK_OFFER: string | null = null;
import { coverageCopy } from '../../../core/session/coverage';
import { restoreInPanel, sessionWarningCopy } from '../../../core/session/state';
import { actionSentence, connectActionButton } from '../../../shared/connect-action';
import { byPlatform, onAndroid, osPick, thisDevice } from '../lib/platform';
import { rowStatus, useCensus, type CensusView } from '../lib/use-census';
import { Icon } from '../components/Icon';
import { useSettled } from '../lib/use-settled';
import { stageInput } from '../components/SessionCard';
import { connectStage, type Tone } from '../../../core/session/connect-stage';
import { tr } from '../../../shared/i18n';

// Colour means state: green protected, amber needs attention, red failed or blocked. Progress is neutral.
const RING_TONE: Record<Tone, string> = { neutral: 'bg-sol opacity-40', working: 'bg-sol opacity-40', ok: 'bg-ok/20 animate-breathe', warn: 'bg-warn/30', bad: 'bg-bad/30' };
const LABEL_TONE: Record<Tone, string> = { neutral: 'text-fg-muted', working: 'text-fg-dim', ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' };

/** The button under a "session ended" banner goes where its advice points, and says so. */
function closeAction(action: string | null, go: (s: Screen) => void): ReactNode {
  if (!action) return undefined;
  if (/fund/i.test(action)) return <button className="btn-ghost btn-sm" onClick={() => go('wallet')}>{tr('Wallet')}</button>;
  if (/plan/i.test(action)) return <button className="btn-ghost btn-sm" onClick={() => go('plans')}>{tr('Plans')}</button>;
  return <button className="btn-ghost btn-sm" onClick={() => go('nodes')}>{tr('Servers')}</button>;
}

/** UI-078: less than a fifth of this session's deposit is left (deposit − spent, base units). Plan sessions have no deposit. */
function depositLow(snap: AppSnapshot): boolean {
  const s = snap.session;
  const dep = s ? snap.settlements.find((p) => p.channel === s.channel) : undefined;
  if (!s || !dep) return false;
  try {
    const escrow = BigInt(dep.escrow || '0');
    const left = escrow - BigInt(s.spent || '0');
    return escrow > 0n && left * 5n < escrow;
  } catch (err) {
    console.warn('deposit-low check: amounts not readable', err);
    return false;
  }
}

/** UI-078: whole minutes a per-hour deposit still pays for (what is left ÷ the hourly rate); null for per GB or when unknown. */
function depositMinutesLeft(snap: AppSnapshot): number | null {
  const s = snap.session;
  const dep = s ? snap.settlements.find((p) => p.channel === s.channel) : undefined;
  if (!dep?.ratePerHour) return null;
  try {
    const rate = BigInt(dep.ratePerHour);
    if (rate <= 0n) return null;
    return Number((BigInt(dep.refundable || '0') * 60n) / rate);
  } catch (err) {
    console.warn('deposit minutes: amounts not readable', err);
    return null;
  }
}

export function Home({ snap, go }: { snap: AppSnapshot; go: (s: Screen) => void }) {
  const nodes = useApp((s) => s.nodes);
  const settings = useApp((s) => s.settings);
  const [sheet, setSheet] = useState<NodeView | null>(null);
  const { conn, session } = snap;
  // The one server count (rows 143–147), the same number the Servers page and Node test show.
  const cv = useCensus(nodes);
  const node = session ? nodes.find((n) => n.address === session.node) : undefined;

  // Quick connect: favourite → preferred country → lowest latency, online only.
  // Random within that pool, held steady until a session ends, then a new one is offered.
  const quick = useMemo(() => {
    // A connect that just failed: never offer that same server again straight away.
    const failed = conn.phase === 'error' ? QUICK_OFFER : null;
    const q = pickRandomQuickNode(failed ? nodes.filter((n) => n.address !== failed) : nodes, settings?.preferredCountry ?? null, failed ? null : QUICK_OFFER, Math.random, settings ? { basis: settings.defaultBasis, units: settings.defaultBasis === 'per_hour' ? settings.defaultHours : settings.defaultGb } : undefined);
    QUICK_OFFER = q?.address ?? null;
    return q;
  }, [nodes, settings?.preferredCountry, settings?.defaultBasis, settings?.defaultHours, settings?.defaultGb, conn.phase]);
  const hadSession = useRef(false);
  useEffect(() => {
    if (hadSession.current && !session) QUICK_OFFER = null;
    hadSession.current = !!session;
  }, [session]);

  const ready = snap.settlements.filter((s) => s.status === 'ready');
  const refundTotal = snap.settlements.reduce((a, s) => a + BigInt(s.refundable || '0'), 0n);
  // Q0366 end copy: the blocked view already says why and that the kill switch is blocking; the header
  // alert would be a second kill-switch message on the same screen. One message: the button moves here.
  const explainsBlock = restoreInPanel(conn);
  // "Protected" only when the measured exit IP says so (core/session/coverage); never just "connected".
  const live = conn.phase === 'connected';
  // One rule for "covered" (coverageCopy().ok): device, proxy-apps and the two split states.
  const safe = live && !!snap.coverage && coverageCopy(snap.coverage).ok;
  const unsafe = live && (snap.coverage === 'proxy-only' || snap.coverage === 'leaking');
  const ip = snap.publicIp && session && snap.publicIp.sid === session.id ? snap.publicIp : null;
  // The last connect that failed or was stopped: its note (a stop is not an error) and one button.
  const lastErr = !session && (conn.phase === 'error' || conn.phase === 'idle') ? snap.lastConnectError : null;
  const errBtn = lastErr ? connectActionButton(lastErr.action) : null;
  const errNode = lastErr ? nodes.find((n) => n.address === lastErr.node) : undefined;
  // One stage for the ring, the label and the tone (core/session/connect-stage). Connected but not yet
  // measured is Checking in the working tone, never a warning (UI-005).
  const stage = connectStage(stageInput(snap));
  const place = session ? (node ? countryName(node.countryCode) : short(session.node)) : '';
  const fallbackDetail = session ? tr('Through {place} over {service}.', { place, service: protocolLabel(session.service) }) : tr('Pick a server or use quick connect.');
  // What the hero says, held for a minimum time so short steps do not flash (UI-002). Urgent states show at once.
  // UI-007, UI-012: the server a connect is working on is known before its session exists: its flag is in the
  // ring from the first stage, and a switch reads "Switching to <place>…" instead of "Disconnecting…".
  const target = snap.connectTarget ? nodes.find((n) => n.address === snap.connectTarget!.node) : undefined;
  const ringNode = target ?? node;
  const heroTitle = snap.connectTarget?.switching && conn.phase === 'disconnecting' && target
    ? tr('Switching to {city}…', { city: target.probe?.city || countryName(target.countryCode) }) : conn.title;
  // UI-188: the minimum display time is for working steps, so they do not flash. A state at rest (not
  // connected, or a failure) gives way at once: a new connect never sits behind the old result.
  const shownAtRest = useRef(false);
  const said = useSettled(
    { stage, title: heroTitle, detail: lastErr?.message || conn.detail || fallbackDetail, note: lastErr?.code ?? null },
    { urgent: stage.urgent || shownAtRest.current, same: (a, b) => a.stage.stage === b.stage.stage && a.title === b.title && a.detail === b.detail },
  );
  shownAtRest.current = said.stage.stage === 'idle' || said.stage.stage === 'problem';
  const tone = said.stage.tone;
  const runErrAction = (): void => {
    if (!errBtn) return;
    if (errBtn.target === 'same-node') { if (errNode) setSheet(errNode); else go('nodes'); return; }
    if (errBtn.target === 'restore') { void call(window.api.IPC.RESTORE_NETWORK); return; }
    if (errBtn.target === 'disconnect') { void call(window.api.IPC.DISCONNECT); return; }
    go(errBtn.target === 'wallet' ? 'wallet' : errBtn.target === 'plans' ? 'plans' : errBtn.target === 'settings' ? 'settings' : errBtn.target === 'diagnostics' ? 'diagnostics' : 'nodes');
  };

  return (
    <div>
      <PageHeader title={tr('Connect')} subtitle={tr('Pick a server and pay it directly.')} right={<BuiltOnSentinel />} />

      {/* A plain "Disconnected." (you pressed Disconnect, or switched servers) needs no bar: the Connect
          button already says so (owner 2026-11-12). Only an unexpected end, or one with a next step, shows. */}
      {/* UI-010: one banner here at most, the most serious, sliding in and out. */}
      <BannerStack max={1}>
      {snap.lastCloseMessage && conn.phase === 'idle' && !(snap.lastCloseMessage.message === tr('Disconnected.') && !snap.lastCloseMessage.action) && (
        <Banner key="close" kind="warn" action={closeAction(snap.lastCloseMessage.action, go)}>
          <span data-close-message>{snap.lastCloseMessage.message}</span>
          {snap.lastCloseMessage.action && <span className="text-fg-dim"> {actionSentence(snap.lastCloseMessage.action)}</span>}
        </Banner>
      )}
      {/* UI-082: an empty wallet is told what it needs and taken there: free devnet SOL for fees (address
          copied, faucet opened), or test tDVPN sent to its address. Only while nothing else needs saying. */}
      {!session && conn.phase === 'idle' && snap.wallet && snap.owner && snap.wallet.ownerLamports === 0 && (
        <Banner key="no-sol" kind="info" action={<button className="btn-ghost btn-sm" data-get-sol onClick={() => { void window.api.invoke(window.api.IPC.COPY, snap.owner); void call(window.api.IPC.OPEN_EXTERNAL, 'https://faucet.solana.com/'); useApp.getState().toast('info', 'Your address is copied. Paste it into the faucet page.'); }}>{tr('Get devnet SOL')}</button>}>
          {tr('Your wallet has no SOL for network fees yet.')} <span className="text-fg-dim">{tr('The devnet faucet gives it for free.')}</span>
        </Banner>
      )}
      {!session && conn.phase === 'idle' && snap.wallet && snap.wallet.ownerLamports > 0 && BigInt(snap.wallet.ownerTdvpn || '0') + BigInt(snap.wallet.userBalance || '0') === 0n && (
        <Banner key="no-tdvpn" kind="info" action={<button className="btn-ghost btn-sm" onClick={() => go('wallet')}>{tr('Wallet')}</button>}>
          {tr('Your wallet has no tDVPN yet.')} <span className="text-fg-dim">{tr('Servers are paid in tDVPN (test tokens): have some sent to your address, shown in Wallet.')}</span>
        </Banner>
      )}
      {/* UI-078: said before the deposit runs out, not after. Under a fifth left = warn, with where to top up. */}
      {session && depositLow(snap) && (
        <Banner key="deposit-low" kind="warn" action={<button className="btn-ghost btn-sm" data-deposit-low-topup onClick={() => go('activity')}>{tr('Top up')}</button>}>
          <span data-deposit-low>{depositMinutesLeft(snap) !== null ? tr('Your deposit with this server is nearly used up: about {minutes} min left.', { minutes: depositMinutesLeft(snap)! }) : tr('Your deposit with this server is nearly used up.')} <span className="text-fg-dim">{tr('Top it up in Activity to stay connected; when it runs out the session ends.')}</span></span>
        </Banner>
      )}
      {session && sessionWarningCopy(session.warning) && (
        <Banner key="warning" kind="warn"><span data-session-warning={session.warning}>{sessionWarningCopy(session.warning)}</span></Banner>
      )}
      {conn.restoreNetwork && !explainsBlock && (
        <Banner key="blocked" kind="error" action={<RestoreNetworkButton small />}>
          {tr('Your internet may be blocked. Restore network releases it.')}
        </Banner>
      )}
      </BannerStack>

      <div className="card-raised relative mb-6 overflow-hidden rounded-xl p-0" data-coverage={live ? snap.coverage ?? '' : ''}>
        <div className="pointer-events-none absolute inset-0 bg-sol-soft opacity-60" aria-hidden />
        {/* Centred stack: status ring, state, one line, actions (the connect view of leading VPN apps). */}
        <div className="relative flex flex-col items-center px-6 py-6 text-center">
          {/* Status orb: gradient ring spins while busy, glows green when connected. */}
          <div className="relative flex h-[132px] w-[132px] shrink-0 items-center justify-center">
            {/* Two layers that are always mounted: the tone fades between states, the turning arc fades in and
                out without restarting (UI-006). */}
            <div className={`absolute inset-0 rounded-full transition-opacity duration-state ${said.stage.busy ? 'opacity-0' : 'opacity-100'} ${RING_TONE[tone]}`} aria-hidden />
            <div className={`absolute inset-0 animate-spin-slow rounded-full bg-sol transition-opacity duration-state ${said.stage.busy ? 'opacity-100' : 'opacity-0'}`} style={{ maskImage: 'conic-gradient(#000 0 70%, transparent)', WebkitMaskImage: 'conic-gradient(#000 0 70%, transparent)' }} aria-hidden />
            <div className={`relative flex h-[116px] w-[116px] items-center justify-center rounded-full border bg-bg-card transition-[border-color,box-shadow] duration-state ${tone === 'ok' ? 'border-ok/50 shadow-glow-green' : tone === 'warn' ? 'border-warn/60' : tone === 'bad' ? 'border-bad/50' : 'border-line-strong'}`}>
              {ringNode ? <Flag code={ringNode.countryCode} size={44} /> : (
                <svg viewBox="0 0 24 24" className={`h-11 w-11 transition-colors duration-state ${tone === 'ok' ? 'text-ok' : 'text-fg-muted'}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M12 2v8M6.3 6.3a8 8 0 1 0 11.4 0" /></svg>
              )}
            </div>
          </div>
          {/* Fixed slots: label, title, two lines of detail, one action row. A longer title or detail fills its
              slot; nothing below it moves (UI-003). */}
          <div className="mt-4 w-full min-w-0" data-stage={said.stage.stage} data-stage-step={said.stage.step ?? ''}>
            <div className={`mb-1 text-label font-semibold uppercase transition-colors duration-state ${LABEL_TONE[tone]}`}>{said.stage.label}</div>
            <div className="flex h-[52px] items-center justify-center">
              <div className={`hero-title font-display ${said.title.length > 26 ? 'text-value leading-snug' : 'text-hero'}`} data-hero-title>{said.title}</div>
            </div>
            <div className="mx-auto mt-1 line-clamp-2 h-10 max-w-[520px] text-sm text-fg-dim" title={said.detail}>{said.note ? <span data-connect-note={said.note}>{said.detail}</span> : said.detail}</div>
            {/* Announced once per settled state, not once per text change (UI-015). */}
            <div className="sr-only" aria-live="polite">{said.title}. {said.detail}</div>
            <div className="mt-4 flex min-h-10 flex-wrap items-center justify-center gap-2">
              {explainsBlock && <RestoreNetworkButton />}
              {errBtn &&<button data-connect-error-action={errBtn.target} className="btn-ghost" onClick={runErrAction}>{errBtn.label}</button>}
              {conn.canCancel && <button data-cancel-connect className="btn-ghost" onClick={() => void call(window.api.IPC.DISCONNECT, { cancel: true })}>{tr('Cancel')}</button>}
              {(conn.canDisconnect || conn.canStop) && <button data-disconnect className="btn-danger" onClick={() => void call(window.api.IPC.DISCONNECT)}>{conn.phase === 'reconnecting' ? tr('Stop') : tr('Disconnect')}</button>}
              {conn.canConnect && (
                quick
                  ? <button className="btn-primary px-6" onClick={() => setSheet(quick)}><span>{tr('Quick connect to')}</span><Flag code={quick.countryCode} size={14} /><span>{countryName(quick.countryCode)}</span></button>
                  : <button className="btn-primary px-6" onClick={() => go('nodes')}>{tr('Choose a server')}</button>
              )}
              {conn.canConnect && quick && errBtn?.target !== 'nodes' && <button className="btn-ghost" onClick={() => go('nodes')}>{tr('All servers')}</button>}
            </div>
          </div>
        </div>
      </div>

      {session && (
        <>
          {/* One aligned grid (owner 2026-11-12: "structured, not aesthetic placement"): label over value, same cell for every item. */}
          <div className="info-grid" data-session-info>
            {node && <span className="info-cell"><span className="text-fg-muted">{tr('Location')}</span><span className="inline-flex items-center gap-1.5"><Flag code={node.countryCode} /> {countryName(node.countryCode)}</span></span>}
            {/* Android: every app is inside the VPN (no proxy-only apps), so the plain "Sites see" cell. */}
            {ip?.viaProxy && !onAndroid() ? (
              <>
                {/* Owner 2026-11-12: no "Browsers" chip (the status line says browsers are covered); Other apps shown. */}
                <span className={`info-cell ${ip.directIp && ip.directIp === snap.homeIp ? 'text-warn' : ''}`} title={tr('What sites see from apps that do not use the proxy.')}><span className="text-fg-muted">{tr('Other apps')}</span> {ip.directIp ? <HiddenIp ip={ip.directIp} defaultShown /> : 'unknown'}</span>
              </>
            ) : snap.coverage === 'split-include' ? (
              // The app is not one of the chosen apps, so its own IP check exits direct: show the server instead.
              <span className="info-cell" title={tr('Where the apps you chose exit.')}><span className="text-fg-muted">{tr('Chosen apps exit at')}</span> {ip?.nodeIp ? <HiddenIp ip={ip.nodeIp} /> : 'the server'}</span>
            ) : (
              <span className={`info-cell ${snap.coverage === 'leaking' ? 'text-warn' : ''}`} title={byPlatform(tr('What sites see from this computer now.'), tr('What sites see from this phone now.'))}><span className="text-fg-muted"><Term k="sitesSee">{tr('Sites see')}</Term></span> {ip?.ip ? <HiddenIp ip={ip.ip} defaultShown /> : tr('checking…')}</span>
            )}
            {snap.homeIp && <span className="info-cell" title={tr('Measured while not connected.')}><span className="text-fg-muted"><Term k="yourOwnIp">{tr('Your own IP')}</Term></span> <HiddenIp ip={snap.homeIp} /></span>}
            <span className="info-cell"><span className="text-fg-muted">{tr('Protocol')}</span> {session.service ? <ProtocolTag protocol={session.service} size={18} /> : '—'}</span>
            {snap.dns && <span className="info-cell"><span className="text-fg-muted"><Term k="dns">DNS</Term></span> {snap.dns}</span>}
          </div>
          <StatStrip>
            <StatCell label={tr('Time')} value={<SessionClock startedAt={session.startedAt} metered={Number(session.seconds)} />} />
            <StatCell label={tr('Downloaded')} value={formatBytes(session.rxBytes)} />
            <StatCell label={tr('Uploaded')} value={formatBytes(session.txBytes)} />
            <StatCell help={HELP().sessionSpent} label={tr('Spent')} value={`${formatTdvpnShort(session.spent)} tDVPN`} />
          </StatStrip>
          {/* Android: V2Ray/Xray run inside the VPN for every app; there is no proxy to choose. DVPN-WIN q0540-buttons r31:
              a whole-computer or split V2Ray/Xray session still carries a proxy endpoint, and this card said 'Only apps you
              point at the VPN proxy use it' under a header saying every app does. It is for proxy sessions only. */}
          {session.proxyEndpoint && !onAndroid() && !(snap.coverage === 'device' || snap.coverage?.startsWith('split')) && (
            <div className={`card mb-4 ${snap.proxyActive ? '' : 'border-warn/40'}`}>
              <div className="label">{tr('Which apps use the VPN')}</div>
              <p className="mb-3 text-sm text-fg-dim">{snap.proxyActive
                ? osPick({
                  win32: tr('Browsers and apps that follow the Windows proxy use the VPN. Apps that ignore it use your normal connection.'),
                  darwin: tr('Browsers and apps that follow the macOS system proxy use the VPN. Apps that ignore it use your normal connection.'),
                  android: tr('Browsers and apps that follow the VPN proxy setting use the VPN. Apps that ignore it use your normal connection.'),
                }, tr('Browsers and apps that follow the system proxy use the VPN. Apps that ignore it use your normal connection.'))
                : tr('Only apps you point at the VPN proxy use it. Your browser and other apps use your normal connection.')}</p>
              <div className="flex flex-wrap items-center gap-2">
                {!snap.proxyActive && <button className="btn-primary" onClick={async () => {
                  try { await call(window.api.IPC.PROXY_SET, { on: true }); } catch (err) { console.warn('proxy on failed', err); }
                }}>{tr('Send apps through the VPN')}</button>}
                <button className="btn-ghost" onClick={() => go('split')}>{tr('Split tunnelling')}</button>
              </div>
            </div>
          )}
          {/* UI-050: the session and deposit ids are in Activity, not here. */}
          <div className="mb-6" />
        </>
      )}

      {/* UI-008: from the moment a connect starts the session's rows are on the page, empty, and fill in;
          nothing pops in when the session begins. */}
      {!session && target && (
        <>
          <div className="info-grid" data-session-info="pending">
            <span className="info-cell"><span className="text-fg-muted">{tr('Location')}</span><span className="inline-flex items-center gap-1.5"><Flag code={target.countryCode} /> {countryName(target.countryCode)}</span></span>
            <span className="info-cell"><span className="text-fg-muted"><Term k="sitesSee">{tr('Sites see')}</Term></span> <span className="text-fg-muted">—</span></span>
            {snap.homeIp && <span className="info-cell"><span className="text-fg-muted"><Term k="yourOwnIp">{tr('Your own IP')}</Term></span> <HiddenIp ip={snap.homeIp} /></span>}
            <span className="info-cell"><span className="text-fg-muted">{tr('Protocol')}</span> {target.protocolNames.length === 1 ? <ProtocolTag protocol={target.protocolNames[0]} size={18} /> : <span className="text-fg-muted">—</span>}</span>
          </div>
          <StatStrip>
            <StatCell label={tr('Time')} value={<span className="text-fg-muted">—</span>} />
            <StatCell label={tr('Downloaded')} value={<span className="text-fg-muted">—</span>} />
            <StatCell label={tr('Uploaded')} value={<span className="text-fg-muted">—</span>} />
            <StatCell help={HELP().sessionSpent} label={tr('Spent')} value={<span className="text-fg-muted">—</span>} />
          </StatStrip>
          <div className="mb-6" />
        </>
      )}

      {!session && !target && (
        <StatStrip>
          <StatCell label={tr('Wallet')} value={`${formatTdvpnShort(snap.wallet?.ownerTdvpn ?? '0')} tDVPN`} />
          <StatCell label={tr('Servers online')} value={cv.c.checked ? cv.c.usable : '—'} hint={cv.c.onNetwork ? tr('of {onNetwork} on the network', { onNetwork: cv.c.onNetwork }) : undefined} help={`Servers that answered a check in the last 10 minutes and can take a connection now. ${cv.line}.`} />
          {/* The amount, like Activity "Refunds on the way": a count of finished deposits read as money when most return 0 (VM 2026-10-22: "110 ready" next to Wallet "0"). */}
          {/* Plain (owner 2026-11-12: the old count of deposits by state was confusing). Detail lives in Activity. */}
          <StatCell help={HELP().comingBack} label={tr('Refunds on the way')} value={refundTotal > 0n ? `${formatTdvpnShort(refundTotal.toString())} tDVPN` : tr('Nothing')} />
        </StatStrip>
      )}

      {/* Fills the lower half the way leading VPN apps do: your servers one click away. */}
      <QuickPicks nodes={nodes} cv={cv} frozen={stage.busy} canConnect={conn.canConnect} current={session?.node ?? null} onPick={setSheet} />

      {sheet && <ConnectSheet node={sheet} snap={snap} onClose={() => setSheet(null)} />}
    </div>
  );
}

/** Favourites and recent servers first; with none yet, the fastest online servers. Up to 6 rows. */
function QuickPicks({ nodes, cv, frozen, canConnect, current, onPick }: { nodes: NodeView[]; cv: CensusView; frozen: boolean; canConnect: boolean; current: string | null; onPick: (n: NodeView) => void }): JSX.Element | null {
  const online = (n: NodeView): boolean => cv.byAddress.get(n.address)?.state === 'usable';
  const [recent, setRecent] = useState<string[]>([]);
  // Reloaded when the session changes, so a server you just used moves to the top.
  useEffect(() => { call<string[]>(window.api.IPC.RECENT_NODES, undefined, { quiet: true }).then(setRecent, () => setRecent([])); }, [current]);
  const mine = recentlyConnected(nodes, recent);
  const fastest = nodes.filter(online).sort((a, b) => (a.probe?.latencyMs ?? 9e9) - (b.probe?.latencyMs ?? 9e9));
  // While a connect is in progress the list keeps its rows, order and heading (UI-009); row data stays live.
  const pick = { title: mine.length ? tr('Recently connected') : tr('Fastest right now'), order: (mine.length ? mine : fastest).slice(0, 6).map((n) => n.address) };
  const held = useRef(pick);
  if (!frozen || !held.current.order.length) held.current = pick;
  const byAddr = new Map(nodes.map((n) => [n.address, n]));
  const rows = held.current.order.map((a) => byAddr.get(a)).filter((n): n is NodeView => !!n);
  if (!rows.length) return null;
  return (
    <Section title={held.current.title}>
      <div className="card overflow-hidden p-0">
        <table className="dtable">
          <thead><tr><th>{tr('Server')}</th><th>{tr('Protocol')}</th><th className="n"><Term k="responseTime">{tr('Response')}</Term></th><th className="w-px" aria-label={tr('Actions')} /></tr></thead>
          <tbody>
            {rows.map((n) => {
              const entry = cv.byAddress.get(n.address);
              const st = rowStatus(entry, n.probe?.latencyMs, false);
              return (
                <tr key={n.address} data-quick-pick={n.address} data-server-state={entry?.state}>
                  <td><span className="flex items-center gap-2">{n.favourite && <Icon name="star-filled" className="text-warn" label={tr('Favourite')} />}<Flag code={n.countryCode} /> {n.probe?.city || countryName(n.countryCode)} <span className="mono text-fg-muted">{short(n.address)}</span></span></td>
                  <td><ProtocolList names={n.protocolNames} /></td>
                  <td className={`n ${st.tone}`} title={st.title}>{st.label}</td>
                  <td className="text-end"><button className="btn-ghost btn-sm" disabled={!online(n) || !canConnect || current === n.address} title={!online(n) ? (entry?.sentence ?? undefined) : undefined} onClick={() => onPick(n)}>{tr('Connect')}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/** Ticks every second from the session start; the daemon's metered seconds move only once a minute. */
function SessionClock({ startedAt, metered }: { startedAt: number | null; metered: number }): JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = startedAt ? Math.max(metered, Math.floor((now - startedAt) / 1000)) : metered;
  return <>{formatDuration(secs)}</>;
}
