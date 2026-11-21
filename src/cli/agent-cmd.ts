// ─── `agent up | down | status`: the three commands an AI agent needs (the agent kit Agentic Privacy) ───
// Thin on purpose: no new service code. `up` filters the probed node list (refreshNodes/nodeViews,
// as `nodes list` does), picks with pickQuickNode (as connect-on-launch does) and calls connect()
// exactly as `connect` does; `down` is `disconnect` + `settle run`; `status` reads what `status`
// reads. Every answer is ONE object with `next`: the exact command, or the funding, to do next.
// A failure carries its next command as `action`: index.ts prints it as the "→" hint and keeps it
// unchanged on the JSON error line (cliActionHint returns an unmapped action as is).
import { str, whole, flag, UsageError, type Args, requireValues } from './args';
import { confirm, disconnectCmd, type Cmd } from './commands';
import { within, internetProbe, STATUS_NET_BUDGET_MS, reconnectBlockedNext, RECONNECT_BLOCKED_ALSO } from './status-cmd';
import { cliActionHint, isLimitShort } from './action-hint';
import { snapshot } from '../main/app-state';
import { runJobNow } from '../main/scheduler';
import { deviceSetup, refreshWallet } from '../main/services/wallet';
import { refreshNodes, nodeViews } from '../main/services/nodes';
import { connect, adoptRunningSession, sessionStateUnknown } from '../main/services/connection';
import { readSettlements, runSettlement } from '../main/services/settlement';
import { refreshSubscriptions, roster } from '../main/services/plans';
import { daemonInfo, initDevice, deviceRecord, linuxUnits, SERVICE_NAME } from '../main/daemon/manager';
import { stoppedStartNext } from '../core/daemon/linux-unit';
import { ksRemoteRiskFields } from './remote-session';
import { readOtherWallet, switchNeeded, SWITCH_NEXT, switchAlsoNext, switchMessage } from './wallet-mismatch';
import { rivalVpns } from '../main/system/tunnels';
import { getSettings } from '../main/system/settings';
import { serviceUsesTun, getDaemonSettings } from '../main/daemon/settings';
import { loadHomeIp } from '../main/home-ip';
import { writeAgentMarker } from '../main/services/agent-marker';
import { ownerAddress, noWallet } from '../main/wallet/vault';
import { payerNote } from './payer';
import { recentFailed, recordFailed, clearFailed, serverFailed, withoutFailed, skippedNote } from './last-failed';
import { exitIsDirect, stoppedReason, depositSafe, depositRows, depositNext, SERVER_STOPPED_MESSAGE, SERVER_STOPPED_NEXT, SERVER_STOPPED_ALSO } from './server-stopped';
import { listHistory } from '../main/services/history';
import { costPreview, type Basis } from '../core/pricing/cost';
import { tdvpn, sol, toBaseUnits } from '../core/chain/amounts';
import { MODE_STREAM } from '../core/chain/idl';
import type { WalletStatus } from '../core/app/wallet-status';
import { daemonErrorCopy } from '../core/daemon/link-copy';
import { rpcUnavailableCopy } from '../core/chain/rpc';
import { PROTOCOLS } from '../shared/protocols';
import { pickQuickNode, cheapestBand } from '../shared/quick-pick';
import { isAndroid } from '../shared/is-android';
import type { LiveSession, NodeView, PendingSettlement } from '../shared/types';
import { PREFLIGHT_CODES } from '../core/session/state';
import { deviceLimitFor, DEPOSITS_PER_RAISE } from '../core/session/device-limit';
import { keyfileModeProblem, keyfileModeNext } from './keystore';
import { clockBlock, clockCheck } from './clock-gate';
import { takeUpLock, UP_LOCK_WAIT_MS } from './up-lock';
import { getHost } from '../main/host';
import { moneyOf } from './money-note';
import { readMarket, defaultCap, defaultLimitBase, fundingAsk, solNeeded, SOL_BEFORE_SETUP, type Defaults } from '../core/session/market-defaults';
import { log } from '../main/logger';

// How the agent runs this CLI. macOS has /usr/local/bin/devnet-dvpn only after `daemon install`; before that
// the app's shim (Contents/Resources/bin/devnet-dvpn) can export its own path here (review review).
const CLI = process.env.DVPN_CLI_NAME || 'devnet-dvpn';
const IP_WAIT_MS = 8000;
/** SOL a wallet needs before its first connect: the device float (~0.05, read on the rc.6 walks), the deposit
 *  account's rent and fees. R7: one number with the page (0.06); it was 0.02, below the float (FRICTION-LOG F8). */
export const AGENT_SOL_MIN = SOL_BEFORE_SETUP;

/** R7: the `defaults` block of an agent up preview and answer: what each default is and where it came from. */
export function defaultsView(d: Defaults, settingBase: bigint | null, units: number, capFromFlag: boolean, liveBase?: string | null): Record<string, unknown> {
  const limitRec = settingBase === null ? null : defaultLimitBase(settingBase, d.market, units);
  // LIM-3 (the agent kit rc.9, T-A 25): spendingLimit is the limit the chain enforces (this device's grant.allowance) when it
  // was read; the Settings amount is configuredDefault (what a first setup uses). With no grant read, as before.
  const live = typeof liveBase === 'string' && /^\d+$/.test(liveBase) ? liveBase : null;
  return {
    priceCap: capFromFlag ? 'set by --max-price' : d.priceCapBase === null ? null : tdvpn(d.priceCapBase),
    priceCapBase: capFromFlag ? null : d.priceCapBase,
    spendingLimit: live !== null ? tdvpn(live) : settingBase === null ? null : tdvpn(settingBase.toString()),
    spendingLimitSource: live !== null ? 'grant' : 'settings',
    configuredDefault: settingBase === null ? null : tdvpn(settingBase.toString()),
    spendingLimitRecommended: limitRec === null ? null : tdvpn(limitRec.toString()),
    units,
    source: d.source,
    ...(d.reason ? { reason: d.reason } : {}),
    market: d.market ? { p50: tdvpn(d.market.p50), p75: tdvpn(d.market.p75), nodes: d.market.nodes, outliers: d.market.outliers } : null,
  };
}

function fail(message: string, code: string, next: string, alsoNext?: string): never {
  throw Object.assign(new Error(message), { code, action: next, ...(alsoNext ? { alsoNext } : {}) });
}

/** S5/E-71 (the agent kit rc.6): the engine's catch-all "Something went wrong. Retry." never reaches an agent as-is. The
 *  answer says what is known (was a deposit paid?) and what to run; `code` and `next` stay the machine contract. */
export const GENERIC_RE = /^Something went wrong\.?( Retry\.?)?$/i;
export function namedFailure(raw: string | null | undefined, depositOpen: boolean): string {
  const r = (raw ?? '').trim();
  const known = r && !GENERIC_RE.test(r) ? ` (${r.replace(/\.$/, '')})` : '';
  return depositOpen
    ? `The node did not start the session after your deposit was paid${known}. The deposit is safe: it is refunded after the wait \`${CLI} agent down --yes\` prints; this node is skipped next time.`
    : `Connect failed for a reason this app does not name${known}. Nothing was paid. Look at \`${CLI} logs --lines 80\` for the cause, then try \`${CLI} agent up --yes\` once more.`;
}

/** The command that fixes a connect() failure, by its Result code. */
export const LIMIT_NEXT = `${CLI} device setup --allowance <N> --yes (N = grant.allowance from "devnet-dvpn device show --json" divided by 1000000, plus the deposit, in tDVPN), then ${CLI} agent up --yes`;

export function nextFor(code: string | undefined, platform: string = process.platform, refusal?: { action?: string | null; error?: string | null; open?: PendingSettlement | null }): string {
  // E-22 (a): a deposit open with this server beats every code's mapping (clock skew answered "unauthorized" after it opened).
  if (refusal?.open) return openDepositNext(refusal.open);
  // E-6: a 'preflight' refusal carries the app's button (Open settings / Open diagnostics / Repair drivers): its command.
  if (code === 'preflight' && refusal) {
    const hint = cliActionHint(refusal.action, refusal.error ?? '');
    if (hint && hint !== refusal.action) return `${hint}, then ${CLI} agent up --yes`;
  }
  if (code === 'no-wallet') return `${CLI} wallet create --keyfile <path> --yes, then fund the address it prints`;
  // Windows has no sudo: elevate.ts runs the step silently only with a full admin token, else ONE UAC prompt an
  // agent cannot answer; daemon-relogin = the service pipe does not accept this account yet (review review).
  if (platform === 'win32' && code === 'daemon-relogin') return `${CLI} daemon install --yes once from an elevated shell or an administrator SSH login (the VPN service does not accept this account yet; a normal shell shows a UAC prompt an agent cannot answer), then ${CLI} agent up --yes`;
  if (platform === 'win32' && code === 'daemon-missing') return `${CLI} daemon install --yes from an elevated shell or an administrator SSH login (a normal shell shows a UAC prompt an agent cannot answer), then ${CLI} agent up --yes`;
  if (code === 'daemon-missing' || code === 'daemon-relogin') return `${CLI} daemon install --yes (administrator/root once: passwordless sudo, or a person types the password), then ${CLI} agent up --yes`;
  // core/session/state.ts: the server's protocol tool is not on this computer (the deposit is refunded by agent down --yes).
  // E-5: never a fixed protocol (V2Ray can be the missing one): `daemon drivers` lists what is ready here.
  if (code === 'protocol-missing') return `${CLI} daemon drivers (it lists the protocols ready on this computer), then ${CLI} agent up --protocol <a ready one> --yes; or ${CLI} daemon repair-drivers --yes`;
  if (code === 'no-device' || code === 'device-permission') return `${CLI} device setup --yes, then ${CLI} agent up --yes`;
  if (code === 'daemon-unavailable') return `${CLI} daemon doctor`;
  if (code === 'daemon-restarting') return `${CLI} agent up --yes again in a few seconds (the VPN service is restarting); if it keeps failing, ${CLI} daemon doctor`;
  // A server test holds the VPN service (connection.ts, connect-5e 2d1cd05).
  if (code === 'test-running') return `${CLI} test stop, then ${CLI} agent up --yes`;
  // E-1: the approval or device limit is below the deposit; its app action is a screen ("Open Wallet").
  if (code === 'spending-limit') return LIMIT_NEXT;
  if (code === 'rpc-busy') return `${CLI} agent up --yes again in a minute (the network was busy)`;
  // CODE-AUDIT U-13 / E3 / E12 (connection.ts): refused before paying; the next try reads the price fresh (--max-price still caps it).
  if (code === 'price-changed' || code === 'deposit-unusable' || code === 'deposits-unread') return `${CLI} agent up --yes again (nothing was paid; it reads the price fresh)`;
  if (code === 'preflight' && refusal?.action === 'Pick another server') return PICK_OTHER;
  // E-22 (b): preflight's clock-skew (engine 24339afa, before any deposit): the minutes come from its sentence.
  if (code === 'clock-skew') return CLOCK_NEXT(platform);
  return (code && SWEEP1_NEXT[code]) ?? `${CLI} agent status`;
}

