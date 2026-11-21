// ─── Settings (F4, F14, F15, F16b, F18) ───
// Two stores: app settings (instant, local) and VPN-service settings (one
// administrator prompt + service restart, applied together).
import { cloneElement, isValidElement, useEffect, useRef, useState } from 'react';
import { call, useApp } from '../lib/store';
import { useDaemonSettings } from '../lib/use-daemon-settings';
import { ApplyBar, Banner, KeepsHeight, ConfirmModal, InlineError, PageHeader, Section, Switch } from '../components/ui';
import { PollSettings } from '../components/PollSettings';
import { GB_OPTIONS, HOUR_OPTIONS, countryName } from '../../../shared/format';
import { DNS_CUSTOM, DNS_PRESETS, dnsPresetKey, dnsSelectChange, dnsSelectValue } from '../../../core/daemon/dns-presets';
import type { AppSettings } from '../../../shared/types';
import { maskRpcKey, unmaskRpcUrls } from '../../../shared/rpc-mask';
import { prepayHint } from '../../../shared/prepay-cap';
import { byPlatform, onAndroid, osPick, thisDevice } from '../lib/platform';
import { AboutAndroid } from './android/AboutAndroid';
import type { DaemonSettings } from '../../../core/daemon/config';
import { tdvpn, toBaseUnits } from '../../../core/chain/amounts';
import { unreadableSettingsCopy } from '../../../shared/settings-copy';
import { START_WITH_KILL_SWITCH_HINT } from '../../../shared/kill-switch-start';
import { speedOriginProblems } from '../../../core/quality/speed-origin';
import { tr } from '../../../shared/i18n';
import { LanguageSelect, menuLanguages } from '../components/LanguageSelector';
import { trJsx } from '../lib/tr-jsx';

const baseToTdvpn = (v: string | undefined): string => (v ? tdvpn(v) : '');

// Curated attribution for the About screen. The authoritative, complete list (every component with its SHA-256
// and full license text) is each build's THIRD-PARTY-NOTICES file. Keep in step with each OS's deps lock when a
// bundled component is added or removed. Rows per OS: macOS installs WireGuard, AmneziaWG and OpenVPN with
// Homebrew (not bundled), so only Windows lists them here.
type Credit = { name: string; license: string; url?: string };
const CREDITS_COMMON = (): Credit[] => ([
  { name: tr('Sentinel dVPN daemon (dvpnd)'), license: tr('Sentinel dVPN License'), url: 'https://github.com/sentinel-official/sentinel-solana' },
  { name: 'Xray', license: 'MPL-2.0', url: 'https://github.com/XTLS/Xray-core' },
  { name: 'V2Ray', license: 'MIT', url: 'https://github.com/v2fly/v2ray-core' },
  { name: 'Hysteria 2', license: 'MIT', url: 'https://github.com/apernet/hysteria' },
  { name: tr('Fonts: Outfit, JetBrains Mono and Tomorrow'), license: 'OFL-1.1', url: 'https://fontsource.org' },
  { name: 'rpc-websockets', license: 'LGPL-3.0', url: 'https://github.com/elpheria/rpc-websockets' },
]);
const CREDITS_WIN32 = (): Credit[] => ([
  { name: tr('WireGuard for Windows'), license: 'MIT', url: 'https://git.zx2c4.com/wireguard-windows/' },
  { name: tr('AmneziaWG for Windows'), license: 'MIT', url: 'https://github.com/amnezia-vpn/amneziawg-windows-client' },
  { name: 'OpenVPN 2.6', license: 'GPL-2.0', url: 'https://github.com/OpenVPN/openvpn/tree/v2.6.23' },
  { name: 'Wintun', license: tr('Wintun Prebuilt Binaries License'), url: 'https://www.wintun.net/' },
]);
// Linux: WireGuard, AmneziaWG, OpenVPN and nftables come from the distribution (package dependencies), not bundled.
const CREDITS_LINUX = (): Credit[] => ([
  { name: tr('AppImage runtime (type 2)'), license: 'MIT', url: 'https://github.com/AppImage/type2-runtime' },
]);
const CREDITS: Credit[] = [...CREDITS_COMMON(), ...osPick<Credit[]>({ win32: CREDITS_WIN32(), linux: CREDITS_LINUX() }, [])];
/** A positive tDVPN amount -> base units, or null. */
function escrowToBase(t: string): string | null {
  if (!/^\d{1,9}(\.\d{1,6})?$/.test(t) || Number(t) <= 0) return null;
  return toBaseUnits(t);
}

