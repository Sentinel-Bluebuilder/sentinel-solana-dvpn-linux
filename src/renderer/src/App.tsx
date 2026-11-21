// ─── App shell: first-run gate → sidebar + screen ───
// The welcome/onboarding screen always comes first (one-shot §1); the main UI
// opens once the wallet and device exist; the spending permission is signed in the background
// (setting autoDevicePermission) and a missing permission or service is a banner, not a step.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useApp, bindEvents, call } from './lib/store';
import { t, type StringKey } from './lib/strings';
import { Toasts, Banner, BannerStack, AppMark, DevnetBadge, Flag } from './components/ui';
import { countryName } from '../../shared/format';
import { ProtocolMark } from './components/ProtocolMark';
import { protocolLabel } from '../../shared/protocols';
import { Onboarding, onboardingStep } from './screens/Onboarding';
import { deviceUnread, showSetupScreen, lostSetupCopy } from '../../core/session/setup-gate';
import { RELOGIN_COPY, RESTARTING_COPY } from '../../core/daemon/link-copy';
import { InstallServiceButton } from './components/InstallServiceButton';
import { Gallery } from './components/Gallery';
import { SessionCard, SessionLine } from './components/SessionCard';
import { TestTokens, ThemeToggle } from './components/SidebarFooter';
import { loadDaemonSettings } from './lib/use-daemon-settings';
import { Home } from './screens/Home';
import { Nodes } from './screens/Nodes';
import { Plans } from './screens/Plans';
import { Activity } from './screens/Activity';
import { Wallet } from './screens/Wallet';
import { Settings } from './screens/Settings';
import { Diagnostics } from './screens/Diagnostics';
import { Cli } from './screens/Cli';
import { NodeTest } from './screens/NodeTest';
import { KillSwitch } from './screens/KillSwitch';
import { SplitTunnel } from './screens/SplitTunnel';
import type { AppSnapshot, AppSettings, NodeView } from '../../shared/types';
import { onAndroid, osPick } from './lib/platform';
import { tr } from '../../shared/i18n';
import { LanguageSelect, menuLanguages, saveLanguage } from './components/LanguageSelector';

export type Screen = 'home' | 'nodes' | 'plans' | 'activity' | 'nodetest' | 'wallet' | 'killswitch' | 'split' | 'settings' | 'diagnostics' | 'cli';
// Icon paths (24×24, stroke) — drawn inline so nothing is fetched.
const ICON: Record<Screen, string> = {
  home: 'M12 2v6M6.3 6.3a8 8 0 1 0 11.4 0',
  nodes: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  plans: 'M4 7h16v10H4zM4 11h16M8 15h3',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  nodetest: 'M9 3h6M10 3v6L4.5 18.5A1.6 1.6 0 0 0 5.9 21h12.2a1.6 1.6 0 0 0 1.4-2.5L14 9V3M7 15h10',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v10a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14h.01',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  killswitch: 'M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3zM9 12l2 2 4-4',
  split: 'M6 3v6a6 6 0 0 0 6 6h0a6 6 0 0 1 6 6M18 3v6a6 6 0 0 1-3 5.2M6 21v-3',
  diagnostics: 'M22 12h-4l-3 9L9 3l-3 9H2',
  cli: 'M4 17l6-5-6-5M12 19h8',
};
const NAV_BREAK = new Set<Screen>(['activity', 'killswitch', 'settings']);
const NAV: Array<{ id: Screen; key: StringKey }> = [
  { id: 'home', key: 'nav.home' },
  { id: 'nodes', key: 'nav.nodes' },
  { id: 'plans', key: 'nav.plans' },
  { id: 'activity', key: 'nav.activity' },
  { id: 'nodetest', key: 'nav.nodetest' },
  { id: 'wallet', key: 'nav.wallet' },
  { id: 'killswitch', key: 'nav.killswitch' },
  { id: 'split', key: 'nav.split' },
  { id: 'settings', key: 'nav.settings' },
  { id: 'diagnostics', key: 'nav.diagnostics' },
  { id: 'cli', key: 'nav.cli' },
];

