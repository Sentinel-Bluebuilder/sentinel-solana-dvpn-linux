/** C-CLOCK: the doctor's clock row; clockSkewSec = local time minus the chain's block time (null: not read). */
async function clockDoctorRow(): Promise<{ name: string; ok: boolean; level: 'ok' | 'fail' | 'skip'; detail: string; clockSkewSec: number | null }> {
  let skew: number | null = null;
  try {
    skew = await chainClockSkew();
  } catch (err) {
    log.warn(`daemon doctor: clock not read: ${(err as Error).message}`);
  }
  if (skew === null) return { name: 'clock', ok: true, level: 'skip', detail: 'could not read the chain time (RPC)', clockSkewSec: null };
  const b = clockSkewBlocker(skew);
  return b
    ? { name: 'clock', ok: false, level: 'fail', detail: `${b.error} Fix: ${CLOCK_NEXT_DOCTOR()}`, clockSkewSec: skew }
    : { name: 'clock', ok: true, level: 'ok', detail: `${skew} s from the chain (servers refuse past ${CLOCK_SKEW_REFUSE_S} s)`, clockSkewSec: skew };
}
const CLOCK_NEXT_DOCTOR = (): string => process.platform === 'win32' ? 'Start-Service w32time; w32tm /resync /force (elevated PowerShell)' : process.platform === 'darwin' ? 'sudo sntp -sS time.apple.com' : 'sudo timedatectl set-ntp true && (sudo chronyc makestep 2>/dev/null || true)';

/** U1-O: the elevated install (PowerShell; Windows asks for an administrator's name and password). */
export const NEEDS_ADMIN_NEXT = `Start-Process ${CLI_NAME} -Verb RunAs -ArgumentList 'daemon install --yes'`;

// ─── `daemon` — the VPN service: version, doctor, drivers, init, install, settings, restore ───
// Split from commands.ts (500-line rule); same services as the app's Diagnostics + Settings.
import { cliErr, CLI_NAME, INIT_NEXT, installNotReadyNext, restoreDeadNext } from './cli-fail';
import fs from 'node:fs';
import { str, UsageError } from './args';
import { confirm, need, walletRead, type Cmd } from './commands';
import { restoreNetwork, adoptRunningSession } from '../main/services/connection';
import { snapshot } from '../main/app-state';
import { driversStatus, repairDrivers, driverLines, DRIVER_LABELS, type DriverReport } from '../main/system/drivers';
import { daemon, daemonInfo, deviceRecord, dvpndPath, runDoctor, initDevice, installService, uninstallService, linuxUnits, SERVICE_NAME } from '../main/daemon/manager';
import { linuxDoctorRows } from '../core/daemon/linux-unit';
import { readOtherWallet, switchNeeded, SWITCH_NEXT, switchAlsoNext } from './wallet-mismatch';
import { ksRemoteCheck, KS_REMOTE_FLAG } from './remote-session';

/** rc9-d: a doctor detail in ASCII (arrows and dashes become their ASCII forms; anything else non-ASCII is dropped). */
export const asciiDetail = (s: string): string => String(s ?? '').replace(/[\u2192\u279c]/g, '>').replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\u2026/g, '...').replace(/[^\x20-\x7e\n\t]/g, '');
import { isAndroid } from '../shared/is-android';
import { runHomeMigration } from '../main/daemon/migrate-run';
import { log } from '../main/logger';
import { EMPTY_SETTINGS_COPY, getDaemonSettings } from '../main/daemon/settings';
import { checkMark } from '../shared/check-level';
import { applyServiceSettings, settingsProblem } from '../main/services/daemon-apply';
import { dnsDoctorRow, probeDns, dnsProbeProblem } from '../main/system/dns-probe';
import { rivalVpnRow } from '../main/system/tunnels';
import { isAdminAccount } from '../main/system/admin-check';
import { ownerAddress } from '../main/wallet/vault';
import { DNS_PRESETS, validateSettings, redactRpcUrl, type DaemonSettings, type SplitMode } from '../core/daemon/config';
import { tdvpn } from '../core/chain/amounts';
import { chainClockSkew, clockSkewBlocker, CLOCK_SKEW_REFUSE_S } from '../core/chain/clock';
import { boolFlag, escrowFlag, wholeFlag, FlagError } from '../core/daemon/flags';

