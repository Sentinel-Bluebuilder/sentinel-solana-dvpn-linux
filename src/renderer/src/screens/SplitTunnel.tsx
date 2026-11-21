// ─── Split tunnelling page (owner 2026-10-22: "see apps and be able to choose", research-led) ───
// Standards: docs/UI-STANDARDS-RESEARCH.md § Split tunnelling (Proton include/exclude, Mullvad app
// list + "Find another app", Microsoft: checkboxes when an Apply step is needed). Engine contract:
// docs/SPLIT-TUNNEL-CONTRACT.md. What dvpnd really applies comes from splitNotApplied() (engine-owned);
// the live picture comes from the measured coverage, never from the setting alone.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { call, useApp } from '../lib/store';
import { ApplyBar, Banner, KeepsHeight, Copy, Flag, HiddenIp, InlineError, PageHeader, RadioCards, Section, Switch } from '../components/ui';
import { Icon } from '../components/Icon';
import { ProtocolMark, ProtocolTag } from '../components/ProtocolMark';
import { useDaemonSettings } from '../lib/use-daemon-settings';
import { daemonSupportsSplit, fullSplit, splitNotApplied } from '../../../core/session/state';
import { validateSplit, type SplitMode, type SplitSettings } from '../../../core/daemon/config';
import { displayName, filterApps, fileName, normalizeRoute, sameNameApps, unsplittableReason, type AppEntry } from '../../../core/split/apps';
import { laneModel, type LaneItem } from '../../../core/split/lanes';
import { PROTOCOLS } from '../../../shared/protocols';
import { onAndroid, osPick, rendererPlatform } from '../lib/platform';
import type { AppSettings, AppSnapshot } from '../../../shared/types';
import { AndroidSplit } from './android/SplitTunnelAndroid';
import { shownMessage, tr } from '../../../shared/i18n';
import { trJsx } from '../lib/tr-jsx';

/** The measured line under the lanes: one whole sentence per case, the addresses as marked parts. */
function measuredLine(vpnIp: string | null | undefined, homeIp: string | null | undefined): ReactNode {
  const parts = { vpn: () => <HiddenIp ip={String(vpnIp)} />, home: () => <HiddenIp ip={String(homeIp)} /> };
  if (vpnIp && homeIp) return trJsx('Measured: sites reached through the VPN see <vpn/>. Apps on your normal connection show your own IP (<home/>, measured before you connected).', parts);
  if (vpnIp) return trJsx('Measured: sites reached through the VPN see <vpn/>. Apps on your normal connection show your own IP.', parts);
  if (homeIp) return trJsx('Measured: the address sites see through the VPN is still being checked. Apps on your normal connection show your own IP (<home/>, measured before you connected).', parts);
  return tr('Measured: the address sites see through the VPN is still being checked. Apps on your normal connection show your own IP.');
}

type PickerApp = AppEntry & { icon: string | null };
const PLATFORM = rendererPlatform();
/** The OS proxy the V2Ray/Xray switches set (Windows keeps its exact words: the Windows UI walks click them). */
// Linux: dvpnd splits by address range only (it refuses --split-apps there), so there is no app list to show.
const APPS = osPick({ linux: false }, true);
/** An example --split-apps value for this OS (CLI box at the bottom). */
const SPLIT_APPS_EXAMPLE = osPick({ darwin: '/Applications/Firefox.app/Contents/MacOS/firefox', linux: '/usr/bin/firefox' }, 'C:\\a.exe;C:\\b.exe');
const OFF: SplitSettings = { mode: 'off', apps: [], routes: [] };

const MODES = (): Array<{ id: SplitMode; name: string; copy: string }> => ([
  { id: 'off', name: tr('Every app uses the VPN'), copy: tr('Split tunnelling off. Nothing leaves outside the VPN.') },
  APPS
    ? { id: 'include', name: tr('Only the apps I choose'), copy: tr('Chosen apps and addresses use the VPN. Everything else uses your normal connection.') }
    : { id: 'include', name: tr('Only the addresses I choose'), copy: tr('Traffic to the address ranges you add uses the VPN. Everything else uses your normal connection.') },
  APPS
    ? { id: 'exclude', name: tr('Every app except the ones I choose'), copy: tr('Everything uses the VPN except the apps and addresses you leave out.') }
    : { id: 'exclude', name: tr('Everything except the addresses I choose'), copy: tr('Everything uses the VPN except traffic to the address ranges you leave out.') },
]);

