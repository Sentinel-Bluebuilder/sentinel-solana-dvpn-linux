// ─── Connect / disconnect (F9, F11, F12) ───
// "Fail before paying": every zero-cost check runs before the daemon is asked to
// open a channel. The daemon then opens the channel with the device key, brings
// the tunnel up, signs vouchers every 60 s and reconnects on its own (D6).
// Never show "Disconnected" before StopSession returns (docs/29 §3).
import type { ConnectRequest, LiveSession, Result } from '../../shared/types';
import { fetchOne } from '../../core/chain/accounts';
import type { DaemonClient, DaemonSession, DaemonChannel, Credential } from '../../core/daemon/client';
import { stopLiveOrCurrent } from './stop-session';
import { waitForDaemon, SERVICE_WAIT_MS } from './daemon-wait';
import { prepayCost, preflight, reusableChannel, planLimitReached, heldTicket, nodeHasRoom, markReuseRefused } from './connect-checks';
import { ensureHomeIp } from '../home-ip';
import { withCheckingWatch } from '../../core/session/checking-watch';
import type { Copy } from '../../core/session/state';
import { closeReasonCopy, connectErrorCopy, preflightCode, phaseFromDaemon, viewFor, TICKET_RETRY_DELAYS_MS, RPC_BUSY_DELAYS_MS, openedChannelOn429, newDepositAfter429, adoptedChannelMissing, ADOPT_LAG_DELAYS_MS } from '../../core/session/state';
import { discoverNode as lookupNode } from '../../core/nodes/discovery';
import { costPreview } from '../../core/pricing/cost';
import { MODE_STREAM, MODE_VOUCHER } from '../../core/chain/idl';
import { daemon, daemonInfo, deviceRecord, grantPipeAccess, restartAndroidDaemon, startServiceIfStopped, withLinkWatch } from '../daemon/manager';
import { connectMove, serviceView } from '../../core/daemon/service-state';
import { isAndroid } from '../../shared/is-android';
import { androidHeldBlock } from '../android/android-bridge';
import { noWallet, ownerAddress } from '../wallet/vault';
import { ensureDevicePermission, serviceSwitchPending } from './wallet';
import { RELOGIN_COPY } from '../../core/daemon/link-copy';
import { applyMarkerFresh, beginServiceTransition, onTransitionBegan, onTransitionSettled, RESTARTING_COPY, serviceInTransition } from './service-transition';
import { patch, setRedialFollow, setSplitInEffect, setWholeDeviceInEffect, snapshot, toast } from '../app-state';
import { recordStart, recordEnd, closeEndedHistory } from './history';
import { claimForReuse, readSettlements, settleChannelSoon, settlesOnEnd } from './settlement';
import { clearSystemProxy, setSystemProxy } from '../system/proxy';
import { log } from '../logger';
import { getDaemonSettings, serviceUsesTun, splitForSession } from '../daemon/settings';
import { getSettings } from '../system/settings';
import { osWord } from '../../shared/os-words';
import { waitForDirect } from '../system/direct-wait';
import { publicIp } from '../../core/quality/quality';
import { DEFAULT_POLL } from '../../shared/poll';
import { internetReachable } from '../../core/quality/reachability';
import { getRpcUrls, onRpcRetry, overLimitState, resetRpcTransport } from '../../core/chain/rpc';
import { waitForDirectPath } from './net-settle';
import { getHost } from '../host';
import { cancelRequested, clearConnecting, markConnecting, otherConnect, requestCancel, waitConnectEnded } from './connect-marker';
import { dnsReallyLeftOver, flushDnsCache } from '../system/dns-check';
import { leftoverTunnels, openvpnRunning, removeTunnelServices, restoreNetworkSweep, rivalVpns } from '../system/tunnels';
import { firstData } from './first-data';
import { tr, trPlural } from '../../shared/i18n';
import { actionSentence } from '../../shared/connect-action';

let unwatch: (() => void) | null = null;

let pollTimer: NodeJS.Timeout | null = null;
let cancelled = false;

/** The shared data dir for the cross-process connect marker (DC1); null where no host is set (unit tests). */
let markerDirWarned = false;
function markerDir(): string | null {
  try {
    return getHost().dataDir;
  } catch (err) {
    if (!markerDirWarned) log.warn('connect marker: no data dir', { err: (err as Error).message });
    markerDirWarned = true;
    return null;
  }
}

/** A connect is running in another process (the CLI): the app looks for its session more often. */
export function connectRunningElsewhere(): boolean {
  const dir = markerDir();
  return dir ? otherConnect(dir) !== null : false;
}

/** Cancel pressed here, or a Disconnect run in another process asked this connect to stop (DC1). */
function isCancelled(): boolean {
  if (!cancelled) {
    const dir = markerDir();
    if (dir && cancelRequested(dir)) {
      log.info('connect: stop requested by another process');
      cancelled = true;
    }
  }
  return cancelled;
}

/**
 * DC1: a Disconnect while ANOTHER process is still connecting (a CLI connect paying its deposit) found
 * no session and answered "No active session.", then that connect finished. Ask it to stop, ask dvpnd
 * to stop the start it may be inside, and wait for it to end. Returns false when no connect was running.
 */
export async function stopOtherConnect(waitMs = 60_000): Promise<{ stopped: boolean; ended: boolean }> {
  const dir = markerDir();
  const other = dir ? otherConnect(dir) : null;
  if (!dir || !other) return { stopped: false, ended: true };
  log.info('disconnect: a connect is running in another process; asking it to stop', { pid: other.pid, node: other.node });
  requestCancel(dir, other);
  try {
    await daemon().stopSession('');
  } catch (err) {
    if ((err as { kind?: string }).kind !== 'not-found') log.warn('disconnect: could not ask the VPN service to stop connecting', { err: (err as Error).message });
  }
  const ended = await waitConnectEnded(dir, other, waitMs);
  if (!ended) log.warn('disconnect: the other connect did not end in time', { pid: other.pid, waitMs });
  return { stopped: true, ended };
}
/** Sessions picked up while the app was open but started elsewhere (the CLI): shown, never auto-settled. */
/** dvpnd's own words for an RPC rate limit, besides 429 (2026-11-12: "unavailable: the network is unreachable or busy"). */
export const RPC_BUSY_RE = /429|Too Many Requests|network is unreachable or busy/i;
/** The call never left this app: the link to the VPN service was down when it was made (gRPC's own words). */
export const LINK_NEVER_SENT_RE = /No connection established/i;
const LINK_SETTLE_MS = process.env.VITEST ? 0 : 1500;
/** Project rule: 7 s between chain transactions. */
export const TX_GAP_MS = 7000;
/** Row 73 / CODE-AUDIT E6: the 7 s wait is for the public endpoint only (it answers "busy" to a quick second one). */
export function txGapMs(): number {
  try {
    return overLimitState().inUse === 'public' ? TX_GAP_MS : 0;
  } catch (err) {
    log.info('connect: endpoint in use not known, keeping the 7 s wait', { err: (err as Error).message });
    return TX_GAP_MS;
  }
}
/** CODE-AUDIT U-13: the fresh price is above the one shown. */
export const PRICE_CHANGED_COPY = (): string => tr('This server\'s price changed since the list was read. Nothing was paid. Connect again to see the new price.');
/** CODE-AUDIT U-13/U-15: the fresh deposit is above the one the user (or the test run) was shown. No shown value = old caller, allowed. */
export function priceRaised(escrow: string, shown: string | undefined): boolean {
  if (!shown || !/^\d+$/.test(shown)) return false;
  return BigInt(escrow) > BigInt(shown);
}
/**
 * U-M4-1 (rc9-c2): a NEW deposit above zero that no shown amount came with. The Connect sheet sends none when it
 * offers an open deposit ("nothing new is paid"); when that deposit is gone by the time connect() looks, paying a
 * new one would spend an amount nobody saw. True = refuse, nothing paid.
 */
export function newDepositUnseen(escrow: string, shown: string | undefined): boolean {
  if (!/^\d+$/.test(String(escrow)) || BigInt(escrow) === 0n) return false;
  return !shown || !/^\d+$/.test(shown);
}
/** L-36: what the Reconnecting screen says under its title. It said "The daemon is retrying the connection.", a word the app never shows. */
export const RETRYING_DETAIL = (): string => tr('The VPN service is reconnecting to the server.');
/** CODE-AUDIT E3: a reused deposit the server refused. Nothing new is paid without the user seeing the price. */
export const DEPOSIT_UNUSABLE_COPY = (): string => tr('Your deposit with this server can no longer be used, so nothing new was paid. Connect again to see the price of a new deposit.');

// Row 74: one connect asked the chain for the same server up to four times here (the limit, the cost, the
// country, a second deposit). One answer is kept for the length of a connect; a failed read is never kept.
// dvpnd checks the price against the listing itself before it pays, so a 20 s old answer cannot overpay.
export const NODE_LOOKUP_KEEP_MS = 20_000;
const lookedUp = new Map<string, { at: number; node: ReturnType<typeof lookupNode> }>();
function discoverNode(address: string): ReturnType<typeof lookupNode> {
  const hit = lookedUp.get(address);
  if (hit && Date.now() - hit.at < NODE_LOOKUP_KEEP_MS) return hit.node;
  const node = lookupNode(address);
  lookedUp.set(address, { at: Date.now(), node });
  node.then((n) => { if (!n) lookedUp.delete(address); }, () => { lookedUp.delete(address); });
  if (lookedUp.size > 50) for (const [k, v] of lookedUp) if (Date.now() - v.at >= NODE_LOOKUP_KEEP_MS) lookedUp.delete(k);
  return node;
}
/** Tests: forget every kept server answer. */
export const resetNodeLookups = (): void => lookedUp.clear();
const foreign = new Set<string>();

// ─── Reconnect chains (DIR/FWX 10-30): dvpnd's counters are per session, the user sees one ───
/** Totals of the sessions a reconnect chain replaced, keyed by the session that carries them on. */
const chainCarry = new Map<string, { rx: bigint; tx: bigint; spent: bigint; start?: number | null }>();
const big = (v: string | undefined): bigint => {
  try { return BigInt(v || '0'); } catch (err) { log.warn('unreadable session counter; counted as 0', { v, err: (err as Error).message }); return 0n; }
};

/** What the rows before `s` in its reconnect chain used, from dvpnd's own list (a CLI has no memory). */
export function chainTotals(list: DaemonSession[], s: DaemonSession): { rx: bigint; tx: bigint; spent: bigint } {
  const t = { rx: 0n, tx: 0n, spent: 0n };
  const seen = new Set([s.id]);
  for (let prev = s.replaces; prev && !seen.has(prev);) {
    seen.add(prev);
    const row = list.find((x) => x.id === prev);
    if (!row) break;
    t.rx += big(row.usage?.rxBytes); t.tx += big(row.usage?.txBytes); t.spent += big(row.spent);
    prev = row.replaces;
  }
  return t;
}

export function toLive(s: DaemonSession): LiveSession {
  const c = chainCarry.get(s.id);
  const chainStart = Number(s.chainStartedUnix || 0);
  return {
    id: s.id,
    node: s.node,
    status: s.status,
    service: s.service,
    rxBytes: c ? String(big(s.usage?.rxBytes) + c.rx) : s.usage?.rxBytes ?? '0',
    txBytes: c ? String(big(s.usage?.txBytes) + c.tx) : s.usage?.txBytes ?? '0',
    seconds: s.usage?.seconds ?? '0',
    spent: c ? String(big(s.spent) + c.spent) : s.spent ?? '0',
    channel: s.channel ?? '',
    proxyEndpoint: s.proxyEndpoint ?? '',
    error: s.error ?? '',
    warning: s.warning ?? '',
    // the chain's first start: one timer across a reconnect that came back as a new session
    startedAt: chainStart > 0 ? chainStart * 1000 : c?.start ? c.start : s.startedAt ? Number(s.startedAt.seconds) * 1000 : null,
  };
}

export const SERVICE_MISSING_COPY = (): string => tr('The VPN service is not installed on this computer (an uninstall removes it, or it was never set up). Set it up again: Wallet > Set up device, or run: {command}. Nothing was paid.', { command: 'devnet-dvpn daemon install --yes' });

let watchWarned = false;
/** Row 121: while a button waits for the service the link retries every second. A link that has no such switch
 *  (another platform's manager, a test's stand-in) just waits at its own pace. */
async function whileWatched<T>(fn: () => Promise<T>): Promise<T> {
  let watch: typeof withLinkWatch | null = null;
  try {
    watch = withLinkWatch;
  } catch (err) {
    if (!watchWarned) { watchWarned = true; log.warn('this link has no fast retry; waiting at its own pace', { err: (err as Error).message }); }
  }
  return typeof watch === 'function' ? watch(fn) : fn();
}

function fail<T = never>(message: string, code = 'preflight', action: string | null = null, node = '', kept: KeptDeposit | null = null): Result<T> {
  patch({ conn: viewFor('error', message), lastConnectError: { code, message, action, node, ...(kept ? { kept } : {}) } });
  return { ok: false, error: message, code, action };
}

/** The note shown when a session has started. The screen's title at that moment can still be the checking stage
 *  ("Checking the connection…": the owner's laptop, build 9bf682c, got that as a green success note at the same
 *  instant as Protected), so a session that is up always says Connected; any other title is said as it is. */
export function connectedToast(title: string): string {
  return /^(Protected|Connected|Checking)/.test(title) ? 'Connected' : title;
}