/**
 * E-18 (A): why there is no wallet, and the way back. A --keyfile / DVPN_KEYFILE wallet whose file is gone is
 * 'keyfile-missing' (vault noWallet, connect-5e a64b3a1e): restore the file, never `wallet create` (a new wallet
 * holds none of the funds). With no key file named but a device record on this computer, the wallet that set it
 * up is the one to import. Exported for tests.
 */
export function walletMissing(verb = 'agent up'): { message: string; code: 'no-wallet' | 'keyfile-missing'; next: string } {
  const w = noWallet();
  if (w.code === 'keyfile-missing') return { message: w.error, code: w.code, next: nextFor('keyfile-missing').replace('agent up', verb) };
  const rec = deviceRecord();
  if (rec?.owner) {
    return { message: 'No wallet.', code: 'no-wallet', next: `${CLI} wallet import <the key file of ${rec.owner}, the wallet that set up this computer's device>, then ${CLI} ${verb} --yes (a new wallet would not hold its funds)` };
  }
  return { message: 'No wallet.', code: 'no-wallet', next: nextFor('no-wallet') };
}

// ─── Sweep 1 (hub docs/AGENT-EDGE-MATRIX.md): a command for every connect() code, never an app screen ───
const AGAIN = (when: string): string => `${CLI} agent up --yes again ${when}`;
const PICK_OTHER = `${CLI} nodes list --online --json, then ${CLI} agent up --node <another node> --yes`;
const OTHER_PROTOCOL = `${CLI} daemon drivers (it lists the protocols ready on this computer), then ${CLI} agent up --protocol <another ready one> --yes`;
const NEW_DEPOSIT = `${CLI} agent down --yes, then ${CLI} agent up --yes (a new deposit)`;
const SET_RPC = `${CLI} daemon set --rpc <https url> --yes (the VPN service's Solana connection), then ${CLI} agent up --yes`;
const SETUP = `${CLI} device setup --yes, then ${CLI} agent up --yes`;
/** E-22 (a): what an open deposit means for the next step. Per-hour bills until closed, so it is named first. */
export function openDepositNext(d: PendingSettlement): string {
  const perHour = d.mode === MODE_STREAM;
  const refund = d.status === 'closing' && d.readyAt ? `refunds the unused part after ${new Date(d.readyAt * 1000).toISOString()}` : perHour ? 'refunds the unused part at once (per hour: it bills until closed)' : 'refunds the unused part 2 h after it starts the close (per GB)';
  return `a deposit of ${tdvpn(d.escrow)} tDVPN is open with this node (${d.channel}): ${CLI} agent up --yes picks another node (this node is skipped), or ${CLI} agent down --yes closes it and ${refund}`;
}
/** E-22 (a): after a failed start, the deposit (if any) open with that server. Never throws: on a failed read, null. */
async function openDepositOn(node: string, code: string | undefined): Promise<PendingSettlement | null> {
  if (code && (PREFLIGHT_CODES as readonly string[]).includes(code)) return null; // refused before paying
  // C-CLOCK / L-RPC (the agent kit rc.8): no code whose class is "nothing was paid" names an older deposit on this node.
  if (code && moneyOf(code) === 'none') return null;
  try {
    const rows = await within(readSettlements(), STATUS_NET_BUDGET_MS, 'reading deposits after a failed connect');
    return rows?.find((x) => x.node === node && (x.status === 'open' || x.status === 'in-use' || x.status === 'closing' || x.status === 'ready')) ?? null;
  } catch (err) {
    log.warn(`agent up: could not read deposits after a failed connect: ${(err as Error).message}`);
    return null;
  }
}
/** E-22 (b): the clock, never device setup. Minutes from the engine's error text when it names them. */
// C-CLOCK (the agent kit rc.8, T-C edge pass): the clock line was prose ("set this computer's clock to the right time"); it is now
// the command that turns on network time for this OS (the minutes stay in the error). Every server refuses a wrong
// clock alike, so no other node or deposit is ever the way out.
export function CLOCK_NEXT(platform: string = process.platform): string {
  // WIN-W8 (the agent kit rc.9): W32Time is trigger-start on a workgroup PC and often stopped; w32tm /resync then fails (0x80070426).
  const fix = platform === 'win32' ? 'Start-Service w32time; w32tm /resync /force (elevated PowerShell)'
    : platform === 'darwin' ? 'sudo sntp -sS time.apple.com'
    // C-CLOCK2: timedatectl alone does not step a running chrony (review: +10 min stayed); one line for both.
    : 'sudo timedatectl set-ntp true && (sudo chronyc makestep 2>/dev/null || true)';
  return `${fix}, then ${CLI} agent up --yes`;
}
/** "off by about 7 minutes" / "7 min" in the engine's sentence, else null. */
export function skewMinutes(error: string | null | undefined): number | null {
  const m = /(\d+)\s*min/i.exec(error ?? '');
  return m ? Number(m[1]) : null;
}
/** Exported for the no-dead-end test. Codes left out on purpose (agent status is the honest answer): SWEEP1_GENERIC. */
export const SWEEP1_NEXT: Record<string, string> = {
  'not-confirmed': `${CLI} agent up --yes (add --yes: nothing is paid without it)`,
  busy: AGAIN('in a few seconds (another connect was running)'),
  'wallet-switch-needed': `load the key file of the wallet named in "error", or ${CLI} device switch --yes (sets this computer up for the loaded wallet; the other wallet's deposits stay refundable)`,
  'keyfile-missing': `restore the key file named in "error" from your backup (it is the only key to this wallet), then ${CLI} agent up --yes`,
  'keyfile-mode': `chmod 600 <the key file named in "error">, then ${CLI} agent up --yes`,
  'plan-limit': `${CLI} agent up --plan <subscription> --node <a node you already use> --yes`,
  'network-mismatch': `${CLI} daemon install --yes (administrator once: it installs the service for this network), then ${CLI} agent up --yes`,
  // B-UP (the agent kit rc.8): another run holds the session (often a second `agent up` started at once): look, never end it.
  'session-active': `${CLI} agent status --json`,
  'node-gone': PICK_OTHER, 'node-stale': PICK_OTHER, 'node-offline': PICK_OTHER, 'node-identity': PICK_OTHER, 'node-ledger': PICK_OTHER,
  'protocol-blocked': OTHER_PROTOCOL,
  'driver-missing': `${CLI} daemon repair-drivers --yes, then ${CLI} agent up --yes`,
  'basis-unavailable': `${CLI} agent up --basis <the other one: per_gb or per_hour> --yes`,
  'not-enough-tdvpn': `send tDVPN to the wallet address (${CLI} agent status shows it), then ${CLI} agent up --yes`,
  'device-sol': SETUP, 'ticket-other-owner': SETUP, 'approval-revoked': SETUP,
  // E-22: under clock skew the server answered unauthorized while the device was fine (a deposit had opened).
  unauthorized: `${CLI} device show --json: if the grant is there and not revoked, set this computer's clock to the right time (a wrong clock makes the node refuse), then ${CLI} agent up --yes; otherwise ${SETUP}`,  'kill-switch-held': `${CLI} daemon restore-network, then ${CLI} agent up --yes`,
  'switch-reconnecting': `${CLI} agent status until "connected" is true, or ${CLI} agent down --yes first`,
  'switch-offline': AGAIN('in a moment'),
  cancelled: AGAIN('(it was stopped before it finished)'),
  // L-RPC (the agent kit rc.8): the service cannot reach Solana (its preflight to the RPC failed): name its RPC (gap 4), as rpc-*.
  'waiting-for-network': SET_RPC,
  'service-stopped-connecting': `${CLI} quality ip; if it shows no address, ${CLI} daemon restore-network; then ${CLI} agent up --yes`,
  'node-price': NEW_DEPOSIT, credit_exhausted: NEW_DEPOSIT, lease_insufficient: NEW_DEPOSIT, voucher_exceeds_escrow: NEW_DEPOSIT, voucher_signature_invalid: NEW_DEPOSIT,
  'node-error': AGAIN('in a minute'),
  'kill-switch-failed': `${CLI} agent up --yes again, or ${CLI} daemon set --kill-switch off --yes`,
  preflight: `read "error": it names what to change (nothing was paid), then ${CLI} agent up --yes`,
  'tunnel-failed': OTHER_PROTOCOL, 'tunnel-dead': OTHER_PROTOCOL, 'tunnel-mtu': OTHER_PROTOCOL, 'port-in-use': OTHER_PROTOCOL,
  'tunnel-closing': AGAIN('in a few seconds'),
  'dns-apply': `${CLI} daemon set --dns-mode none --yes (the VPN's DNS off), then ${CLI} agent up --yes`,
  'deposit-pending': AGAIN('in a few minutes (it never pays twice)'),
  'rpc-network': SET_RPC, 'rpc-quota': SET_RPC, 'rpc-unavailable': SET_RPC, 'rpc-ws': SET_RPC,
  'rpc-timeout': `${AGAIN('in a minute')}; if it keeps failing, ${SET_RPC}`,
  timeout: AGAIN('in a moment'),
  'chain-encoding': `${CLI} agent up --basis per_hour --yes (pay per hour instead)`,
  peer_limit_reached: PICK_OTHER, terms_rejected: PICK_OTHER,
  subscription_invalid: `${CLI} plans subscriptions, then ${CLI} agent up --plan <an active one> --yes, or ${CLI} agent up --yes without --plan`,
  ticket_request_stale: AGAIN('in a moment'), ticket_invalid: AGAIN('in a moment'), channel_node_reopened: AGAIN('in a moment'),
  provider_unreachable: AGAIN('in a minute (the plan provider did not answer)'),
  'cannot cover the prepay': `${CLI} agent up --units <more> --yes (a deposit large enough for the node's minimum)`,
  rate_limited: AGAIN('in a minute'),
  mode_not_voucher: `${CLI} agent up --basis per_hour --yes`, mode_not_stream: `${CLI} agent up --basis per_gb --yes`,
  'stop-failed': `${CLI} daemon doctor, then ${CLI} agent up --yes`,
  'dns-revert-failed': `${CLI} daemon restore-network`, 'tunnel-left': `${CLI} daemon restore-network`,
};
/** agent status IS the answer for these: nothing more specific is known. */
export const SWEEP1_GENERIC: readonly string[] = ['unknown', 'connect-failed', 'unsupported'];