// Phone layout (< md): these four sit in the bottom bar; the rest live under "More".
const TABS: Screen[] = ['home', 'nodes', 'plans', 'wallet'];
const MORE_ICON = 'M5 12h.01M12 12h.01M19 12h.01';
type View = Screen | 'more';

/**
 * Screen state mirrored into history, so the Android back button (WebView goBack) walks back
 * through screens instead of leaving the app. Home is the root entry; at home, back leaves.
 */
type Entry = { view: View; depth: number };
function useScreenHistory(): [View, (v: View) => void, { current: boolean }] {
  const [view, setView] = useState<View>('home');
  const depth = useRef(0); // entries above the home entry
  const back = useRef(false); // the last change came from Back: restore the scroll position, do not reset it
  useEffect(() => {
    history.replaceState({ view: 'home', depth: 0 } satisfies Entry, '');
    const onPop = (e: PopStateEvent): void => {
      const s = e.state as Entry | null;
      // go('home') also arrives here (history.go); that one was asked for by a click, not by Back.
      back.current = !forward.current;
      forward.current = false;
      depth.current = s?.depth ?? 0;
      setView(s?.view ?? 'home');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const forward = useRef(false);
  const go = (v: View): void => {
    if (v === view) return;
    back.current = false;
    if (v === 'home') {
      // Back to the root entry; popstate sets the view.
      if (depth.current > 0) { forward.current = true; history.go(-depth.current); }
      else setView('home');
      return;
    }
    // A bottom-bar tab replaces the current entry (one back step from any tab = home), like a
    // native bottom bar; screens opened from "More" stack on top of it.
    if (TABS.includes(v as Screen) && depth.current > 0) {
      history.replaceState({ view: v, depth: depth.current } satisfies Entry, '');
    } else {
      depth.current += 1;
      history.pushState({ view: v, depth: depth.current } satisfies Entry, '');
    }
    setView(v);
  };
  return [view, go, back];
}

export function Icon({ d, className = 'h-[18px] w-[18px]' }: { d: string; className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
}

/**
 * The one button of the VPN service banner (UI-119): main does whatever the current state needs
 * (install, start, finish setup, reinstall, repair). A failure is the state's own sentence, which the
 * banner already shows, so nothing else is raised here.
 */
function ServiceFixButton({ label }: { label: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn-ghost btn-sm" data-service-fix disabled={busy} aria-busy={busy}
      onClick={() => {
        setBusy(true);
        call(window.api.IPC.DAEMON_INIT, { step: 'fix' }, { quiet: true })
          .catch((err) => console.warn('service fix did not finish', err))
          .finally(() => setBusy(false));
      }}
    >
      {busy ? tr('Working…') : label}
    </button>
  );
}

function applyTheme(theme: AppSettings['theme']): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

export function App() {
  const { snap, settings, setSnap, setSettings } = useApp();
  const nodeList = useApp((s) => s.nodes);
  // Phone layout: screens mirror into history so Android's back button walks back through them.
  const [view, go, cameBack] = useScreenHistory();
  // UI-019, UI-020: a page opens at its top; Back returns to where you were on the page before.
  const mainRef = useRef<HTMLElement | null>(null);
  const scrolls = useRef(new Map<View, number>());
  useLayoutEffect(() => {
    const el = mainRef.current;
    if (!el) return undefined;
    const top = cameBack.current ? scrolls.current.get(view) ?? 0 : 0;
    el.scrollTop = top;
    // Lists fill in a frame later; a restored position is applied again once they have.
    const raf = top ? requestAnimationFrame(() => { el.scrollTop = top; }) : 0;
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [view, cameBack]);
  const screen: Screen | null = view === 'more' ? null : view;
  // UI-023: a banner or an error that sends you to a page can name the part it is about. The page marks
  // that part with data-section="<name>"; it is scrolled into view and outlined once.
  const wanted = useRef<string | null>(null);
  // U-14: a section asked for on the page already shown would wait for the next page change and flash there.
  const setScreen = (s: Screen, section?: string): void => { wanted.current = s === view ? null : section ?? null; go(s); };
  useEffect(() => {
    const name = wanted.current;
    if (!name) return undefined;
    wanted.current = null;
    let clear = 0;
    const t = window.setTimeout(() => {
      const el = mainRef.current?.querySelector<HTMLElement>(`[data-section="${name}"]`);
      if (!el) return;
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      el.setAttribute('data-flash', '');
      clear = window.setTimeout(() => el.removeAttribute('data-flash'), 1800);
    }, 220); // after the page-enter motion and the first list paint
    return () => { window.clearTimeout(t); window.clearTimeout(clear); };
  }, [view]);
  // The notification rules need to know which screen is on show (UI-033).
  useEffect(() => { useApp.getState().setScreen(view === 'more' ? null : view); }, [view]);
  const goRef = useRef(go); // the listeners below are bound once; `go` closes over the current view
  goRef.current = go;
  // Android: the screen can be rebuilt mid-session (memory, theme); the app process remembers the welcome.
  const [welcomed, setWelcomed] = useState(() => window.api.android?.welcomed() ?? false);
  const [phrase, setPhrase] = useState<string | null>(null); // a new wallet's recovery phrase, until checked
  const [gallery, setGallery] = useState(() => window.location.hash.startsWith('#gallery'));
  useEffect(() => {
    const onHash = (): void => setGallery(window.location.hash.startsWith('#gallery'));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const sawSetup = useRef(false);
  const setupDone = useRef(false); // set up at least once this run: a lost step shows a banner, not setup

  useEffect(() => {
    const off = bindEvents();
    void call<AppSnapshot>(window.api.IPC.STATE_SNAPSHOT).then(setSnap, (err) => console.warn('first state read failed', err));
    void call<AppSettings>(window.api.IPC.SETTINGS_GET).then(setSettings, (err) => console.warn('settings read failed', err));
    // UI-185: the VPN service's settings are read once at start, so Settings, Kill switch and Split
    // tunnelling open with their data in place instead of growing when it arrives.
    void loadDaemonSettings({ keepEdits: true }).catch((err) => console.warn('service settings not read at start', err));
    void call<NodeView[]>(window.api.IPC.NODES_LIST, undefined, { quiet: true }).then((list) => {
      if (list.length) useApp.getState().setNodes(list);
      else void call(window.api.IPC.NODES_REFRESH, undefined, { quiet: true });
    }, (err) => console.warn('node list failed', err));
    const offGo = window.api.on<Screen>(window.api.EVENTS.GO, (s) => { if (Object.hasOwn(ICON, s)) setScreen(s); });
    // A component deep in a screen asks for a screen (ConnectSheet after Confirm, UI-022).
    const onGo = (e: Event): void => { const s = (e as CustomEvent<Screen>).detail; if (Object.hasOwn(ICON, s)) goRef.current(s); };
    window.addEventListener('dvpn:go', onGo);
    return () => { off(); offGo(); window.removeEventListener('dvpn:go', onGo); };
  }, [setSnap, setSettings]);

  useEffect(() => { if (settings) applyTheme(settings.theme); }, [settings]);

  // The component gallery (UI-165): `#gallery` in the address. Needs no wallet and no VPN service.
  if (gallery) return <Gallery />;

  if (!snap) return <div className="flex h-full flex-col items-center justify-center gap-4 text-fg-dim"><AppMark size={48} /><span className="font-display text-sm tracking-[0.04em]">{tr('Starting…')}</span></div>;

  // F2.1: welcome first on every launch. A wallet made or imported in this run counts as welcomed.
  if (!snap.hasWallet) sawSetup.current = true;
  // KSM7 UI arm (DVPN-WIN k7u2): after a restart while connected the kill switch still blocks the internet; the
  // welcome card hid that (no word, no Restore network). A held block goes straight to the app, which shows it.
  const blockedNow = snap.conn.phase === 'error' && snap.conn.restoreNetwork === true;
  const showWelcome = snap.hasWallet && !welcomed && !sawSetup.current && !blockedNow;
  const step = onboardingStep(snap);
  if (!snap.hasWallet) setupDone.current = false; // logout: setup again from the start
  if (step === 'done' && !showWelcome) setupDone.current = true;
  // neither source read yet after a restart; never while setting up in this run (Q0386)
  const deviceUnknown = deviceUnread(snap.daemon.reachable, snap.wallet !== null, sawSetup.current);
  // Steps the first Connect does by itself (owner 2026-11-11): the spending permission, and installing
  // the service for a device key that waits for it. Neither shows setup or a banner.
  const quiet = step === 'permission' || (step === 'service' && snap.serviceSwitchPending === true);
  const lost = !quiet && !showWelcome && step !== 'done' && !showSetupScreen(step, setupDone.current, !!snap.wallet?.device, deviceUnknown) ? lostSetupCopy(step, snap.wallet, snap.deviceAuto) : null;
  const sv = snap.daemon.service;
  // A missing spending permission never shows setup: the first Connect signs it (owner 2026-11-11).
  // A new wallet's recovery phrase (and its word check) always shows before the app, whatever step is next.
  if (phrase || showWelcome || (step !== 'done' && !quiet && !lost)) {
    return (
      <>
        <Onboarding snap={snap} phrase={phrase} setPhrase={setPhrase} onContinue={showWelcome && !phrase ? () => { window.api.android?.markWelcomed(); setWelcomed(true); } : undefined} />
        <Toasts />
      </>
    );
  }

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Phone: top bar with the connection state (the sidebar's status card). */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-bg-card/80 px-4 backdrop-blur md:hidden">
        <AppMark size={28} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-sm font-bold leading-tight tracking-[0.02em]">{screen ? t(NAV.find((n) => n.id === screen)!.key) : t('nav.more')}</div>
          <SessionLine snap={snap} />
        </div>
        <DevnetBadge compact />
      </header>
      <nav className="hidden w-60 shrink-0 flex-col border-e border-line bg-bg-card/70 p-3 backdrop-blur md:flex" aria-label={tr('Main')} data-main-nav="side">
        {/* Brand row: the mark + the name, nothing else. px-3 = the menu items' padding, so the mark's
            left edge sits on the icon column; the name is on the type scale (section, 18 px); the
            hairline is set off from the first item by the same 12 px the items use between groups. */}
        <div className="mb-3 flex h-16 items-center gap-3 border-b border-line px-3 pb-1" data-brand-row>
          {/* Owner 2026-11-16: back to the earlier, larger mark now the footer is one card shorter. */}
          <AppMark size={34} />
          <div className="min-w-0 truncate font-display text-section font-semibold leading-none tracking-[-0.01em]">
            Devnet <span className="bg-sol bg-clip-text text-transparent">dVPN</span>
          </div>
        </div>
        {NAV.map((n) => {
          const on = screen === n.id;
          return (
            <button
              key={n.id}
              // UI-029: hairline breaks between everyday, money, protection and advanced; same items, same order.
              data-nav-break={NAV_BREAK.has(n.id) ? '' : undefined}
              style={NAV_BREAK.has(n.id) ? { marginTop: 9, boxShadow: '0 -5px 0 -4px var(--border)' } : undefined}
              onClick={() => setScreen(n.id)}
              aria-current={on ? 'page' : undefined}
              className={`group relative mb-1 flex h-10 items-center gap-3 rounded-lg px-3 text-start text-ctl transition-colors ${on ? 'bg-sol-soft text-fg' : 'text-fg-dim hover:bg-bg-hover hover:text-fg'}`}
            >
              {on && <span className="absolute start-0 top-2 h-6 w-[3px] rounded-e bg-sol" aria-hidden />}
              <Icon d={ICON[n.id]} className={`h-[18px] w-[18px] ${on ? 'text-sol-green' : 'text-fg-muted group-hover:text-fg-dim'}`} />
              {t(n.key)}
            </button>
          );
        })}
        <div className="mt-auto space-y-3 px-1">
          {/* UI-040 to UI-043: one card, one height in every state; a click opens Connect. */}
          <SessionCard snap={snap} onOpen={() => setScreen('home')} />
          {/* The language menu lives here, bottom left (owner): one place on every screen. Its list is drawn in
              the page body, so it opens upward over the sidebar without being clipped. */}
          {/* One row: the language (bottom left, owner) and the light | dark switch beside it. */}
          <div className="flex items-center gap-2">
            {menuLanguages().length > 1 && (
              <div className="min-w-0 flex-1" data-sidebar-language>
                <LanguageSelect look="row" value={settings?.language ?? ''} languages={menuLanguages()} onChange={(code) => void saveLanguage(code)} />
              </div>
            )}
            <div className="ms-auto"><ThemeToggle settings={settings} onChange={setSettings} /></div>
          </div>
          {/* Devnet and the test tokens: one card in the Devnet style (owner 2026-11-16). */}
          <div className="pb-1"><TestTokens owner={snap.owner ?? null} onWallet={() => setScreen('wallet')} /></div>
        </div>
      </nav>
      <main ref={mainRef} onScroll={(e) => scrolls.current.set(view, e.currentTarget.scrollTop)} className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6 lg:px-8">
        {/* One container for every screen: centred, same edges everywhere, 1200 px at most. */}
        <div className="page flex min-h-full flex-col">
        {/* UI-010, UI-037: one stack; most serious first, two at most, each opens and closes its own height. */}
        <BannerStack>
        {snap.rpc.publicOnly && screen !== 'settings' && (
          <Banner key="rpc" kind="info" action={<button className="btn-ghost btn-sm" onClick={() => setScreen('settings', 'solana-connection')}>{tr('Settings')}</button>}>{t('rpc.publicOnly')}</Banner>
        )}
        {/* Service installed, this account not signed in again yet (owner 2026-11-11): say that, no Install button. */}
        {/* Q0520/Q0521: while the service restarts (an Apply here or in the CLI, a crash restart) say exactly that:
            never "not answering… Install service" or "sign out" for a restart (owner laptop 2026-11-11 23:34Z). */}
        {/* Agent M Mac T4 r3: also when the restart began on an event while the link still read up (a dropped
            stream): it showed only when the link was already lost, so a crash restart said nothing. */}
        {/* UI-119: one state of the VPN service, one sentence, one button (core/daemon/service-state). The older
            branches below stay for a build whose snapshot has no service state. */}
        {sv && sv.state !== 'ready' && sv.state !== 'wrong-network' ? (!(quiet && step === 'service') && (
          <Banner
            key="service"
            kind={sv.tone === 'info' ? 'info' : 'warn'}
            action={sv.action === null ? undefined : <ServiceFixButton label={sv.actionLabel ?? tr('Fix it')} />}
          >
            <span data-service-state={sv.state} data-setup-lost={sv.state === 'restarting' || sv.state === 'starting' ? 'restarting' : sv.state === 'no-permission' ? 'relogin' : 'service'}>{sv.sentence}</span>
          </Banner>
        )) : snap.daemon.transition ? (
          <Banner key="service" kind="info"><span data-setup-lost="restarting">{RESTARTING_COPY}</span></Banner>
        ) : lost && step === 'service' && snap.daemon.error === RELOGIN_COPY ? (
          <Banner key="service" kind="info"><span data-setup-lost="relogin">{osPick({ win32: tr('One last step: press Connect and Windows asks once to finish setting up the VPN service.') }, tr('One last step: press Connect and your system asks once to finish setting up the VPN service.'))}</span></Banner>
        ) : lost && (
          // One banner per lost step (the 276e46e Android merge had added a second copy of this one).
          <Banner key="service" kind="warn" action={step === 'service' ? <InstallServiceButton label={tr('Start the VPN service')} /> : screen !== lost.screen ? <button className="btn-ghost btn-sm" onClick={() => setScreen(lost.screen)}>{lost.screen === 'wallet' ? 'Wallet' : lost.screen === 'settings' ? 'Settings' : 'Diagnostics'}</button> : undefined}>
            <span data-setup-lost={step}>{lost.text}</span>
          </Banner>
        )}
        {/* Agent M (Mac): a dmg drag-over updates only the app; the service kept its old copies (and every service fix). */}
        {!!snap.serviceOutdated?.length && snap.daemon.reachable && !onAndroid() && (
          <Banner key="outdated" kind="info" action={<InstallServiceButton label={tr('Update the VPN service')} />}><span data-service-outdated>{tr('This app was updated, but the VPN service still runs its old version. Update it to finish (one administrator prompt).')}</span></Banner>
        )}
        {snap.daemon.networkOk === false && <Banner key="network" kind="error">{tr('The VPN service is set up for a different network than this app. Connecting is blocked until it is re-installed for Solana devnet.')}</Banner>}
        </BannerStack>
        {view === 'more' && <MoreList snap={snap} go={setScreen} />}
        {/* UI-024: a page fades in and rises 6 px in 160 ms (off with reduced motion). */}
        <div key={view} className="flex min-h-0 flex-1 animate-page-enter flex-col" data-page={view}>
        <ErrorBoundary key={view}>
          {screen === 'home' && <Home snap={snap} go={setScreen} />}
          {screen === 'nodes' && <Nodes snap={snap} go={setScreen} />}
          {screen === 'plans' && <Plans snap={snap} />}
          {screen === 'activity' && <Activity snap={snap} go={setScreen} />}
          {screen === 'nodetest' && <NodeTest snap={snap} />}
          {screen === 'wallet' && <Wallet snap={snap} />}
          {screen === 'killswitch' && <KillSwitch snap={snap} />}
          {screen === 'split' && <SplitTunnel snap={snap} />}
          {screen === 'settings' && <Settings go={setScreen} />}
          {screen === 'diagnostics' && <Diagnostics snap={snap} />}
          {screen === 'cli' && <Cli />}
        </ErrorBoundary>
        </div>
        </div>
      </main>
      {/* Phone: bottom tab bar, 56 dp, every target ≥ 48 dp. */}
      <nav className="flex h-16 shrink-0 border-t border-line bg-bg-card/90 backdrop-blur md:hidden" aria-label={tr('Main')} data-main-nav="bottom">
        {[...TABS, 'more' as const].map((id) => {
          const on = id === 'more' ? view === 'more' || (!TABS.includes(view as Screen) && view !== 'home') : view === id;
          const label = id === 'more' ? t('nav.more') : t(NAV.find((n) => n.id === id)!.key);
          return (
            <button
              key={id}
              onClick={() => go(id)}
              aria-current={on ? 'page' : undefined}
              className={`flex min-h-[48px] flex-1 flex-col items-center justify-center gap-1 font-display text-label font-semibold tracking-[0.02em] ${on ? 'text-fg' : 'text-fg-muted'}`}
            >
              <Icon d={id === 'more' ? MORE_ICON : ICON[id]} className={`h-[22px] w-[22px] ${on ? 'text-sol-green' : ''}`} />
              {label}
            </button>
          );
        })}
      </nav>
      <Toasts />
    </div>
  );
}

/** Phone: the screens that are not in the bottom bar. */
function MoreList({ snap, go }: { snap: AppSnapshot; go: (s: Screen) => void }) {
  const rest = NAV.filter((n) => !TABS.includes(n.id));
  return (
    <div className="space-y-4">
      <SessionCard snap={snap} onOpen={() => go('home')} />
      <div className="card divide-y divide-line p-0">
        {rest.map((n) => (
          <button key={n.id} onClick={() => go(n.id)} className="flex min-h-[52px] w-full items-center gap-3 px-4 text-start font-display text-sm font-semibold tracking-[0.02em] text-fg hover:bg-bg-hover">
            <Icon d={ICON[n.id]} className="h-5 w-5 text-fg-muted" />
            <span className="flex-1">{t(n.key)}</span>
            <Icon d="M9 6l6 6-6 6" className="h-4 w-4 text-fg-muted" />
          </button>
        ))}
      </div>
    </div>
  );
}

export function ConnDot({ phase }: { phase: string }) {
  const c = phase === 'connected' ? 'bg-ok shadow-[0_0_0_3px_rgb(var(--sol-green)/.18)]' : phase === 'error' ? 'bg-bad' : phase === 'idle' ? 'bg-fg-muted' : 'bg-warn animate-pulse';
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${c}`} aria-hidden />;
}
