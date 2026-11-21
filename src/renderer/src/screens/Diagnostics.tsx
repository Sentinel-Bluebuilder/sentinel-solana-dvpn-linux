// ─── Diagnostics (F4, F14, F19) ───
import { useEffect, useState } from 'react';
import { call } from '../lib/store';
import { Copy, PageHeader, Section, StatCell, StatStrip } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import { RestoreNetworkButton } from '../components/RestoreNetworkButton';
import type { AppSnapshot } from '../../../shared/types';
import { protocolLabel } from '../../../shared/protocols';
import { byPlatform, osPick, rendererPlatform } from '../lib/platform';
import { InstallServiceButton } from '../components/InstallServiceButton';
import { checkMark, type CheckLevel } from '../../../shared/check-level';

import type { RpcState } from '../../../core/chain/rpc';
import { tr, trPlural } from '../../../shared/i18n';

interface DoctorRow { name: string; ok: boolean; level: CheckLevel; detail: string }
interface DriverRow { name: string; found: string; status: string; detail: string }
interface DriversView { supported: boolean; live: { ok: boolean; rebootRequired: boolean; deps: DriverRow[] } | null; installer: { at: string } | null; error: string | null }

const DRIVER_NAMES = (): Record<string, string> => ({
  wireguard: 'WireGuard', amneziawg: 'AmneziaWG', openvpn: 'OpenVPN', 'openvpn-wintun': tr('OpenVPN Wintun adapter'),
  'openvpn-dco': tr('OpenVPN DCO adapter'), windows: tr('Windows (64-bit)'), 'deps.json': tr('Bundled driver list'),
  // macOS rows (the macOS app drivers check): the OS, the tool installer, the firewall and DNS backends
  macos: 'macOS 12 or newer', homebrew: 'Homebrew', pf: 'pf (kill switch)', dns: tr('DNS (networksetup)'),
  // Linux rows (the Linux app drivers check)
  linux: tr('Linux (64-bit)'), nftables: 'nftables (kill switch)', resolvectl: tr('DNS (systemd-resolved or resolv.conf)'),
  // Android rows (the Android app): the engine and the protocol programs bundled with the app
  dvpnd: tr('VPN engine'), v2ray: 'V2Ray', xray: 'Xray', hysteria2: 'Hysteria2',
});
const DRIVER_COPY = (): Record<string, string> => ({
  present: tr('Installed'), installed: tr('Installed'), upgraded: tr('Updated'), missing: tr('Not installed'),
  failed: tr('Could not install'), incompatible: tr('Wrong version'),
});

// The VPN service's check names in the app's words. `delegate` (the token approval the service spends from) read
// as a bare 'Delegate' on the 687e1af pictures (UI-187 gallery pass).
const CHECK_NAMES = (): Record<string, string> => ({
  kill_switch: tr('Kill switch state'), build: tr('VPN service build'), rpc: tr('Solana connection'), mint: tr('tDVPN token'), clock: tr('System clock'),
  key: tr('This device\'s key'), grant: tr('Spending permission'), mandate: tr('Spending permission'), delegate: tr('Spending limit'), privileges: tr('VPN service rights'), dns_backend: tr('DNS control'), kill_switch_backend: tr('Firewall control'),
  clock_skew: tr('System clock'), service_update: tr('VPN service version'), dns_servers: tr('DNS servers answer'), other_vpn: tr('Other VPN'),
});
// UI-105: results are icons with a spoken word, never text glyphs.
const LEVEL_ICON: Record<CheckLevel, IconName> = { ok: 'check', warn: 'alert', fail: 'x', skip: 'info' };
const LEVEL_WORD = (): Record<CheckLevel, string> => ({ ok: tr('Fine'), warn: tr('Needs a look'), fail: tr('Problem'), skip: tr('Not checked here') });

/** UI-104: a passed check says "Fine" (the service's own text stays as its tooltip); only a row
 *  that needs attention prints what the service reported. */
function checkDetail(r: { level: CheckLevel; detail: string }): { text: string; title?: string } {
  if (r.level === 'ok') return { text: tr('Fine'), title: r.detail || undefined };
  return { text: r.detail || LEVEL_WORD()[r.level] };
}

/** The line above the service check rows. A failed row wins: "Every check passed." over a red cross
 *  (the service program missing) told the reader the opposite of the list under it. */