export interface AgentInputs { basis: Basis; units: number; protocol?: string; country?: string; maxPrice?: string; plan?: string; node?: string }

/** Every flag checked before anything runs (a bad value is a usage error, exit 3). */
export function agentInputs(a: Args, d: { basis: string; gb: number; hours: number }): AgentInputs {
  // E-21 (money): an empty --plan meant a paid deposit; every filter given empty is a usage error before anything runs.
  requireValues(a, ['plan', 'node', 'country', 'protocol', 'max-price', 'basis', 'units']);
  const basis = str(a, 'basis', d.basis);
  if (basis !== 'per_gb' && basis !== 'per_hour') throw new UsageError('--basis must be per_gb or per_hour');
  const units = whole(a, 'units', basis === 'per_gb' ? d.gb : d.hours, 1, 1000);
  const p = str(a, 'protocol')?.toLowerCase();
  if (p && p !== 'any' && !(PROTOCOLS as readonly string[]).includes(p)) throw new UsageError(`--protocol must be any, ${PROTOCOLS.join(', ')}`);
  const country = str(a, 'country')?.toUpperCase();
  if (country && !/^[A-Z]{2}$/.test(country)) throw new UsageError('--country must be a two-letter country code, e.g. DE');
  const mp = str(a, 'max-price');
  let maxPrice: string | undefined;
  if (mp !== undefined) {
    try { maxPrice = toBaseUnits(mp); } catch (err) { throw new UsageError(`--max-price: ${(err as Error).message}`); }
  }
  return { basis, units, protocol: p === 'any' ? undefined : p, country, maxPrice, plan: str(a, 'plan'), node: str(a, 'node') };
}

/**
 * E-8 (money): with no --max-price, lowest latency alone paid 50 tDVPN for 1 GB while servers at 0.002 answered.
 * Then the pick is among the cheapest band of the servers Connect accepts (deposit at most QUICK_PRICE_BAND times
 * the cheapest, as Quick connect, UI-195). --max-price is the agent's own cap; a plan pays nothing per server.
 * Exported for tests.
 */
export function pickPool(pool: NodeView[], inp: { maxPrice?: string; basis: Basis; units: number }, plan: boolean): NodeView[] {
  if (inp.maxPrice !== undefined || plan) return pool;
  return cheapestBand(pool.filter((n) => n.probe?.ok && n.listingFresh !== false), { basis: inp.basis, units: inp.units });
}

/** The plain filter before pickQuickNode. A plan session pays nothing per node, so `only` (its live roster) replaces the price rules. */
export function filterNodes(list: NodeView[], f: { basis: Basis; protocol?: string; country?: string; maxPrice?: string; only?: string[] }): NodeView[] {
  // P4 (the agent kit): a malformed price counts as unpriced (left out), as in cheapestBand; BigInt('1.5') threw out of agent up.
  const price = (n: NodeView): bigint => { const v = String((f.basis === 'per_gb' ? n.pricePerGb : n.pricePerHour) ?? ''); return /^\d+$/.test(v) ? BigInt(v) : 0n; };
  const out = list.filter((n) => (!f.protocol || n.protocolNames.includes(f.protocol))
    && (!f.country || n.countryCode === f.country)
    && (f.only ? f.only.includes(n.address) : price(n) > 0n && (!f.maxPrice || price(n) <= BigInt(f.maxPrice))));
  // dvpnd picks the service on a node that offers several: prefer nodes that offer only the asked protocol.
  const exact = f.protocol ? out.filter((n) => n.protocolNames.length === 1) : [];
  return exact.some((n) => n.probe?.ok) ? exact : out;
}

/**
 * Does the session carry the whole computer? A tunnel protocol (no SOCKS address) always does. V2Ray/Xray do
 * when their service config has tun = true (serviceUsesTun; a fresh Windows/macOS install, manager.ts
 * wholeDeviceByDefault). Android carries every app (app-state.ts). Exported for tests.
 */
export function sessionWholeDevice(live: LiveSession, usesTun: (service: string) => boolean = serviceUsesTun): boolean {
  return !live.proxyEndpoint || isAndroid() || usesTun(live.service);
}

/**
 * The one-line answer for a live session. `directIp` is this computer's own address, never the node's: in
 * whole-device mode a direct check now exits by the node too (Windows rc2, V2Ray: direct = viaSocks = node),
 * so it is the address read before the connect (home-ip.json), or null.
 */
export function upAnswer(live: LiveSession, country: string | null, deposit: unknown, ip: { ip: string; directIp?: string | null; viaProxy?: boolean } | null, home: string | null, wholeDevice = !live.proxyEndpoint): Record<string, unknown> {
  const socks = live.proxyEndpoint && !isAndroid() ? `socks5h://${live.proxyEndpoint}` : null;
  const measured = !wholeDevice && ip?.viaProxy ? ip.directIp ?? null : null;
  // E-27: the wallet that paid (from the deposit account), and whether it is the loaded one.
  const payer = live.payer ?? null;
  const loaded = ownerAddress();
  return {
    ok: true, connected: true, session: live.id, node: live.node, protocol: live.service, country,
    exitIp: ip?.ip ?? null, directIp: measured ?? home, wholeDevice, socks, channel: live.channel || null, deposit,
    payer, payerIsLoaded: payer && loaded ? payer === loaded : null, payerNote: payerNote(payer, loaded),
    // E-38: `next` is one plain command (a runner refuses prose with shell characters); what the session means is in `note`.
    next: `${CLI} agent down --yes`,
    note: wholeDevice
      ? `the whole computer goes through the node${socks ? ` (${socks} works too)` : ''}; when done: ${CLI} agent down --yes`
      : `send traffic through ${socks} (e.g. curl --proxy ${socks} https://api.ipify.org); only apps that use it go through the node; when done: ${CLI} agent down --yes`,
  };
}

// ─── E-73 (blind round 3, Linux rc.4): a limit raise is said, never silent ───
// connect() raises a spending limit below the deposit to the Settings limit (owner 2026-11-11). T-A's planted
// 0.001 tDVPN cap became 50 tDVPN and agent up's answer said nothing. Each deposit uses up part of the
// allowance, so "raised" = the allowance after plus this deposit is above the allowance before.
export interface LimitRaise { from: string; to: string; fromBase: string; toBase: string }
export function limitRaise(beforeBase: string | null | undefined, afterBase: string | null | undefined, escrowBase: string): LimitRaise | null {
  const ok = (v: string | null | undefined): v is string => typeof v === 'string' && /^\d+$/.test(v);
  if (!ok(beforeBase) || !ok(afterBase) || !/^\d+$/.test(escrowBase)) return null;
  const to = BigInt(afterBase) + BigInt(escrowBase);
  if (to <= BigInt(beforeBase)) return null;
  return { from: tdvpn(beforeBase), to: tdvpn(to.toString()), fromBase: beforeBase, toBase: to.toString() };
}
export function limitRaiseNote(r: LimitRaise): string {
  return `This computer's spending limit was ${r.from} tDVPN, below this deposit, so it was raised to ${r.to} tDVPN (the Settings limit). To lower it: ${CLI} device setup --allowance <N> --yes`;
}
/** The preview line when the deposit is above the current limit: what --yes will also sign. */
export function limitPreview(allowanceBase: string | null | undefined, escrowBase: string, settingTdvpn: string): string | null {
  if (typeof allowanceBase !== 'string' || !/^\d+$/.test(allowanceBase) || !/^\d+$/.test(escrowBase)) return null;
  if (BigInt(allowanceBase) >= BigInt(escrowBase)) return null;
  const settingBase = /^\d+(\.\d+)?$/.test(String(settingTdvpn ?? '')) ? BigInt(toBaseUnits(settingTdvpn)) : 0n;
  const want = deviceLimitFor(settingBase, BigInt(escrowBase));
  return `This computer's spending limit (${tdvpn(allowanceBase)} tDVPN) is below this deposit. It is raised only with --raise-limit: then --yes raises it to ${tdvpn(want.toString())} tDVPN.`;
}

/** S7 default cap in base units: the Settings limit / DEPOSITS_PER_RAISE (50 → 5 tDVPN); null when the setting is unreadable. */
export function depositCap(settingTdvpn: string): bigint | null {
  if (!/^\d+(\.\d+)?$/.test(String(settingTdvpn ?? ''))) return null;
  return BigInt(toBaseUnits(settingTdvpn)) / DEPOSITS_PER_RAISE;
}