export const OTHER_WALLET_COPY = (): string => tr('The VPN service on this computer is still set up for another wallet, so it would pay from that wallet. Set up this computer for the current wallet (Wallet > Set up device), then connect. Nothing was paid.');
/** True when the service's device record names a wallet other than this one. No record (not set up yet, or a
 *  link that keeps none) = false: the other checks speak for that. */
/**
 * rc.4 E-27: who paid this deposit, from the deposit account (the service spends for the wallet its device is
 * set up for, which is not always the loaded one). A wallet other than `loaded` is logged; null = unreadable.
 */
export async function payerOf(channel: string, loaded: string, read = (c: string) => fetchOne('channel', c)): Promise<string | null> {
  if (!channel) return null;
  try {
    const acct = await read(channel);
    const payer = acct?.owner ? String(acct.owner) : null;
    if (payer && payer !== loaded) log.warn('the deposit was paid by another wallet than the loaded one', { channel, payer, loaded });
    return payer;
  } catch (err) {
    log.warn('could not read who paid the deposit', { channel, err: (err as Error).message });
    return null;
  }
}

function serviceWalletIsNot(owner: string): boolean {
  try {
    const rec = deviceRecord();
    return !!rec && !!rec.owner && rec.owner !== owner;
  } catch (err) {
    if (!recordWarned) { recordWarned = true; log.warn('this link keeps no device record; the wallet check is skipped', { err: (err as Error).message }); }
    return false;
  }
}
let recordWarned = false;

type KeptDeposit = { channel: string; amount: string };
/** Row 79: the deposit this computer holds with a server after a failed connect, with what is left of it (base
 *  units). The newest open one. null = none, or the service could not be asked (then nothing is claimed). */
export function keptOf(channels: Array<{ address: string; node: string; escrow: string; cumulative: string; openedAt: string; status: string }>, node: string): KeptDeposit | null {
  const open = channels.filter((c) => c.node === node && !/clos|settl/i.test(c.status));
  if (!open.length) return null;
  const c = open.reduce((a, b) => (Number(b.openedAt) > Number(a.openedAt) ? b : a));
  try {
    const left = BigInt(c.escrow || '0') - BigInt(c.cumulative || '0');
    return left > 0n ? { channel: c.address, amount: left.toString() } : null;
  } catch (err) {
    log.warn('deposit amounts not readable', { channel: c.address, err: (err as Error).message });
    return null;
  }
}
async function keptDeposit(node: string): Promise<KeptDeposit | null> {
  try {
    return keptOf(await daemon().listChannels(), node);
  } catch (err) {
    log.info('could not ask the VPN service for the deposit kept with this server', { err: (err as Error).message });
    return null;
  }
}

/** The user stopped the connect (Cancel, or Disconnect while connecting): not a failure. Home goes back
 *  to "Not connected" with the note and a "Connect again" button; nothing turns red. */
function stoppedByUser<T = never>(message: string, node: string): Result<T> {
  const action = 'Connect again';
  patch({ conn: viewFor('idle', message), lastConnectError: { code: 'cancelled', message, action, node }, lastCloseMessage: null });
  return { ok: false, error: message, code: 'cancelled', action };
}

/** quiet: a server test's start, nothing on the Connect screen. onDeposit: called the moment a deposit paid for
 *  this start is known (the service names it after a busy read, or its list shows it), before the tunnel is up. */
async function startWithRetry(node: string, firstCred: Credential, isTicket: boolean, basis?: 'per_gb' | 'per_hour', opts: { quiet?: boolean; onDeposit?: (channel: string) => void } = {}): Promise<DaemonSession> {
  let cred = firstCred;
  const delays = isTicket ? [0, ...TICKET_RETRY_DELAYS_MS] : [0];
  // The public RPC rate-limits dvpnd (429) while it reads an existing deposit or ticket. Nothing
  // is paid before that read, so retrying is safe. A new deposit is retried only as that deposit.
  const reuse = !('newChannel' in cred);
  // Deposits that existed before this attempt: a 429 can then be told apart from a paid deposit.
  const channelsNow = async (): Promise<DaemonChannel[] | null> => {
    try { return await daemon().listChannels(); } catch (err) { log.warn('listing channels for a 429 check failed', { error: (err as Error).message }); return null; }
  };
  let before = reuse ? null : new Set((await channelsNow())?.map((c) => c.address) ?? []);
  let busy = 0;
  // A deposit carried on with after a 429; if the chain never shows it, it was not paid (see below).
  let adopted: string | null = null;
  let missing = 0;
  let repaid = false;
  let linkRetried = false;
  let last: unknown;
  for (let i = 0; i < delays.length; i++) {
    if (isCancelled()) throw new Error('cancelled'); // copy:internal
    if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
    try {
      // Q0357: dvpnd answers only after its tunnel check (up to ~13 s); say so meanwhile.
      return await withCheckingWatch(daemon().startSession(node, cred, isTicket ? undefined : basis), {
        listSessions: () => daemon().listSessions(),
        onChecking: () => { if (!opts.quiet && !isCancelled()) patch({ conn: viewFor('checking') }); },
      });
    } catch (err) {
      last = err;
      const msg = (err as Error).message;
      // Windows VM 2026-11-15 (c975868, case C): the service restarted while Connect was at "Paying deposit…".
      // The start was never sent ("No connection established"), so nothing was paid, yet Connect gave up at once
      // with "The VPN service is off". Wait for the service to answer again and send the start once more.
      if (!linkRetried && LINK_NEVER_SENT_RE.test(msg) && !isCancelled()) {
        linkRetried = true;
        log.warn('the VPN service went away before the start reached it; waiting for it to answer again', { err: msg });
        if (!opts.quiet) patch({ conn: viewFor('preflight', serviceView('restarting').sentence) });
        await new Promise((r) => setTimeout(r, LINK_SETTLE_MS)); // let the link notice it is down before asking
        const back = await whileWatched(() => waitForDaemon(SERVICE_WAIT_MS, () => daemonInfo()));
        if (back.reachable && !isCancelled()) {
          if (!reuse) before = new Set((await channelsNow())?.map((c) => c.address) ?? []);
          delays.splice(i + 1, 0, 1);
          continue;
        }
      }
      if (adoptedChannelMissing(msg, adopted)) {
        // RPC lag first: ask again for the same deposit (paying again here could pay twice).
        if (missing < ADOPT_LAG_DELAYS_MS.length) {
          log.warn('carried-on deposit not on chain yet; asking again', { channel: adopted, delay: ADOPT_LAG_DELAYS_MS[missing] });
          delays.splice(i + 1, 0, ADOPT_LAG_DELAYS_MS[missing++]);
          continue;
        }
        // Still missing after the waits: its open never landed, nothing was paid. One new deposit.
        if (!repaid && 'newChannel' in firstCred) {
          log.warn('carried-on deposit never landed; paying a new deposit', { channel: adopted });
          repaid = true; adopted = null; cred = firstCred;
          before = new Set((await channelsNow())?.map((c) => c.address) ?? []);
          delays.splice(i + 1, 0, RPC_BUSY_DELAYS_MS[0]);
          continue;
        }
      }
      // dvpnd pays a new deposit, then re-reads it; a 429 on that read names the deposit that is
      // now open and paid. Carry on with that one (no second payment) instead of failing.
      const paid = !reuse ? openedChannelOn429(msg) : null;
      if (paid && busy < RPC_BUSY_DELAYS_MS.length) {
        log.warn('rpc busy after the deposit was paid; continuing with that deposit', { channel: paid, delay: RPC_BUSY_DELAYS_MS[busy] });
        cred = { channel: paid };
        adopted = paid;
        opts.onDeposit?.(paid);
        delays.splice(i + 1, 0, RPC_BUSY_DELAYS_MS[busy++]);
        continue;
      }
      if ((reuse || 'channel' in cred) && RPC_BUSY_RE.test(msg) && busy < RPC_BUSY_DELAYS_MS.length) {
        log.warn('rpc busy while starting; retrying', { delay: RPC_BUSY_DELAYS_MS[busy] });
        delays.splice(i + 1, 0, RPC_BUSY_DELAYS_MS[busy++]);
        continue;
      }
      // New deposit, other 429 wording: retry only when dvpnd's own list proves nothing was paid.
      if ('newChannel' in cred && RPC_BUSY_RE.test(msg) && busy < RPC_BUSY_DELAYS_MS.length) {
        const d = newDepositAfter429(node, before, await channelsNow());
        if (d.action !== 'unknown') {
          if (d.action === 'adopt') { cred = { channel: d.channel }; adopted = d.channel; opts.onDeposit?.(d.channel); }
          log.warn('rpc busy while starting a new deposit', { decision: d.action, delay: RPC_BUSY_DELAYS_MS[busy] });
          delays.splice(i + 1, 0, RPC_BUSY_DELAYS_MS[busy++]);
          continue;
        }
      }
      if (!isTicket || !/ticket_invalid|invalid_ticket/.test(msg)) throw err;
      log.warn('ticket_invalid, retrying', { delay: delays[i] });
    }
  }
  throw last;
}

// ─── A server test's connect (UI-SCREENS rows 149-156): quiet, and nothing of the user's is touched ───
// The test connects to one server after another. Done through the normal path, every one of them moved the
// Connect screen, raised "Connected", set the system proxy, wrote a history entry and queued a deposit close
// that raced the test's own. This path does only what the test needs: check, pay (or use the open deposit),
// start, and report the deposit the moment it is known. It shows nothing and keeps nothing.
export interface ConnectHooks { onDeposit?: (channel: string, basis: ConnectRequest['basis']) => void }
const TEST_MAX_MS = 15 * 60_000;
let testRun: { node: string; id: string | null; at: number } | null = null;
/** A server test holds the VPN service's one session: the app does not adopt it or show it. */
export function testSessionActive(): boolean {
  if (testRun && Date.now() - testRun.at > TEST_MAX_MS) { log.warn('a server test session was never ended; releasing it', { node: testRun.node }); testRun = null; }
  return testRun !== null;
}

async function testConnect(req: ConnectRequest, hooks: ConnectHooks): Promise<Result<LiveSession>> {
  const no = (error: string, code: string, extra: { paid?: boolean; channel?: string } = {}): Result<LiveSession> => ({ ok: false, error, code, action: null, paid: false, ...extra });
  if (testSessionActive()) return no(tr('A server test is already using the VPN service.'), 'busy');
  const s0 = snapshot();
  if (s0.session || (s0.conn.phase !== 'idle' && s0.conn.phase !== 'error')) return no(tr('Disconnect first: a test uses the VPN service, which runs one session at a time.'), 'session-active');
  if (req.subscription) return no(tr('A server test pays its own deposit; it cannot run on a plan.'), 'unsupported');
  const owner = ownerAddress();
  if (!owner) { const w = noWallet(); return no(w.error, w.code); }
  let d = daemonInfo();
  // (written with its own arrow: tests find the user's Connect by its `waitForDaemon(SERVICE_WAIT_MS, daemonInfo)` line)
  if (!d.reachable) d = await whileWatched(() => waitForDaemon(SERVICE_WAIT_MS, () => daemonInfo()));
  if (!d.reachable) return no((d.service && d.service.state !== 'ready' ? d.service : serviceView('stopped')).sentence, 'daemon-unavailable');
  if (d.networkOk === false) return no(serviceView('wrong-network').sentence, 'network-mismatch');
  if (!d.device) return no(tr('Finish device setup first.'), 'no-device');
  // Windows VM 2026-11-15 (UI-SCREENS' run): a test started with a new wallet while the VPN service was still set
  // up for another one paid three deposits from that other wallet. The user's Connect moves the service to the
  // current wallet first (ensureDevicePermission); a quiet test never does an admin step, so it refuses instead.
  if (serviceWalletIsNot(owner)) return no(tr('The VPN service on this computer is set up for another wallet, so a test would be paid from that wallet. Connect once with this wallet to switch it, then test. Nothing was paid.'), 'no-device');
  testRun = { node: req.node, id: null, at: Date.now() };
  cancelled = false;
  let deposit: string | null = null;
  let reused = false;
  const told = new Set<string>();
  const tell = (ch: string): void => {
    deposit = ch;
    if (reused || told.has(ch)) return;
    told.add(ch);
    try { hooks.onDeposit?.(ch, req.basis); } catch (err) { log.warn('server test: the deposit note failed', { err: (err as Error).message }); }
  };
  const listed = async (): Promise<string[]> => {
    try { return (await daemon().listChannels()).filter((c) => c.node === req.node).map((c) => c.address); } catch (err) { log.warn('server test: could not list deposits', { err: (err as Error).message }); return []; }
  };
  try {
    const refused = await preflight(req, owner, d.device);
    if (refused) { testRun = null; return no(refused.error, refused.code ?? preflightCode(refused.error)); }
    const mode = req.basis === 'per_hour' ? MODE_STREAM : MODE_VOUCHER;
    const node = await discoverNode(req.node);
    const cost = costPreview(node!, req.basis, req.units);
    const found = await reusableChannel(req.node, mode, prepayCost(node!, req.basis));
    const open = found && claimForReuse(found) ? found : null;
    // CODE-AUDIT U-15: a price raised mid-run never pays more than the run planned.
    if (!open && priceRaised(cost.escrow, req.shownEscrow)) { testRun = null; return no(PRICE_CHANGED_COPY(), 'price-changed'); }
    // U-M4-1: a job planned with no new deposit never pays one.
    if (!open && newDepositUnseen(cost.escrow, req.shownEscrow)) { testRun = null; return no(DEPOSIT_UNUSABLE_COPY(), 'deposit-unusable'); }
    if (open) { reused = true; deposit = open; }
    const before = new Set(await listed());
    let s: DaemonSession;
    try {
      s = await startWithRetry(req.node, open ? { channel: open } : { newChannel: { mode, escrow: cost.escrow } }, false, req.basis, { quiet: true, onDeposit: tell });
    } catch (err) {
      // It may have paid before it failed: a deposit with this server that was not there before is this start's.
      if (!open) { const fresh = (await listed()).find((a) => !before.has(a)); if (fresh) tell(fresh); }
      throw err;
    }
    testRun.id = s.id;
    if (s.channel) tell(s.channel);
    resetRpcTransport(); // sockets opened before the tunnel use the old route
    flushDnsCache();
    log.info('server test: connected', { node: req.node, id: s.id, service: s.service, deposit, reused });
    return { ok: true, data: toLive(s) };
  } catch (err) {
    const copy = isCancelled() ? connectErrorCopy('stop requested while connecting') : connectErrorCopy((err as Error).message);
    log.info('server test: connect failed', { node: req.node, code: copy.code, err: (err as Error).message, deposit, reused });
    testRun = null;
    return no(copy.message, copy.code, { paid: deposit !== null, ...(deposit ? { channel: deposit } : {}) });
  }
}

