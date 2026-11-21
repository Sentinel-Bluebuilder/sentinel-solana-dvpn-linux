// ─── Component gallery (UI-165) ───
// Every shared component in every state, on one page, in the current theme. Opened with
// `#gallery` in the address (the screenshot run does this with DVPN_UI_GALLERY=1). It needs no
// wallet and no VPN service, so the design system can be looked at on any machine.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { nodeTestPreviews } from '../../../core/nodetest/fixtures';
import { NodeTest } from '../screens/NodeTest';
import { GALLERY_NODES, PREVIEWS } from './gallery-fixtures';
import { SessionCard } from './SessionCard';
import { ConnectSheet } from './ConnectSheet';
import { Home } from '../screens/Home';
import { RestoreNetworkButton } from './RestoreNetworkButton';
import { ApplyBar, RadioCards, Banner, ConfirmModal, Copy, Help, InlineError, PageHeader, Section, Sheet, Skeleton, StatCell, StatStrip, Switch } from './ui';
import { AppMark, Toasts } from './ui';
import { TestTokens, ThemeToggle } from './SidebarFooter';
import { LanguageSelect, menuLanguages } from './LanguageSelector';
import { Wallet } from '../screens/Wallet';
import type { AppSnapshot } from '../../../shared/types';
import { useApp } from '../lib/store';
import { Icon, type IconName } from './Icon';
import { connectStage, STEPS, type StageInput, type Tone } from '../../../core/session/connect-stage';

const ICONS: IconName[] = ['check', 'x', 'alert', 'info', 'help', 'star', 'star-filled', 'chevron-right', 'chevron-down', 'close', 'copy', 'external', 'refresh', 'shield', 'shield-off', 'clock', 'arrow-right', 'agent'];

const STAGES: Array<[string, StageInput]> = [
  ['Not connected', { phase: 'idle', covered: null }],
  ['Getting ready…', { phase: 'preflight', covered: null }],
  ['Paying the deposit…', { phase: 'paying', covered: null }],
  ['Connecting…', { phase: 'connecting', covered: null }],
  ['Checking the connection…', { phase: 'checking', covered: null }],
  ['Protected', { phase: 'connected', covered: true }],
  ['Not going through the VPN', { phase: 'connected', covered: false }],
  ['Connected', { phase: 'connected', covered: 'unknown' }],
  ['Reconnecting…', { phase: 'reconnecting', covered: null }],
  ['Disconnecting…', { phase: 'disconnecting', covered: null }],
  ['Couldn\'t connect', { phase: 'error', covered: null }],
];

const DOT: Record<Tone, string> = { neutral: 'bg-fg-muted', working: 'bg-accent', ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad' };
const INK: Record<Tone, string> = { neutral: 'text-fg-muted', working: 'text-fg-dim', ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' };

function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <div data-gallery-section={id} className="scroll-mt-4"><Section title={title}>{children}</Section></div>;
}

/**
 * `#gallery/connect/<id>`: the real Connect screen and status card fed one made-up state. The same
 * screen stays mounted while the id changes, so walking the ids replays a connect the way the app
 * shows it (minimum display time included) and the screenshot run can measure that nothing moves.
 */
function ConnectPreview({ id }: { id: string }) {
  const p = PREVIEWS.find((x) => x.id === id) ?? PREVIEWS[0];
  useEffect(() => { useApp.setState({ nodes: GALLERY_NODES, probeProgress: null }); }, []);
  return (
    <div className="flex h-full bg-bg" data-gallery-preview={p.id}>
      <div className="hidden w-60 shrink-0 flex-col justify-end border-e border-line bg-bg-card/70 p-3 md:flex"><SessionCard snap={p.snap} onOpen={() => undefined} /></div>
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-6"><div className="page"><Home snap={p.snap} go={() => undefined} /></div></main>
      <Toasts />
    </div>
  );
}

export function Gallery() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onHash = (): void => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const preview = /^#gallery\/connect\/([\w-]+)$/.exec(hash)?.[1];
  if (hash === '#gallery/sheet/new') {
    // The Connect dialog for a new deposit, over the idle Connect screen.
    return <><ConnectPreview id="idle" /><ConnectSheet node={GALLERY_NODES[0]} snap={PREVIEWS[0].snap} onClose={() => { window.location.hash = '#gallery/connect/idle'; }} /></>;
  }
  if (hash === '#gallery/wallet') return <WalletPreview />;
  const test = /^#gallery\/nodetest\/([\w-]+)$/.exec(hash)?.[1];
  if (test) return <NodeTestPreviewPage id={test} />;
  return preview ? <ConnectPreview id={preview} /> : <Components />;
}

/**
 * `#gallery/wallet`: the Wallet page with refunds ready to claim, beside the real bottom of the
 * sidebar (status card, test tokens, the Devnet strip, the theme switch). The screenshot run looks
 * at the Claim refunds button, the strip and a tooltip here, in both themes.
 */