/** E-88: `agent up` pinned to the chosen node, with the agent's own --protocol and --max-price kept (they are its
 *  choices and its cap; dropping --max-price removed the cap the agent asked for). Pure; unit-tested. */
export function pinnedUpLine(a: Args, node: string, inp: { basis: string; units: number | string }): string {
  const p = str(a, 'protocol');
  const mp = str(a, 'max-price');
  return `${CLI} agent up --node ${node}${p ? ` --protocol ${p}` : ''} --basis ${inp.basis} --units ${inp.units}${mp ? ` --max-price ${mp}` : ''}`;
}

/** S7 (the agent kit rc.6): a spending-limit raise is its own explicit step. `agent up --yes` with the limit below the deposit
 *  pays nothing and names the exact line that raises it (old → new), never raising it on its own. */
export function limitRefusal(allowanceBase: string, escrowBase: string, settingTdvpn: string, line: string): { message: string; next: string; alsoNext: string } {
  // LIM-1 (the agent kit rc.9, T-A 3 least privilege): the next was the --raise-limit line, which raises the limit to the Settings
  // amount (often 10x the deposit). It now sets the limit to this deposit, then runs the same pinned line; the wider
  // raise stays one step away in alsoNext.
  const settingBase = /^\d+(\.\d+)?$/.test(String(settingTdvpn ?? '')) ? BigInt(toBaseUnits(settingTdvpn)) : 0n;
  const want = deviceLimitFor(settingBase, BigInt(escrowBase));
  const deposit = tdvpn(escrowBase);
  return {
    message: `Spending limit ${tdvpn(allowanceBase)} tDVPN is below this deposit (${deposit} tDVPN). Nothing was paid. next sets the limit to this deposit (${deposit} tDVPN); alsoNext raises it to ${tdvpn(want.toString())} tDVPN with --raise-limit.`,
    next: `${CLI} device setup --allowance ${deposit} --yes, then ${line} --yes`,
    alsoNext: `${line} --raise-limit --yes`,
  };
}

function human(r: Record<string, unknown>): string {
  return `Connected. Session ${r.session}  node ${r.node}  ${r.protocol}  ${r.country ?? ''}  exit IP ${r.exitIp ?? 'unknown'}${r.socks ? `  SOCKS ${r.socks}` : ''}${r.payerNote ? `\n${r.payerNote}` : ''}${r.skippedNote ? `\nNote: ${r.skippedNote}` : ''}${r.replacedNote ? `\nNote: ${r.replacedNote}` : ''}\nNext: ${r.next}${r.note ? `\n${r.note}` : ''}`;
}

/** This computer's own address as read before a connect (home-ip.json), or null. */
function homeIp(): string | null {
  loadHomeIp();
  return snapshot().homeIp;
}

async function exitIp(sid: string): Promise<{ ip: string; directIp?: string | null; viaProxy?: boolean } | null> {
  await within(runJobNow('ip'), IP_WAIT_MS, 'the exit IP check');
  const p = snapshot().publicIp;
  return p && p.sid === sid ? p : null;
}

/** R3 gap 1 + M-S (the agent kit rc.8): the key-file-mode sentence and its one command, shared by `agent up` and `agent status`. */
const keyfileModeText = (k: { path: string; mode: string }): string => `The key file ${k.path} can be read by other users (mode ${k.mode}).`;
export { keyfileModeNext, shellWord } from './keystore'; // K-WIN2: shared with wallet show