/** End a server test's session. Quiet unless leaving it broke the internet, which the user must see. */
async function testDisconnect(): Promise<Result> {
  const t = testRun;
  if (!t) return { ok: true };
  try {
    const r = await stopLiveOrCurrent(t.id ?? '', daemon());
    flushDnsCache();
    resetRpcTransport();
    if (t.id) await sessionGone(t.id);
    if (r.dnsRevertFailed && await dnsReallyLeftOver(getDaemonSettings().settings.dnsServers)) {
      patch({ conn: { ...viewFor('error', tr('Your internet may not work: DNS could not be restored.')), restoreNetwork: true } });
      return { ok: false, error: tr('DNS could not be restored.'), code: 'dns-revert-failed', action: 'Restore network' };
    }
    return { ok: true };
  } catch (err) {
    log.error('server test: stopSession failed', err);
    patch({ conn: { ...viewFor('error', tr('Your internet may not work.')), restoreNetwork: true } });
    return { ok: false, error: tr('Your internet may not work.'), code: 'stop-failed', action: 'Restore network' };
  } finally {
    testRun = null;
  }
}

export async function connect(req: ConnectRequest, hooks: ConnectHooks = {}): Promise<Result<LiveSession>> {
  if (req.confirmed !== true) return { ok: false, error: tr('Confirm the cost first.'), code: 'not-confirmed' };
  if (req.purpose === 'test') return testConnect(req, hooks);
  if (testSessionActive()) return fail(tr('A server test is running and uses the VPN service. Stop the test first, or wait for it to finish.'), 'test-running', null, req.node);
  // UI-007/UI-012: the Connect screen shows the server from the first stage, before a session exists.
  // UI-188 (owner's laptop): the old failure stayed on screen for a moment after the next Connect, because the
  // first patch that cleared it (Checking the server…) came only after a server lookup on the chain. It is
  // cleared here, in the same patch as the target. A switch keeps the live session's view until it leaves it.
  const live = !!snapshot().session;
  patch({
    connectTarget: { node: req.node, switching: !!req.switch && live },
    ...(live ? {} : { conn: viewFor('preflight'), lastConnectError: null, lastCloseMessage: null }),
  });
  try {
    return await connectTo(req);
  } finally {
    patch({ connectTarget: null });
  }
}

async function connectTo(req: ConnectRequest): Promise<Result<LiveSession>> {
  const owner = ownerAddress();
  if (!owner) { const w = noWallet(); return fail(w.error, w.code, w.code === 'no-wallet' ? 'Open Wallet' : null); }
  // First connect (owner 2026-11-11): the spending permission is signed here, not at setup. dvpnd
  // will not start without it, so this runs before waiting for the service. Plans need it too.
  // A failed earlier try (e.g. the admin prompt for a wallet switch was declined) runs again too.
  // So does a service switch still waiting after an app restart (2026-11-11, owner's laptop).
  // And a deposit above this computer's limit raises the limit in the same click (owner 2026-11-11:
  // "above the device spending limit (50 tDVPN)" by default was a dead end).
  const w0 = snapshot().wallet;
  const autoOn = getSettings().autoDevicePermission !== false;
  let floor = '0';
  if (!req.subscription && autoOn && (w0?.needsPermission === true || !!w0?.grant)) {
    const n = await discoverNode(req.node).catch((err) => { log.warn('connect: node price unread; using the Settings limit', { err: (err as Error).message }); return null; });
    if (n) floor = costPreview(n, req.basis, req.units).escrow;
  }
  const limitShort = autoOn && !!w0?.grant && BigInt(floor) > 0n && (BigInt(w0.grant.allowance) < BigInt(floor) || BigInt(w0.delegated) < BigInt(floor));
  // The VPN service pays for the wallet in its device record, whatever wallet the app holds. When that is another
  // wallet the service is switched first, always: found 2026-11-15 on the Windows VM, where a wallet that already
  // had a permission on the same device key (or, from the CLI, whose balances were not read yet) skipped the
  // switch below, and the service paid from the other wallet.
  const otherWallet = serviceWalletIsNot(owner);
  if (otherWallet || w0?.needsPermission === true || limitShort || snapshot().deviceAuto?.state === 'failed' || serviceSwitchPending()) {
    patch({ conn: viewFor('preflight', limitShort ? tr('Raising this computer\'s spending limit…') : tr('Setting up payments for this computer…')), lastCloseMessage: null, lastConnectError: null });
    const blocked = await ensureDevicePermission(floor, { confirmSwitch: !!req.confirmWalletSwitch });
    if (blocked) return fail(blocked.error, blocked.code ?? 'device-permission', blocked.action, req.node);
    // A permission or limit just signed: give the RPC the project's 7 s between transactions before the
    // deposit, or the public devnet RPC answers "busy" (owner's laptop 2026-11-12, Singapore node).
    patch({ conn: viewFor('preflight', tr('Getting the deposit ready…')) });
    const gap = txGapMs();
    if (gap > 0) await new Promise((r) => setTimeout(r, gap));
  }
  // Hard stop: nothing is paid while the service is still set up for another wallet (the switch above was
  // declined, failed, or is not possible on this system).
  if (serviceWalletIsNot(owner)) return fail(OTHER_WALLET_COPY(), 'no-device', 'Set up device', req.node);
  // Installed, but the service refuses this account until it signs in again (owner 2026-11-12: no
  // sign-out). One admin step grants the account directly, then connecting carries on.
  // Q0521: never during a restart, when a moment's 'access denied' on the pipe is not a missing grant.
  if (!daemonInfo().reachable && daemonInfo().error === RELOGIN_COPY && !serviceInTransition()) {
    patch({ conn: viewFor('preflight', tr('Finishing setup of the VPN service…')), lastCloseMessage: null, lastConnectError: null });
    const g = await grantPipeAccess();
    if (!g.ok) return fail(g.error ?? RELOGIN_COPY, 'daemon-relogin', null);
  }
  // Rows 120/125: what Connect does follows the service's state (core/daemon/service-state.ts connectMove).
  // Starting or restarting: wait for it. Off: start it now (it never comes back by waiting; this used to
  // wait 30 s first). Not installed: say so at once. The link retries every second meanwhile (row 121).
  let d = daemonInfo();
  let startTried = false;
  if (!d.reachable) {
    const st = d.service?.state;
    const move = st ? connectMove(st) : 'wait';
    log.info('connect waits for the VPN service', { maxMs: SERVICE_WAIT_MS, state: st ?? null, move });
    if (st === 'not-installed') return fail(SERVICE_MISSING_COPY(), 'daemon-missing', 'Set up device');
    patch({ conn: viewFor('preflight', move === 'start' ? tr('Starting the VPN service…') : st === 'starting' ? tr('Waiting for the VPN service to start…') : tr('Waiting for the VPN service to restart…')), lastCloseMessage: null, lastConnectError: null });
    if (move === 'start') {
      startTried = true;
      const svc = await startServiceIfStopped();
      if (svc === 'no-service') return fail(SERVICE_MISSING_COPY(), 'daemon-missing', 'Set up device');
    }
    d = await whileWatched(() => waitForDaemon(SERVICE_WAIT_MS, daemonInfo));
  }
  if (!d.reachable) {
    // Not running vs not installed need different fixes. A reinstall removes the service and the
    // setup does not register it (the app does, at device setup): ddv-win-2 kse-pk-215 said "not
    // running" for a service that did not exist. A stopped one is started (no elevation).
    if (!startTried) {
      const svc = await startServiceIfStopped();
      if (svc === 'no-service') return fail(SERVICE_MISSING_COPY(), 'daemon-missing', 'Set up device');
      if (svc === 'started') d = await whileWatched(() => waitForDaemon(SERVICE_WAIT_MS, daemonInfo));
    }
    if (!d.reachable && serviceInTransition()) return fail(RESTARTING_COPY, 'daemon-restarting', 'Try again');
    if (!d.reachable && d.error === RELOGIN_COPY) return fail(RELOGIN_COPY, 'daemon-relogin', null);
    // Still not answering: the state's own sentence (never the old "is not running"). The state's one button
    // lives on the service banner and in Diagnostics; here the button goes there, or retries a state that only
    // needs time. The Result code stays 'daemon-unavailable' for every state the CLI does not tell apart yet.
    if (!d.reachable) {
      const v = d.service && d.service.state !== 'ready' ? d.service : serviceView('stopped');
      return fail(v.sentence, 'daemon-unavailable', v.action ? 'Open diagnostics' : 'Try again');
    }
  }
  if (d.networkOk === false) return fail(d.error ?? tr('The VPN service is on a different network.'), 'network-mismatch');
  if (!d.device) return fail(tr('Finish device setup first.'), 'no-device', 'Open Wallet');
  cancelled = false;
  const markDir = markerDir();
  if (markDir) markConnecting(markDir, req.node);
  patch({ conn: viewFor('preflight', tr('Checking the server and your balance…')), lastCloseMessage: null, lastConnectError: null });
  // G31: a chain read retrying (slow or unreachable RPC) says so instead of a silent "Checking…" for a minute.
  const stopRetryNote = onRpcRetry((e) => {
    const phase = snapshot().conn?.phase;
    if (phase !== 'preflight' && phase !== 'connecting' && phase !== 'paying') return;
    log.warn('chain read retrying during connect', { read: e.label, attempt: e.attempt, err: e.error, leftMs: e.leftMs });
    patch({ conn: viewFor(phase, tr('Waiting for the Solana network to answer…')) });
  });
  try {
    const blocker = await preflight(req, owner, d.device);
    if (blocker) {
      // Q0540 (DVPN-WIN): after a crash under the kill switch the kept block also stops our server check and the
      // chain, so every other server read 'Node is not reachable' (blaming the server). Lifting the block here would
      // leak what the user chose to block, so say what it is and offer Restore network.
      // Agent M grid xrp ks_persist: a live V2Ray/Xray proxy session under the kill switch blocks the plain probe by
      // design, so the daemon's real refusal ('Disconnect the current session first') became 'press Restore network',
      // advice that would lift the block under a working protected session. Only with no session running.
      if (!snapshot().session && !/current session/i.test(blocker.error)
        && getDaemonSettings().settings.killSwitch !== 'off' && !(await internetReachable(getRpcUrls()))) {
        log.warn('connect: the server check failed while the kill switch blocks the internet', { node: req.node, err: blocker.error });
        return fail(KILL_SWITCH_HELD_CONNECT(), 'kill-switch-held', 'Restore network', req.node);
      }
      // Q0560 (DVPN-WIN hunt ksw rc2 r91/r92 w-06): a switch while the current session is reconnecting, under the
      // kill switch. The only way out is the current tunnel, which is down while the daemon redials, so the check
      // of the NEW server failed ('Node did not answer: read ECONNRESET' / 'Node is not reachable') and the app
      // blamed that server ('Pick another server'). Say what is true; nothing was paid and the block stays.
      if (req.switch && snapshot().session && !/current session/i.test(blocker.error)
        && getDaemonSettings().settings.killSwitch !== 'off' && await currentSessionReconnecting()) {
        log.warn('connect: switch refused, the current session is reconnecting under the kill switch', { node: req.node, err: blocker.error });
        return fail(SWITCH_WHILE_RECONNECTING(), 'switch-reconnecting', 'Retry', req.node);
      }
      return fail(blocker.error, blocker.code ?? 'preflight', blocker.action ?? null, req.node);
    }
    if (isCancelled()) return stoppedByUser(tr('Connecting stopped. Nothing was paid.'), req.node);
    if (!snapshot().session) {
      if (!known) await adoptRunningSession();
      await ensureHomeIp(known);
    }
    if (req.switch && snapshot().session) {
      patch({ conn: viewFor('disconnecting', tr('Leaving the current server…')) });
      // Kill switch on: dvpnd keeps the block through the switch; the RPC stays reachable through it.
      const stopped = await disconnect({ keepKillSwitch: getDaemonSettings().settings.killSwitch !== 'off' });
      if (!stopped.ok) return fail(stopped.error ?? tr('Could not leave the current server.'), stopped.code ?? 'stop-failed', stopped.action ?? null);
      patch({ conn: viewFor('connecting', tr('Waiting for your connection to come back…')) });
      if (!await waitForDirectPath()) return fail(tr('You left the old server, but your internet has not come back yet, so nothing was paid for the new one. Wait a moment and connect again.'), 'switch-offline', 'Retry');
    }
    let cred: Credential;
    if (req.subscription) {
      // A plan's max_connections counts TICKETS until they expire, not live sessions, so a fresh
      // ticket per connect would use the plan up. Reuse one the daemon already holds for this server.
      const held = await heldTicket(req.subscription.subscription, req.node);
      if (!held) {
        const limit = await planLimitReached(req.subscription.subscription);
        if (limit) return fail(trPlural({ one: 'This plan gives access on {count} server, and you already use it. Connect to one of those, or get another plan.', other: 'This plan gives access on {count} servers, and you already use them. Connect to one of those, or get another plan.' }, limit.max, { count: limit.max }), 'plan-limit', 'Pick a server you already use');
      }
      cred = held ? { ticketHash: held } : { ticketRequest: req.subscription };
      patch({ conn: viewFor('connecting', held ? tr('Using your plan access for this server…') : tr('Getting access from your plan…')) });
    } else {
      const mode = req.basis === 'per_hour' ? MODE_STREAM : MODE_VOUCHER;
      const node = await discoverNode(req.node);
      const cost = costPreview(node!, req.basis, req.units);
      let found = await reusableChannel(req.node, mode, prepayCost(node!, req.basis));
      // Never a second deposit while one is open with this server (owner 2026-11-12): an open deposit in
      // the other pricing is used as it is.
      if (!found) {
        const otherBasis = req.basis === 'per_hour' ? 'per_gb' : 'per_hour';
        const other = await reusableChannel(req.node, otherBasis === 'per_hour' ? MODE_STREAM : MODE_VOUCHER, prepayCost(node!, otherBasis));
        if (other) { log.info('using the open deposit with this server in its own pricing', { channel: other, basis: otherBasis }); found = other; }
      }
      const reuse = found && claimForReuse(found) ? found : null;
      if (found && !reuse) {
        // CODE-AUDIT E3: the dialog offered this deposit ("nothing new is paid"); its refund started meanwhile.
        // Paying a new one here would spend an amount never shown: mark it and let the next Connect show the price.
        markReuseRefused(found);
        log.info('that deposit is closing; nothing new paid', { channel: found });
        void readSettlements().catch((e: unknown) => log.warn('settlements refresh after a closing deposit failed', { err: (e as Error).message }));
        return fail(DEPOSIT_UNUSABLE_COPY(), 'deposit-unusable', 'Connect again', req.node);
      }
      // CODE-AUDIT U-13: the dialog showed a deposit from the cached list; the price read here is fresh. A higher
      // one is never paid without being shown.
      if (!reuse && priceRaised(cost.escrow, req.shownEscrow)) {
        log.info('price went up since the list was read; nothing paid', { node: req.node, shown: req.shownEscrow, now: cost.escrow });
        return fail(PRICE_CHANGED_COPY(), 'price-changed', 'Connect again', req.node);
      }
      // U-M4-1: a new deposit is paid only at an amount that was shown (the sheet offered a deposit that is gone now).
      if (!reuse && newDepositUnseen(cost.escrow, req.shownEscrow)) {
        log.info('a new deposit with no shown amount; nothing paid', { node: req.node, now: cost.escrow });
        void readSettlements().catch((e: unknown) => log.warn('settlements refresh after an unseen deposit failed', { err: (e as Error).message }));
        return fail(DEPOSIT_UNUSABLE_COPY(), 'deposit-unusable', 'Connect again', req.node);
      }
      cred = reuse ? { channel: reuse } : { newChannel: { mode, escrow: cost.escrow } };
      patch({ conn: viewFor(reuse ? 'connecting' : 'paying', reuse ? tr('Using your existing deposit with this server…') : tr('Paying deposit {escrowText}…', { escrowText: cost.escrowText })) });
    }
    // Everything chain-side is read BEFORE the tunnel starts: right after it starts, routes and
    // DNS are still moving and a read can fail although the session is up (clean-VM run).
    const country = (await discoverNode(req.node).catch((err: Error) => { log.warn('node lookup before connect', { err: err.message }); return null; }))?.country ?? '';
    // Last check before dvpnd pays the deposit (DC1: a Disconnect from another process lands here).
    if (isCancelled()) return stoppedByUser(tr('Connecting stopped. Nothing was paid.'), req.node);
    let s: DaemonSession;
    try {
      s = await startWithRetry(req.node, cred, !!req.subscription, req.basis);
    } catch (err) {
      if ('ticketHash' in cred && req.subscription) {
        // The stored ticket was refused (data cap used, or expired early): ask the provider for a new one.
        // CODE-AUDIT E4: then the same Cancel checks and first-data wait as every other start (below); this
        // used to return at once, so a Cancel pressed during that retry left the session up.
        log.warn('stored ticket refused; requesting a new one', { err: (err as Error).message });
        if (isCancelled()) return stoppedByUser(tr('Connecting stopped. Nothing was paid.'), req.node);
        s = await startWithRetry(req.node, { ticketRequest: req.subscription }, true);
      } else {
        if (!('channel' in cred)) throw err;
        const msg = (err as Error).message;
        // peer_limit_reached on a REUSED channel usually means the node still holds that channel's
        // last session (its close was lost; it frees after idle_timeout); with free slots it is the deposit.
        const busyChannel = /peer_limit_reached/.test(msg) && await nodeHasRoom(req.node);
        if (!busyChannel && !/cannot cover the prepay|prepay_below_minimum|channel_not_open|channel_node_reopened|channel_node_stale|account not found/.test(msg)) throw err;
        // CODE-AUDIT E3 (money): the Connect dialog told the user this deposit would be used and nothing new paid,
        // with no amount on the button. Paying a new deposit here spent an amount never shown. Nothing is paid now:
        // the deposit is marked so it is not offered again (dialog and reuse), and the next Connect shows the price.
        markReuseRefused(cred.channel);
        log.warn('existing deposit refused by the server; nothing new paid', { channel: cred.channel, err: msg });
        void readSettlements().catch((e: unknown) => log.warn('settlements refresh after a refused deposit failed', { err: (e as Error).message }));
        return fail(DEPOSIT_UNUSABLE_COPY(), 'deposit-unusable', 'Connect again', req.node);
      }
    }
    if (isCancelled()) return await stopAfterStart(s, req.node, country);
    await firstData(s);
    if (isCancelled()) return await stopAfterStart(s, req.node, country);
    return sessionStarted(s, country);
  } catch (err) {
    // After the user pressed Cancel, whatever the start failed with is the stop they asked for: the app's
    // own retry throws 'cancelled', dvpnd says "stop requested while connecting", and on gate30 (dvpnd
    // 18.31) that text never arrived ("9 FAILED_PRECONDITION: "), which showed "Connection failed".
    let copy = isCancelled() ? connectErrorCopy('stop requested while connecting') : connectErrorCopy((err as Error).message);
    // The sentence for a service that is not answering comes from its state now (restarting, starting, off),
    // not from one fixed text: case C said "The VPN service is off" while Windows was restarting it.
    const svcNow = daemonInfo().service;
    if (copy.code === 'daemon-unavailable' && svcNow && svcNow.state !== 'ready') copy = { ...copy, message: svcNow.sentence };
    // An expected refusal is not an app error: Cancel is info, and dvpnd refusing a second start while a
    // session is live (a switch racing a connect that is still coming up) is warn (Q0229).
    const level = copy.code === 'cancelled' ? 'info' : copy.code === 'session-active' ? 'warn' : 'error';
    log[level]('connect failed', { node: req.node, code: copy.code, err: (err as Error).message });
    // A failed start can leave the tunnel service up with no session: the computer is offline (gap another project).
    // A tunnel that belongs to a session dvpnd still runs (or is still bringing up) is that session's,
    // not a leftover: a refused `connect --switch` during another connect named the live session's
    // xray.exe and sent the user to Restore network, which ends it (Q0191).
    const owner = await runningSessionId();
    // CODE-AUDIT E5: the session is cleared only when dvpnd runs none. A second start refused while a session is
    // live ('session-active', from the CLI or an agent) used to blank the screen while the tunnel stayed up.
    if (!owner) patch({ session: null });
    else if (!snapshot().session) await adoptRunningSession().catch((e: unknown) => log.warn('connect failed; re-adopting the live session failed', { err: (e as Error).message }));
    const left = owner ? [] : await leftoverTunnels();
    if (owner) log.info('connect failed; the tunnel running belongs to session', { session: owner });
    if (left.length) {
      log.warn('connect failed and left a tunnel service running', { left });
      const message = `${copy.message} It also left a VPN tunnel running, which blocks your internet: press Restore network.`;
      patch({ conn: { ...viewFor('error', message), restoreNetwork: true } });
      return { ok: false, error: message, code: 'tunnel-left', action: 'restore-network' };
    }
    if (copy.code === 'cancelled') return stoppedByUser(copy.message, req.node);
    // Another VPN on is the usual cause of a failed connect (rival-d9): name it (D6).
    const rivals = await rivalVpns();
    // Row 79: a deposit open with this server is named with the failure, whatever the failure was.
    const kept = req.subscription ? null : await keptDeposit(req.node);
    if (rivals.length) return fail(`${copy.message} Another VPN (${rivals.join(', ')}) is on and is probably blocking this: turn it off, then connect again.`, copy.code, copy.action, req.node, kept);
    return fail(copy.message, copy.code, copy.action, req.node, kept);
  } finally {
    stopRetryNote();
    if (markDir) clearConnecting(markDir);
  }
}