export function doctorSummary(doctor: Array<{ level: CheckLevel }> | null | undefined): string {
  if (!doctor) return tr('Asking the VPN service…');
  if (doctor.some((r) => r.level === 'fail')) return tr('A check found a problem: see the rows marked with a cross.');
  if (doctor.some((r) => r.level === 'warn')) return tr('Items with a warning mark are advice: a connection type works only once its program is installed.');
  return tr('Every check passed.');
}

type Outcome = { kind: 'busy' | 'ok' | 'bad'; text: string };
const OUTCOME_ICON: Record<Outcome['kind'], IconName> = { busy: 'clock', ok: 'check', bad: 'alert' };
const OUTCOME_INK: Record<Outcome['kind'], string> = { busy: 'text-fg-muted', ok: 'text-ok', bad: 'text-bad' };

/** UI-106: every result of Repair, Update, Remove and the connection checks is one line of the same shape. */
function OutcomeLine({ o, name }: { o: Outcome | null; name: string }) {
  if (!o) return null;
  return (
    <p className="mt-2 flex items-start gap-2 text-sm" role={o.kind === 'bad' ? 'alert' : 'status'} data-outcome={name} data-outcome-kind={o.kind}>
      <Icon name={OUTCOME_ICON[o.kind]} className={`mt-0.5 ${OUTCOME_INK[o.kind]}`} /><span className="min-w-0 break-words">{o.text}</span>
    </p>
  );
}

function checkName(n: string): string {
  if (CHECK_NAMES()[n]) return CHECK_NAMES()[n];
  const m = /^service_(binaries|adapter)_(.+)$/.exec(n);
  if (m) return `${protocolLabel(m[2])} ${m[1] === 'binaries' ? 'program' : 'adapter'}`;
  // Unknown names from a newer service: sentence case like the rest ("clock skew" → "Clock skew").
  const s = n.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "https://api.devnet.solana.com/" → "api.devnet.solana.com" for a card (full URL stays in Settings). */
function rpcHost(url: string | null | undefined): string {
  if (!url) return 'none';
  try { return new URL(url).host; } catch (err) { console.warn('rpc url unreadable', err); return url; }
}

// Owner 2026-11-15: the page opens at its full size with its data in it, and never grows while it
// loads. The last results are kept for the app run and shown at once on the next visit (then
// refreshed in place); the very first visit shows rows of the same height where the results go.
const LAST: { doctor: DoctorRow[] | null; rpc: RpcState | null; drivers: DriversView | null } = { doctor: null, rpc: null, drivers: null };
const ROW = 'grid grid-cols-[1.25rem_8rem_1fr] gap-2 sm:grid-cols-[1.25rem_12rem_1fr] border-b border-line py-2 text-sm last:border-0';

/** Placeholder rows with the height of real ones, so the card has its size before the answer. */
function RowsLoading({ rows }: { rows: number }) {
  return (
    <div aria-busy="true" aria-label={tr('Checking')} data-rows-loading>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={ROW} aria-hidden>
          <span className="mt-0.5 h-4 w-4 animate-pulse rounded-full bg-bg-hover" />
          <span className="h-5 w-24 animate-pulse rounded bg-bg-hover" />
          <span className="h-5 w-16 animate-pulse rounded bg-bg-hover" />
        </div>
      ))}
    </div>
  );
}