// ─── agent up ───
/** B-UP: one paying `agent up` at a time; a second one waits for the first, then reuses its session. */
async function takeAgentUpLock(): Promise<{ release: () => void } | null> {
  let dir: string;
  try {
    dir = getHost().dataDir;
  } catch (err) {
    log.warn(`agent up: no data dir, so no lock against a second agent up: ${(err as Error).message}`);
    return null;
  }
  const l = await takeUpLock({ dir });
  if (!l) fail(`Another agent up on this computer is still connecting (waited ${UP_LOCK_WAIT_MS / 1000} s). Nothing was paid.`, 'busy', `${CLI} agent status --json`);
  return l;
}
const up: Cmd = async (a, o) => {
  const lock = flag(a, 'yes') ? await takeAgentUpLock() : null; // a preview pays nothing: never waits
  try {
    await upOnce(a, o);
  } finally {
    lock?.release();
  }
};
const upOnce: Cmd = async (a, o) => {
  const s = getSettings();
  const inp = agentInputs(a, { basis: s.defaultBasis, gb: s.defaultGb, hours: s.defaultHours });
  const owner = ownerAddress();
  if (!owner) { const m = walletMissing(); fail(m.message, m.code, m.next); }
  // R3 gap 1: a key file others can read is refused before anything is signed (Path B's own check does the same).
  const kfm = keyfileModeProblem(str(a, 'keyfile') ?? process.env.DVPN_KEYFILE);
  if (kfm) fail(`${keyfileModeText(kfm)} Nothing was paid.`, 'keyfile-mode', keyfileModeNext(kfm.path));
  // Idempotent: a live session that matches the request is answered, never paid for twice.
  await adoptRunningSession();
  const already = snapshot().session;
  // rc9-d: set up for another wallet (and nothing live to answer): the switch, never the service gates' loop.
  const otherW = already ? null : readOtherWallet(owner);
  if (otherW) throw switchNeeded(otherW, owner);
  // E-35: a session the server stopped serving still reads "live" for a while, with the direct address as its exit.
  // It is never reused: that server is skipped and the connect below switches away from it.
  const liveIp = already ? await exitIp(already.id) : null;
  const dead = !!already && exitIsDirect(liveIp, homeIp());
  if (dead) recordFailed(already!.node, 'server-stopped');
  if (already && !dead) {
    const countryOf = (): string | null => nodeViews().find((n) => n.address === already.node)?.countryCode ?? null;
    if (inp.country && !countryOf()) await refreshNodes({ probe: false });
    const liveCountry = countryOf();
    if (inp.node === already.node || ((!inp.node) && (!inp.protocol || already.service === inp.protocol) && (!inp.country || liveCountry === inp.country))) {
      const r = { ...upAnswer(already, liveCountry, null, liveIp, homeIp(), sessionWholeDevice(already)), reused: true };
      // The desktop app shows 'Agentic connection is on' while this marker names the live session (agent-marker.ts).
      writeAgentMarker({ session: already.id, node: already.node, protocol: already.service });
      o.print(human(r), r);
      return;
    }
    // A different server is asked for: below, through connect()'s switch path (it keeps a kill switch up between
    // the two sessions; disconnect + connect would release it and leak the real IP: review, docs/agent-safety.md).
  }
  // WIN-W7 (the agent kit rc.9): a wrong clock is refused here, before the device gate and any funding ask (edge row 2: a
  // +10 min clock answered not-funded, so the agent would fund a device first). Unreadable chain time = skipped.
  const clock = await within(clockBlock(), STATUS_NET_BUDGET_MS, 'the chain clock');
  if (clock) fail(clock.error, 'clock-skew', CLOCK_NEXT());
  // First-run step `daemon init` (local, unelevated, no spend); connect() itself signs the spending permission.
  if (!daemonInfo().device) {
    const d = await initDevice(owner!);
    if (!d.ok) fail(d.error ?? 'Could not create the device key.', 'no-device', `${CLI} daemon doctor`);
  }
  let only: string[] | undefined;
  let subscription: { provider: string; subscription: string } | undefined;
  if (inp.plan) {
    const sub = (await refreshSubscriptions()).find((x) => x.address === inp.plan && x.active);
    if (!sub) fail(`You do not hold an active subscription ${inp.plan}.`, 'no-subscription', `${CLI} plans list, then ${CLI} plans subscribe <plan> --yes`);
    subscription = { provider: sub!.provider, subscription: sub!.address };
    only = (await roster(sub!.provider, sub!.plan)).filter((r) => r.live).map((r) => r.node);
  }
  const [wallet] = await Promise.all([refreshWallet(), refreshNodes({ probe: true })]);
  // A switch never re-picks the live server (Q0559: re-picking the same server can fail late and lift the kill switch).
  const pool = filterNodes(nodeViews(), { ...inp, only }).filter((n) => !already || n.address !== already.node);
  // The server that failed within 10 min is left out of the quick pick (never when --node names a server).
  const picked = inp.node ? null : withoutFailed(pickPool(pool, inp, !!subscription), recentFailed());
  const skipped = picked?.skipped ?? null;
  const node = inp.node ? pool.find((n) => n.address === inp.node && n.probe?.ok) ?? null : pickQuickNode(picked!.pool, null);
  // R7: the market = every online priced node that matches the request, the --max-price filter left out.
  const unitPrice = (n: NodeView): string => String((inp.basis === 'per_gb' ? n.pricePerGb : n.pricePerHour) ?? '');
  const matching = filterNodes(nodeViews(), { ...inp, maxPrice: undefined, only }).filter((n) => n.probe?.ok !== false);
  const market = subscription ? null : readMarket(matching.map(unitPrice));
  if (!node) {
    // K2-T (the agent kit rc.8, Windows R4): under a kill-switch block every probe fails, so no node is picked whatever the
    // price; the refusal named a price under the cap and its next lowered the cap. No matching node answering its check
    // and no internet = the block: its own code, next = the one way out.
    const anyAnswered = filterNodes(nodeViews(), { ...inp, maxPrice: undefined, only }).some((n) => n.probe?.ok === true);
    if (!anyAnswered && await noInternet()) fail('No server answered its check, and this computer has no internet: the kill switch is holding the block. Nothing was paid.', 'kill-switch-held', `${CLI} daemon restore-network`);
    // R7 rule 5: a refusal names the number and the flag (FRICTION-LOG F4: --max-price 0.01 left nothing, unexplained).
    // A-NODES (the agent kit rc.8, T-C edge pass): the price named here and its next come from the SAME test as the pick
    // (pickQuickNode: answers its check AND is still listed). The old list also counted nodes that do not answer or
    // whose listing lapsed, so it named a price the pick refused again: --max-price 0 → 0.001 → "above your
    // --max-price: 0.001", the same next; --country US --max-price 0.01 named a US node no check had reached.
    // K2-T: only a price ABOVE --max-price is named. When price is not the blocker, the filter that is gets named, and
    // next is the same line without it (never the failing value again).
    const cap = inp.maxPrice !== undefined ? BigInt(inp.maxPrice) : null;
    const per = `tDVPN/${inp.basis === 'per_gb' ? 'GB' : 'hour'}`;
    const pickable = (f: { country?: string; protocol?: string; maxPrice?: string }): NodeView[] =>
      filterNodes(nodeViews(), { ...inp, ...f, only }).filter((n) => n.probe?.ok && n.listingFresh !== false && (!already || n.address !== already.node));
    const priceOf = (n: NodeView): bigint => BigInt(/^\d+$/.test(unitPrice(n)) ? unitPrice(n) : '0');
    const upLine = (f: { node?: string; protocol?: string; country?: string; maxPrice?: string }): string =>
      `${CLI} agent up${f.node ? ` --node ${f.node}` : ''}${f.protocol ? ` --protocol ${f.protocol}` : ''}${f.country ? ` --country ${f.country}` : ''} --basis ${inp.basis} --units ${inp.units}${f.maxPrice !== undefined ? ` --max-price ${tdvpn(f.maxPrice)}` : ''} --yes`;
    const proto = str(a, 'protocol');
    const atCap = cap !== null ? ` at --max-price ${tdvpn(inp.maxPrice!)} ${per}` : '';
    const nodesWord = (k: number): string => `${k} node${k === 1 ? '' : 's'}`;
    if (!inp.node) {
      if (cap !== null) {
        const above = pickable({ maxPrice: undefined }).map(priceOf).filter((p) => p > 0n && p > cap).sort((x, y) => (x < y ? -1 : 1))[0];
        const refused = filterNodes(nodeViews(), { ...inp, only }).length; // match the price, but do not answer or lapsed
        if (above !== undefined) fail(`No online node matches${atCap}.${refused ? ` ${nodesWord(refused)} at or under it ${refused === 1 ? 'does' : 'do'} not answer ${refused === 1 ? 'its check or its listing' : 'their check or their listing'} lapsed.` : ''} The cheapest matching node above your --max-price: ${tdvpn(above.toString())} ${per}. Nothing was paid.`, 'no-nodes', upLine({ protocol: proto, country: inp.country, maxPrice: above.toString() }));
      }
      // Price is not the blocker (nothing answers above it either): the country or the protocol is.
      const elsewhere = inp.country ? pickable({ country: undefined }).length : 0;
      if (elsewhere) fail(`No node in ${inp.country} answers its check${atCap} right now; ${nodesWord(elsewhere)} elsewhere ${elsewhere === 1 ? 'does' : 'do'}. Nothing was paid.`, 'no-nodes', upLine({ protocol: proto, maxPrice: inp.maxPrice }));
      const otherProto = inp.protocol ? pickable({ protocol: undefined }).length : 0;
      if (otherProto) fail(`No ${inp.protocol} node answers its check${inp.country ? ` in ${inp.country}` : ''}${atCap} right now; ${nodesWord(otherProto)} with another protocol ${otherProto === 1 ? 'does' : 'do'}. Nothing was paid.`, 'no-nodes', upLine({ country: inp.country, maxPrice: inp.maxPrice }));
      const neither = inp.country && inp.protocol ? pickable({ country: undefined, protocol: undefined }).length : 0;
      if (neither) fail(`No ${inp.protocol} node in ${inp.country} answers its check${atCap} right now; ${nodesWord(neither)} elsewhere with another protocol ${neither === 1 ? 'does' : 'do'}. Nothing was paid.`, 'no-nodes', upLine({ maxPrice: inp.maxPrice }));
    }
    if (inp.node) {
      // A-NODES (T-A money audit): --node with a refusal dropped --node from its next and named another node's price.
      // It now says why THIS node is not picked and keeps --node where trying it again can work.
      const v = nodeViews().find((n) => n.address === inp.node);
      const pin = { node: inp.node, protocol: proto, country: inp.country, maxPrice: inp.maxPrice };
      const LIST = `${CLI} nodes list --online --json`;
      const [why, next] = !v ? ['it is not on the network', LIST]
        : already && v.address === already.node ? ['it is the server this computer is on now', `${CLI} agent status --json`]
        : inp.protocol && !v.protocolNames.includes(inp.protocol) ? [`it does not offer ${inp.protocol} (it offers ${v.protocolNames.join(', ') || 'none'})`, upLine({ ...pin, protocol: undefined })]
        : inp.country && v.countryCode !== inp.country ? [`it is in ${v.countryCode || 'an unknown country'}, not ${inp.country}`, upLine({ ...pin, country: undefined })]
        : !(priceOf(v) > 0n) ? [`it has no ${inp.basis === 'per_gb' ? 'per-GB' : 'per-hour'} price (try the other --basis)`, LIST]
        : cap !== null && priceOf(v) > cap ? [`its price is ${tdvpn(priceOf(v).toString())} ${per}, above your --max-price ${tdvpn(inp.maxPrice!)}`, upLine({ ...pin, maxPrice: priceOf(v).toString() })]
        : v.listingFresh === false ? ['its listing lapsed (it has not checked in recently)', LIST]
        : !v.probe?.ok ? ['it does not answer its check right now', LIST]
        : ['it does not match the filters', LIST];
      fail(`Node ${inp.node} is not picked: ${why}. Nothing was paid.`, 'no-nodes', next);
    }
    fail('No online node matches these filters.', 'no-nodes', `${CLI} nodes list --online --json, then widen --protocol / --country / --max-price`);
  }
  const c = costPreview(node!, inp.basis, inp.units);
  const settingText = getSettings().allowanceTdvpn;
  const settingBase = /^\d+(\.\d+)?$/.test(String(settingText ?? '')) ? BigInt(toBaseUnits(settingText)) : null;
  const dflt: Defaults | null = subscription ? null : defaultCap(settingBase, market, inp.units);
  const defaults = dflt ? defaultsView(dflt, settingBase, inp.units, inp.maxPrice !== undefined, wallet?.grant?.allowance ?? null) : null;
  // S7 (the agent kit rc.6, review proposal): with no --max-price and no plan, a deposit above the Settings limit / 10 is
  // refused (nothing paid). That is the largest deposit whose limit raise (deviceLimitFor) stays within the Settings
  // limit, so one number means "capped by default" and "never widened past the owner's setting".
  // R7: the cap is market-sized (max(limit / 10, p75 × units), never above the Settings limit); depositCap is the fallback.
  if (!subscription && inp.maxPrice === undefined) {
    const cap = dflt?.priceCapBase != null ? BigInt(dflt.priceCapBase) : depositCap(settingText);
    // L-DROP (the agent kit rc.8, Linux R4): the cheap nodes went offline and the only answering one cost 50 against a default
    // cap of 15 with a spending limit of 150: price-cap refused an agent with funds for a cap it never set. When the
    // quick pick (no --node) finds no answering node under the cap, the cheapest answering one is taken if its deposit
    // is within the spending limit, and defaults.reason says so. Above the limit, or with --node, it is refused as before.
    const answeringUnderCap = pool.some((n) => n.probe?.ok && BigInt(costPreview(n, inp.basis, inp.units).escrow) <= (cap ?? 0n));
    const widen = cap !== null && BigInt(c.escrow) > cap && !inp.node && !!node!.probe?.ok && !answeringUnderCap && settingBase !== null && BigInt(c.escrow) <= settingBase;
    if (widen && defaults) {
      const why = `no answering node is under the default cap of ${tdvpn(cap!.toString())} tDVPN, and the cheapest one that answers (${node!.address}, ${tdvpn(c.escrow)} tDVPN) is within your spending limit of ${tdvpn(settingBase!.toString())} tDVPN, so it was picked`;
      defaults.reason = defaults.reason ? `${String(defaults.reason)}; ${why}` : why;
      defaults.capWidened = tdvpn(c.escrow);
      defaults.capWidenedBase = c.escrow;
    }
    if (!widen && cap !== null && BigInt(c.escrow) > cap) fail(`This deposit (${tdvpn(c.escrow)} tDVPN) is above the default cap of ${tdvpn(cap.toString())} tDVPN (${dflt?.source === 'market' ? 'sized from the market' : 'your spending limit / 10'}). Nothing was paid. The cheapest matching node above the cap: ${tdvpn(inp.basis === 'per_gb' ? node!.pricePerGb ?? '0' : node!.pricePerHour ?? '0')} tDVPN/${inp.basis === 'per_gb' ? 'GB' : 'hour'}; add --max-price ${tdvpn(inp.basis === 'per_gb' ? node!.pricePerGb ?? '0' : node!.pricePerHour ?? '0')} to accept it.`, 'price-cap', `${CLI} agent up --node ${node!.address} --basis ${inp.basis} --units ${inp.units} --max-price ${tdvpn(inp.basis === 'per_gb' ? node!.pricePerGb ?? '0' : node!.pricePerHour ?? '0')} --yes (you accept this price), or fewer --units, or another node`);
  }
  const deposit = subscription ? { plan: subscription.subscription, tdvpn: '0' } : { basis: inp.basis, units: inp.units, tdvpn: tdvpn(c.escrow), tdvpnBase: c.escrow, baseUnits: c.escrow };
  if (wallet && !subscription) {
    const short: string[] = [];
    // R7 rule 3: the SOL ask covers the device float before setup (0.02 was below it: FRICTION-LOG F8); the tDVPN ask
    // is the exact shortfall plus a recommended amount that also covers a reconnect at market prices.
    const solMin = solNeeded(false);
    if (!wallet.ready && wallet.ownerLamports < solMin) short.push(`${sol(solMin)} SOL`);
    const have = BigInt(wallet.ownerTdvpn) + BigInt(wallet.userBalance);
    const ask = fundingAsk(BigInt(c.escrow), have, market, inp.units);
    if (ask.needBase > 0n) short.push(`${tdvpn(ask.needBase.toString())} tDVPN${ask.recommendBase > ask.needBase ? ` (${tdvpn(ask.recommendBase.toString())} recommended: it also covers a reconnect)` : ''}`);
    if (short.length) fail(`Not enough funds for this deposit (${tdvpn(c.escrow)} tDVPN).`, 'not-funded', `send at least ${short.join(' and ')} to ${owner}, then ${CLI} agent up --yes`);
  }
  const allowanceBefore = wallet?.grant?.allowance ?? null;
  const limitLine = subscription ? null : limitPreview(allowanceBefore, c.escrow, getSettings().allowanceTdvpn);
  // LIM-5 (the agent kit rc.9, T-A 4): --raise-limit-to N sets the limit to exactly N (never below this deposit).
  const raiseTo = str(a, 'raise-limit-to');
  if (raiseTo !== undefined && !/^\d+(\.\d+)?$/.test(raiseTo)) throw new UsageError(`--raise-limit-to needs a number of tDVPN (got "${raiseTo}").`);
  if (raiseTo !== undefined && BigInt(toBaseUnits(raiseTo)) < BigInt(c.escrow)) {
    fail(`The limit asked with --raise-limit-to (${raiseTo} tDVPN) is below this deposit (${tdvpn(c.escrow)} tDVPN). Nothing was paid.`, 'spending-limit', `${pinnedUpLine(a, node!.address, inp)} --raise-limit-to ${tdvpn(c.escrow)} --yes`);
  }
  const raiseToLine = limitLine && raiseTo !== undefined ? `This computer's spending limit (${tdvpn(String(allowanceBefore))} tDVPN) is below this deposit: --yes first sets it to ${tdvpn(toBaseUnits(raiseTo))} tDVPN (one transaction).` : null;
  // S7: with --yes alone a limit below the deposit is refused (nothing paid); the raise is its own explicit flag.
  if (limitLine && flag(a, 'yes') && !flag(a, 'raise-limit') && raiseTo === undefined) {
    // E-88 (blind T-A, rc.6): the line dropped the agent's own --max-price / --protocol; it repeats every flag it gave.
    const lr = limitRefusal(allowanceBefore as string, c.escrow, getSettings().allowanceTdvpn, pinnedUpLine(a, node!.address, inp));
    fail(lr.message, 'spending-limit', lr.next, lr.alsoNext);
  }
  confirm(a, o, (skipped ? `${skippedNote(skipped)}. ` : '') + (defaults?.capWidened ? `The default cap was widened to ${String(defaults.capWidened)} tDVPN: ${String(defaults.reason).split('; ').pop()}. ` : '') + (already ? `Switch from ${already.node}. ` : '') + (subscription
    ? `Connect to ${node!.address} (${node!.countryCode}) using plan subscription ${subscription.subscription} (no deposit).`
    : `Connect to ${node!.address} (${node!.countryCode}, ${node!.protocolNames.join(',')}): deposit up to ${c.escrowText} (${inp.units} ${inp.basis === 'per_gb' ? 'GB' : 'h'}), unused part refunded.`) + (raiseToLine ? ` ${raiseToLine}` : limitLine ? ` ${limitLine}` : '') + ' Nothing is signed until you pass --yes.', { node: node!.address, deposit, switchFrom: already?.node ?? null, ...(skipped ? { skipped } : {}), ...(limitLine ? { limitRaise: limitLine } : {}), ...(defaults ? { defaults } : {}) });
  const rivals = await rivalVpns();
  if (rivals.length) process.stderr.write(`Warning: another VPN is on (${rivals.join(', ')}). Turn it off first: two VPNs fight over the same traffic.\n`);
  // LIM-5: the exact limit is signed after the confirm and before any deposit; a failure pays nothing.
  if (raiseToLine) {
    const rs = await deviceSetup(raiseTo!);
    if (!rs.ok) fail(`The spending limit was not set to ${raiseTo} tDVPN: ${rs.error ?? 'device setup failed'}. Nothing was paid.`, 'spending-limit', `${CLI} device setup --allowance ${raiseTo} --yes, then ${pinnedUpLine(a, node!.address, inp)} --yes`);
  }
  // M13: an agent that reconnected out of a held block is told so (connect() itself refuses a block it cannot lift).
  const blockedBefore = !already && await noInternet();
  const r = await connect({ node: node!.address, basis: inp.basis, units: inp.units, confirmed: true, subscription, ...(already ? { switch: true } : {}), ...(subscription ? {} : { shownEscrow: c.escrow }) });
  // 'preflight' carries the same shortfall by text (cost.ts fundingBlocker).
  if (!r.ok) {
    if (serverFailed(r.code)) recordFailed(node!.address, r.code!);
    const open = subscription ? null : await openDepositOn(node!.address, r.code);
    // E-37: a failure after the deposit is the server's refusal, not "unknown"; that server is skipped next time.
    const generic = !r.code || r.code === 'unknown' || r.code === 'connect-failed';
    if (open && generic) recordFailed(node!.address, 'node-refused');
    fail(generic ? namedFailure(r.error, !!open) : r.error ?? 'Connect failed.', open && generic ? 'node-refused' : r.code ?? 'connect-failed', nextFor(isLimitShort(r.error ?? '', r.code) ? 'spending-limit' : r.code, process.platform, { action: (r as { action?: string }).action, error: r.error, open }));
  }
  const ans = upAnswer(r.data!, node!.countryCode, deposit, await exitIp(r.data!.id), homeIp(), sessionWholeDevice(r.data!));
  if (blockedBefore) ans.blockedBefore = true;
  if (defaults) ans.defaults = defaults;
  if (dead) { ans.replaced = { node: already!.node, code: 'server-stopped' }; ans.replacedNote = `${SERVER_STOPPED_MESSAGE} Switched to ${r.data!.node}; ${already!.node} is skipped next time.`; }
  if (skipped) { ans.skipped = skipped; ans.skippedNote = skippedNote(skipped); }
  // W91b (the agent kit rc.9): a first connect whose limit was capped at the wallet says so, as `device setup` does (W91).
  if (!subscription && allowanceBefore === null && settingBase !== null) {
    const after = await refreshWallet().then((w) => w?.grant?.allowance ?? null, (err: Error) => { log.warn('agent up: wallet re-read for the limit note failed', { err: err.message }); return null; });
    if (typeof after === 'string' && /^\d+$/.test(after) && BigInt(after) < settingBase) {
      ans.limitCapped = tdvpn(after);
      ans.limitNote = `No --allowance: the spending limit is this wallet's ${tdvpn(after)} tDVPN, below the Settings limit of ${tdvpn(settingBase.toString())} tDVPN. After funding, raise it with ${CLI} device setup --allowance <N> --yes.`;
    }
  }
  if (!subscription && allowanceBefore !== null) {
    const after = await refreshWallet().then((w) => w?.grant?.allowance ?? null, (err: Error) => { log.warn('agent up: wallet re-read for the limit check failed', { err: err.message }); return null; });
    const raised = limitRaise(allowanceBefore, after, c.escrow);
    if (raised) { ans.limitRaised = raised; ans.limitNote = limitRaiseNote(raised); }
  }
  clearFailed();
  writeAgentMarker({ session: r.data!.id, node: r.data!.node, protocol: r.data!.service });
  o.print(human(ans), ans);
};