/**
 * The daemon has a live session. From here nothing may report the connect as failed
 * (that cleared the session in the app while the tunnel stayed up): bookkeeping
 * problems are logged, never thrown.
 */
async function sessionStarted(s: DaemonSession, country: string): Promise<Result<LiveSession>> {
  resetRpcTransport(); // sockets opened before the tunnel use the old route
  adoptedOpenId = null; // this process opened it: its own connect flow, not the adopted-session backstop
  lastEndCopy = null;
  serviceDownShown = false;
  transitionHeldId = null;
  flushDnsCache(); // answers cached on the direct path (or failures from the first second) are stale now
  const live: LiveSession = { ...toLive(s), payer: await payerOf(s.channel, ownerAddress() ?? '') };
  // V2Ray/Xray are a SOCKS proxy: without the system proxy the browser keeps the user's own IP
  // while the app said "Connected" (owner 2026-10-21). Default: send apps through it now.
  // Set BEFORE the session is published, so no screen shows "proxy-only" for a moment.
  let proxyNote = '';
  if (proxyOnConnectFor(live)) {
    try {
      await setSystemProxy(live.proxyEndpoint);
    } catch (err) {
      log.warn('system proxy not set at connect', { err: (err as Error).message });
      proxyNote = (err as Error).message || '?';
    }
  }
  setSplitInEffect(splitForSession(live.service));
  setWholeDeviceInEffect(serviceUsesTun(live.service));
  patch({ session: live, conn: viewFor(phaseFromDaemon(s.status, s.error)), lastConnectError: null });
  try {
    recordStart(live, country);
  } catch (err) {
    log.warn('history record failed', { err: (err as Error).message });
  }
  watch(s.id);
  const c = snapshot().conn.title;
  toast(proxyNote ? 'warn' : 'success', proxyNote ? tr('Connected. Browsers are not using it yet: {reason}', { reason: proxyNote }) : connectedToast(c));
  return { ok: true, data: live };
}

/**
 * Cancel while connecting. The flag alone was only read before the deposit and between retries, so
 * a Cancel pressed during "Paying deposit…" or "Connecting…" was ignored and the app connected
 * anyway. dvpnd is asked to stop too (what the CLI's disconnect does): it fails the start with
 * "stop requested while connecting", whatever step it was on.
 */
export async function cancelConnect(): Promise<void> {
  cancelled = true;
  if (snapshot().session) return;
  try {
    await daemon().stopSession('');
  } catch (err) {
    if ((err as { kind?: string }).kind !== 'not-found') log.warn('cancel: could not ask the VPN service to stop connecting', { err: (err as Error).message });
  }
}

/** The Cancel landed just after dvpnd finished starting: take that session down again (its deposit
 *  is settled like any Disconnect). If the stop fails, show it as connected, which is the truth. */
async function stopAfterStart(s: DaemonSession, node: string, country: string): Promise<Result<LiveSession>> {
  log.info('connect finished after Cancel; stopping it', { id: s.id });
  try {
    const r = await stopLiveOrCurrent(s.id, daemon());
    await ended(r.session ? toLive(r.session) : toLive(s), 'closed by client');
  } catch (err) {
    log.warn('could not stop the session started after Cancel; showing it', { err: (err as Error).message });
    toast('warn', tr('Cancel came too late: the connection is up. Press Disconnect to end it.'));
    return sessionStarted(s, country);
  }
  return stoppedByUser(tr('Connecting stopped. Your unused deposit is refunded automatically.'), node);
}

// ─── Live updates: WatchSession stream, GetSession poll fallback ───
/**
 * Point the system proxy at the session on connect? Only in proxy mode. A whole-device V2Ray/Xray
 * session (TUN) already carries every app; the system proxy only sent browsers through the SOCKS
 * port, which Xray routes straight to the node past split tunnelling (an excluded Firefox exited at
 * the node, the macOS app rig 3: 9/9 for 80 s). An explicit 'proxy on' still sets it.
 */