/** Flag errors are usage errors (exit 3), raised before anything is asked or applied. */
/** Valid values for every field: used only to check the given flags when no config can be read. */
const VALIDATION_BASE: DaemonSettings = {
  killSwitch: 'off', basis: 'per_gb', dnsServers: ['1.1.1.1'], escrow: '1', prepayBytes: '0', prepaySeconds: '0',
  rpcUrl: 'https://api.devnet.solana.com', rpcWsUrl: 'wss://api.devnet.solana.com',
} as DaemonSettings;

function flagged<T>(fn: () => T): T {
  try { return fn(); } catch (err) { if (err instanceof FlagError) throw new UsageError(err.message); throw err; }
}

/** --whole-device: parsed here; whether this service can do it is checked by the shared settingsProblem (Q0508). */
function wholeDeviceFlag(v: string): boolean {
  return boolFlag('whole-device', v);
}

/** The daemon set confirm echo with the RPC gate token masked; the caller keeps the real settings (FMC-M6). */
export function redactSettingsForDisplay(s: DaemonSettings): DaemonSettings {
  return { ...s, ...(s.rpcUrl ? { rpcUrl: redactRpcUrl(s.rpcUrl) } : {}), ...(s.rpcWsUrl ? { rpcWsUrl: redactRpcUrl(s.rpcWsUrl) } : {}) };
}

// Which servers a missing driver stops (blind round 2: a bare "run repair-drivers" when only AmneziaWG was
// missing read as "nothing works"). V2Ray, Xray and Hysteria2 need none of these drivers.
const DRIVER_PROTOCOLS: Record<string, string> = {
  wireguard: 'WireGuard', amneziawg: 'AmneziaWG', openvpn: 'OpenVPN', 'openvpn-wintun': 'OpenVPN', 'openvpn-dco': 'OpenVPN',
};

/** The line after `daemon drivers` when something is missing: what it affects, then the fix. Exported for tests. */
export function driversMissingTail(r: DriverReport): string {
  // Same rule as driverLines: missing, failed and incompatible are not ready.
  const bad = r.deps.filter((d) => d.status === 'missing' || d.status === 'failed' || d.status === 'incompatible');
  const names = bad.map((d) => DRIVER_LABELS[d.name] ?? d.name);
  const protos = [...new Set(bad.map((d) => DRIVER_PROTOCOLS[d.name]))];
  // 'Some drivers are missing' stays first: vm-installer-test.ps1:311 and vm-arm-i6.ps1:25 match it.
  if (!names.length) return 'Some drivers are missing: run "daemon repair-drivers --yes".';
  if (protos.some((p) => !p)) return `Some drivers are missing: ${names.join(', ')}. No server can be used until it is fixed: run "daemon repair-drivers --yes".`;
  const list = protos.length > 1 ? `${protos.slice(0, -1).join(', ')} and ${protos[protos.length - 1]}` : protos[0];
  return `Some drivers are missing: ${names.join(', ')}. Only ${list} servers need it; the others work now. To fix it: "daemon repair-drivers --yes".`;
}

/** The service answers GetVersion within 8 s. */
async function serviceAnswers(): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), 8_000); });
  const asked = Promise.resolve().then(() => daemon().getVersion()).then(() => true, (err) => {
    log.info('doctor: the VPN service did not answer', { err: (err as Error).message });
    return false;
  });
  try { return await Promise.race([asked, late]); } finally { if (timer) clearTimeout(timer); }
}