// ─── UI-185: nothing on this page grows or moves while its data loads ───
// The VPN service settings are kept for the app run (lib/use-daemon-settings): only the first visit waits,
// and meanwhile the mode cards are laid out invisibly at their real size under a placeholder. The app list
// keeps its height and the last list for the app run.
const LAST: { apps: PickerApp[] | null } = { apps: null };

// Android has its own page: the VPN service applies the per-app / per-address split there, not dvpnd.
export function SplitTunnel({ snap }: { snap: AppSnapshot }) {
  return onAndroid() ? <AndroidSplit snap={snap} /> : <DesktopSplitTunnel snap={snap} />;
}

/** Rows of the real height where the apps go, while the list is read the first time. */
function AppRowsLoading() {
  return (
    <div aria-busy="true" aria-label={tr('Reading your apps')} data-apps-loading>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex min-h-14 items-center gap-3 border-b border-line px-4 py-2 last:border-0" aria-hidden>
          <span className="h-4 w-4 animate-pulse rounded bg-bg-hover" /><span className="h-6 w-6 animate-pulse rounded bg-bg-hover" /><span className="h-4 w-40 animate-pulse rounded bg-bg-hover" />
        </div>
      ))}
    </div>
  );
}

function DesktopSplitTunnel({ snap }: { snap: AppSnapshot }) {
  const { settings, setSettings, nodes } = useApp();
  const { daemon, draft, setDraft, dirty, pending, applying, apply, reset } = useDaemonSettings();
  const [apps, setAppsRaw] = useState<PickerApp[] | null>(LAST.apps);
  const setApps = (v: PickerApp[]): void => { LAST.apps = v; setAppsRaw(v); };
  const [appsError, setAppsError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [route, setRoute] = useState('');
  const [routeError, setRouteError] = useState<string | null>(null);

  const split: SplitSettings = draft.split ?? OFF;
  const saved: SplitSettings = daemon?.settings.split ?? OFF;
  const setSplit = (next: Partial<SplitSettings>): void => setDraft({ ...draft, split: { ...split, ...next } });

  const loadApps = async (): Promise<void> => {
    try {
      const v = await call<{ supported: boolean; apps: PickerApp[]; error: string | null }>(window.api.IPC.APPS_LIST, { chosen: split.apps });
      setApps(v.apps);
      setAppsError(v.supported ? v.error : tr('The app list is not available here. You can still browse for an app.'));
    } catch (err) {
      console.warn('app list failed', err);
      setApps([]);
      setAppsError(tr('The app list could not be read. You can still browse for an app.'));
    }
  };
  // A kept list is shown at once and refreshed in place.
  const [fresh, setFresh] = useState(false);
  useEffect(() => { if (APPS && split.mode !== 'off' && !fresh) { setFresh(true); void loadApps(); } }, [split.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = snap.session;
  const node = s ? nodes.find((n) => n.address === s.node) : undefined;
  const ip = snap.publicIp && s && snap.publicIp.sid === s.id ? snap.publicIp : null;
  // The app's own IP check follows the split too: in "only chosen apps" the app is not chosen, so
  // it measures the user's own IP. The VPN lane then shows the server's address instead.
  const vpnIp = snap.coverage === 'split-include' ? (ip?.nodeIp ?? null) : (ip?.ip ?? null);
  const caps = { daemonVersion: snap.daemon.version, killSwitch: draft.killSwitch, wholeDevice: draft.wholeDevice, hasApps: split.apps.length > 0, platform: PLATFORM };
  const liveReason = s ? splitNotApplied({ ...caps, service: s.service, killSwitch: daemon?.settings.killSwitch, wholeDevice: daemon?.settings.wholeDevice, hasApps: saved.apps.length > 0 }) : null;
  const nameOf = (p: string): string => apps?.find((a) => a.path === p)?.name ?? displayName(p);
  const lanes = laneModel({ split: s ? saved : split, liveService: s?.service ?? null, coverage: snap.coverage, notApplied: liveReason, appName: nameOf, platform: rendererPlatform() });
  const iconOf = (p?: string): string | null => (p ? apps?.find((a) => a.path === p)?.icon ?? null : null);

  const shown = useMemo(() => {
    const all = apps ?? [];
    // Chosen apps first, then running, then A–Z (mergeApps already sorts running first).
    return filterApps(all, q).sort((a, b) => Number(split.apps.includes(b.path)) - Number(split.apps.includes(a.path)));
  }, [apps, q, split.apps]);

  let invalid: string | null = null;
  // DVPN-LINUX KSM13: without a platform the check read process.platform, which the renderer does not have
  // ("Process is not defined." blocked every Apply on the Split page).
  try { validateSplit(split, rendererPlatform()); } catch (err) { invalid = shownMessage(err); }
  const invalidText = invalid ? `${invalid.replace(/^split /, '').replace(/^./, (c) => c.toUpperCase())}.` : undefined;
  // UI-114: a proxy switch or browser that did not work is said next to it.
  const [proxyError, setProxyError] = useState('');
  const proxyDo = async (channel: Parameters<typeof call>[0], payload: unknown, fallback: string): Promise<void> => {
    setProxyError('');
    try { await call(channel, payload, { quiet: true }); } catch (err) { console.warn('proxy action failed', err); setProxyError((err as Error).message || fallback); }
  };

  const toggleApp = (path: string): void => setSplit({ apps: split.apps.includes(path) ? split.apps.filter((x) => x !== path) : [...split.apps, path] });
  const browse = async (): Promise<void> => {
    try {
      const p = await call<string>(window.api.IPC.APPS_PICK);
      if (!split.apps.includes(p)) setSplit({ apps: [...split.apps, p] });
      if (apps && !apps.some((a) => a.path === p)) setApps([{ path: p, name: displayName(p), running: false, source: 'picked', icon: null }, ...apps]);
    } catch (err) {
      console.warn('pick app cancelled or failed', err);
      // Closing the file dialog is not a failure; anything else is said under the list.
      if (!/cancel/i.test((err as Error).message ?? '')) setAppsError(tr('That app could not be added. Pick the program file itself.'));
    }
  };
  const addRoute = (): void => {
    const r = normalizeRoute(route);
    if (!r) { setRouteError(tr('Enter an IP address or a range like 192.168.0.0/16 or 2001:db8::/32. Names like example.com don\'t work: sites behind a CDN change addresses.')); return; }
    if (!split.routes.includes(r)) setSplit({ routes: [...split.routes, r] });
    setRoute(''); setRouteError(null);
  };
  const setApp = async (patch: Partial<AppSettings>): Promise<void> => { setSettings(await call<AppSettings>(window.api.IPC.SETTINGS_SET, patch)); };

  if (!settings) return null;
  return (
    <div>
      <PageHeader title={tr('Split tunnelling')} subtitle={APPS ? tr('Choose which apps and addresses use the VPN.') : tr('Choose which address ranges use the VPN.')} />

      {snap.daemon.version && !daemonSupportsSplit(snap.daemon.version) && (
        <Banner kind="warn">{tr('Your VPN service ({version}) is older than split tunnelling. You can set your choices now; they take effect after the app update installs the new service.', { version: snap.daemon.version })}</Banner>
      )}

      {/* Wide windows: choices left, live picture + what each server type does right. */}
      <div className="grid gap-x-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="xl:order-2">
      {/* ── Live picture ── */}
      <Section title={s ? tr('Right now') : tr('When you connect')}>
      <div className="card" data-split-live={s ? 'live' : 'plan'}>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-4">
          <Lane id="vpn" title={tr('Through the VPN')} items={lanes.vpn} iconOf={iconOf} tone="ok"
            end={s ? <span className="flex items-center gap-2">{node && <Flag code={node.countryCode} />}<ProtocolTag protocol={s.service} />{vpnIp ? <HiddenIp ip={vpnIp} /> : 'Checking…'}</span> : <span className="font-sans text-fg-dim">{tr('A server you pick')}</span>} />
          <div className="flex flex-col items-center justify-center" aria-hidden>
            <span className="h-full w-px bg-line" />
          </div>
          <Lane id="direct" title={tr('Normal connection')} items={lanes.direct} iconOf={iconOf} tone="muted"
            // homeIp, not publicIp.directIp: the app's own IP check rides the VPN, so its "direct" IP is the VPN's (VM 2026-10-22).
            end={<span className="font-sans text-fg-dim" data-lane-direct-sees>{tr('Your own IP address')}</span>} />
        </div>
        {lanes.note && <p className="mt-3 text-meta text-warn">{lanes.note}</p>}
        {/* Q0569 (DVPN-WIN ksm10): the plan card listed left-out apps under Normal connection with no word that a V2Ray/Xray
            proxy session ignores app choices; the live card says it, the plan card now does too. */}
        {!s && !lanes.note && APPS && split.mode !== 'off' && split.apps.length > 0 && (draft.wholeDevice === false || !fullSplit(PLATFORM, snap.daemon.version)) && (
          <p className="mt-3 text-meta text-fg-muted" data-split-plan-proxy-note>{tr('On V2Ray and Xray servers your app choices are used only with \'Whole computer\' on; otherwise only apps set to use the proxy use the VPN.')}</p>
        )}
        {s && !lanes.note && saved.mode !== 'off' && <p className="mt-3 text-meta text-fg-muted">{measuredLine(vpnIp, snap.homeIp)}</p>}
      </div>
      </Section>
      </div>

      <div className="xl:order-1 xl:row-span-3">
      {/* ── Mode ── */}
      <Section title={APPS ? tr('Which apps use the VPN') : tr('What uses the VPN')}>
      <KeepsHeight loading={!daemon} label={tr('Reading the split tunnelling settings')}>
      <RadioCards name="split-mode" label={tr('Split tunnelling mode')} value={split.mode} onChange={(id) => setSplit({ mode: id })}
        options={MODES().map((m) => ({ id: m.id, title: m.name, text: m.copy, hook: { 'data-split-mode': m.id } }))} />
      </KeepsHeight>
      </Section>

      {split.mode !== 'off' && (
        <>
          {APPS ? (
          <>
          {/* ── Apps ── */}
          <Section title={<>{split.mode === 'include' ? tr('Apps that use the VPN') : tr('Apps that skip the VPN')} <span className="num ms-1 text-meta text-fg-muted">{tr('{length} chosen', { length: split.apps.length })}</span></>}>
          {split.mode === 'exclude' && <Banner kind="warn">{tr('Apps you leave out use your normal connection and show your real IP address.')}</Banner>}
          <div className="card mb-2 overflow-hidden p-0">
            <div className="flex items-center gap-2 border-b border-line p-3">
              <input className="input flex-1" placeholder={tr('Search apps')} aria-label={tr('Search apps')} value={q} onChange={(e) => setQ(e.target.value)} />
              <button className="btn-ghost" onClick={() => void loadApps()}>{tr('Refresh')}</button>
            </div>
            <div className="h-80 overflow-y-auto" data-app-list>
              {apps === null ? <AppRowsLoading /> : shown.length === 0 ? <p className="empty-line">{q ? tr('No app matches.') : tr('No apps found.')}</p> : shown.map((a) => {
                const on = split.apps.includes(a.path);
                const twins = on ? sameNameApps(apps, a.path).length : 0;
                const restart = a.running && on !== saved.apps.includes(a.path);
                // macOS: Safari cannot be split by app (shared system WebKit processes); never on Windows.
                const blocked = on ? null : unsplittableReason(a.path);
                return (
                  <label key={a.path} className={blocked ? 'flex min-h-14 items-center gap-3 border-b border-line px-4 py-2 opacity-60 last:border-0' : 'flex min-h-14 cursor-pointer items-center gap-3 border-b border-line px-4 py-2 last:border-0 hover:bg-bg-hover'} data-app={a.path} data-app-blocked={blocked ? 'true' : undefined}>
                    <input type="checkbox" checked={on} disabled={Boolean(blocked)} onChange={() => toggleApp(a.path)} aria-label={a.name} />
                    {a.icon ? <img src={a.icon} alt="" className="h-6 w-6 shrink-0" /> : <span className="h-6 w-6 shrink-0 rounded bg-bg-hover" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      {/* UI-112: the name is what people know; the file path is its tooltip, shown only to tell two same-named apps apart. */}
                      <span className="block truncate text-sm" title={a.path}>{a.name}</span>
                      {shown.filter((x) => x.name === a.name).length > 1 && <span className="mono block truncate text-fg-muted" title={a.path}>{a.path}</span>}
                      {twins > 0 && <span className="block text-meta text-fg-muted">{tr('Programs with the same name ({fileName}) are included too.', { fileName: fileName(a.path) })}</span>}
                      {blocked && <span className="block text-meta text-fg-muted">{blocked}</span>}
                    </span>
                    {restart ? <span className="pill text-warn">{tr('Running: restart it to apply')}</span> : a.running ? <span className="pill">{tr('Running')}</span> : null}
                  </label>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-line bg-bg-raised/40 px-4 py-3">
              <span className="text-meta text-fg-muted">{appsError ?? osPick({ win32: tr('Microsoft Store apps can’t be chosen.'), darwin: tr('Safari can’t be chosen (shared system processes). Apps already open may need a restart to change lane.') }, '')}</span>
              <button className="btn-ghost shrink-0" onClick={() => void browse()}>{tr('Browse for an app…')}</button>
            </div>
          </div>
          <p className="text-meta text-fg-muted">{tr('Apps are matched by their full path and their program name, so programs with the same file name are matched too.')}</p>
          </Section>
          </>
          ) : (
            <p className="mb-6 text-meta text-fg-muted" data-split-linux-note>{tr('Here the VPN service splits by address range; choosing apps works in the Windows and macOS apps.')} {split.mode === 'exclude' ? tr('Addresses you leave out use your normal connection and show your real IP address.') : tr('Only the addresses you add use the VPN.')}</p>
          )}

          {/* ── Addresses ── */}
          <Section title={split.mode === 'include' ? tr('Addresses that use the VPN') : tr('Addresses that skip the VPN')}>
          <div className="card">
            <p className="mb-3 text-meta text-fg-muted">{tr('Any app reaching these addresses follows this rule. Enter an IP address or a range (IPv4 or IPv6), not a site name.')}</p>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addRoute(); }}>
              <input className="input flex-1 mono" placeholder="192.168.0.0/16" aria-label={tr('Address or range')} value={route} onChange={(e) => { setRoute(e.target.value); setRouteError(null); }} />
              <button type="submit" className="btn-ghost">{tr('Add')}</button>
            </form>
            {routeError && <p className="mt-2 text-meta text-bad" role="alert">{routeError}</p>}
            {split.routes.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2" data-route-list>
                {split.routes.map((r) => (
                  <li key={r} className="chip mono">{r}<button className="ms-2 text-fg-muted hover:text-bad" aria-label={tr('Remove {r}', { r })} onClick={() => setSplit({ routes: split.routes.filter((x) => x !== r) })}>×</button></li>
                ))}
              </ul>
            )}
          </div>
          </Section>
        </>
      )}

      {/* ── V2Ray / Xray whole computer (engine binding: draft.wholeDevice, ca28be7) ── */}
      <Section title={tr('V2Ray and Xray: whole computer')}>
      {!fullSplit(PLATFORM, snap.daemon.version) ? (
        <p className="text-meta text-fg-muted" data-whole-device-unavailable>{osPick({ win32: tr('This VPN service runs V2Ray and Xray as a proxy: only browsers (with the Windows proxy) and apps you point at the proxy use the VPN.'), darwin: tr('This VPN service runs V2Ray and Xray as a proxy: only browsers (with the macOS system proxy) and apps you point at the proxy use the VPN.'), linux: tr('This VPN service runs V2Ray and Xray as a proxy: only browsers (with the desktop proxy (GNOME/KDE)) and apps you point at the proxy use the VPN.') }, tr('This VPN service runs V2Ray and Xray as a proxy: only browsers (with the system proxy) and apps you point at the proxy use the VPN.'))} {osPick({ linux: tr('For every app, use a WireGuard, AmneziaWG, OpenVPN or Hysteria2 server.') }, tr('Update the VPN service to carry every app.'))}</p>
      ) : (
      <div className="card">
        <label className="flex cursor-pointer items-start justify-between gap-4">
          <span>
            <span className="text-sm font-medium">{tr('Whole computer')}</span>
            <span className="block text-meta text-fg-muted">{tr('On: every app uses the VPN, and your app choices above apply.')}</span>
            <span className="block text-meta text-fg-muted">{osPick({ win32: tr('Off: only browsers (with the Windows proxy) and apps you point at the proxy use the VPN.'), darwin: tr('Off: only browsers (with the macOS system proxy) and apps you point at the proxy use the VPN.'), linux: tr('Off: only browsers (with the desktop proxy (GNOME/KDE)) and apps you point at the proxy use the VPN.') }, tr('Off: only browsers (with the system proxy) and apps you point at the proxy use the VPN.'))}</span>
          </span>
          <Switch label={tr('Whole computer')} data-whole-device checked={draft.wholeDevice !== false} onChange={(on) => setDraft({ ...draft, wholeDevice: on })} />
        </label>
      </div>
      )}
      </Section>

      {/* ── Proxy (advanced, V2Ray/Xray sessions) ── */}
      <details className="card mb-6 p-0">
        <summary className="disclosure flex h-12 cursor-pointer items-center px-4 text-sm font-medium hover:bg-bg-hover">{tr('Advanced: V2Ray and Xray proxy (send single apps through the VPN)')}</summary>
        <div className="space-y-4 border-t border-line p-4 text-sm">
          <label className="flex cursor-pointer items-start justify-between gap-4">
            <span><span className="font-medium">{osPick({ win32: tr('Set the Windows proxy when I connect'), darwin: tr('Set the macOS system proxy when I connect'), linux: tr('Set the desktop proxy (GNOME/KDE) when I connect') }, tr('Set the system proxy when I connect'))}</span><span className="block text-meta text-fg-muted">{tr('Browsers use the VPN even when "Whole computer" is off. Your own proxy settings come back when you disconnect.')}</span></span>
            <Switch label={osPick({ win32: tr('Set the Windows proxy when I connect'), darwin: tr('Set the macOS system proxy when I connect'), linux: tr('Set the desktop proxy (GNOME/KDE) when I connect') }, tr('Set the system proxy when I connect'))} data-proxy-on-connect checked={settings.proxyOnConnect} onChange={(on) => void setApp({ proxyOnConnect: on })} />
          </label>
          {s?.proxyEndpoint ? (
            <>
              <label className="flex cursor-pointer items-center justify-between gap-4">
                <span>{osPick({ win32: tr('Send apps through the VPN now (Windows proxy)'), darwin: tr('Send apps through the VPN now (macOS system proxy)'), linux: tr('Send apps through the VPN now (desktop proxy, GNOME/KDE)') }, tr('Send apps through the VPN now (system proxy)'))}</span>
                <Switch label={osPick({ win32: tr('Send apps through the VPN now (Windows proxy)'), darwin: tr('Send apps through the VPN now (macOS system proxy)'), linux: tr('Send apps through the VPN now (desktop proxy, GNOME/KDE)') }, tr('Send apps through the VPN now (system proxy)'))} checked={snap.proxyActive} onChange={(on) => void proxyDo(window.api.IPC.PROXY_SET, { on }, tr('The proxy setting could not be changed. Try again.'))} />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn-ghost" onClick={() => void proxyDo(window.api.IPC.PROXY_BROWSER, {}, 'No browser could be opened. Install Chrome or Edge, then try again.')}>{tr('Open browser through VPN')}</button>
                <span className="text-meta text-fg-muted">{osPick({ win32: tr('A separate Edge or Chrome window that uses only the VPN.') }, tr('A separate Chrome, Edge or Brave window that uses only the VPN.'))}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-meta text-fg-muted">{tr('Any other app: SOCKS5 proxy address, to paste into that app\'s network settings')}</span>
                <span className="mono rounded bg-bg-input px-2 py-1">{tr('socks5://{proxyEndpoint}', { proxyEndpoint: s.proxyEndpoint })}</span>
                <Copy text={`socks5://${s.proxyEndpoint}`} />
              </div>
              {proxyError && <div data-proxy-error><InlineError>{proxyError}</InlineError></div>}
            </>
          ) : <p className="text-meta text-fg-muted">{tr('Connect to a V2Ray or Xray server to use the proxy controls.')}</p>}
        </div>
      </details>
      </div>

      <div className="xl:order-3">
      {/* ── Per protocol ── */}
      <Section title={tr('What each server type does with your choices')}>
      <div className="card overflow-hidden p-0" data-split-support>
        {PROTOCOLS.map((p) => {
          const reason = split.mode === 'off' ? null : splitNotApplied({ ...caps, service: p });
          return (
            <div key={p} className="flex min-h-12 items-center justify-between gap-4 border-b border-line px-4 py-2 text-sm last:border-0" data-split-protocol={p} data-split-ok={reason ? 'no' : 'yes'}>
              <ProtocolTag protocol={p} />
              <span className={`text-end text-meta ${reason ? 'text-fg-muted' : 'text-ok'}`}>{split.mode === 'off' ? tr('Every app uses the VPN') : reason ?? tr('Applied')}</span>
            </div>
          );
        })}
        {draft.killSwitch && draft.killSwitch !== 'off' && <p className="px-4 py-3 text-meta text-fg-muted">{tr('Kill switch is on: if the VPN drops, traffic you chose for the VPN is blocked; what you left out keeps your normal connection.')}</p>}
      </div>
      </Section>

      </div>
      </div>

      {/* ── Apply bar (Proton: Apply when disconnected, reconnect when connected) ── */}
      {dirty && (
        <ApplyBar hook={{ 'data-split-apply': '' }} busy={applying} disabled={!!invalid} reason={invalidText} onApply={() => void apply()} onDiscard={reset}
          note={<><span className="block" data-pending-areas>{tr('Not applied yet: {join}.', { join: pending.join(', ') })}</span>{invalid ? <span className="text-bad">{invalidText}</span> : s ? 'Disconnects you first. Connect again after.' : 'Asks for administrator once.'}</>} />
      )}

      {/* UI-101: kept, closed, last on the page. */}
      <details className="card mb-6" data-cli-card>
        <summary className="cursor-pointer text-sm text-fg-dim">{tr('The same from the command line')}</summary>
        <div className="mono mt-3 leading-6">
          <div>{tr('devnet-dvpn split status')}</div>
          {APPS && <div>{tr('devnet-dvpn split apps [--search firefox]')}</div>}
          <div>devnet-dvpn daemon set --split-mode off|include|exclude{APPS ? <> {tr('--split-apps "{SPLIT_APPS_EXAMPLE}"|none', { SPLIT_APPS_EXAMPLE })}</> : null} --split-routes &quot;10.0.0.0/8&quot;|none --yes</div>
          {APPS && <div>devnet-dvpn daemon set --whole-device true|false --yes</div>}
          <div>devnet-dvpn proxy on --yes | proxy off | proxy browser</div>
        </div>
      </details>
    </div>
  );
}

function Lane({ id, title, items, iconOf, end, tone }: { id: 'vpn' | 'direct'; title: string; items: LaneItem[]; iconOf: (p?: string) => string | null; end: ReactNode; tone: 'ok' | 'muted' }) {
  return (
    // Owner 2026-11-15: one structure for both lanes: a header (mark + name), what goes this way, then
    // what sites see on its own labelled row, so the two cards read line for line.
    // Owner 2026-11-16: both lane cards centred: header, label, items and "Sites see" on one centre line.
    <div className={`flex min-w-0 flex-col overflow-hidden rounded-lg border text-center ${tone === 'ok' ? 'border-ok/40' : 'border-line'} bg-bg-raised/60`} data-lane={id}>
      <div className={`flex h-10 items-center justify-center gap-2 border-b px-4 ${tone === 'ok' ? 'border-ok/25 bg-ok-soft text-ok' : 'border-line bg-bg-raised text-fg-dim'}`}>
        <Icon name={tone === 'ok' ? 'shield' : 'arrow-right'} />
        <span className="truncate text-meta font-semibold">{title}</span>
      </div>
      <div className="px-4 pt-3 text-label font-medium uppercase tracking-wider text-fg-muted">{tone === 'ok' ? tr('Goes through it') : tr('Stays outside')}</div>
      <ul className="flex-1 space-y-2 px-4 pb-3 pt-1.5 text-sm">
        {items.length === 0 ? <li className="text-fg-muted">{tr('Nothing')}</li> : items.slice(0, 8).map((it, i) => {
          const icon = iconOf(it.path);
          return (
            <li key={`${it.label}-${i}`} className="flex items-center justify-center gap-2" data-lane-item={it.path ?? it.kind}>
              {icon ? <img src={icon} alt="" className="h-4 w-4 shrink-0" /> : <span className={`h-2 w-2 shrink-0 rounded-full ${tone === 'ok' ? 'bg-ok' : 'bg-fg-muted'}`} aria-hidden />}
              <span className="min-w-0 [overflow-wrap:anywhere]" title={it.label}>{it.label}</span>{/* Q0569: long lane labels wrap, never cut at 1296 px */}
            </li>
          );
        })}
        {items.length > 8 && <li className="text-meta text-fg-muted">{tr('and {length} more', { length: items.length - 8 })}</li>}
      </ul>
      <div className="border-t border-line px-4 py-3">
        <div className="text-label font-medium uppercase tracking-wider text-fg-muted">{tr('Sites see')}</div>
        <div className="mono mt-1 flex min-h-[20px] items-center justify-center text-meta">{end}</div>
      </div>
    </div>
  );
}