export function proxyOnConnectFor(live: { proxyEndpoint: string; service: string }): boolean {
  // Android: V2Ray/Xray already run through the VpnService (tun2socks), so there is no system proxy to set;
  // dvpnd still reports its local SOCKS port as proxyEndpoint.
  return !!live.proxyEndpoint && !isAndroid() && getSettings().proxyOnConnect && !serviceUsesTun(live.service);
}

/** Set while disconnect() runs: it owns the view until the daemon list and direct internet confirm (W5d-b). */
let disconnectRunning = false;

/**
 * DIR/FWX 10-30 (FLX2 fedora, wg cut lifted 5 s into the redial; FLX the Linux app 21debd95): dvpnd recovered the
 * session as a NEW one; the app cleared the old one (Q0361, "The connection to this server stopped
 * working.") and showed the new one with the timer reset. dvpnd now links them (replaced_by on the old,
 * replaces on the new): follow the link as the same session: no end notice, no settle, one timer,
 * totals carried on, and "Reconnecting" until the new session's first IP check (app-state).
 * A V2Ray/Xray chain whose new session listens elsewhere moves the system proxy with it.
 * False = nothing to follow.
 */
export async function followRedial(old: LiveSession, newId: string, list?: DaemonSession[]): Promise<boolean> {
  let rows = list;
  if (!rows) {
    try {
      rows = await daemon().listSessions();
    } catch (err) {
      log.warn('could not read the reconnected session from the VPN service', { from: old.id, to: newId, err: (err as Error).message });
      return false;
    }
  }
  const n = rows.find((x) => x.id === newId && phaseFromDaemon(x.status, x.error) !== 'idle');
  if (!n || disconnectRunning) return false;
  chainCarry.delete(old.id);
  // the old session's own counters + what it already carried (old comes from toLive, which holds both)
  chainCarry.set(n.id, { rx: big(old.rxBytes), tx: big(old.txBytes), spent: big(old.spent), start: old.startedAt });
  if (foreign.delete(old.id)) foreign.add(n.id);
  setRedialFollow(n.id);
  const next = toLive(n); // chain start from dvpnd, else the shown session's (carried): one timer
  patch({ session: next, conn: viewFor(phaseFromDaemon(n.status, n.error)) });
  watch(n.id);
  log.info('the VPN service reconnected this session as a new one; following it', { from: old.id, to: n.id });
  if (snapshot().proxyActive && next.proxyEndpoint && next.proxyEndpoint !== old.proxyEndpoint) {
    try {
      await setSystemProxy(next.proxyEndpoint);
    } catch (err) {
      log.warn('system proxy not moved to the reconnected session', { to: next.proxyEndpoint, err: (err as Error).message });
    }
  }
  return true;
}

/**
 * Q0366 pass 3 (FLX2 fedora, v2ray cut, KS off; kept on the macOS app): dvpnd's redial first tears the dead tunnel
 * down, and that teardown tells watchers the session ENDED ("the connection to this server stopped
 * working") while dvpnd goes on redialing it under the same id; the real end comes when it gives up.
 * A CLI `status` attached at that moment printed "Not connected" mid-redial. An end the user did not
 * ask for is therefore checked against dvpnd's list: still listed as running = the redial goes on, so
 * the session stays shown and is watched again; otherwise it ended.
 */
async function endedUnlessRedialing(live: LiveSession, s: DaemonSession): Promise<void> {
  if (s.error && !/closed by client/i.test(s.error)) {
    let still: DaemonSession | undefined;
    try {
      still = (await daemon().listSessions()).find((x) => x.id === s.id && phaseFromDaemon(x.status, x.error) !== 'idle');
    } catch (err) {
      log.warn('could not confirm the session end with the VPN service; taking it as ended', { err: (err as Error).message });
    }
    if (disconnectRunning) return;
    if (still) {
      log.info('the session\'s tunnel ended but the VPN service is still reconnecting it; kept (Q0366)', { id: s.id, status: still.status, error: still.error });
      patch({ session: toLive(still), conn: viewFor(phaseFromDaemon(still.status, still.error), still.error ? RETRYING_DETAIL() : '') });
      watch(s.id);
      return;
    }
  }
  await ended(live, s.error);
}

function watch(id: string): void {
  stopWatching();
  const onUpdate = (s: DaemonSession): void => {
    // The stream reports the session closed while stopSession is still tearing the tunnel down;
    // acting on it would show "Not connected" before the internet is back (W5d-b).
    if (disconnectRunning) return;
    const live = toLive(s);
    const phase = phaseFromDaemon(s.status, s.error);
    if (phase === 'idle') {
      // dvpnd brought it back as a new session: follow it, never an end (DIR/FWX 10-30)
      if (s.replacedBy) {
        const shown = snapshot().session;
        void followRedial(shown?.id === s.id ? shown : live, s.replacedBy).then((followed) => {
          if (followed) return;
          log.info('session ended (stream); its successor is not running', { id: s.id, to: s.replacedBy });
          void endedUnlessRedialing(live, s);
        });
        return;
      }
      log.info('session ended (stream)', { id: s.id, error: s.error });
      void endedUnlessRedialing(live, s);
      return;
    }
    streamSaid = { id: s.id, phase, at: Date.now() };
    const shown = snapshot().conn.phase;
    // Q0546 (DVPN-WIN r31): a healthy session's stream said 'active + error' for 4-200 ms on a 400 ms grid, 9 times
    // in 3 min, and each flicked the screen to the red Reconnecting view. A drop from connected shows only if it is
    // still the stream's word RECONNECT_GRACE_MS later; a connected update in between cancels it.
    if (phase === 'reconnecting' && shown === 'connected') {
      if (!reconnectPending) {
        log.info('stream: connected -> reconnecting; waiting before showing it (Q0546)', { id: s.id, status: s.status, error: s.error });
        reconnectPending = setTimeout(() => {
          reconnectPending = null;
          const last = streamSaid;
          if (last?.id !== s.id || last.phase !== 'reconnecting' || snapshot().session?.id !== s.id || snapshot().conn.phase !== 'connected') return;
          log.info('stream: still reconnecting after the grace; showing it', { id: s.id, error: s.error });
          patch({ session: toLive(s), conn: viewFor('reconnecting', RETRYING_DETAIL()) });
        }, RECONNECT_GRACE_MS);
        reconnectPending.unref?.();
      }
      patch({ session: live }); // bytes keep moving; the view waits
      return;
    }
    if (reconnectPending && phase !== 'reconnecting') {
      clearTimeout(reconnectPending); reconnectPending = null;
      log.info('stream: back to ' + phase + ' within the grace; the Reconnecting view was never shown (Q0546)', { id: s.id });
    }
    if (phase !== shown) log.info('stream: phase change', { id: s.id, from: shown, to: phase, status: s.status, error: s.error || null });
    patch({ session: live, conn: viewFor(phase, s.error ? RETRYING_DETAIL() : '') });
  };
  try {
    unwatch = daemon().watchSession(id, onUpdate, (err) => {
      if (err) {
        log.warn('watch stream ended; polling instead', { err: err.message });
        // Mac T4 (dvpnd SIGKILL): the stream drops at once, the poll and the health check see it seconds later;
        // until then the screen kept "Protected" over a held block. A dropped link is a service transition.
        if (/connection dropped|unavailable|econnreset|enoent|socket closed/i.test(err.message)) beginServiceTransition('the service link dropped');
      } else log.info('watch stream closed by the service', { id, shown: snapshot().session?.id ?? null });
      unwatch = null;
      if (snapshot().session) startPolling(id, onUpdate);
    });
  } catch (err) {
    log.warn('watch unavailable; polling', { err: (err as Error).message });
    startPolling(id, onUpdate);
  }
}

function startPolling(id: string, onUpdate: (s: DaemonSession) => void): void {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    try {
      const s = await daemon().getSession(id);
      if (disconnectRunning) return;
      if (!s) void ended(snapshot().session, 'closed by client');
      else onUpdate(s);
    } catch (err) {
      log.debug('session poll failed', { err: (err as Error).message });
    }
  }, (getSettings().poll?.session ?? DEFAULT_POLL.session) * 1000);
}