export const daemonCmd: Cmd = async (a, o) => {
  const sub = a._[1] ?? 'version';
  if (sub === 'version') {
    const v = await daemon().getVersion();
    o.print(`${v.tag || v.commit}  network ${v.network}  program ${v.programId}  mint ${v.mint}  ${daemonInfo().networkOk ? 'OK' : 'MISMATCH'}`, { ...v, networkOk: daemonInfo().networkOk });
  } else if (sub === 'doctor') {
    const [rows0, rival] = await Promise.all([runDoctor(), rivalVpnRow()]);
    // T-C row 17 (RC8 W47): dvpnd passed its root-only rows "because it is running" while the service was stopped.
    // On Linux the unit pair is read and the socket must answer: a stopped service is a fail row with its start command.
    const rows = process.platform === 'linux' && !isAndroid()
      ? linuxDoctorRows(rows0, await linuxUnits(), await serviceAnswers(), SERVICE_NAME) as typeof rows0
      : rows0;
    const dnsRow = await dnsDoctorRow(getDaemonSettings().settings.dnsServers ?? []);
    if (dnsRow) rows.push(dnsRow);
    // C-CLOCK (the agent kit rc.8): this computer's clock against the chain's (servers refuse past CLOCK_SKEW_REFUSE_S).
    rows.push(await clockDoctorRow());
    // Other VPN adapters are a desktop check; Android has none to compete with.
    if (!isAndroid()) rows.push(rival);
    // rc9-d: a service set up for another wallet fails its preflight ("grant") however often it restarts: say why.
    const otherW = readOtherWallet(ownerAddress());
    if (otherW) rows.unshift({ name: 'service wallet', ok: false, level: 'fail', detail: `set up for another wallet (${otherW}), not the loaded one: it cannot start a session for this wallet. Run: ${SWITCH_NEXT} (${switchAlsoNext(otherW)})`, code: 'wallet-switch-needed', next: SWITCH_NEXT } as (typeof rows)[number]);
    // rc9-d (review over SSH): ASCII only, as the payer line: a non-ASCII arrow reached the agent as mojibake.
    for (const r of rows) r.detail = asciiDetail(r.detail);
    o.print(rows.map((r) => `${checkMark(r.level).label}  ${r.name.padEnd(28)} ${r.detail}`).join('\n'), rows);
  } else if (sub === 'drivers') {
    const v = await driversStatus();
    if (!v.supported) { o.print('VPN drivers cannot be checked on this system.', v); return; }
    if (!v.live) throw cliErr('driver-missing', `${CLI_NAME} daemon repair-drivers --yes`, v.error ?? 'driver check failed');
    const tail = v.live.ok ? 'All VPN drivers are ready.' : driversMissingTail(v.live);
    o.print([...driverLines(v.live), tail].join('\n'), v);
  } else if (sub === 'repair-drivers') {
    confirm(a, o, isAndroid()
      ? 'Re-link the protocol programs bundled with the app. The VPN engine restarts only if one is missing.'
      : process.platform === 'darwin'
      ? 'Install or repair WireGuard, AmneziaWG and OpenVPN with Homebrew, as you (one administrator prompt at the end, to hand the tools to the service). Tools already installed are left alone. On an Intel Mac this can take over an hour.'
      : process.platform === 'linux'
        ? 'Install or repair WireGuard, AmneziaWG, OpenVPN and nftables with the system package manager (apt, dnf or pacman; one administrator prompt). Tools already installed are left alone.'
        : 'Install or repair WireGuard, AmneziaWG and OpenVPN 2.6 (one administrator prompt). Drivers already installed are left alone.');
    // Progress lines (macOS Homebrew runs for minutes) go to stderr so --json stays clean.
    const r = await repairDrivers((line) => process.stderr.write(`… ${line}\n`));
    const lines = r.view.live ? driverLines(r.view.live) : [];
    if (!r.ok) throw cliErr('driver-repair-failed', `${CLI_NAME} daemon doctor --json`, [r.error, ...lines].join('\n'));
    o.print([...lines, 'All VPN drivers are ready.'].join('\n'), r);
  } else if (sub === 'init') {
    const owner = ownerAddress();
    if (!owner) throw cliErr('no-wallet', `${CLI_NAME} wallet create --keyfile <path> --yes, then fund the address it prints`, 'Create or import a wallet first: the device key is made for a wallet. Nothing was paid.'); // AUD-2 M10
    const r = await initDevice(owner);
    if (!r.ok) throw cliErr('no-device-key', `${CLI_NAME} daemon doctor --json`, r.error ?? 'The service step failed with no message. Nothing was paid.');
    // Android: the engine runs inside the app, so there is no service to install.
    o.print(`Device ${r.device} created for this wallet. Next: ${INIT_NEXT}${isAndroid() ? '' : `, then ${CLI_NAME} daemon install --yes`}`, { ...r, next: INIT_NEXT });
  } else if (sub === 'migrate') {
    // Run by the installer (already elevated) on an update from a pre-cb33 build; safe to repeat.
    confirm(a, o, 'Move the VPN service home of an older version to the new layout (same device key, same settings). Needs administrator rights.');
    const legacy = str(a, 'legacy-dvpnd');
    const r = await runHomeMigration({ dvpnd: dvpndPath(), ...(legacy ? { legacyDvpnd: legacy } : {}) });
    if (r.status === 'failed') throw cliErr('migrate-failed', `${CLI_NAME} daemon doctor --json`, `Upgrade of the VPN service home stopped at "${r.step}": ${r.error}\n${r.log.join('\n')}`);
    if (r.status === 'skipped') { o.print(`Nothing to move (${r.reason}).`, r); return; }
    o.print([...r.log, `Moved ${r.from} -> ${r.to}.`].join('\n'), r);
  } else if (sub === 'install') {
    // U1-O (the agent kit rc.9): a standard user learns it first, not after the wallet and device checks (review rc.8).
    if (isAdminAccount() === false) throw cliErr('needs-admin', NEEDS_ADMIN_NEXT, 'Installing the VPN service needs an administrator, and this Windows account is a standard user. Run the command below: Windows asks for an administrator\'s name and password. Nothing was paid.');
    if (!ownerAddress()) throw cliErr('no-wallet', `${CLI_NAME} wallet create --keyfile <path> --yes, then fund the address it prints`, 'Create or import a wallet, then run "device setup --yes": the service will not start without a funded, permitted device.');
    // rc9-d: installing again cannot make the service pay for another wallet (its preflight fails on "grant").
    const otherW = readOtherWallet(ownerAddress());
    if (otherW) throw switchNeeded(otherW, ownerAddress()!);
    // Offline repair (port of the macOS app 0790fc2): when the balances cannot be read but this wallet already
    // set up a device here, the service is reinstalled anyway (it needs no network to start).
    let w: Awaited<ReturnType<typeof walletRead>> | null = null;
    try {
      w = await walletRead();
    } catch (readErr) {
      if (deviceRecord()?.owner !== ownerAddress()) throw readErr;
      log.warn('daemon install: balances unreadable, repairing for the recorded device', { err: (readErr as Error).message });
    }
    // AUD-1: with no device key here, init comes first (device setup alone refuses: no-device-key).
    if (w && !w.ready) { const hasKey = !!deviceRecord()?.device; throw cliErr('device-not-ready', installNotReadyNext(hasKey), `${hasKey ? 'Run "device setup --yes" first' : 'Run "daemon init --yes", then "device setup --yes" first'}: the service will not start without a funded, permitted device.`); }
    confirm(a, o, 'Install (or update to this app version) and start the VPN service (one administrator prompt). With kill switch on, a stopped session blocks internet until you disconnect or restore network.');
    const r = await installService();
    // WIN-W4: RunAs could not show a prompt here (no desktop): a person's step, not a failed install.
    if (!r.ok && r.code === 'needs-admin') throw cliErr('needs-admin', `open PowerShell with "Run as administrator" (or SSH in as an administrator), then ${CLI_NAME} daemon install --yes`, r.error ?? 'An administrator is needed. Nothing was changed.');
    // STAGING-MISSING (rc9-d): installed, nothing staged: agent status names the real way on (start, switch, agent up).
    if (!r.ok && r.code === 'service-installed') throw cliErr('service-installed', `${CLI_NAME} agent status --json`, r.error ?? 'The VPN service is already installed. Nothing was paid.');
    if (!r.ok) throw cliErr('install-failed', `${CLI_NAME} daemon doctor --json`, r.error ?? 'The service step failed with no message. Nothing was paid.');
    // relogin: Windows grants the pipe at the next sign-in; waitingForNetwork: macOS' service waits for a network first.
    const waiting = (r as { waitingForNetwork?: boolean }).waitingForNetwork === true;
    o.print(r.data?.relogin
      ? 'Service installed and running. One more step: sign out of Windows and sign back in; this account can use the service from its next sign-in.'
      : waiting ? 'Service installed. It starts by itself once the network is back (it retries every minute).' : 'Service installed and running.', { ...r, next: r.data?.relogin ? `sign out of Windows and sign back in, then ${CLI_NAME} agent status --json` : `${CLI_NAME} agent status --json` });
  } else if (sub === 'settings') {
    const s = getDaemonSettings();
    // Same units as the flags: escrow in tDVPN, prepay in MB / minutes.
    const human = (k: string, v: unknown): string => {
      if (Array.isArray(v)) return v.join(', ');
      if (k === 'split' && v && typeof v === 'object') {
        const sp = v as { mode: string; apps: string[]; routes: string[] };
        return sp.mode === 'off' ? 'off' : `${sp.mode}  apps: ${sp.apps.join('; ') || 'none'}  routes: ${sp.routes.join(', ') || 'none'}`;
      }
      // Not what this app/CLI pays: connect sizes the deposit from the node price (UI session 2026-10-22).
      if (k === 'escrow') return `${tdvpn(String(v))} tDVPN (fallback for dvpnd-only sessions; connect sizes its own deposit)`;
      if ((k === 'prepayBytes' || k === 'prepaySeconds') && String(v) === '0') return "the node's minimum";
      if (k === 'prepayBytes') return `${Number(v) / 1e6} MB`;
      if (k === 'prepaySeconds') return `${Number(v) / 60} min`;
      if (k === 'rpcUrl' || k === 'rpcWsUrl') return redactRpcUrl(String(v)); // FMC-M6: never echo a gate token
      return String(v);
    };
    // Unset values are left out (they printed "split undefined"; the Android app v7), and so are the desktop-only split
    // and whole-device rows on Android (the VPN service applies split there: `split show`).
    const desktopOnly = new Set(['split', 'wholeDevice']);
    const shown = Object.entries(s.settings).filter(([k, v]) => v !== undefined && !(isAndroid() && desktopOnly.has(k)));
    // --json too: the stored RPC can carry a gate token (FMC-M6); the Linux app printed it raw in JSON before rpc-shown.ts.
    const redacted = { ...s, settings: { ...s.settings, ...(s.settings.rpcUrl ? { rpcUrl: redactRpcUrl(String(s.settings.rpcUrl)) } : {}), ...(s.settings.rpcWsUrl ? { rpcWsUrl: redactRpcUrl(String(s.settings.rpcWsUrl)) } : {}) } };
    o.print(s.readable ? shown.map(([k, v]) => `${k.padEnd(14)} ${human(k, v)}`).join('\n') : s.empty ? EMPTY_SETTINGS_COPY : 'Service settings are not readable as this user.', redacted);
  } else if (sub === 'set') {
    // Android: apps and addresses are chosen with `split set` / `split routes` (the VPN service), and
    // every protocol already covers the whole phone; the desktop flags would mean nothing there.
    if (isAndroid()) for (const k of ['whole-device', 'split-mode', 'split-apps', 'split-routes']) {
      if (str(a, k) !== undefined) throw new UsageError(`--${k} is for the desktop app; on Android use: split set / split routes`);
    }
    const cur = getDaemonSettings();
    // Q0544: an empty settings copy is refused before anything is built from it (the flags were checked against
    // nothing: '--kill-switch on' said 'Basis must be per_gb or per_hour.').
    if (cur.empty) throw cliErr('daemon-settings-empty', `${CLI_NAME} daemon install --yes`, EMPTY_SETTINGS_COPY);
    // rc9-e H: from an SSH / Remote Desktop session the kill switch is not turned on without --allow-remote-lockout
    // (after a lost session it blocks every new connection to this computer at every boot). Before the prompt.
    const ksRemote = ksRemoteCheck(str(a, 'kill-switch'), a.flags[KS_REMOTE_FLAG] === true);
    if (ksRemote) throw ksRemote;
    const dns = str(a, 'dns');
    // Q0478 (FMC-M7 port): enforce the RPC https rule only when the user actually sets --rpc/--rpc-ws;
    // otherwise skip it so a KS/DNS-only set does not die re-validating a stored (http gate) RPC.
    const rpcTouched = !!(str(a, 'rpc') || str(a, 'rpc-ws'));
    if (dns && !DNS_PRESETS[dns] && /[g-z]/i.test(dns)) throw new UsageError(`unknown DNS preset "${dns}": use ${Object.keys(DNS_PRESETS).join(', ')} or IP addresses`);
    const next = {
      ...cur.settings,
      ...(str(a, 'kill-switch') ? { killSwitch: str(a, 'kill-switch') } : {}),
      ...(str(a, 'allow-lan') ? { allowLan: flagged(() => boolFlag('allow-lan', str(a, 'allow-lan')!)) } : {}),
      // V2Ray/Xray: whole computer through a TUN adapter (true) or only apps using the SOCKS proxy (false).
      ...(str(a, 'whole-device') ? { wholeDevice: flagged(() => wholeDeviceFlag(str(a, 'whole-device')!)) } : {}),
      ...(dns ? { dnsServers: DNS_PRESETS[dns]?.servers ?? dns.split(',').map((x) => x.trim()) } : {}),
      // netsh / networksetup / resolvectl = set the VPN's DNS during a session; none = never touch system DNS.
      ...(str(a, 'dns-mode') ? { dnsMode: str(a, 'dns-mode') } : {}),
      ...(str(a, 'basis') ? { basis: str(a, 'basis') } : {}),
      ...(str(a, 'rpc') ? { rpcUrl: str(a, 'rpc'), rpcWsUrl: str(a, 'rpc')!.replace(/^https:/, 'wss:') } : {}),
      ...(str(a, 'rpc-ws') ? { rpcWsUrl: str(a, 'rpc-ws') } : {}),
      ...(str(a, 'escrow') ? { escrow: flagged(() => escrowFlag(str(a, 'escrow')!)) } : {}),
      ...(str(a, 'prepay-mb') ? { prepayBytes: flagged(() => wholeFlag('prepay-mb', str(a, 'prepay-mb')!, 1_000_000n)) } : {}),
      ...(str(a, 'prepay-minutes') ? { prepaySeconds: flagged(() => wholeFlag('prepay-minutes', str(a, 'prepay-minutes')!, 60n)) } : {}),
    } as DaemonSettings;
    // Split tunnelling: --split-mode off|include|exclude, --split-apps "<path>;<path>" (or none; `split apps` lists them),
    // --split-routes "10.0.0.0/8,1.2.3.4/32" (or none). Unset flags keep the current values.
    // Agent M (the macOS app KSM10): '--split-apps A,B' became ONE path that names no app, so include mode covered nothing
    // while the user believed two apps were protected. Apps are separated with ';' (a path may hold a comma, so
    // a comma is only refused when no ';' is given and the whole value is not an existing file).
    const appsArg = str(a, 'split-apps');
    if (appsArg && appsArg !== 'none' && !appsArg.includes(';') && appsArg.includes(',') && !fs.existsSync(appsArg)) {
      throw new UsageError('--split-apps: separate apps with ";", not commas (for example "<app 1>;<app 2>").');
    }
    if (str(a, 'split-mode') || str(a, 'split-apps') || str(a, 'split-routes')) {
      const list = (v: string | undefined, sep: string, cur: string[]): string[] =>
        v === undefined ? cur : v === 'none' ? [] : v.split(sep).map((x) => x.trim()).filter(Boolean);
      // Per-app split needs a capable service; refused by the shared settingsProblem below, same words as the app (Q0508).
      const cur = next.split ?? { mode: 'off' as const, apps: [], routes: [] };
      next.split = {
        mode: (str(a, 'split-mode') ?? cur.mode) as SplitMode,
        apps: list(str(a, 'split-apps'), ';', cur.apps),
        routes: list(str(a, 'split-routes'), ',', cur.routes),
      };
    }
    // No readable service config: still refuse bad values first (exit 3), checked against a valid
    // baseline, then say what is wrong. A clean Win11 VM said "not readable as this user" for a
    // service that was never set up, and refused nothing (vm-phase2 settings-e2e, 2026-10-22).
    if (!cur.readable) {
      try { validateSettings({ ...VALIDATION_BASE, ...next }, { skipRpc: !rpcTouched }); } catch (err) { throw new UsageError((err as Error).message); }
      throw cliErr(cur.missing ? 'daemon-missing' : 'daemon-settings-unreadable', `${CLI_NAME} daemon install --yes`, cur.missing
        ? 'The VPN service is not set up on this computer yet. Finish device setup in the app (or run: devnet-dvpn daemon install), then change its settings.'
        : 'Service settings are not readable as this user.');
    }
    // A DNS choice that does not answer gives a session with no names (Handshake preset, 2026-10-22).
    if (dns) { const p = dnsProbeProblem(await probeDns(next.dnsServers ?? [])); if (p) process.stderr.write(`warning: ${p}\n`); }
    // Validate before asking for --yes: a bad value must never reach the elevated step. The SAME checks and
    // words as the app's Apply buttons (Q0508 F4): settingsProblem in services/daemon-apply.ts.
    const problem = settingsProblem(next, cur.settings, process.platform, () => daemonInfo().version);
    if (problem) throw new UsageError(problem.error);
    // Applying restarts dvpnd, which ends a live session (the app's Settings says so too). Say so
    // before and after: a silent end looked like a tunnel leak (F-C2-1, ported from mac 4378d68a).
    await adoptRunningSession();
    const live = !!snapshot().session;
    // FMC-M6: redact a gate token in rpcUrl/rpcWsUrl for the echo only; the real `next` is applied below.
    const shownNext = redactSettingsForDisplay(next);
    confirm(a, o, `${isAndroid() ? 'Apply these settings and restart the VPN engine' : 'Apply service settings and restart it (one administrator prompt)'}${live ? '. This ENDS the current VPN session; connect again after' : ''}:\n${JSON.stringify(shownNext, null, 2)}`);
    // Q0508: the one apply path the app's buttons use too (lock, checks, session end, system proxy back).
    const r = await applyServiceSettings(next);
    // A16 (rc9-c2): the apply's own code (apply-busy, apply-while-connecting, apply-failed) reaches the agent.
    if (!r.ok) throw r.code === 'invalid-daemon-setting' ? new UsageError(r.error ?? 'Invalid setting.') : cliErr(r.code ?? 'apply-failed', `${CLI_NAME} agent status --json`, r.error ?? 'Applying the service settings failed.');
    o.print(r.sessionEnded ? 'Applied and restarted. The VPN session ended with the restart: connect again.' : 'Applied and restarted.', r);
  } else if (sub === 'dns-check') {
    // Same probe as the Settings DNS picker: --dns preset|ip,ip, or the service's current servers.
    const dns = str(a, 'dns');
    if (dns && !DNS_PRESETS[dns] && /[g-z]/i.test(dns)) throw new UsageError(`unknown DNS preset "${dns}": use ${Object.keys(DNS_PRESETS).join(', ')} or IP addresses`);
    const servers = dns ? DNS_PRESETS[dns]?.servers ?? dns.split(',').map((x) => x.trim()) : getDaemonSettings().settings.dnsServers ?? [];
    const rows = await probeDns(servers);
    const problem = dnsProbeProblem(rows);
    o.print(rows.map((r) => `${r.server.padEnd(16)} ${r.ok ? `answers (${r.ms} ms)` : 'no answer'}`).join('\n') || 'No DNS servers set.', { rows, problem });
    if (problem) throw cliErr('dns-no-answer', `${CLI_NAME} daemon doctor --json`, problem); // exit 1: scripts can gate on it
  } else if (sub === 'restore-network') {
    const r = await restoreNetwork();
    // RESTORE-DEAD-NEXT (the agent kit rc.9): never ok and never next:null while the service is dead (it may still hold the block).
    if (!r.ok && r.code === 'daemon-unavailable') throw cliErr('daemon-unavailable', restoreDeadNext(), r.error ?? 'The VPN service is not answering.');
    need(r);
    o.print('Network restored.', r);
  } else if (sub === 'uninstall') {
    // In-app removal (the macOS app): each OS's manager does it (Windows: removed with the app, says so).
    confirm(a, o, 'Remove the VPN service from this computer (one administrator prompt): ends any session, puts the system proxy, DNS and firewall back and removes the service and its tools. The device key stays.');
    const r = await uninstallService();
    if (!r.ok) throw cliErr('uninstall-failed', `${CLI_NAME} daemon doctor --json`, r.error ?? 'The service step failed with no message. Nothing was paid.');
    o.print('Service removed. Remove the app itself to finish.', r);
  } else throw new UsageError(`unknown: daemon ${sub}`);
};