function WalletPreview() {
  const base = PREVIEWS[0].snap;
  const snap = { ...base, wallet: base.wallet ? { ...base.wallet, userBalance: '18400000' } : base.wallet } as AppSnapshot;
  const settings = useApp((s) => s.settings);
  return (
    <div className="flex h-full bg-bg" data-gallery-wallet>
      <div className="hidden w-60 shrink-0 flex-col justify-between border-e border-line bg-bg-card/70 p-3 md:flex">
        <div className="mb-3 flex h-16 items-center gap-3 border-b border-line px-3 pb-1">
          <AppMark size={34} />
          <div className="min-w-0 truncate font-display text-section font-semibold leading-none tracking-[-0.01em]">Devnet <span className="bg-sol bg-clip-text text-transparent">dVPN</span></div>
        </div>
        {/* Mirrors the app's sidebar foot: session card, language + light | dark, the Devnet test-token card. */}
        <div className="space-y-3 px-1" data-gallery-sidebar-foot>
          <SessionCard snap={snap} onOpen={() => undefined} />
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1"><LanguageSelect look="row" value={settings?.language ?? ''} languages={menuLanguages()} onChange={() => undefined} /></div>
            <ThemeToggle settings={settings} onChange={() => undefined} />
          </div>
          <div className="pb-1"><TestTokens owner={snap.owner ?? null} onWallet={() => undefined} /></div>
        </div>
      </div>
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-6"><div className="page"><Wallet snap={snap} /></div></main>
      <Toasts />
    </div>
  );
}

/** `#gallery/nodetest/<id>`: the real Node test page fed one made-up state (core/nodetest/fixtures). */
function NodeTestPreviewPage({ id }: { id: string }) {
  const all = useMemo(() => nodeTestPreviews(Date.now()), []);
  const p = all.find((x) => x.id === id) ?? all[0];
  return (
    <div className="h-full overflow-y-auto bg-bg px-6 py-6" data-gallery-nodetest={p.id}>
      <div className="page"><NodeTest key={p.id} snap={PREVIEWS[0].snap} preview={p} /></div>
    </div>
  );
}