// ─── agent down ───
const down: Cmd = async (a, o) => {
  // With no wallet readSettlements() is [] and the plan would say "close 0 deposits" while some are open.
  // `disconnect` needs no wallet (it only stops the service's session), so an agent that must leave the VPN can.
  if (!ownerAddress()) {
    // E-18: a lost key file is restored, not replaced by an import of "some" wallet.
    const m = walletMissing('agent down');
    if (m.code === 'keyfile-missing') fail(m.message, m.code, `${CLI} disconnect to leave the VPN now; ${m.next}`);
    fail('No wallet, so the deposits cannot be read or closed.', 'no-wallet', `${CLI} disconnect to leave the VPN now; ${CLI} wallet import <file> (the wallet that paid), then ${CLI} agent down --yes to close the deposits`);
  }
  await adoptRunningSession();
  const live = snapshot().session;
  const spent = live?.spent ?? null;
  // Settling signs transactions with the agent's key: like every command that spends, nothing runs without --yes.
  // A per-hour deposit is charged until its channel is closed (settlement.ts: refundable = streamLeft(now)), and the
  // app's close-soon timer (settleChannelSoon) never fires in a CLI process that exits, so the plan names it apart.
  // The live session's own deposit reads 'in-use' (settlement.ts inUse): the disconnect below frees it and the settle
  // run closes it, so the plan counts it (Linux walk c2 S6 said 0 while --yes closed it). Another session's stays out.
  const due = (await readSettlements()).filter((x) => x.status === 'open' || x.status === 'ready'
    || (x.status === 'in-use' && !!live?.channel && x.channel === live.channel));
  const perHour = due.filter((x) => x.mode === MODE_STREAM).length;
  confirm(a, o, `${live ? `Disconnect from ${live.node}, then c` : 'C'}lose ${perHour} per-hour deposit(s) (they bill until closed) and start closing ${due.length - perHour} per-GB deposit(s); refunds go to your wallet.`, { session: live?.id ?? null, perHour, perGb: due.length - perHour });
  let stopped: unknown = null;
  // `disconnect` as is (it also puts back a system proxy left with no session, and releases the kill switch unless persist).
  try {
    await disconnectCmd(a, { json: true, print: (_h, d) => { stopped = d ?? null; } });
  } catch (err) {
    // A5: no settle runs after a failed disconnect, and a live session's deposit cannot be closed while the session is
    // up (settlement.ts planChannel 'in-use'), so a per-hour deposit keeps billing: say so and name what works.
    // index.ts rewrites an error whose text is a raw service / RPC failure (daemonErrorCopy, rpcUnavailableCopy) and
    // would drop this message and action: take the plain sentence and code here, so the raw text never reaches it.
    const e = err as Error & { code?: string };
    const dc = daemonErrorCopy(e.message);
    const rpc = dc ? null : rpcUnavailableCopy(e);
    const reason = dc?.message ?? rpc?.message ?? e.message;
    // review #2 (rc.6): dns-revert-failed comes AFTER the session stopped; only the DNS put-back failed. Saying
    // "could not disconnect" was false, and the real fix is restore-network; agent down again closes the deposits.
    if (e.code === 'dns-revert-failed') fail(`The session stopped, but this computer's DNS could not be put back. No deposit was closed yet. ${reason}`,
      'dns-revert-failed', `${CLI} daemon restore-network, then ${CLI} agent down --yes again (it closes the deposits)`);
    fail(`Could not disconnect, so no deposit was closed (a per-hour deposit keeps billing). ${reason}`,
      dc?.code ?? (rpc ? 'rpc-unavailable' : e.code ?? 'stop-failed'), `${CLI} daemon doctor, then ${CLI} agent down --yes again`);
  }
  // One settle run closes the per-hour deposits at once and starts the 2 h close of the per-GB ones.
  const r = await runSettlement();
  // 'busy' (another run in THIS process, settlement.ts:148) is a failure too: answering ok would hide a per-hour deposit still billing.
  if (r.code === 'busy') fail('Disconnected, but another refund run was busy, so the deposits were not closed.', 'busy', `${CLI} settle run --yes`);
  if (!r.ok) fail(r.error ?? 'Settling failed.', r.code ?? 'settle-failed', `${CLI} settle list`);
  const signatures = r.data ?? [];
  const left = await readSettlements();
  const refundable = left.reduce((t, x) => t + BigInt(x.refundable || '0'), 0n);
  // E-89 (blind T-C, rc.6): `spent` came from the session (chain redeemed) and `refundable` from the daemon's signed
  // vouchers, so the two did not add up to the deposit (0.000001 + 0.001883 of 0.002). Both now come from the same rows:
  // deposited = spent + refundable, always. With no rows left, the session's own figure stays.
  // A row with no readable escrow (older dvpnd, a mock) gives no total: then the session's own figure stays.
  const known = left.length > 0 && left.every((x) => /^\d+$/.test(String(x.escrow ?? '')));
  const depositedSum = known ? left.reduce((t, x) => t + BigInt(x.escrow), 0n) : null;
  const deposited = depositedSum !== null && depositedSum >= refundable ? depositedSum : null;
  const spentNow = deposited !== null ? deposited - refundable : (spent === null ? null : BigInt(spent));
  const readyAt = left.reduce((t, x) => Math.max(t, x.readyAt ?? 0), 0);
  // E-72 (Windows rc.4, review): a deposit opened by another device of this wallet (a replaced one) stays open:
  // this computer cannot close it, and the answer said ok with nothing about it. Name it and the command that closes it.
  const stuck = otherDeviceOpen(left);
  const next = stuck ? stuck.next
    : readyAt ? `${CLI} settle run --yes after ${new Date(readyAt * 1000).toISOString()} (a closing deposit waits 2 h), then ${CLI} settle withdraw --yes`
      : left.length ? `${CLI} settle list` : `${CLI} agent up --yes to connect again`;
  const ans = { ok: true, disconnected: stopped, ...(deposited !== null ? { deposited: tdvpn(deposited), depositedBase: String(deposited) } : {}), spent: spentNow === null ? null : tdvpn(spentNow), spentBase: spentNow === null ? null : String(spentNow), refundable: tdvpn(refundable), refundableBase: String(refundable), readyAt: readyAt || null, signatures, pending: left, next, ...(stuck ? { notClosed: stuck.rows, warning: stuck.warning } : {}) };
  o.print(`Disconnected.${deposited !== null ? ` Deposited ${tdvpn(deposited)} tDVPN.` : ''}${spentNow !== null ? ` Spent ${tdvpn(spentNow)} tDVPN.` : ''} Refundable ${tdvpn(refundable)} tDVPN.\nNext: ${next}`, ans);
};