export function Diagnostics({ snap }: { snap: AppSnapshot }) {
  const [doctor, setDoctorState] = useState<DoctorRow[] | null>(LAST.doctor);
  const [rpc, setRpcState] = useState<RpcState | null>(LAST.rpc);
  const setDoctor = (v: DoctorRow[]): void => { LAST.doctor = v; setDoctorState(v); };
  const setRpc = (v: RpcState): void => { LAST.rpc = v; setRpcState(v); };
  const [ip, setIp] = useState<Outcome | null>(null);
  const [speed, setSpeed] = useState<Outcome | null>(null);
  const [log, setLog] = useState('');
  // Audit U-11: what is running, by action name. One shared name let a 'Run again' that finished clear it while a
  // repair still ran, so Repair could be pressed again mid-repair (a second administrator prompt and installer).
  const [running, setRunning] = useState<ReadonlySet<string>>(() => new Set());
  const busy = running.size > 0;
  const isBusy = (name: string): boolean => running.has(name);
  // UI-114: what failed, by action name, shown where that action lives (never only in the console).
  const [failed, setFailed] = useState<Record<string, string>>({});

  const run = async (name: string, fn: () => Promise<void>): Promise<void> => {
    setRunning((r) => new Set(r).add(name));
    setFailed((f) => { const { [name]: _gone, ...rest } = f; return rest; });
    try { await fn(); } catch (err) { console.warn(`${name} failed`, err); setFailed((f) => ({ ...f, [name]: (err as Error).message || tr('That did not work. Try again.') })); } finally { setRunning((r) => { const n = new Set(r); n.delete(name); return n; }); }
  };
  const QUIET = { quiet: true };
  const loadDoctor = (): Promise<void> => run('doctor', async () => setDoctor(await call<DoctorRow[]>(window.api.IPC.DAEMON_DOCTOR, undefined, QUIET)));
  const loadRpc = (): Promise<void> => run('rpc', async () => setRpc(await call<RpcState>(window.api.IPC.RPC_STATE, undefined, QUIET)));
  const [drivers, setDriversState] = useState<DriversView | null>(LAST.drivers);
  const setDrivers = (v: DriversView): void => { LAST.drivers = v; setDriversState(v); };
  const [driverOut, setDriverOut] = useState<Outcome | null>(null);
  const setDriverMsg = (text: string, kind: Outcome['kind'] = 'busy'): void => setDriverOut({ kind, text });
  const loadDrivers = (): Promise<void> => run('drivers', async () => setDrivers(await call<DriversView>(window.api.IPC.DRIVERS_STATUS, undefined, QUIET)));
  const repair = (): Promise<void> => run('repair', async () => {
    setDriverMsg(osPick({
      win32: tr('Waiting for the Windows permission prompt…'),
      darwin: tr('Installing with Homebrew as you. On an Intel Mac this can take over an hour; you can keep using the app. The administrator prompt comes at the end.'),
      android: tr('Re-linking the bundled programs…'),
    }, tr('Waiting for the administrator permission prompt…')));
    // Progress lines while it runs (macOS: Homebrew, minutes to an hour); an OS that sends none keeps the text above.
    const off = window.api.on<{ line: string }>(window.api.EVENTS.DRIVERS, (p) => setDriverMsg(p.line));
    let r: { ok: boolean; error?: string; view: DriversView };
    try { r = await call<{ ok: boolean; error?: string; view: DriversView }>(window.api.IPC.DRIVERS_REPAIR, undefined, QUIET); } catch (err) { setDriverMsg((err as Error).message || tr('Repair did not finish.'), 'bad'); throw err; } finally { off(); }
    setDrivers(r.view);
    setDriverMsg(r.ok ? (r.view.live?.rebootRequired ? osPick({ win32: tr('Drivers installed. Restart Windows to finish.'), darwin: tr('Drivers installed. Restart the Mac to finish.'), android: tr('Drivers installed. Restart the phone to finish.') }, tr('Drivers installed. Restart the computer to finish.')) : osPick({ android: tr('All protocol programs are ready.') }, tr('All VPN drivers are ready.'))) : r.error ?? tr('Repair did not finish.'), r.ok ? 'ok' : 'bad');
    // Q0313: the repair's own report can be the check from before it ran, which kept "Repair
    // drivers" on screen for minutes after a good repair. A good repair re-reads the drivers now.
    if (r.ok) setDrivers(await call<DriversView>(window.api.IPC.DRIVERS_STATUS, undefined, { quiet: true }));
    void loadDoctor();
  });
  // the macOS app: the doctor row service_update says the installed service runs an older copy than this app
  // (a .dmg update replaces only the app). One administrator step reinstalls it from this app.
  const [svcOut, setSvcOut] = useState<Outcome | null>(null);
  const setSvcMsg = (text: string, kind: Outcome['kind'] = 'busy'): void => setSvcOut({ kind, text });
  const updateService = (): Promise<void> => run('update', async () => {
    setSvcMsg(tr('Waiting for the administrator permission prompt…'));
    // DAEMON_INIT returns a Result: call() gives no data on success and throws on failure (Q0313 shape).
    try {
      await call(window.api.IPC.DAEMON_INIT, { step: 'install' }, { quiet: true });
      setSvcMsg(tr('The VPN service now runs this app version.'), 'ok');
    } catch (err) { setSvcMsg((err as Error).message || tr('The update did not finish.'), 'bad'); }
    void loadDoctor();
  });
  // In-app removal of the service (the macOS app). Windows removes it with the app from Settings > Apps, so the
  // section shows on the other desktop OSes only.
  const platform = rendererPlatform();
  const canRemove = platform !== 'win32' && platform !== 'android';
  const [confirmRemove, setConfirmRemove] = useState(false);
  const removeService = (): Promise<void> => run('remove', async () => {
    setConfirmRemove(false);
    setSvcMsg(tr('Waiting for the administrator permission prompt…'));
    try {
      await call(window.api.IPC.SERVICE_UNINSTALL, undefined, { quiet: true });
      setSvcMsg(osPick({ darwin: tr('The VPN service is removed and networking is back as it was. Quit the app and drag it to the Trash to finish.') }, tr('The VPN service is removed and networking is back as it was. Remove the app itself to finish.')), 'ok');
    } catch (err) { setSvcMsg((err as Error).message || tr('Removal did not finish.'), 'bad'); }
  });
  // rc.4 E-55: a wallet switch or setup that stopped half-way leaves its files; the connect error names this
  // button. It removes only those files (manager.discardHalfFinishedSetup): the device record, the installed
  // service, the wallet and every deposit stay as they are.
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [discardOut, setDiscardOut] = useState<Outcome | null>(null);
  const discardSetup = (): Promise<void> => run('discard', async () => {
    setConfirmDiscard(false);
    try {
      const out = await call<{ removed: string[] }>(window.api.IPC.DISCARD_SETUP, undefined, QUIET);
      setDiscardOut(out.removed.length > 0
        ? { kind: 'ok', text: tr('The half-finished setup is removed. Connect again to finish setting up.') }
        : { kind: 'ok', text: tr('There was no half-finished setup left to remove.') });
    } catch (err) { setDiscardOut({ kind: 'bad', text: (err as Error).message || tr('The half-finished setup could not be removed.') }); }
    void loadDoctor();
  });
  useEffect(() => { void loadDoctor(); void loadRpc(); void loadDrivers(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const d = snap.daemon;
  return (
    <div>
      <PageHeader title={tr('Diagnostics')} subtitle={tr('Read-only checks, plus Restore network.')} />
      <StatStrip>
        <StatCell label={tr('VPN service')} value={d.reachable ? 'Running' : 'Not reachable'} hint={d.reachable ? (d.version ? tr('Version {replace}', { replace: d.version.replace(/^fork-/, '') }) : undefined) : (d.error ?? undefined)} />
        <StatCell label={tr('Network')} value={d.networkOk === false ? 'Mismatch' : d.networkOk ? 'Solana devnet' : '—'} hint={d.networkOk === false ? tr('Reinstall the VPN service') : tr('Test tokens only')} />
        {/* UI-104: "Answering", not a block number. */}
        <StatCell label={tr('Solana connection')} value={failed.rpc ? 'Not answering' : rpc?.slot ? 'Answering' : '—'} hint={rpc ? (rpc.latencyMs != null ? tr('{rpcHost} answers in {latencyMs} ms', { rpcHost: rpcHost(rpc.serving), latencyMs: rpc.latencyMs }) : rpcHost(rpc.serving)) : undefined} />
      </StatStrip>

      {/* Wide windows: service and drivers left, live checks and the log right. */}
      <div className="grid grid-cols-1 gap-x-6 xl:grid-cols-2 [&>*]:min-w-0">
      <div>
      <Section title={tr('Service check')} right={<button className="btn-ghost btn-sm" disabled={isBusy('doctor')} onClick={() => void loadDoctor()}>{tr('Run again')}</button>}>
      <div className="card" data-section="service">
        {!d.reachable && <div className="mb-3 flex items-center gap-3 text-sm" data-service-missing><span className="me-auto text-bad">{byPlatform(tr('The VPN service is not answering. If it was removed, install it again (one administrator prompt).'), tr('The VPN service is not answering. Start it again; it runs inside this app.'))}</span><InstallServiceButton /></div>}
        {/* Always there (one line of height), so a warning row arriving does not push the list down. */}
        <p className="mb-2 min-h-[16px] text-meta text-fg-muted" data-check-summary>{doctorSummary(doctor)}</p>
        {failed.doctor && <OutcomeLine name="doctor" o={{ kind: 'bad', text: 'The VPN service did not answer the check. Run it again in a moment.' }} />}
        {!doctor ? (failed.doctor ? null : <RowsLoading rows={12} />) : doctor.map((r) => (
          <div key={r.name} data-check={r.name} data-level={r.level} className={ROW}>
            <Icon name={LEVEL_ICON[r.level]} className={`mt-0.5 ${checkMark(r.level).className}`} label={LEVEL_WORD()[r.level]} />
            <span className="text-fg-dim">{checkName(r.name)}</span>
            <span className="min-w-0 break-words text-fg-dim" title={checkDetail(r).title}>{checkDetail(r).text}</span>
          </div>
        ))}
        {doctor?.some((r) => r.name === 'service_update' && !r.ok) && (
          <div className="mt-3 flex items-center gap-3">
            <button className="btn-primary btn-sm" disabled={busy} onClick={() => void updateService()}>{tr('Update the VPN service')}</button>
            <span className="text-meta text-fg-muted">{tr('This app was updated; the service still runs the old copy. One administrator prompt.')}</span>
          </div>
        )}
        <OutcomeLine name="service" o={svcOut} />
        {(snap.halfFinishedSetup || discardOut) && (
          <div className="mt-3 border-t border-line pt-3" data-half-finished-setup>
            {snap.halfFinishedSetup && <p className="mb-2 text-sm text-fg-dim">{tr('A setup on this computer stopped half-way. Removing it deletes only what that setup left behind; your wallet, your deposits and the installed VPN service stay as they are.')}</p>}
            {snap.halfFinishedSetup && (!confirmDiscard
              ? <button className="btn-ghost btn-sm" disabled={busy} onClick={() => setConfirmDiscard(true)} data-discard-setup>{tr('Remove half-finished setup')}</button>
              : <div className="flex flex-wrap items-center gap-2" data-discard-setup-confirm>
                  <span className="text-sm">{tr('Remove it? Nothing is paid or refunded by this.')}</span>
                  <button className="btn-danger btn-sm" disabled={busy} onClick={() => void discardSetup()}>{tr('Yes, remove it')}</button>
                  <button className="btn-ghost btn-sm" onClick={() => setConfirmDiscard(false)}>{tr('Cancel')}</button>
                </div>)}
            <OutcomeLine name="discard" o={discardOut} />
          </div>
        )}
      </div>
      </Section>

      {drivers?.supported !== false && (
        <Section title={byPlatform(tr('VPN drivers'), tr('Protocol programs'))} right={<>
          <button className="btn-ghost btn-sm" disabled={isBusy('drivers') || isBusy('repair')} onClick={() => void loadDrivers()}>{tr('Check again')}</button>
          {drivers?.live && !drivers.live.ok && <button className="btn-primary btn-sm" disabled={busy} onClick={() => void repair()}>{byPlatform('Repair drivers', 'Repair')}</button>}
        </>}>
        <div className="card">
          {!drivers ? <RowsLoading rows={7} /> : drivers.live ? drivers.live.deps.map((r) => {
            const good = r.status === 'present' || r.status === 'installed' || r.status === 'upgraded';
            return (
              <div key={r.name} data-driver={r.name} className="grid grid-cols-[1.25rem_8rem_1fr] gap-2 sm:grid-cols-[1.25rem_12rem_1fr] border-b border-line py-2 text-sm last:border-0">
                <Icon name={good ? 'check' : 'x'} className={`mt-0.5 ${good ? 'text-ok' : 'text-bad'}`} label={good ? tr('Fine') : tr('Problem')} />
                <span className="text-fg-dim">{DRIVER_NAMES()[r.name] ?? r.name}</span>
                <span className="min-w-0 break-words text-fg-dim">{DRIVER_COPY()[r.status] ?? r.status}{r.found ? ` (version ${r.found})` : ''}{r.detail ? `: ${r.detail}` : ''}</span>
              </div>
            );
          }) : <OutcomeLine name="drivers-read" o={{ kind: 'bad', text: drivers.error ?? 'The drivers could not be checked.' }} />}
          {failed.drivers && <OutcomeLine name="drivers-read" o={{ kind: 'bad', text: failed.drivers }} />}
          <OutcomeLine name="drivers" o={driverOut} />
          <p className="mt-2 text-meta text-fg-muted">{byPlatform(tr('WireGuard, AmneziaWG and OpenVPN carry those protocols; V2Ray, Xray and Hysteria2 ship inside the app. Repair installs only what is missing.'), tr('All six protocols ship inside the app: WireGuard and AmneziaWG run in the VPN engine, the others as bundled programs. Repair re-links any that are missing.'))}</p>
        </div>
        </Section>
      )}
      </div>

      <div>
      <Section title={tr('Connection checks')}>
      <div className="card">
        <div className="mb-3 flex flex-wrap gap-2">
          <button className="btn-ghost" disabled={busy} onClick={() => void run('ip', async () => {
            setIp({ kind: 'busy', text: 'Checking your public address…' });
            try {
              const r = await call<{ ip?: string; source?: string; error?: string }>(window.api.IPC.QUALITY_IP, undefined, QUIET);
              setIp(r.error ? { kind: 'bad', text: r.error } : { kind: 'ok', text: `Your public address is ${r.ip} (seen by ${r.source}).${snap.session ? ' While connected it should be the server’s address.' : ''}` });
            } catch (err) { setIp({ kind: 'bad', text: (err as Error).message || 'Your public address could not be read.' }); }
          })}>{tr('Check my IP')}</button>
          <button className="btn-ghost" disabled={busy} onClick={() => void run('speed', async () => {
            setSpeed({ kind: 'busy', text: 'Measuring download speed…' });
            try {
              const r = await call<{ mbps?: number; source?: string; error?: string }>(window.api.IPC.QUALITY_SPEED, undefined, QUIET);
              setSpeed(r.error ? { kind: 'bad', text: r.error } : { kind: 'ok', text: `Download speed: ${r.mbps} Mbps (measured against ${r.source}).` });
            } catch (err) { setSpeed({ kind: 'bad', text: (err as Error).message || 'The speed could not be measured.' }); }
          })}>{tr('Speed test')}</button>
          <button className="btn-ghost" disabled={busy} onClick={() => void loadRpc()}>{tr('Check Solana connection')}</button>
          <span className="ms-auto" data-section="network"><RestoreNetworkButton /></span>
        </div>
        <OutcomeLine name="ip" o={ip} />
        <OutcomeLine name="speed" o={speed} />
        {failed.rpc && <OutcomeLine name="rpc" o={{ kind: 'bad', text: tr('Solana did not answer. Check your internet connection, or set another address in Settings.') }} />}
        {failed.log && <OutcomeLine name="log" o={{ kind: 'bad', text: tr('The log could not be read.') }} />}
        {rpc && rpc.benched.length > 0 && <p className="text-sm text-warn">{trPlural({ one: '{count} busy Solana address is skipped for now.', other: '{count} busy Solana addresses are skipped for now.' }, rpc.benched.length, { count: rpc.benched.length })}</p>}
        <p className="mt-2 text-meta text-fg-muted">{tr('Restore network ends any session and removes kill-switch rules and system-proxy settings this app made.')}</p>
      </div>
      </Section>

      <Section title={tr('App log')} right={<>
        <button className="btn-ghost btn-sm" onClick={() => void run('log', async () => setLog(await call<string>(window.api.IPC.LOG_TAIL, undefined, QUIET)))}>{tr('Load')}</button>
        {log && <Copy text={log} label={tr('Copy log')} />}
      </>}>
      <div className="card">
        {log ? <pre className="mono max-h-80 overflow-auto whitespace-pre-wrap rounded bg-bg-input p-3">{log}</pre> : <p className="text-meta text-fg-muted">{tr('Secrets and API keys are removed from the log.')}</p>}
      </div>
      </Section>
      {canRemove && (
      <Section title={osPick({ darwin: tr('Remove from this Mac') }, tr('Remove from this computer'))}>
      <div className="card">
        <p className="mb-3 text-sm text-fg-dim">{tr('Ends any session, puts the system proxy, DNS and firewall back, and removes the VPN service, its tools and the devnet-dvpn command. The device key stays, so a reinstall keeps its spending limit. One administrator prompt; then remove the app itself.')}</p>
        {!confirmRemove
          ? <button className="btn-ghost" disabled={busy} onClick={() => setConfirmRemove(true)}>{tr('Remove the VPN service…')}</button>
          : <div className="flex gap-2"><button className="btn-danger" disabled={busy} onClick={() => void removeService()}>{tr('Yes, remove it')}</button><button className="btn-ghost" onClick={() => setConfirmRemove(false)}>{tr('Cancel')}</button></div>}
      </div>
      </Section>
      )}
      </div>
      </div>
    </div>
  );
}