function Components() {
  const [on, setOn] = useState(true);
  const [mode, setMode] = useState<'off' | 'on' | 'always'>('on');
  const [sheet, setSheet] = useState(false);
  const [confirm, setConfirm] = useState<'ok' | 'fail' | null>(null);
  return (
    <div className="h-full overflow-y-auto bg-bg px-6 py-6" data-gallery>
      <div className="mx-auto max-w-[1040px]">
        <PageHeader title="Components" subtitle="Every shared part of the app, in every state." />

        <Block id="buttons" title="Buttons">
          <div className="card flex flex-wrap items-center gap-2">
            <button className="btn-primary">Connect</button>
            <button className="btn-primary" disabled title="Add funds first.">Connect</button>
            <button className="btn-ghost">All servers</button>
            <button className="btn-ghost" disabled>All servers</button>
            <button className="btn-danger">Disconnect</button>
            <button className="btn-ghost btn-sm">Small</button>
            <button className="btn-danger btn-sm">Restore network</button>
            <button className="btn-primary" aria-busy="true">Working…</button>
          </div>
        </Block>

        <Block id="fields" title="Fields and choices">
          <div className="card flex flex-wrap items-center gap-2">
            <input className="input w-56" placeholder="Search country, city or address" aria-label="Search" />
            <input className="input w-40" defaultValue="5" aria-label="Amount" />
            <input className="input w-40" disabled defaultValue="Disabled" aria-label="Disabled" />
            <select className="input w-44" aria-label="Sort" defaultValue="a"><option value="a">Fastest response</option><option value="b">Price per GB</option></select>
            <label className="toggle-chip toggle-chip-on"><input type="checkbox" defaultChecked /> Online only</label>
            <label className="toggle-chip"><input type="checkbox" /> Favourites</label>
            <span className="chip">WireGuard</span>
            <Switch checked={on} onChange={setOn} label="Example switch" />
            <Help text="A deposit is the amount set aside for this server. What you do not use is refunded to your wallet." />
            <Copy text="example" />
          </div>
          <div className="card mt-2"><input className="input w-56" defaultValue="-3" aria-label="Spending limit" aria-invalid="true" /><InlineError>Enter an amount above zero.</InlineError></div>
        </Block>

        <Block id="choices" title="One choice of several, and applying it">
          <RadioCards name="gallery-mode" label="Kill switch" value={mode} onChange={setMode} columns={3} options={[
            { id: 'off', title: 'Off', text: 'Your internet works as usual when the VPN drops.' },
            { id: 'on', title: 'On', text: 'If the VPN drops, your internet is blocked until it is back.' },
            { id: 'always', title: 'Always', text: 'Not on this computer yet.', disabled: true, reason: 'Needs a newer VPN service.' },
          ]} />
          <div className="mt-3"><ApplyBar note="Disconnects you first." onApply={() => undefined} onDiscard={() => setMode('off')} disabled={mode === 'off'} reason="Nothing to apply." /></div>
          <div className="card mt-2"><RestoreNetworkButton help /></div>
        </Block>

        <Block id="banners" title="Banners">
          <Banner kind="info">The VPN service is starting. This takes a few seconds.</Banner>
          <Banner kind="warn" action={<button className="btn-ghost btn-sm">Wallet</button>}>Your deposit ran out. <span className="text-fg-dim">Add funds and reconnect.</span></Banner>
          <Banner kind="error" action={<button className="btn-danger btn-sm">Restore network</button>}>Your internet may be blocked. Restore network releases it.</Banner>
        </Block>

        <Block id="stages" title="Connection stages">
          <div className="card overflow-hidden p-0">
            {STAGES.map(([title, input]) => {
              const v = connectStage(input);
              return (
                <div key={title} className="row flex h-12 items-center gap-3 border-b border-line px-4 last:border-b-0" data-stage={v.stage}>
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[v.tone]} ${v.busy ? 'animate-pulse' : ''}`} aria-hidden />
                  <span className={`w-32 text-label font-semibold uppercase ${INK[v.tone]}`}>{v.label}</span>
                  <span className="min-w-0 flex-1 truncate">{title}</span>
                  <span className="num text-meta text-fg-muted">{v.step ? `step ${v.step} of ${STEPS}` : v.urgent ? 'shown at once' : ''}</span>
                </div>
              );
            })}
          </div>
        </Block>

        <Block id="data" title="Numbers, lists and loading">
          <StatStrip>
            <StatCell label="Wallet" value="124.5 tDVPN" />
            <StatCell label="Servers online" value={35} hint="of 47 on the network" help="Servers that answered a check in the last 10 minutes and can take a connection now." />
            <StatCell label="Refunds on the way" value="Nothing" />
          </StatStrip>
          <div className="card overflow-hidden p-0">
            <table className="dtable">
              <thead><tr><th>Server</th><th>Protocol</th><th className="n">Response</th></tr></thead>
              <tbody>
                <tr><td>Frankfurt</td><td>WireGuard</td><td className="n text-ok">42 ms</td></tr>
                <tr><td>Singapore</td><td>V2Ray</td><td className="n text-fg-muted" title="Last checked 12:04. Checking again.">180 ms</td></tr>
                <tr><td>Toronto</td><td>OpenVPN</td><td className="n text-bad">Offline</td></tr>
              </tbody>
            </table>
          </div>
          <div className="mt-2"><Skeleton rows={3} /></div>
          <div className="empty-box mt-2">No servers match these filters.</div>
        </Block>

        <Block id="icons" title="Icons">
          <div className="card flex flex-wrap gap-4">
            {ICONS.map((n) => <span key={n} className="flex w-20 flex-col items-center gap-1 text-meta text-fg-muted"><Icon name={n} size={20} className="text-fg" />{n}</span>)}
          </div>
        </Block>

        <Block id="dialogs" title="Dialogs">
          <div className="card flex flex-wrap gap-2">
            <button className="btn-ghost" data-gallery-open="sheet" onClick={() => setSheet(true)}>Open a sheet</button>
            <button className="btn-ghost" data-gallery-open="confirm" onClick={() => setConfirm('ok')}>Open a confirmation</button>
            <button className="btn-ghost" data-gallery-open="confirm-fail" onClick={() => setConfirm('fail')}>Open one that fails</button>
          </div>
        </Block>

        <Block id="notifications" title="Notifications">
          <div className="card flex flex-wrap gap-2">
            <button className="btn-ghost" data-gallery-toast="all" onClick={() => {
              const { toast } = useApp.getState();
              toast('success', '12.4 tDVPN is back in your wallet.', { title: 'Refund received' });
              toast('warn', 'About 10 minutes left at this rate.', { title: 'Your deposit is running low', action: { label: 'Top up', screen: 'activity' } });
              toast('error', 'The Solana network did not answer. Nothing was paid.', { title: 'Couldn\'t connect', action: { label: 'Try again', screen: 'home' } });
            }}>Show three</button>
            <button className="btn-ghost" data-gallery-toast="repeat" onClick={() => useApp.getState().toast('info', 'Address copied.')}>Show the same one again</button>
          </div>
        </Block>
      </div>

      <Toasts />
      {sheet && (
        <Sheet title="Connect to Frankfurt" onClose={() => setSheet(false)}>
          <p className="text-sm text-fg-dim">You already have 3.2 tDVPN on deposit with this server. Connecting uses it first, so nothing new is paid.</p>
          <div className="mt-4 flex justify-end gap-2"><button className="btn-ghost" onClick={() => setSheet(false)}>Cancel</button><button className="btn-primary" onClick={() => setSheet(false)}>Connect</button></div>
        </Sheet>
      )}
      {confirm && (
        <ConfirmModal
          title="Remove this computer's spending limit?"
          lines={['This computer will not be able to pay for a connection until you set a limit again.']}
          confirmLabel="Remove"
          danger
          onConfirm={async () => { if (confirm === 'fail') throw new Error('The Solana network did not answer. Nothing was changed.'); }}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