/** E-72: open deposits another device of this wallet opened, which this computer's settle run does not start. Pure. */
export function otherDeviceOpen(rows: PendingSettlement[]): { rows: { channel: string; device: string }[]; warning: string; next: string } | null {
  const open = rows.filter((x) => x.status === 'open' && !!x.device).map((x) => ({ channel: x.channel, device: x.device! }));
  if (!open.length) return null;
  const dev = open[0].device;
  const n = open.length;
  return {
    rows: open,
    warning: `${n} deposit(s) opened by another device of this wallet (${dev}) are still open: this computer cannot close them, so nothing was refunded for them.`,
    next: `${CLI} device revoke --device ${dev} --yes (if it is not revoked yet), then ${CLI} settle run --device ${dev} --yes`,
  };
}

/** No session's internet answers (status-cmd's TCP-only probe, same budget as `status`). */
async function noInternet(): Promise<boolean> {
  return (await within(internetProbe(STATUS_NET_BUDGET_MS), STATUS_NET_BUDGET_MS + 300, 'the internet check')) === false;
}

// ─── agent status ───
/** What to do next from where the agent stands. Pure; unit-tested. */
export function statusNext(p: { owner: string | null; wallet: WalletStatus | null | undefined; live: boolean; reachable: boolean; device: string | null; blocked?: boolean; noWalletNext?: string; reconnectNext?: string | null }): string {
  if (p.reconnectNext) return p.reconnectNext; // E-41 (C): reconnecting with the internet held
  const noWalletNext = p.noWalletNext ?? nextFor('no-wallet'); // E-18: walletMissing() when known
  // CODE-AUDIT M13 (A): no session and no internet (kill switch held): both ways out, never only "agent up".
  // R3 gap 3 (review STATE-MATRIX): `next` is ONE runnable command (E-86); the other way out is statusAlso().
  if (p.blocked && !p.live) return p.owner ? `${CLI} agent up --yes` : `${CLI} daemon restore-network`;
  if (!p.owner) return noWalletNext;
  if (p.live) return `${CLI} agent down --yes`;
  if (!p.wallet) return `${CLI} agent status (the balances could not be read; try again in a moment)`;
  const short: string[] = [];
  if (!p.wallet.ready && p.wallet.ownerLamports < AGENT_SOL_MIN) short.push(`${sol(AGENT_SOL_MIN)} SOL`);
  if (BigInt(p.wallet.ownerTdvpn) + BigInt(p.wallet.userBalance) === 0n) short.push('tDVPN (enough for one deposit: node price x units)');
  if (short.length) return `send at least ${short.join(' and ')} to ${p.owner}, then ${CLI} agent up --yes`;
  // E-84 (Linux rc.5): a fresh computer (no device, no service) was told "agent up --yes", which cannot start the service. agent up makes the device itself; the service it cannot.
  if (!p.reachable) return nextFor('daemon-missing');
  // R3 gap 2 (STATE-MATRIX): a device with no spending permission (revoked, or used up) or under 1 tDVPN held walked
  // into a refusal on "agent up --yes". The preview pays nothing and names the deposit, the limit raise or the shortfall.
  const allowance = p.wallet.grant ? String(p.wallet.grant.allowance ?? '0') : null; // no grant object = not read yet
  // Under 1 tDVPN of permission covers no market deposit (a revoked device reads grant null: connect signs a new one).
  const noPermission = !!p.device && allowance !== null && (!/^\d+$/.test(allowance) || BigInt(allowance) < 1_000_000n);
  if (noPermission || BigInt(p.wallet.ownerTdvpn) + BigInt(p.wallet.userBalance) < 1_000_000n) return `${CLI} agent up`;
  return `${CLI} agent up --yes`;
}

/** R3 gap 3: the second way out of a block with no session (statusNext names the first). Null otherwise. */
// Runnable as printed (the reason is in the status text: restore-network goes direct, protection off until the next connect).
export const BLOCKED_ALSO_OWNER = `${CLI} daemon restore-network`;
export function statusAlso(p: { owner: string | null; live: boolean; blocked?: boolean; noWalletNext?: string }): string | null {
  if (!p.blocked || p.live) return null;
  return p.owner ? BLOCKED_ALSO_OWNER : `then ${p.noWalletNext ?? nextFor('no-wallet')}`;
}

/** The deposits on chain, or null when they cannot be read in the status budget (a failed read is logged, never thrown). */
async function readDeposits(): Promise<PendingSettlement[] | null> {
  try {
    return (await within(readSettlements(), STATUS_NET_BUDGET_MS, 'reading deposits')) ?? null;
  } catch (err) {
    log.warn(`agent status: deposits not read: ${(err as Error).message}`);
    return null;
  }
}

/** rc9-e: the kill switch setting (undefined when unreadable: nothing is claimed). */
function ksSetting(): string | undefined {
  try {
    return getDaemonSettings().settings.killSwitch;
  } catch (err) {
    log.warn(`agent status: kill switch setting not read: ${(err as Error).message}`);
    return undefined;
  }
}

/** WIN-W5: the kill switch setting is on or persist (unreadable = not known, so nothing is claimed). */
function killSwitchOn(): boolean {
  try {
    const k = getDaemonSettings().settings.killSwitch;
    return k === 'on' || k === 'persist';
  } catch (err) {
    log.warn(`agent status: kill switch setting not read: ${(err as Error).message}`);
    return false;
  }
}
export const KS_NOT_HOLDING = 'The kill switch is on but is not blocking: the server ended the session and traffic now goes out directly, not through the VPN.';