function stopWatching(): void {
  if (reconnectPending) { clearTimeout(reconnectPending); reconnectPending = null; }
  if (unwatch) { unwatch(); unwatch = null; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

/**
 * Q0508 F1: a settings apply restarted the service under session `liveId`. If the service no longer runs
 * it, end it now the app's way (history, system proxy back, the kill-switch end screen) instead of
 * waiting for a stream or poll that may never report it (a V2Ray/Xray proxy pointed at a dead port).
 * True = the session is gone (ended here, or already ended by the stream).
 */
export async function endAfterServiceRestart(liveId: string): Promise<boolean> {
  let running = false;
  try {
    running = (await daemon().listSessions()).some((x) => x.id === liveId && phaseFromDaemon(x.status, x.error) !== 'idle');
  } catch (err) {
    log.warn('after the settings change: could not list sessions; treating the session as ended', { err: (err as Error).message });
  }
  if (running) return false;
  const shown = snapshot().session;
  if (shown?.id === liveId) {
    log.info('session ended by the settings change (service restart)', { id: liveId });
    await ended(shown, 'settings changed');
  } else {
    // The stream already ended it; make sure the proxy is back (no-op when we never set one).
    await clearSystemProxy().catch((err) => log.warn('system proxy restore after the settings change failed', { err: (err as Error).message }));
  }
  return true;
}

/** Returns the system-proxy restore so a caller that exits next (the CLI) can wait for it. */
function ended(live: LiveSession | null, reason: string, opts: { holdDisconnecting?: boolean } = {}): Promise<void> {
  if (/daemon stopping/i.test(reason)) {
    beginServiceTransition('the service is stopping'); // owner laptop 23:34:39Z
    // DVPN-WIN KSM2: a stop caused by a settings Apply (any process) is recorded and worded as that, not 'daemon stopping'.
    if (applyMarkerFresh()) reason = 'settings changed';
  }
  stopWatching();
  adoptedOpenId = null;
  setSplitInEffect(null);
  setWholeDeviceInEffect(false);
  if (live) chainCarry.delete(live.id); // recordEnd below already got the chain's totals through toLive
  resetRpcTransport(); // the default route just moved back
  const copy = closeReasonCopy(reason);
  if (live) recordEnd(live, reason);
  const unexpected = !!reason && !/closed by client/i.test(reason);
  // The user's own settings Apply is not a VPN drop: daemon-apply releases the block the restart kept (Q0534),
  // so no up-front held screen (Android showed "still blocking" with the internet back, AND-34 apk9). If the
  // release fails, daemon-apply runs the block check once the restart is over.
  const settingsChange = /settings changed/i.test(reason);
  // Desktop: only 'persist' keeps the block after the session for sure ('on' is released by dvpnd after its own
  // redial gives up, so an up-front held view there would be a false alarm, the owner's original complaint).
  const ks = getDaemonSettings().settings.killSwitch;
  const android = isAndroid();
  const dropped = unexpected && !settingsChange && !opts.holdDisconnecting;
  lastEndCopy = dropped ? copy : null; // carried across a service restart to the settle check (Mac T3 r2: lost)
  transitionHeldId = null;
  const heldView = endedHeldView(android, android ? ks !== 'off' : ks === 'persist', dropped, copy);
  // disconnect() keeps "Disconnecting…" until the daemon list and direct internet confirm (W5d-b)
  patch({ session: null, conn: heldView ?? viewFor(opts.holdDisconnecting ? 'disconnecting' : 'idle'), lastCloseMessage: copy });
  // AND-34 KSM13 blk x ks-off: a held view is a blocked view this module put up, so a later check (after a kill
  // switch Off Apply) can take it down; before, only checkLeftoverBlock's own view could be.
  if (heldView) blockedShown = true;
  if (heldView && android) void confirmHeldAfterEnd(); // the one end screen, checked at once (not after a 'Not connected' step)
  if (heldView && !android) {
    // Agent M Mac T3/T4 r2: 5-10 s of "Not connected" over a held block before the probe answered. The held view
    // goes up at once (with its reason); the check below only takes it down if the internet answers.
    setTimeout(() => { void checkLeftoverBlock(copy).catch((err) => log.warn('block check after an unexpected end failed', { err: (err as Error).message })); }, 3000);
  }
  // The CLI leaves its deposit open on purpose (a reconnect reuses it; it prints the settle hint).
  // A CLI session the open app picked up must not be start-closed later (the Android app grid F9.2), and a
  // "switching servers" end queues none (Q0411: switching back reuses the deposit).
  if (live?.channel && !foreign.delete(live.id) && settlesOnEnd(reason)) settleChannelSoon(live.channel);
  // Awaited by disconnect(): the CLI exits right after, and a restore still running was lost
  // (the macOS app matrix: the SOCKS proxy stayed set after every V2Ray/Xray CLI disconnect).
  const proxyBack = clearSystemProxy().catch((err) => log.warn('system proxy restore after the session ended failed', { err: (err as Error).message }));
  if (unexpected && !heldView) {
    // A settings Apply already says the session ended (one message, not two); the block check still runs.
    if (!/settings changed/i.test(reason)) toast('warn', copy.message);
    // An unexpected end with the kill switch on leaves the internet BLOCKED (dvpnd keeps it);
    // the screens must say "Blocking internet" + Restore network, not "Not connected"
    // (VM ddv-win-2 2026-10-22: xray killed → 0 leaks, but the page said "Nothing is blocked").
    setTimeout(() => { void checkLeftoverBlock(copy).catch((err) => log.warn('leftover-block check after an unexpected end failed', { err: (err as Error).message })); }, 3000);
  }
  return proxyBack;
}

/**
 * Q0366 end copy (lab-q0366k): an unexpected end with the kill switch on showed two screens, 'Not
 * connected / The connection to this server stopped working.' and ~3 s later the blocked screen.
 * The spec is one: why it ended + the kill switch is still blocking + Restore network. On Android
 * dvpnd keeps the kill switch after it gives up, so that screen is shown at once; confirmHeldAfterEnd
 * falls back to the plain end only if the VPN service holds nothing.
 * null = the usual idle view (desktop, kill switch off, or a user's own stop).
 */
/** `holds`: the kill switch keeps the block after this end (Android: on; desktop: persist). */
export function endedHeldView(android: boolean, holds: boolean, unexpected: boolean, copy: Copy): (ReturnType<typeof viewFor> & { restoreNetwork: true }) | null {
  if (!holds || !unexpected) return null;
  return { ...viewFor('error', blockedAfterEnd(copy, android ? BLOCKED_HELD_ANDROID() : BLOCKED_HELD_DESKTOP())), title: BLOCKED_TITLE(), restoreNetwork: true };
}
/** The reason of the last unexpected end, for a block check that runs later (after a service restart settles). */
let lastEndCopy: Copy | null = null;

async function confirmHeldAfterEnd(): Promise<void> {
  const showing = (): boolean => !snapshot().session && snapshot().conn.phase === 'error' && !!snapshot().conn.restoreNetwork;
  const held = await androidHeldBlock().catch((err: unknown) => { log.warn('vpn state unreadable after the session ended', { err: (err as Error).message }); return null; });
  if (held !== false || !showing()) return; // held (or unknown): the blocked screen stays
  log.info('the session ended and the VPN interface is not held: plain end');
  patch({ conn: viewFor('idle') });
}

/**
 * A kill switch dvpnd kept with no session (persist mode after dvpnd restarted, e.g. a crash) is
 * released only by StopSession with no id. True when one was released.
 */
export async function releaseKeptKillSwitch(): Promise<boolean> {
  try {
    const held = await daemon().stopSession('');
    return !!held.killSwitchReleased;
  } catch (err) {
    if ((err as { kind?: string }).kind !== 'not-found') throw err; // not-found = nothing held
    return false;
  }
}

/** Hold Disconnect until dvpnd no longer lists the session as running (W5 e: after a Hysteria2 app
 *  Disconnect the CLI `status` still read an active session, "Connected, but traffic is not going
 *  through the VPN", while direct internet was already back). Bounded; a list error ends the wait. */
async function sessionGone(id: string): Promise<void> {
  const took = await waitForDirect({
    probe: async () => {
      try { return !(await daemon().listSessions()).some((x) => x.id === id && phaseFromDaemon(x.status, x.error) !== 'idle'); } catch (err) { log.warn('disconnect: could not list sessions', { err: (err as Error).message }); return true; }
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: Date.now,
  }, 15_000, 1000);
  if (took === null) log.warn('disconnect: dvpnd still lists the session as running after 15 s', { id });
  else if (took > 1000) log.info('disconnect: session left the daemon list', { id, ms: took });
}

/** Hold Disconnect until a direct request answers (W5 d). Only with the kill switch off (otherwise
 *  the block is meant to stay) and IP checks on (the probe is an outside request); bounded. */
async function directBack(opts: { keepKillSwitch?: boolean }): Promise<void> {
  if (opts.keepKillSwitch || getDaemonSettings().settings.killSwitch !== 'off' || !getSettings().thirdPartyChecks) return;
  const took = await waitForDirect({
    probe: async () => 'ip' in await publicIp(4000),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: Date.now,
  });
  if (took === null) log.warn('disconnect: direct internet did not answer within 25 s');
  else if (took > 2000) log.info('disconnect: direct internet back', { ms: took });
}

/** User Disconnect: stop, then queue settlement of that channel (F12). keepKillSwitch: a server switch (gap #67). */
export async function disconnect(opts: { keepKillSwitch?: boolean; purpose?: 'test' } = {}): Promise<Result> {
  if (opts.purpose === 'test') return testDisconnect();
  const live = snapshot().session;
  if (!live && !opts.keepKillSwitch) {
    // DC1: a connect still running in another process (the CLI) is stopped, not ignored.
    const other = await stopOtherConnect();
    if (other.stopped) {
      await adoptRunningSession();
      if (snapshot().session) return disconnect(opts); // it got up before the stop landed: take it down
    }
  }
  if (!live) {
    // No session here, but dvpnd may still HOLD the kill switch: after it crashed mid-session
    // (ddv10+ keeps the block, the user never disconnected) or persist mode after a restart.
    // "Disconnect" must give the internet back, so release it (not-found = nothing held).
    try {
      const held = await daemon().stopSession('');
      if (held.killSwitchReleased) log.info('disconnect: released a kill switch held with no session');
    } catch (err) {
      if ((err as { kind?: string }).kind !== 'not-found') log.warn('disconnect: could not check for a held kill switch', { err: (err as Error).message });
    }
    // A session that ended on its own (service restart) can leave our system proxy on.
    await clearSystemProxy().catch((err) => log.warn('disconnect: system proxy restore failed', { err: (err as Error).message }));
    patch({ conn: viewFor('idle') });
    return { ok: true };
  }
  disconnectRunning = true;
  patch({ conn: viewFor('disconnecting') });
  foreign.delete(live.id); // Disconnect pressed here: settle it like any session of ours
  try {
    const r = await stopLiveOrCurrent(live.id, daemon(), opts);
    flushDnsCache(); // tunnel answers are stale on the direct path
    await ended(r.session ? toLive(r.session) : live, 'closed by client', { holdDisconnecting: true });
    await sessionGone(live.id);
    await directBack(opts);
    patch({ conn: viewFor('idle') });
    if (r.dnsRevertFailed && await dnsReallyLeftOver(getDaemonSettings().settings.dnsServers)) {
      patch({ conn: { ...viewFor('error', tr('Your internet may not work: DNS could not be restored.')), restoreNetwork: true } });
      return { ok: false, error: tr('DNS could not be restored.'), code: 'dns-revert-failed', action: 'Restore network' };
    }
    return { ok: true };
  } catch (err) {
    log.error('stopSession failed', err);
    patch({ conn: { ...viewFor('error', tr('Your internet may not work.')), restoreNetwork: true } });
    return { ok: false, error: tr('Your internet may not work.'), code: 'stop-failed', action: 'Restore network' };
  } finally {
    disconnectRunning = false;
  }
}

/** The id of a session dvpnd runs or is bringing up, or null (none, or the daemon could not say). */
async function runningSessionId(): Promise<string | null> {
  try {
    return (await daemon().listSessions()).find((x) => phaseFromDaemon(x.status, x.error) !== 'idle')?.id ?? null;
  } catch (err) {
    log.warn('connect failed; could not list sessions', { err: (err as Error).message });
    return null;
  }
}

/**
 * Q0361: a session the app shows as connected but dvpnd no longer runs is cleared, so the screen
 * never stays "Connected" (and the Connect buttons blocked) after its end went unseen. Seen on
 * Android: the app adopted a CLI session while the CLI was disconnecting it and missed the end.
 * Two misses in a row (one poll apart) before acting, so a session between dvpnd steps is left alone;
 * a different running session (dvpnd reconnected under a new id) is adopted. True when it cleared one.
 */
let missedId: string | null = null;
// Q0546 (DVPN-WIN r31, V2Ray whole-device, healthy): the screen flicked to the red Reconnecting view and back within
// 4-200 ms, 9 times in 3 min. The list backstop below is for a dead stream; while the stream for the shown session
// has said connected in the last STREAM_FRESH_MS, or before the list has said reconnecting twice in a row, it waits.
export const STREAM_FRESH_MS = 15_000;
export const RECONNECT_GRACE_MS = 1_500;
let reconnectPending: NodeJS.Timeout | null = null;
let streamSaid: { id: string; phase: string; at: number } | null = null;
let listReconnecting: { id: string; seen: number } | null = null;

/**
 * The session dvpnd is running. During a redial its list also holds the attempt's stored row, which
 * reads "active" before the attempt's tunnel check (Q0366 pass 2), so a reconnecting or checking
 * entry (dvpnd's live copy) wins over a plain active row.
 */
export function runningSession(list: DaemonSession[]): DaemonSession | undefined {
  const running = list.filter((x) => phaseFromDaemon(x.status, x.error) !== 'idle');
  // dvpnd final2 lists a session "closing" before "ended" (G32): on a switch the old one is still
  // listed while the new one runs, so a closing row is the running session only when it is the only one.
  const open = running.filter((x) => phaseFromDaemon(x.status, x.error) !== 'disconnecting');
  return open.find((x) => ['reconnecting', 'checking'].includes(phaseFromDaemon(x.status, x.error))) ?? open[0] ?? running[0];
}

/** Views a dvpnd session can be gone under: connected, and reconnecting (Q0366: dvpnd gave up while
 *  the app watched its reconnect placeholder; while dvpnd reconnects it lists the session as running). */
const RECONCILED_PHASES = new Set(['connected', 'reconnecting']);
// The session this check itself showed as Disconnecting because dvpnd listed it "closing" (G32). Only
// that one is followed further in the Disconnecting view; the app's own disconnect is left alone.
let closingShownId: string | null = null;
// Q0506 (the Android app KSM13 grid, apk12): a session the app ADOPTED while another process's connect was still opening
// it (dvpnd "open"/"checking") was left to its watch stream alone; when the stream missed the step, the screen
// said "Connecting…" for good (dvpnd: active) and every settings Apply was refused as "a connection is starting".
// Only that adopted session is followed in those phases: the app's own connect is never adopted, so never touched.
const ADOPTED_OPEN_PHASES = new Set(['connecting', 'checking']);
let adoptedOpenId: string | null = null;
// Agent M Mac T4 r3: a session shown 'Protected' while the service restarts is no verdict anyone can trust; it
// reads 'Checking the connection…' until the restarted service says what it is (settle → reconcile below).
let transitionHeldId: string | null = null;
/** Q0551: the 'VPN service stopped' view is up (replaced once the service answers again). */
let serviceDownShown = false;
const checked = (phase: string, id: string): boolean => RECONCILED_PHASES.has(phase) || (phase === 'disconnecting' && closingShownId === id)
  || (ADOPTED_OPEN_PHASES.has(phase) && adoptedOpenId === id) || (phase === 'checking' && transitionHeldId === id);
/** `afterRestart`: the service has just restarted (a transition settled), so one miss is proof the session is gone. */
export async function reconcileShownSession(d: Pick<DaemonClient, 'listSessions'> = daemon(), opts: { afterRestart?: boolean } = {}): Promise<boolean> {
  const live = snapshot().session;
  if (!live || disconnectRunning || !checked(snapshot().conn.phase, live.id)) { missedId = null; closingShownId = null; return false; }
  let list: DaemonSession[];
  try {
    list = await d.listSessions();
  } catch (err) {
    log.debug('session check: could not list sessions', { err: (err as Error).message });
    return false;
  }
  const now = snapshot();
  if (now.session?.id !== live.id || disconnectRunning || !checked(now.conn.phase, live.id)) { missedId = null; return false; }
  const running = runningSession(list);
  // Q0366 pass 2 (FLX2 fedora, wg cut): during a redial dvpnd lists the attempt FIRST (its stored row
  // reads "active" before its tunnel check, or its live copy "checking") and the shown session second,
  // still running (reconnecting, or its stored row). Taking the first running one as "the" session
  // swapped the shown session for the attempt: a green "Connected" with the timer reset, and its
  // stream was dropped, so dvpnd's give-up reason never arrived. The shown session is kept while
  // dvpnd lists IT as running; another one is adopted only once ours has ended or is gone.
  const mine = list.find((x) => x.id === live.id && phaseFromDaemon(x.status, x.error) !== 'idle');
  if (mine) {
    missedId = null;
    // FLX2 fedora wg lift (dvpnd 9b3fc24): dvpnd lists the session "reconnecting" from the moment the
    // tunnel is dead, but its watch stream sends nothing until the redial ends, so the screen stayed a
    // green "Protected" with frozen bytes. The list is the backstop for dvpnd's "reconnecting" ONLY: never
    // back to connected from it (while an attempt checks its tunnel the shown session's stored row reads
    // plain "active", Q0366 pass 2); recovery comes from the stream or the replaced_by link.
    const ph = phaseFromDaemon(mine.status, mine.error);
    if (transitionHeldId === live.id && now.conn.phase === 'checking') {
      transitionHeldId = null;
      log.info('the session outlived the service restart; showing its state again', { id: live.id, listed: ph });
      patch({ session: toLive(mine), conn: viewFor(ph) });
      return true;
    }
    if (adoptedOpenId === live.id && ADOPTED_OPEN_PHASES.has(now.conn.phase)) {
      if (ph === now.conn.phase) return false;
      if (!ADOPTED_OPEN_PHASES.has(ph)) adoptedOpenId = null; // past opening: the usual checks from here
      log.info('the adopted session moved on in the VPN service; taking its state (Q0506)', { id: live.id, shown: now.conn.phase, listed: ph });
      if (ph === 'disconnecting') closingShownId = live.id;
      patch({ session: toLive(mine), conn: viewFor(ph, mine.error && ph === 'reconnecting' ? RETRYING_DETAIL() : '') });
      return true;
    }
    // dvpnd final2: "closing" before "ended" (G32; a stop from the CLI or dvpnd ending the session while
    // its stream sends nothing). The screen says Disconnecting, never "Protected", until the end.
    if (ph === 'disconnecting' && now.conn.phase !== 'disconnecting') {
      log.info('the VPN service lists the shown session as closing; showing Disconnecting', { id: live.id, shown: now.conn.phase });
      closingShownId = live.id;
      patch({ session: toLive(mine), conn: viewFor('disconnecting') });
      return true;
    }
    if (ph !== 'reconnecting') listReconnecting = null;
    if (ph === 'reconnecting' && now.conn.phase !== 'reconnecting') {
      const seen = listReconnecting?.id === live.id ? listReconnecting.seen + 1 : 1;
      listReconnecting = { id: live.id, seen };
      const streamFresh = streamSaid?.id === live.id && streamSaid.phase === 'connected' && Date.now() - streamSaid.at < STREAM_FRESH_MS;
      if (streamFresh || seen < 2) {
        log.debug('the VPN service lists the shown session as reconnecting; waiting for a second look (Q0546)', { id: live.id, seen, streamFresh });
        return false;
      }
      log.info('the VPN service lists the shown session as another state than shown; taking it', { id: live.id, shown: now.conn.phase, listed: ph });
      patch({ session: toLive(mine), conn: viewFor(ph, mine.error ? RETRYING_DETAIL() : '') });
      return true;
    }
    return false;
  }
  // dvpnd brought it back as a new session (its row names the successor, or the successor names it):
  // the same session to the user, followed at once, never cleared with "stopped working" (DIR/FWX 10-30)
  const by = list.find((x) => x.id === live.id)?.replacedBy;
  const successor = list.find((x) => (by ? x.id === by : x.replaces === live.id) && phaseFromDaemon(x.status, x.error) !== 'idle');
  if (successor) { missedId = null; return followRedial(live, successor.id, list); }
  if (missedId !== live.id && !opts.afterRestart) { missedId = live.id; return false; }
  missedId = null;
  const row = list.find((x) => x.id === live.id);
  log.warn('the shown session is no longer running in the VPN service; clearing it (Q0361)', { id: live.id, status: row?.status ?? null, running: running?.id ?? null });
  // After a restart a session missing from the list ended with the service, not by the user (Mac T4 r2).
  // A session with NO row at all also ended with the service: dvpnd keeps the row of a client close, with its
  // reason (AND-34 KSM13 blk × split-exc: engine killed, the row was gone, 'closed by client' showed
  // "Not connected" while the kill switch still blocked; the held view is the truth there).
  await ended(row ? toLive(row) : live, row?.error || (opts.afterRestart || !row ? 'daemon restarted' : 'closed by client'));
  if (running) await adoptRunningSession({ applyProxy: !isAndroid(), startedElsewhere: true });
  return true;
}

/** On app start: adopt a session the daemon still runs (never auto-start one). */
let known = false;
/** True once the app has asked the daemon for running sessions (or found it unreachable). */
export function sessionsKnown(): boolean {
  return known;
}

// Q0373 (TWD, Windows): during dvpnd's redial a ListSessions call dropped; the app took that as "no
// session", then the internet check (blocked by the kill switch holding for the redial) offered
// Restore network, which drops the block mid-redial. A failed read on a RUNNING daemon now means
// "unknown": never "no session", never Restore network. Only a daemon that is not running at all
// (nothing attached) proves no session of ours runs.
let sessionsUnreadable = false;

// Q0518 class: no leftover/blocked verdict while the service restarts (any process's Apply, a crash restart,
// 'daemon stopping'); one check when it has settled (services/service-transition.ts).
// Agent M Mac T4 r2: on settle the screen fell back to the session shown before the restart ('Protected') until
// the poll found it gone 1 s later; the shown session is checked against the restarted service first.
onTransitionBegan(() => {
  const s = snapshot();
  if (!s.session || s.conn.phase !== 'connected') return;
  transitionHeldId = s.session.id;
  patch({ conn: { ...viewFor('checking', RESTARTING_COPY), canCancel: false, canDisconnect: true } });
});
/** Q0548 (DVPN-WIN tr-kill-xr): the service crashed and Windows waits 5 min before its 3rd restart in a reset
 *  period; the screen kept 'Checking the connection… restarting. This takes a few seconds.' over a blocked internet. */
export function serviceDownCopy(ks: string): string {
  return ks !== 'off'
    ? tr('The VPN service stopped and has not started again, so the session ended. The kill switch keeps the internet blocked until it does, so nothing leaks. Press Restore network to start it now and get your normal connection back.')
    : tr('The VPN service stopped and has not started again, so the session ended. Press Restore network to start it now and get your normal connection back.');
}
onTransitionSettled(() => {
  void (async () => {
    // The guard's cap ended it with the service still down: say so, never keep 'restarting' (Q0548).
    const shownNow = snapshot().session;
    if (shownNow && !daemonRunning()) {
      transitionHeldId = null;
      const ks = getDaemonSettings().settings.killSwitch ?? 'off';
      log.warn('the VPN service did not come back within the restart window; ending the shown session', { id: shownNow.id, ks });
      await ended(shownNow, 'the VPN service stopped');
      patch({ conn: { ...viewFor('error', serviceDownCopy(ks)), title: tr('VPN service stopped'), restoreNetwork: true } });
      serviceDownShown = true;
      return;
    }
    if (snapshot().session) await reconcileShownSession(daemon(), { afterRestart: true });
    await adoptRunningSession({ applyProxy: !isAndroid(), startedElsewhere: true });
    await checkLeftoverBlock();
  })().catch((err) => log.warn('check after the service settled failed', { err: (err as Error).message }));
});
/** True when the last session read failed while dvpnd was running: whether a session runs is unknown. */
export function sessionStateUnknown(): boolean { return sessionsUnreadable; }
/** daemonInfo() reads the device file and can throw before the host is set up (FAN 47b427a): never from a catch. */
function daemonRunning(): boolean {
  try {
    return daemonInfo().reachable;
  } catch (err) {
    log.warn('could not read the VPN service state', { err: (err as Error).message });
    return false;
  }
}


/** Q0505: close history entries the service already ended (see closeEndedHistory). Never throws. */
function closeHistoryFrom(list: DaemonSession[], keepId: string | null): void {
  try {
    const n = closeEndedHistory(list.map((r) => ({
      id: r.id,
      running: phaseFromDaemon(r.status, r.error) !== 'idle',
      endedAt: r.endedAt ? Number(r.endedAt.seconds) * 1000 : null,
      rxBytes: r.usage?.rxBytes, txBytes: r.usage?.txBytes, spent: r.spent,
      reason: r.error, replacedBy: r.replacedBy,
    })), keepId);
    if (n) log.info('history: closed sessions the VPN service had ended', { count: n });
  } catch (err) {
    log.warn('history: could not close ended sessions', { err: (err as Error).message });
  }
}

/** watch: false = read once, open no stream (CLI `status`: one daemon call, Q0372). */
const adopting = new Map<string, Promise<void>>();
export function adoptRunningSession(opts: { applyProxy?: boolean; startedElsewhere?: boolean; watch?: boolean } = {}): Promise<void> {
  // Rows 119/122: a service that is not answering has no session of ours to read. No call, no log line (the
  // link says once why it is down); the owner's laptop log had 704 "could not list daemon sessions … not
  // running" lines, 330 of them in pairs 2 ms apart because every link event asked again.
  if (!daemonRunning()) {
    known = true;
    sessionsUnreadable = false;
    return Promise.resolve();
  }
  // A server test's session is the test's, not the user's: never shown, never taken over.
  if (testSessionActive()) return Promise.resolve();
  // Two callers asking the same thing at the same moment (a link event and the session poll) share one read.
  const key = `${opts.applyProxy ? 1 : 0}${opts.startedElsewhere ? 1 : 0}${opts.watch === false ? 0 : 1}`;
  const running = adopting.get(key);
  if (running) return running;
  const p = adoptOnce(opts).finally(() => { adopting.delete(key); });
  adopting.set(key, p);
  return p;
}

async function adoptOnce(opts: { applyProxy?: boolean; startedElsewhere?: boolean; watch?: boolean }): Promise<void> {
  try {
    const list = await daemon().listSessions();
    known = true;
    sessionsUnreadable = false;
    const s = runningSession(list);
    closeHistoryFrom(list, s?.id ?? snapshot().session?.id ?? null);
    if (!s) return;
    const shown = snapshot().session;
    if (shown && s.replaces === shown.id && await followRedial(shown, s.id, list)) return;
    const fresh = shown?.id !== s.id;
    if (opts.startedElsewhere && fresh) foreign.add(s.id);
    // a CLI (no shown session) picking up a reconnect chain: the earlier rows' totals from dvpnd's list
    if (s.replaces && !chainCarry.has(s.id)) chainCarry.set(s.id, chainTotals(list, s));
    const live = toLive(s);
    setSplitInEffect(splitForSession(live.service));
    setWholeDeviceInEffect(serviceUsesTun(live.service));
    const adoptedPhase = phaseFromDaemon(s.status, s.error);
    patch({ session: live, conn: viewFor(adoptedPhase) });
    // Q0506: picked up while another process's connect was still opening it; the list follows it too (reconcile).
    adoptedOpenId = ADOPTED_OPEN_PHASES.has(adoptedPhase) ? s.id : null;
    if (opts.watch !== false) watch(s.id);
    log.info('adopted running session', { id: s.id, node: s.node });
    // App only (never a CLI `status`): a V2Ray/Xray session found at start gets the same
    // "send apps through the VPN" as one started here, so the app never says connected while
    // the browser keeps the user's own IP.
    if (opts.applyProxy && fresh && proxyOnConnectFor(live) && !snapshot().proxyActive) {
      try {
        await setSystemProxy(live.proxyEndpoint);
      } catch (err) {
        log.warn('system proxy not set for the adopted session', { err: (err as Error).message });
      }
    }
  } catch (err) {
    known = true;
    // Not running: no session of ours can be. Running but the call failed (busy redialing): unknown.
    sessionsUnreadable = daemonRunning();
    log.warn('could not list daemon sessions', { err: (err as Error).message, daemonRunning: sessionsUnreadable });
  }
}

/**
 * What the blocked-internet screen says. After a session ended on its own (endedCopy = why, from dvpnd)
 * it keeps that reason: Q0366 pass 2 (FLX2 fedora) showed only "Your internet is not working…" after
 * dvpnd gave up reconnecting, hiding "The connection to this server stopped working." The kill switch
 * is still on then (kept until the user disconnects), so Restore network stays offered.
 */
const BLOCKED_NO_SESSION = (): string => tr('Your internet is not working and no VPN session is running. If the VPN was on before, its kill switch may still be blocking traffic.');
// DVPN-WIN Q0540 r21: with the kill switch on, the Kill switch page states the block as fact; this view hedged
// ('may still be blocking'). Same words both places; the hedge stays for kill switch off (a network fault).
/** KSM7 UI arm (DVPN-WIN k7u2): a kept block is not a failed connection (nothing was attempted); say what it is. */
export const BLOCKED_TITLE = (): string => tr('Internet blocked by the kill switch');
export const BLOCKED_HELD_DESKTOP = (): string => tr('The kill switch is still blocking the internet from the last session, so nothing leaks. Connect again, or press Restore network to get your normal connection back.');
export const KILL_SWITCH_HELD_CONNECT = (): string => tr('The kill switch is still blocking the internet from the last session, so this server cannot be reached. Press Restore network, then connect. Nothing was paid.');
export const SWITCH_WHILE_RECONNECTING = (): string => tr('Your current connection is reconnecting, and the kill switch lets nothing else out, so the new server cannot be checked yet. Nothing was paid. Try again once it says Protected, or disconnect first.');

/** Q0560: whether dvpnd says the running session is reconnecting right now (its live list, not the screen,
 *  which waits RECONNECT_GRACE_MS before it shows a drop). A failed list reads "no". */
export async function currentSessionReconnecting(): Promise<boolean> {
  try {
    const s = runningSession(await daemon().listSessions());
    return !!s && ['reconnecting', 'checking'].includes(phaseFromDaemon(s.status, s.error));
  } catch (err) {
    log.warn('switch: could not list sessions', { err: (err as Error).message });
    return false;
  }
}
const BLOCKED_HELD_ANDROID = (): string => tr('The kill switch is blocking your internet: the VPN dropped and nothing leaves the phone outside it. Reconnect, or press Restore network.');

export function blockedAfterEnd(endedCopy: Copy | null, general = BLOCKED_NO_SESSION()): string {
  if (!endedCopy) return general;
  // The action is an English routing key: its advice is a whole sentence of its own (actionSentence), never a
  // lower-cased piece inside this one.
  const advice = actionSentence(endedCopy.action);
  return advice
    ? `${endedCopy.message} ${tr('The kill switch is still blocking the internet to protect you.')} ${advice} ${tr('Or press Restore network to get it back.')}`
    : `${endedCopy.message} ${tr('The kill switch is still blocking the internet to protect you. Press Restore network to get it back.')}`;
}

/**
 * Dead-internet check (F14.3): no session, yet nothing answers — usually a kill switch
 * left behind by a daemon that died. Offers "Restore network"; never changes anything itself.
 */
export const LEFTOVER_RECHECK_MS = 3_000;
/** The blocked-internet view this module put up (not the leftover-tunnel one), so it can be taken down. */
let blockedShown = false;
// Q0575 (DVPN-WIN upgboot): on Windows the service starts ~2 min after log-in (delayed-auto) while its persistent
// block already holds; the app read 'Not connected' all that time. Now it says the block holds and the service is
// starting. Restore network needs the service, so it is not offered until the service answers.
let waitingShown = false;
export const BLOCKED_WAITING_DETAIL = (): string => tr('The kill switch is blocking the internet from your last session, so nothing leaks. The VPN service is still starting; once it is ready you can connect again or restore your network.');

/** At app start with the service not answering yet: shows the held block if the kill switch is on and nothing gets out. */
export async function showBlockWhileServiceStarts(): Promise<boolean> {
  const s = snapshot();
  if (daemonRunning() || s.session || s.conn.phase !== 'idle') return false;
  if ((getDaemonSettings().settings.killSwitch ?? 'off') === 'off') return false;
  if (await internetReachable(getRpcUrls())) return false;
  if (daemonRunning() || snapshot().session || snapshot().conn.phase !== 'idle') return false;
  waitingShown = true;
  log.info('the kill switch blocks the internet while the VPN service starts');
  patch({ conn: { ...viewFor('error', BLOCKED_WAITING_DETAIL()), title: BLOCKED_TITLE(), restoreNetwork: false } });
  return true;
}
export async function checkLeftoverBlock(given: Copy | null = null): Promise<boolean> {
  // Mac T3 r2: the reason of the end was lost across the restart (generic card); the last unexpected end's is used.
  const endedCopy = given ?? lastEndCopy;
  if (serviceInTransition()) return false; // the service is restarting: not a leftover; one check runs when it settles
  // Q0575: the service answers now: the waiting view goes, and the normal check below decides what is true.
  if (waitingShown && daemonRunning()) { waitingShown = false; if (snapshot().conn.phase === 'error' && !snapshot().session) patch({ conn: viewFor('idle') }); }
  // Q0551 (DVPN-WIN ksoff-held r51): the service came back 16 ms after the 'VPN service stopped' view and the view
  // still said 'has not started again' for 38 s. Once it answers, the screen says what is true now.
  if (serviceDownShown && daemonRunning() && !snapshot().session) {
    serviceDownShown = false;
    const ks = getDaemonSettings().settings.killSwitch ?? 'off';
    const back = closeReasonCopy('daemon restarted');
    log.info('the VPN service is back after the stopped view (Q0551)', { ks });
    if (ks === 'off') patch({ conn: viewFor('idle'), lastCloseMessage: back });
    else {
      blockedShown = true; // the check below takes it down once the internet answers
      patch({ conn: { ...viewFor('error', blockedAfterEnd(back)), title: BLOCKED_TITLE(), restoreNetwork: true }, lastCloseMessage: back });
    }
  }
  const s = snapshot();
  // DVPN-LINUX KSM14: after kill switch Off + Apply the 'Blocking internet' view stayed 61 s with the
  // internet already direct. A shown block that is gone is taken down (idle), never left up.
  if (blockedShown && !s.session && s.conn.phase === 'error' && s.conn.restoreNetwork) {
    // Android: this app's own traffic is outside the VPN, so 'the internet answers' proves nothing about the
    // block; the VPN interface does (held = still blocking every other app). Unreadable keeps the view (AND-34).
    const gone = isAndroid()
      ? (await androidHeldBlock().catch((err: unknown) => { log.warn('vpn state unreadable at the blocked-view check', { err: (err as Error).message }); return null; })) === false
      : await internetReachable(getRpcUrls());
    if (!gone || snapshot().session) return true;
    blockedShown = false;
    log.info('the block is gone: blocked view taken down');
    patch({ conn: viewFor('idle') });
    return false;
  }
  if (s.session || s.conn.phase !== 'idle') return false;
  // Q0373: read dvpnd again; a running daemon that cannot answer may be redialing a session.
  await adoptRunningSession();
  if (snapshot().session) return false;
  if (sessionsUnreadable) {
    log.warn('the VPN service is running but did not list its sessions: not offering Restore network (it may be reconnecting)');
    return false;
  }
  // A tunnel with no session can leave the internet WORKING, through a node, still billed
  // (gap the Linux app): look for one before the reachability check, which would say all is well.
  // Q0522: a v2ray.exe/xray.exe still exiting after its session ended is not a leftover: look again 3 s later.
  let left = await leftoverTunnels();
  if (left.length) { await new Promise((r) => setTimeout(r, LEFTOVER_RECHECK_MS)); left = await leftoverTunnels(); }
  if (left.length && !snapshot().session && !serviceInTransition()) {
    log.warn('no session but a VPN tunnel is still running: offering Restore network', { left });
    patch({ conn: { ...viewFor('error', tr('A VPN connection from before is still running without this app. Your traffic may still go through a server. Press Restore network to stop it.')), restoreNetwork: true } });
    return true;
  }
  // Android: this app's own traffic is outside the VPN, so "is the internet reachable" always
  // says yes. The VPN service knows whether it is holding the interface with no session.
  if (isAndroid()) {
    const held = await androidHeldBlock().catch((err: unknown) => { log.warn('vpn state unreadable', { err: (err as Error).message }); return null; });
    if (!held || snapshot().session) return false;
    log.warn('no session and the VPN interface is held: offering Restore network', { ended: endedCopy?.message ?? null });
    blockedShown = true;
    patch({ conn: { ...viewFor('error', blockedAfterEnd(endedCopy, BLOCKED_HELD_ANDROID())), title: BLOCKED_TITLE(), restoreNetwork: true } });
    return true;
  }
  if (await internetReachable(getRpcUrls())) return false;
  if (snapshot().session) return false; // a session started while we checked
  log.warn('no session and no internet: offering Restore network', { ended: endedCopy?.message ?? null });
  blockedShown = true;
  patch({ conn: blockedNoSessionView(endedCopy) });
  return true;
}

/**
 * CODE-AUDIT M13 (A): the view for "no session and the internet does not answer" (desktop). The app's leftover check
 * and the CLI's `status` (another process, which never saw the session end) both use it, so neither can say
 * "Not connected" with nothing to press while the kill switch still blocks the internet.
 */
export function blockedNoSessionView(endedCopy: Copy | null = null): ReturnType<typeof viewFor> & { restoreNetwork: true } {
  const held = (getDaemonSettings().settings.killSwitch ?? 'off') !== 'off';
  return { ...viewFor('error', blockedAfterEnd(endedCopy, held ? BLOCKED_HELD_DESKTOP() : BLOCKED_NO_SESSION())), title: BLOCKED_TITLE(), restoreNetwork: true };
}

/**
 * Remove dvpn tunnel services left running with no session. Returns an error message, or null when none are left.
 * `sweep` (the user pressed Restore network, on an OS where restoreNetworkSweep() says so: Linux, macOS): run the
 * root step even when nothing is visible, because only root sees dvpnd's firewall tables. A killed dvpnd left
 * `inet dvpnd_hy2` with nothing else, and `Network restored.` kept it (Q0239, the Linux app). A sweep that finds nothing
 * visible and cannot run (prompt declined, no sudo over SSH) is not an error. Windows: restoreNetworkSweep() is
 * false, so Restore network raises no new admin prompt there.
 */
async function removeOrphanTunnels(sweep = false): Promise<string | null> {
  const left = await leftoverTunnels();
  // CODE-AUDIT U-27b: an openvpn.exe left by dvpnd is not in leftoverTunnels() (unelevated it cannot be told from a
  // user's own OpenVPN), so the elevated step that stops it never ran from Restore network. Any openvpn.exe running
  // now runs that step; the step stops only dvpnd's. Like a sweep, a step that cannot run is then not an error.
  const ovpn = !left.length && !sweep && (await openvpnRunning());
  if (ovpn) log.info('restore network: an OpenVPN process is running; checking whether it is a leftover of ours');
  if (!left.length && !sweep && !ovpn) return null;
  if (left.length) log.warn('leftover tunnel services with no session', { left });
  const r = await removeTunnelServices();
  if (!r.ok && !left.length) { log.warn('restore network: root clean-up of firewall tables did not run', { detail: r.detail }); return null; }
  return r.ok ? null : tr('A VPN tunnel was left running and could not be removed ({detail}). {osWord} to clear it.', { detail: r.detail, osWord: osWord('restart', process.platform) });
}

/** RC9 PF-DEAD: the root clean-up (tunnels, kill-switch firewall table, DNS) with the daemon not answering. Never throws. */
async function sweepAfterDeadDaemon(): Promise<void> {
  try {
    const r = await removeTunnelServices();
    if (r?.ok) log.info('restore network: root sweep with the daemon down', { detail: r.detail });
    else log.warn('restore network: root sweep with the daemon down did not finish', { detail: r?.detail ?? 'no result' });
  } catch (err) {
    log.warn('restore network: root sweep with the daemon down failed', { err: (err as Error).message });
  }
}

/** "Restore network": stop whatever the daemon holds so it releases kill switch + DNS (F14.3). */
export async function restoreNetwork(retried = false): Promise<Result> {
  try {
    const list = await daemon().listSessions();
    for (const s of list) {
      if (phaseFromDaemon(s.status, s.error) === 'idle') continue;
      const r = await daemon().stopSession(s.id);
      recordEnd(r.session ? toLive(r.session) : toLive(s), 'restored network');
      if (r.dnsRevertFailed && await dnsReallyLeftOver(getDaemonSettings().settings.dnsServers)) return { ok: false, error: DNS_NOT_RESTORED_COPY(), code: 'dns-revert-failed' };
    }
    // A kill switch dvpnd KEPT with no live session (persist mode after a restart, or a failed
    // re-apply) is released only by StopSession, which dvpnd accepts with no session at all.
    // Skipping it because the session list was empty left a VM offline for good (R3, gap the macOS app).
    if (await releaseKeptKillSwitch()) log.info('restore network: released a kept kill switch');
    stopWatching();
    await clearSystemProxy();
    // No session left, yet a dvpn tunnel service may still hold the default route (gap another project).
    const stuck = await removeOrphanTunnels(restoreNetworkSweep());
    if (stuck) return { ok: false, error: stuck, code: 'tunnel-left' };
    patch({ session: null, conn: viewFor('idle') });
    return { ok: true };
  } catch (err) {
    // A dead daemon can leave its kill switch blocking everything; restarting the service
    // makes it release (proven on the box rig, TEST-PLAN T14). Its tunnel is orphaned too.
    log.warn('restore network: daemon did not answer', { err: (err as Error).message });
    if (isAndroid()) {
      // A phone has no service to restart by hand and no orphan tunnels: the app restarts its VPN engine
      // itself (as Settings does), and the user presses Restore network once more (C16, no desktop wording).
      const re = await restartAndroidDaemon();
      if (!re.ok) log.warn('restore network: VPN engine restart failed', { err: re.error });
      return { ok: false, error: re.ok ? ANDROID_ENGINE_RESTARTED_COPY() : ANDROID_ENGINE_DOWN_COPY(), code: 'daemon-unavailable' };
    }
    // RC9 PF-DEAD (the macOS app live run 44808199308, pf_restore): after kill -9 of the daemon no leftover LINK showed, so
    // removeOrphanTunnels() returned before the root step and the kill switch's firewall table (pf anchor + its
    // attach line) kept blocking everything. A dead daemon always gets the root sweep; it is idempotent.
    await sweepAfterDeadDaemon();
    // A stopped service is started without elevation (old installs: 'no-right'); once it
    // answers, one more pass releases its kill switch. Same as linux-app 19bff7a7 (C18).
    // RC9 PF-DEAD: a killed daemon is restarted by launchd/systemd itself ('running'): wait for it and run once more too.
    // RC9 PF-DEAD-2 (the macOS app live run 44813895933): a normal user cannot kickstart a system daemon ('no-right'), so the
    // restore gave up at once; seconds later KeepAlive brought dvpnd back and it RE-APPLIED the kill switch it held
    // when it died (the block was back after the sweep). Off Windows the service manager restarts it anyway: wait
    // for it and run once more, which releases the held kill switch (StopSession, as the second restore did live).
    if (!retried) {
      const svc = await startServiceIfStopped();
      log.info('restore network: service start', { svc });
      const comesBack = svc === 'started' || svc === 'running' || (svc === 'no-right' && process.platform !== 'win32');
      if (comesBack && (await waitForDaemon(SERVICE_WAIT_MS, daemonInfo)).reachable) return restoreNetwork(true);
    }
    return { ok: false, error: tr('The VPN service is not answering. {osWord}, then press Restore network again.', { osWord: osWord('restartService', process.platform) }), code: 'daemon-unavailable' };
  }
}

export const ANDROID_ENGINE_RESTARTED_COPY = (): string => tr('The VPN engine was not answering, so the app restarted it. Press Restore network again.');
export const ANDROID_ENGINE_DOWN_COPY = (): string => tr('The VPN engine is not answering and could not be restarted. Close the app from Recent apps (or restart the phone), then press Restore network again.');
export const DNS_NOT_RESTORED_COPY = (): string => (isAndroid()
  ? tr('DNS could not be restored. Turn Wi-Fi or mobile data off and on, or restart the phone.')
  : tr('DNS could not be restored. Reconnect your network or restart the computer.'));