/**
 * Audit U-10: a whole number from 1 to `max` from what was typed. Unbounded, a long number became "1e+22" in the VPN
 * service's settings file (String of a float), which it cannot read as a size.
 */
const PREPAY_MB_MAX = 100_000;
const PREPAY_MIN_MAX = 7 * 24 * 60;
function wholeUnits(typed: string, max: number): number {
  const n = Number(typed.replace(/\D/g, '').slice(0, 9)) || 1;
  return Math.min(max, Math.max(1, n));
}

/** A row with one input or select: give it the row's label (screen readers, F25.3; Q0499). */
function named(children: React.ReactNode, label: string): React.ReactNode {
  if (!isValidElement<{ 'aria-label'?: string }>(children)) return children;
  if (children.type !== 'input' && children.type !== 'select') return children;
  if (children.props['aria-label']) return children;
  return cloneElement(children, { 'aria-label': label });
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-line px-4 py-3 last:border-0">
      <div className="min-w-0 flex-[1_1_12rem]"><div className="text-sm">{label}</div>{hint && <div className="prose-cap mt-1 text-meta text-fg-muted">{hint}</div>}</div>
      <div className="max-w-full shrink-0">{named(children, label)}</div>
    </div>
  );
}

// ─── UI-185: nothing on this page grows or moves while its data loads ───
// The VPN service settings are kept for the app run (lib/use-daemon-settings), so only the first visit waits;
// then the card is laid out invisibly at its real size under a placeholder. The DNS answer keeps two lines.
/** Last DNS answer per server list, for the app run: a revisit shows it at once. */
const DNS_LAST = new Map<string, { key: string; problem: string | null; ok: number }>();