/** The session the node ended within the last 30 min (dvpnd's own reason in history), else null. */
function endedByServer(now = Date.now()): { node: string; endedAt: number; reason: string } | null {
  try {
    const h = listHistory()[0];
    return h?.endedAt && now - h.endedAt < 30 * 60_000 && stoppedReason(h.closeReason) ? { node: h.node, endedAt: h.endedAt, reason: h.closeReason! } : null;
  } catch (err) {
    log.warn(`agent status: history not read: ${(err as Error).message}`);
    return null;
  }
}

const status: Cmd = async (a, o) => {
  const owner = ownerAddress();
  // M-S (the agent kit rc.8, macOS kit): a key file others can read was named only by `agent up`; status read exit 0 with the
  // normal next. It stays a read (ok:true), names the problem and sends the agent to the chmod line first.
  const kfm = owner ? keyfileModeProblem(str(a, 'keyfile') ?? process.env.DVPN_KEYFILE) : null;
  const [wallet, deposits, , clockRead] = await Promise.all([
    owner ? within(refreshWallet(), STATUS_NET_BUDGET_MS, 'the wallet read') : Promise.resolve(null),
    owner ? readDeposits() : Promise.resolve(null),
    within(adoptRunningSession({ watch: false }), STATUS_NET_BUDGET_MS, 'reading the daemon session'),
    owner ? within(clockCheck(), STATUS_NET_BUDGET_MS, 'the chain clock') : Promise.resolve(null), // WIN-W7
  ]);
  const live = snapshot().session;
  const d = daemonInfo();
  const ip = live ? await exitIp(live.id) : null;
  // E-35 / E-36: a session whose exit address is this computer's own is not tunnelled; one the server ended says why.
  const liveStopped = !!live && exitIsDirect(ip, homeIp());
  // L-STALE (the agent kit rc.8, Linux R4): a server that ended the session read server-stopped for 30 min, even after agent
  // down had closed its deposits and the block was lifted, so status hid the real state (the funding ask). With no
  // live session it is cleared once the internet answers direct and no deposit with that server is still open.
  const noNet = !live && !sessionStateUnknown() ? await noInternet() : null;
  const endedRaw = !live ? endedByServer() : null;
  // WIN-W5 (the agent kit rc.9, K3-L): the kill switch is on, dvpnd ended the session itself and the internet answers direct:
  // the block was released while the setting still reads on. Said, never hidden (holding the block is upstream).
  const ksLeak = !!endedRaw && noNet === false && killSwitchOn();
  const stillOpen = (node: string): boolean => (deposits ?? []).some((x) => x.node === node && (x.status === 'open' || x.status === 'in-use'));
  const ended = endedRaw && !(noNet === false && !stillOpen(endedRaw.node)) ? endedRaw : null;
  const stopped = liveStopped ? { node: live!.node, session: live!.id, reason: 'the exit address is this computer\'s own' } : ended ? { node: ended.node, session: null, reason: ended.reason } : null;
  if (stopped) recordFailed(stopped.node, 'server-stopped');
  // E-87 (Linux rc.6 Q5, review): a session that reconnects with the internet held passes no traffic: it read
  // connected:true with no blocked and a prose next. Now connected:false, reconnecting + blocked true, next = one command.
  const reconnectNext = !!live && !liveStopped ? reconnectBlockedNext(snapshot().conn) : null;
  const reconnecting = !!reconnectNext;
  const connected = !!live && !liveStopped && !reconnecting;
  const blocked = reconnecting || noNet === true; // the same probe as before, read once (L-STALE)
  const missing = owner ? null : walletMissing();
  const dNext = !connected && !reconnecting && deposits ? depositNext(deposits) : null;
  // E-75 (blind round 3 T-C, Linux rc.4): with the service down, the blocker is the service, not the deposit wait;
  // `next` named only "agent down --yes after <2 h>", so an agent running it as printed never connected.
  const serviceDown = !connected && !reconnecting && !stopped && !!owner && !d.reachable; // E-84: with or without a device
  // E-82 (Linux rc.4 phase 7, T7): the server stopped AND the kill switch holds the block. `next` said only
  // "agent up --yes"; the way out of the block (restore-network) was never named, while plain `status` named it.
  // E-86 (Linux rc.5, review): `next` is ONE runnable command. During a block that is restore-network; the reconnect
  // or the close goes to alsoNext (the prose form could not be run verbatim by an agent).
  const stoppedNext = blocked ? `${CLI} daemon restore-network` : SERVER_STOPPED_NEXT;
  const stoppedAlso = blocked ? `then ${CLI} agent up --yes to reconnect, or ${CLI} agent down --yes to close the deposit` : SERVER_STOPPED_ALSO;
  // T-C row 16 (RC8 W47): installed but stopped is one start of the socket, not a reinstall (daemon install = root, a minute).
  const startNext = serviceDown ? stoppedStartNext(await linuxUnits(), SERVICE_NAME) : null;
  // rc9-d: set up for another wallet: the switch comes before the service (installing it again loops).
  const otherW = !connected && !reconnecting && !stopped ? readOtherWallet(owner) : null;
  const next0 = stopped ? stoppedNext : reconnectNext ? reconnectNext : otherW ? SWITCH_NEXT : serviceDown ? startNext ?? nextFor('daemon-missing', process.platform) : dNext ?? statusNext({ owner, wallet, live: connected, reachable: d.reachable, device: d.device, blocked, noWalletNext: missing?.next, reconnectNext: null });
  // M-S: the chmod comes first, except where the way out of a block does (the internet back before anything else).
  // CLOCK-UNKNOWN (rc9-c, review L3 w11): a read that missed the budget (public RPC 429) or found no chain time was
  // dropped silently, so status looked like a checked clock. Say it was not checked; never claim a skew.
  const clock = clockRead && clockRead.kind === 'block' ? clockRead : null;
  const clockUnknown = !!owner && (clockRead === undefined || clockRead?.kind === 'unknown');
  // WIN-W7: the way out of a block first, then the key file, then the clock (no server takes a wrong clock).
  const blockNext = next0.startsWith(`${CLI} daemon restore-network`);
  const next1 = clock && !blockNext ? CLOCK_NEXT() : next0;
  const next = kfm && !blockNext ? keyfileModeNext(kfm.path) : next1;
  const message = stopped ? `${SERVER_STOPPED_MESSAGE} ${depositSafe(deposits ?? [])}` : null;
  const ans = {
    ok: true, address: owner, ...(missing?.code === 'keyfile-missing' ? { keyfileMissing: missing.message } : {}), ...(kfm ? { keyfileMode: keyfileModeText(kfm) } : {}), ...(clock ? { clockSkewSec: clock.skewS, clock: clock.error } : clockUnknown ? { clock: 'unknown', clockNote: 'not checked: the chain clock did not answer in time' } : {}), ...(ksLeak ? { killSwitchHolding: false, killSwitch: KS_NOT_HOLDING } : {}), sol: wallet ? sol(wallet.ownerLamports) : null, solLamports: wallet ? String(wallet.ownerLamports) : null, tdvpn: wallet ? tdvpn(wallet.ownerTdvpn) : null, tdvpnBase: wallet ? String(wallet.ownerTdvpn) : null,
    held: wallet ? tdvpn(wallet.userBalance) : null, heldBase: wallet ? String(wallet.userBalance) : null, device: d.device, service: d.reachable,
    connected, ...(connected && live ? { session: live.id, node: live.node, protocol: live.service, spent: tdvpn(live.spent), spentBase: String(live.spent), exitIp: ip?.ip ?? null, wholeDevice: sessionWholeDevice(live), socks: live.proxyEndpoint && !isAndroid() ? `socks5h://${live.proxyEndpoint}` : null } : {}),
    ...(stopped ? { code: 'server-stopped', message, nodeStopped: stopped, alsoNext: stoppedAlso } : {}),
    ...(otherW ? { code: 'wallet-switch-needed', serviceWallet: otherW, message: switchMessage(otherW, owner!), alsoNext: switchAlsoNext(otherW) } : {}),
    ...(deposits?.length && depositRows(deposits).length ? { deposits: depositRows(deposits) } : {}),
    ...(reconnecting && live ? { reconnecting: true, session: live.id, node: live.node, protocol: live.service, alsoNext: RECONNECT_BLOCKED_ALSO } : {}),
    ...(blocked ? { blocked: true } : {}), next,
    // rc9-e H: on in an SSH / RDP session: a lost connection locks this computer out, a reboot included.
    ...ksRemoteRiskFields(ksSetting()),
    ...(serviceDown && startNext ? { alsoNext: `then ${CLI} agent up --yes${dNext ? ` (or ${dNext})` : ''}` } : serviceDown && dNext ? { alsoNext: dNext } : {}),
    ...(!stopped && !reconnecting && !serviceDown && !dNext && statusAlso({ owner, live: connected, blocked, noWalletNext: missing?.next }) ? { alsoNext: statusAlso({ owner, live: connected, blocked, noWalletNext: missing?.next }) } : {}),
  };
  o.print(`${connected && live ? `Connected to ${live.node} (${live.service})` : reconnecting ? 'Reconnecting, and the internet is blocked to protect you' : stopped ? `Not connected: ${message}` : blocked ? 'Not connected, and the internet is blocked' : 'Not connected'}. Wallet ${owner ?? 'none'}${wallet ? `  ${sol(wallet.ownerLamports)} SOL  ${tdvpn(wallet.ownerTdvpn)} tDVPN` : ''}\nNext: ${next}`, ans);
};

export const agentCmd: Cmd = async (a, o) => {
  const sub = a._[1] ?? 'status';
  if (sub === 'up') return up(a, o);
  if (sub === 'down') return down(a, o);
  if (sub === 'status') return status(a, o);
  throw new UsageError(`unknown: agent ${sub} (up | down | status)`);
};