/** Asks each chosen DNS server one question (DNS_PROBE = CLI `daemon dns-check`); warns before Apply when none answers. */
function DnsCheck({ servers }: { servers: string[] }) {
  const key = servers.join(',');
  const [state, setStateRaw] = useState<{ key: string; problem: string | null; ok: number } | null>(DNS_LAST.get(key) ?? null);
  const setState = (v: { key: string; problem: string | null; ok: number } | null): void => { if (v) DNS_LAST.set(v.key, v); setStateRaw(v); };
  useEffect(() => {
    if (!servers.length) { setState(null); return; }
    let live = true;
    const t = setTimeout(() => {
      call<{ rows: Array<{ ok: boolean }>; problem: string | null }>(window.api.IPC.DNS_PROBE, { servers }, { quiet: true })
        .then((r) => { if (live) setState({ key, problem: r.problem, ok: r.rows.filter((x) => x.ok).length }); })
        .catch((err) => console.warn('dns probe failed', err));
    }, 600);
    return () => { live = false; clearTimeout(t); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!state || state.key !== key) return <span className="block min-h-[2lh] text-meta text-fg-muted" data-dns-check="checking">{tr('Checking these servers…')}</span>;
  return state.problem
    ? <span className="block min-h-[2lh] max-w-xs text-end text-meta text-warn" role="alert" data-dns-check="dead">{byPlatform(tr('None of these servers answered from this computer. Names may not work during a session: pick another.'), tr('None of these servers answered from this phone. Names may not work during a session: pick another.'))}</span>
    : <span className="num block min-h-[2lh] text-meta text-ok" data-dns-check="ok">{tr('{ok} of {length} answer', { ok: state.ok, length: servers.length })}</span>;
}

export function Settings({ go }: { go: (s: 'killswitch' | 'split') => void }) {
  const { settings, setSettings, nodes, snap } = useApp();
  const [rpcText, setRpcText] = useState('');
  // Q0508 F3: the same draft as the Kill switch and Split tunnelling screens (edits survive navigation).
  const { daemon, draft, setDraft, dirty, pending, applying, apply, reset } = useDaemonSettings();
  const ksOn = !!daemon?.readable && (daemon.settings.killSwitch ?? 'off') !== 'off';
  const [customDns, setCustomDns] = useState('');
  const [customDnsMode, setCustomDnsMode] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [escrowText, setEscrowText] = useState('');
  const [allowanceText, setAllowanceText] = useState('');
  const [allowanceError, setAllowanceError] = useState('');
  const [speedOrigin, setSpeedOrigin] = useState('');
  const [speedPin, setSpeedPin] = useState('');
  const [speedChecked, setSpeedChecked] = useState(false);
  const speedProblems = speedOriginProblems(speedOrigin, speedPin);
  // Android: notifications can be off at the system level; re-read when coming back from its settings.
  const [notifAllowed, setNotifAllowed] = useState(() => window.api.android?.notificationsAllowed() ?? true);
  useEffect(() => {
    if (!onAndroid()) return undefined;
    const reread = (): void => { if (document.visibilityState === 'visible') setNotifAllowed(window.api.android?.notificationsAllowed() ?? true); };
    document.addEventListener('visibilitychange', reread);
    window.addEventListener('focus', reread);
    return () => { document.removeEventListener('visibilitychange', reread); window.removeEventListener('focus', reread); };
  }, []);

  // Text boxes from the draft: a non-preset DNS list opens in Custom with its addresses filled in.
  const syncText = (s: Partial<DaemonSettings>): void => {
    const custom = dnsPresetKey(s.dnsServers) === null;
    setCustomDnsMode(custom); setCustomDns(custom ? (s.dnsServers ?? []).join(', ') : ''); setEscrowText(baseToTdvpn(s.escrow));
  };
  // Each fresh read (open, after Apply or Reset) refills them from the draft, which keeps unapplied edits.
  useEffect(() => { if (daemon) syncText(draft); }, [daemon]); // eslint-disable-line react-hooks/exhaustive-deps

  // Audit U-9: refill a text box only when ITS stored value changed. Refilling all of them on any change (a theme
  // switch, a toggle) wiped an RPC list or speed server being typed and not yet saved.
  const seen = useRef<AppSettings | null>(null);
  useEffect(() => {
    if (!settings) return;
    const was = seen.current;
    seen.current = settings;
    if (!was || was.rpcUrls.join('\n') !== settings.rpcUrls.join('\n')) setRpcText(settings.rpcUrls.map(maskRpcKey).join('\n'));
    if (!was || was.allowanceTdvpn !== settings.allowanceTdvpn) setAllowanceText(settings.allowanceTdvpn);
    if (!was || was.speedOrigin !== settings.speedOrigin) setSpeedOrigin(settings.speedOrigin);
    if (!was || was.speedPin !== settings.speedPin) setSpeedPin(settings.speedPin);
  }, [settings]);

  if (!settings) return null;
  const set = async (patch: Partial<AppSettings>): Promise<void> => { setSettings(await call<AppSettings>(window.api.IPC.SETTINGS_SET, patch)); };
  const countries = [...new Set(nodes.map((n) => n.countryCode).filter(Boolean))].sort((a, b) => countryName(a).localeCompare(countryName(b)));
  const presetKey = dnsSelectValue(draft.dnsServers, customDnsMode);
  const firstRpc = settings.rpcUrls[0] ?? '';
  const sameAsApp = firstRpc.startsWith('https://') && maskRpcKey(firstRpc) === firstRpc ? firstRpc : '';

  return (
    <div>
      <PageHeader title={tr('Settings')} subtitle={tr('Preferences for the app and the VPN service.')} />

      {/* Wide windows: app settings left, VPN service + RPC right. */}
      <div className="grid grid-cols-1 gap-x-6 xl:grid-cols-2 [&>*]:min-w-0">
      <div>
      <Section title={tr('Connection defaults')}>
      <div className="card overflow-hidden p-0">
        <Row label={tr('Default pricing')} hint={tr('Per-GB and per-hour prices are never compared; pick what suits how you browse.')}>
          <select className="input w-auto min-w-36 max-w-full" aria-label={tr('Default pricing')} value={settings.defaultBasis} onChange={(e) => void set({ defaultBasis: e.target.value as AppSettings['defaultBasis'] })}>
            <option value="per_gb">{tr('Per GB')}</option><option value="per_hour">{tr('Per hour')}</option>
          </select>
        </Row>
        <Row label={tr('Default amount')}>
          <div className="flex gap-2">
            <select className="input w-auto min-w-24 max-w-full" value={settings.defaultGb} onChange={(e) => void set({ defaultGb: Number(e.target.value) })} aria-label={tr('Default gigabytes')}>{GB_OPTIONS.map((g) => <option key={g} value={g}>{g} GB</option>)}</select>
            <select className="input w-auto min-w-24 max-w-full" value={settings.defaultHours} onChange={(e) => void set({ defaultHours: Number(e.target.value) })} aria-label={tr('Default hours')}>{HOUR_OPTIONS.map((h) => <option key={h} value={h}>{h} h</option>)}</select>
          </div>
        </Row>
        <Row label={tr('Preferred country')} hint={tr('Used by quick connect when you have no favourites.')}>
          <select className="input w-auto min-w-48 max-w-full" aria-label={tr('Preferred country')} value={settings.preferredCountry ?? ''} onChange={(e) => void set({ preferredCountry: e.target.value || null })}>
            <option value="">{tr('Fastest anywhere')}</option>
            {countries.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}
          </select>
        </Row>
        <div data-section="payments">
        {/* UI-095: one short label, one sentence; a failed try is its own line, in words, not the raw error. */}
        <Row label={tr('Set up payments on first connect')} hint={byPlatform(tr('Your first Connect lets this computer pay servers from your wallet, up to the limit below. Off: set it up yourself in Wallet → This device.'), tr('Your first Connect lets this phone pay servers from your wallet, up to the limit below. Off: set it up yourself in Wallet → This device.'))}>
          <Switch label={tr('Set up payments on first connect')} checked={settings.autoDevicePermission} onChange={(on) => void set({ autoDevicePermission: on })} />
        </Row>
        {snap?.deviceAuto?.state === 'failed' && (
          <div className="border-b border-line px-4 py-3" data-device-auto-failed><InlineError>{tr('The last try to set up payments did not work. Connect again, or set it up in Wallet → This device.')}</InlineError></div>
        )}
        <Row label={tr('Device spending limit')} hint={byPlatform(tr('The most this computer may spend from your wallet without asking again. Used when you set up or update the device.'), tr('The most this phone may spend from your wallet without asking again. Used when you set up or update the device.'))}>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2 text-sm">
              {/* UI-097: a wrong amount is said under the field and the typed text stays, so it can be corrected. */}
              <input className="input mono w-24 text-end" inputMode="decimal" value={allowanceText} aria-invalid={!!allowanceError} onChange={(e) => { setAllowanceText(e.target.value.replace(/[^\d.]/g, '')); setAllowanceError(''); }} onBlur={() => { if (!escrowToBase(allowanceText)) { setAllowanceError('Use an amount above 0, for example 50.'); return; } setAllowanceError(''); if (allowanceText !== settings.allowanceTdvpn) void set({ allowanceTdvpn: allowanceText }); }} aria-label={tr('Device spending limit, tDVPN')} /> tDVPN
            </div>
            {allowanceError && <span className="text-meta text-bad" role="alert" data-field-error="allowance">{allowanceError}</span>}
          </div>
        </Row>
        </div>
      </div>
      </Section>

      <Section title={tr('App')}>
      <div className="card overflow-hidden p-0">
        {/* Queue B5: first row of the general section; saved at once and applied live (main switches, the
            screens follow its state). Empty = System language. */}
        {menuLanguages().length > 1 && (
          <Row label={tr('Language')} hint={tr('Applies at once. System language follows this device.')}>
            <div className="w-56 max-w-full" data-settings-language>
              <LanguageSelect look="row" value={settings.language ?? ''} languages={menuLanguages()} onChange={(code) => void set({ language: code })} />
            </div>
          </Row>
        )}
        {/* Android: the VPN service keeps running with its notification; start at boot = Always-on VPN (Kill switch screen). */}
        {!onAndroid() && <Row label={tr('Start when I log in')} hint={ksOn ? START_WITH_KILL_SWITCH_HINT() : undefined}><Switch label={tr('Start when I log in')} checked={settings.startWithOs || ksOn} disabled={ksOn} onChange={(on) => void set({ startWithOs: on })} /></Row>}
        {!onAndroid() && <Row label={tr('Keep running in the tray when closed')}><Switch label={tr('Keep running in the tray when closed')} checked={settings.closeToTray} onChange={(on) => void set({ closeToTray: on })} /></Row>}
        <Row label={tr('Connect on launch')} hint={tr('Uses quick connect. Never resumes on its own after a crash.')}><Switch label={tr('Connect on launch')} checked={settings.autoConnect} onChange={(on) => void set({ autoConnect: on })} /></Row>
        {/* UI-099 */}
        <Row label={tr('Keep enough SOL for network fees')} hint={byPlatform(tr('When this computer runs low before you connect, 0.05 SOL is sent to it from your wallet. Only with the wallet saved in this app.'), tr('When this phone runs low before you connect, 0.05 SOL is sent to it from your wallet. Only with the wallet saved in this app.'))}><Switch label={tr('Keep enough SOL for network fees')} checked={settings.autoTopUpDevice} onChange={(on) => void set({ autoTopUpDevice: on })} /></Row>
        <Row label={tr('Notifications')} hint={byPlatform(tr('Only while the window is hidden: dropped connection, refunds, low balance.'), tr('Only while the app is in the background: dropped connection, refunds, low balance.'))}><Switch label={tr('Notifications')} checked={settings.notifications} onChange={(on) => void set({ notifications: on })} /></Row>
        {onAndroid() && settings.notifications && !notifAllowed && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 text-meta text-warn">
            <span>{tr('Android has notifications turned off for this app, so none will show.')}</span>
            <button className="btn-ghost btn-sm" onClick={() => window.api.android?.openNotificationSettings()}>{tr('Turn on in Android settings')}</button>
          </div>
        )}
        <Row label={tr('IP check and speed test')} hint={tr('These contact third-party services (ipify, Cloudflare). Off = never contacted.')}><Switch label={tr('IP check and speed test')} checked={settings.thirdPartyChecks} onChange={(on) => void set({ thirdPartyChecks: on })} /></Row>
        <Row label={tr('Theme')}>
          <select className="input w-auto min-w-32 max-w-full" aria-label={tr('Theme')} value={settings.theme} onChange={(e) => void set({ theme: e.target.value as AppSettings['theme'] })}>
            <option value="system">{tr('System')}</option><option value="dark">{tr('Dark')}</option><option value="light">{tr('Light')}</option>
          </select>
        </Row>
      </div>
      </Section>

      <Section title={tr('Background refresh')}>
        <PollSettings settings={settings} />
      </Section>
      </div>

      <div>
      {/* UI-096: said in plain words; the VPN service's own Solana connection is under Advanced below. */}
      <Section title={tr('Solana connection (this app)')}>
      <div className="card" data-section="solana-connection">
        <p className="mb-2 text-meta text-fg-muted">{tr('The addresses this app uses to read your balance and send payments on Solana. One per line, tried in order; one that is busy is skipped for a while. https only (http only for 127.0.0.1).')}</p>
        <textarea className="input mono mb-2 h-24" value={rpcText} onChange={(e) => setRpcText(e.target.value)} spellCheck={false} aria-label={tr('RPC endpoints')} />
        <button className="btn-ghost" onClick={async () => {
          const urls = unmaskRpcUrls(rpcText.split(/\s+/).map((u) => u.trim()).filter(Boolean), settings?.rpcUrls ?? []);
          const next = await call<AppSettings>(window.api.IPC.SETTINGS_SET, { rpcUrls: urls });
          setSettings(next);
          const dropped = urls.filter((u) => !next.rpcUrls.includes(u));
          useApp.getState().toast(dropped.length ? 'warn' : 'success', dropped.length ? `${dropped.length === 1 ? '1 address was' : `${dropped.length} addresses were`} not valid and left out.` : 'Solana connection saved.');
        }}>{tr('Save')}</button>
      </div>
      </Section>

      {/* Row 148: where the Node test measures speed. Empty = the public hosts (capped at 25 MB a request). */}
      <Section title={tr('Advanced: speed test server')}>
      <div className="card" data-speed-origin data-section="speed-test">
        <p className="mb-3 text-meta text-fg-muted">{tr('Node test measures download speed against public hosts. A fast server can only be measured fully against a speed test server of your own. Leave both empty to use the public hosts.')}</p>
        <label className="mb-1 block text-sm" htmlFor="speed-origin">{tr('Address')}</label>
        <input id="speed-origin" className="input mono mb-1" placeholder="https://speed.example.com" value={speedOrigin} aria-invalid={!!speedProblems.origin} spellCheck={false} onChange={(e) => { setSpeedOrigin(e.target.value); setSpeedChecked(false); }} />
        {speedChecked && speedProblems.origin && <p className="mb-1 text-meta text-bad" role="alert" data-field-error="speed-origin">{speedProblems.origin}</p>}
        <p className="mb-3 text-meta text-fg-muted">{tr('The https address of the speed test server.')}</p>
        <label className="mb-1 block text-sm" htmlFor="speed-pin">{tr('Key')}</label>
        <input id="speed-pin" className="input mono mb-1" placeholder="sha256//…" value={speedPin} aria-invalid={!!speedProblems.pin} spellCheck={false} onChange={(e) => { setSpeedPin(e.target.value); setSpeedChecked(false); }} />
        {speedChecked && speedProblems.pin && <p className="mb-1 text-meta text-bad" role="alert" data-field-error="speed-pin">{speedProblems.pin}</p>}
        <p className="mb-3 text-meta text-fg-muted">{tr('The server\'s public key fingerprint. A test stops if the server that answers has a different key.')}</p>
        <button className="btn-ghost" data-speed-save disabled={speedOrigin.trim() === settings.speedOrigin && speedPin.trim() === settings.speedPin} onClick={async () => {
          setSpeedChecked(true);
          if (speedProblems.origin || speedProblems.pin) return;
          const pin = { speedPin: speedPin.trim() }; // the pair is saved in one call: half a pair is refused
          await set({ speedOrigin: speedOrigin.trim(), ...pin });
          useApp.getState().toast('success', speedOrigin.trim() ? 'Speed test server saved.' : 'Speed tests use the public hosts.');
        }}>{tr('Save')}</button>
      </div>
      </Section>

      <Section title={tr('VPN service')}>
      <p className="mb-3 text-meta text-fg-muted">{tr('The kill switch and which apps use the VPN have their own pages:')} <button className="text-accent-ink underline" onClick={() => go('killswitch')}>{tr('Kill switch')}</button> {tr('and')} <button className="text-accent-ink underline" onClick={() => go('split')}>{tr('Split tunnelling')}</button>.</p>
      {!daemon || daemon.readable ? (
        <KeepsHeight loading={!daemon} label={tr('Reading the VPN service settings')}>
        <div className="card overflow-hidden p-0">
          <Row label={tr('DNS while connected')} hint={tr('Handshake resolves decentralised names as well as normal ones.')}>
            <div className="flex flex-col items-end gap-2">
              <select className="input w-auto min-w-48 max-w-full" aria-label={tr('DNS while connected')} value={presetKey} onChange={(e) => { const next = dnsSelectChange(e.target.value, draft.dnsServers); setCustomDnsMode(next.customMode); setCustomDns(next.customMode ? next.dnsServers.join(', ') : ''); setDraft({ ...draft, dnsServers: next.dnsServers }); }}>
                {Object.entries(DNS_PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
                <option value={DNS_CUSTOM}>{tr('Custom')}</option>
              </select>
              {presetKey === DNS_CUSTOM && <input className="input mono w-48" placeholder="1.1.1.1, 9.9.9.9" value={customDns} onChange={(e) => { setCustomDns(e.target.value); setDraft({ ...draft, dnsServers: e.target.value.split(/[\s,]+/).filter(Boolean) }); }} aria-label={tr('Custom DNS servers')} />}
              <DnsCheck servers={draft.dnsServers ?? []} />
            </div>
          </Row>
          <Row label={tr('Use the VPN\'s DNS')} hint={draft.dnsMode === 'none' ? tr('Off: your system keeps its own DNS servers during a session. Your DNS provider can see the sites you look up.') : byPlatform(tr('On: during a session, this computer asks the DNS servers above, through the VPN.'), tr('On: during a session, this phone asks the DNS servers above, through the VPN.'))}>
            <Switch label={tr('Use the VPN\'s DNS')} checked={draft.dnsMode !== 'none'} onChange={(on) => setDraft({ ...draft, dnsMode: on ? osPick({ win32: 'netsh', darwin: 'networksetup', linux: 'resolvectl', android: 'vpn' }, 'netsh') : 'none' })} />
          </Row>
          {/* UI-096: the three expert rows sit under one heading, each named for what it does. */}
          <div className="border-b border-line bg-bg-raised/40 px-4 py-2 text-meta text-fg-muted" data-settings-advanced>{tr('Advanced. Most people never change these.')}</div>
          <Row label={tr('Smallest deposit')} hint={prepayHint(draft.prepayBytes, draft.prepaySeconds)}>
            <div className="flex items-center gap-2 text-sm">
              <input className="input w-24" inputMode="numeric" value={String(Math.round(Number(draft.prepayBytes ?? 0) / 1e6))} onChange={(e) => setDraft({ ...draft, prepayBytes: String(wholeUnits(e.target.value, PREPAY_MB_MAX) * 1e6) })} aria-label={tr('Prepaid megabytes')} /> MB
              <input className="input w-20" inputMode="numeric" value={String(Math.round(Number(draft.prepaySeconds ?? 0) / 60))} onChange={(e) => setDraft({ ...draft, prepaySeconds: String(wholeUnits(e.target.value, PREPAY_MIN_MAX) * 60) })} aria-label={tr('Prepaid minutes')} /> {tr('min')}
            </div>
          </Row>
          <Row label={tr('Defaults for the command line')} hint={tr('Used only for sessions started outside this app, from the VPN service\'s own command line. The app always sends its own amount.')}>
            <div className="flex items-center gap-2 text-sm">
              <select className="input w-auto min-w-28 max-w-full" value={draft.basis ?? 'per_gb'} onChange={(e) => setDraft({ ...draft, basis: e.target.value as DaemonSettings['basis'] })} aria-label={tr('Service default pricing')}>
                <option value="per_gb">{tr('Per GB')}</option><option value="per_hour">{tr('Per hour')}</option>
              </select>
              <input className="input mono w-24 text-end" inputMode="decimal" value={escrowText} onChange={(e) => setEscrowText(e.target.value.replace(/[^\d.]/g, ''))} onBlur={() => { const v = escrowToBase(escrowText); if (v) setDraft({ ...draft, escrow: v }); else setEscrowText(baseToTdvpn(draft.escrow)); }} aria-label={tr('Service default deposit, tDVPN')} /> tDVPN
            </div>
          </Row>
          <Row label={tr('Solana connection for the VPN service')} hint={tr('The VPN service talks to Solana itself, with its own address. Access keys are hidden here and kept unless you change the address.')}>
            <div className="flex flex-col items-end gap-2">
              <input className="input mono w-64" value={draft.rpcUrl ?? ''} onChange={(e) => setDraft({ ...draft, rpcUrl: e.target.value.trim(), rpcWsUrl: e.target.value.trim().replace(/^https:/, 'wss:') })} aria-label={tr('Service RPC URL')} />
              {/* Offered only when the app's first address carries no access key (a key must never be shown or copied here). */}
              {sameAsApp && draft.rpcUrl !== sameAsApp && <button className="btn-ghost btn-sm" data-rpc-same onClick={() => setDraft({ ...draft, rpcUrl: sameAsApp, rpcWsUrl: sameAsApp.replace(/^https:/, 'wss:') })}>{tr('Use the same as this app')}</button>}
            </div>
          </Row>
        </div>
        </KeepsHeight>
      ) : <Banner kind="info"><span data-settings-unreadable={daemon.empty ? 'empty' : 'missing'}>{unreadableSettingsCopy(daemon.empty)}</span></Banner>}
      {/* UI-098: the same Apply bar as Kill switch and Split tunnelling; it shows only with a change to apply. */}
      {daemon?.readable && dirty && (
        <div className="mt-3">
          <ApplyBar hook={{ 'data-settings-apply': '' }} busy={applying} onApply={() => void apply()} onDiscard={() => { reset(); syncText(daemon.settings); }}
            note={<><span className="block" data-pending-areas>{tr('Not applied yet: {join}.', { join: pending.join(', ') })}</span>{snap?.session ? 'Disconnects you first.' : byPlatform('Asks for administrator once.', 'Restarts the VPN service.')}</>} />
        </div>
      )}
      </Section>

      {onAndroid() ? <AboutAndroid /> : (
      <Section title={tr('About & credits')}>
      <div className="card">
        <p className="mb-2 text-sm">{tr('A pure-P2P VPN client built on')} <button className="text-accent-ink underline" onClick={() => void call(window.api.IPC.OPEN_EXTERNAL, 'https://sentinel.co')}>Sentinel</button> {tr('— decentralised bandwidth, with no servers of ours to trust.')}</p>
        {/* Sentinel dVPN License §4: an app that reuses its code shows exactly "Built on Sentinel." with a visible link (the Linux app release About). */}
        <p className="mb-2 text-sm" data-attribution>{tr('Built on Sentinel.')} <button className="text-accent-ink underline" onClick={() => void call(window.api.IPC.OPEN_EXTERNAL, 'https://sentinel.co')}>https://sentinel.co</button></p>
        <p className="mb-3 text-meta text-fg-muted">{tr('It bundles open-source software, unmodified, each under its own license:')}</p>
        <ul className="mb-3 space-y-1 text-meta text-fg-muted">
          {CREDITS.map((c) => (
            <li key={c.name}>
              <span className="text-fg">{c.name}</span> — {c.license}
              {c.url && <>. <button className="text-accent-ink underline" onClick={() => void call(window.api.IPC.OPEN_EXTERNAL, c.url!)}>{tr('Source code')}</button></>}
            </li>
          ))}
        </ul>
        <p className="prose-cap text-meta text-fg-muted">{osPick({ win32: trJsx('Full license texts, SHA-256 and source links for every bundled component are on the installer\'s license page and in <file/> next to the app. OpenVPN is GPL-2.0; its complete corresponding source is offered there.', { file: () => <span className="mono">THIRD-PARTY-NOTICES.txt</span> }) }, trJsx('Full license texts and source links for every bundled component are in the <file/> file published with this release.', { file: () => <span className="mono">THIRD-PARTY-NOTICES</span> }))}</p>
      </div>
      </Section>
      )}

      {/* "Restore default settings": app preferences only; the VPN service has its own Reset above. */}
      <div className="card mb-6 flex items-center justify-between gap-4 text-sm">
        <span className="text-fg-muted">{tr('Put this app\'s settings back to how they were at install. Favourites and RPC endpoints are kept.')}</span>
        <button className="btn-ghost shrink-0" data-settings-reset onClick={() => setConfirmReset(true)}>{tr('Restore default settings')}</button>
      </div>
      </div>
      </div>
      {confirmReset && (
        <ConfirmModal
          title={tr('Restore default settings?')}
          lines={['Pricing, amounts, preferred country, start-up, tray, notifications, checks, theme, background refresh and the device spending limit go back to their defaults.', 'Favourites and RPC endpoints are kept. VPN service settings are not changed.']}
          confirmLabel={tr('Restore defaults')}
          onConfirm={async () => { setSettings(await call<AppSettings>(window.api.IPC.SETTINGS_RESET)); useApp.getState().toast('success', 'App settings restored to defaults.'); }}
          onClose={() => setConfirmReset(false)}
        />
      )}
    </div>
  );
}
