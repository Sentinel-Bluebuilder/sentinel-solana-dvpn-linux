// ─── Settlement executor (F12, D3) ───
// Only channels THIS device opened (opener == device) are touched — the owner may
// have channels from other apps/devices — unless the user names another device
// whose spending permission is already removed (gap #95). Live-session channels are
// skipped. Voucher: start_close, then close after the grace. Stream: close now.
// Refunds land in User.balance; withdraw moves them back to the wallet.
import type { PendingSettlement, Result } from '../../shared/types';
import { channelsByOwner, userByOwner } from '../../core/chain/accounts';
import { fetchConfig } from '../../core/chain/program';
import type { TransactionInstruction } from '@solana/web3.js';
import { overLimitState } from '../../core/chain/rpc';
import { approveDelegate, closeChannel, startCloseChannel, withdrawUserBalance } from '../../core/chain/builders';
import { balanceGone, channelGone, daemonWentAway, planChannel, refundable, streamLeft, type ChainChannel, type StreamFields } from '../../core/settlement/settlement';
import { MODE_STREAM } from '../../core/chain/idl';
import { dueForAutoRefund, idleCandidate } from '../../core/settlement/auto-refund';
import { reuseRefused } from './connect-checks';
import { signAndSend } from '../../core/app/signer';
import { describeInstructionError } from '../../core/chain/errors';
import { noWallet, ownerAddress, ownerSigner } from '../wallet/vault';
import { readWalletStatus } from '../../core/app/wallet-status';
import { tr, trPlural } from '../../shared/i18n';
import { daemon, daemonInfo, deviceRecord } from '../daemon/manager';
import { phaseFromDaemon } from '../../core/session/state';
import { patch, snapshot, toast } from '../app-state';
import { log } from '../logger';
import { isAndroid } from '../../shared/is-android';

let running = false;
const soon = new Map<string, ReturnType<typeof setTimeout>>();
/** Channels whose queued close already fired: start_close may be in flight or not yet visible on RPC. */
const closing = new Map<string, number>();
const CLOSING_MS = 120_000;
/**
 * How long after a session ends a PER-HOUR deposit stays open for a reconnect (Q0411, DIR); the timer below
 * closes only per-hour ones. A per-GB deposit is kept a day (auto-refund.ts KEEP_PER_GB_S, owner 2026-11-12).
 * The timer is in memory; autoRefundIdle does the same from chain + dvpnd after a restart.
 */
export const SETTLE_AFTER_MS = 10 * 60_000;

/** A "switching servers" end queues no close: the user is moving between servers and may be back. */
export function settlesOnEnd(reason: string): boolean {
  return !/switching servers/i.test(reason);
}

function toChain(c: Record<string, unknown>): ChainChannel {
  return {
    address: String(c.address), owner: String(c.owner), node: String(c.node), opener: String(c.opener),
    mode: Number(c.mode), status: Number(c.status), escrow: String(c.escrow ?? '0'), redeemed: String(c.redeemed ?? '0'),
    closeStartedAt: String(c.closeStartedAt ?? '0'), rentPayer: String(c.rentRecipient),
  };
}

const maxBig = (a: string, b: string): string => (BigInt(a) > BigInt(b) ? a : b);

/** Channels behind the daemon's live sessions, and what the daemon has signed per channel. Throws if the
 *  daemon is up but cannot answer: settling blind could close the channel of the session in use. */
async function liveFromDaemon(): Promise<{ channels: string[]; cumulative: Map<string, string> }> {
  if (!daemonInfo().reachable) return { channels: [], cumulative: new Map() }; // no daemon → no tunnel
  const [sessions, chans] = await Promise.all([daemon().listSessions(), daemon().listChannels()]);
  return {
    channels: sessions.filter((x) => phaseFromDaemon(x.status, x.error) !== 'idle').map((x) => x.channel).filter(Boolean),
    cumulative: new Map(chans.map((c) => [c.address, c.cumulative || '0'])),
  };
}

/**
 * Another device of this wallet (gap #95: its computer is gone, its key lost; rc.3.1 F1: the device a wallet
 * switch replaced). While it holds a spending permission it may be in a paid session somewhere, so its OPEN
 * deposits are listed `unverified` and a refund starts only for one named with --channel. Its closing and ready
 * deposits, and all of a device without a permission, settle as usual: that cannot cut a live connection.
 */
async function canStillSpend(owner: string, device: string): Promise<boolean> {
  try {
    return Boolean((await readWalletStatus(owner, device)).grant);
  } catch (err) {
    log.warn('settle: could not read another device\'s spending permission; its open deposits wait to be named', { device, err: (err as Error).message });
    return true;
  }
}

/** This computer's device record when it is the loaded wallet's; null when it names another wallet or none. */
function recordFor(owner: string | null): { device: string } | null {
  const d = daemonInfo().device;
  if (!owner || !d) return null;
  try {
    const rec = deviceRecord();
    return !rec?.owner || rec.owner === owner ? { device: d } : null;
  } catch (err) {
    log.warn('settle: no device record to read; listing by the service device', { err: (err as Error).message });
    return { device: d };
  }
}

/**
 * The loaded wallet's deposits on chain, with what settling each needs. `other` = only that device's (gap #95).
 * rc.3.1 F1 (after rc.4 E-17/E-55): every device's deposits are listed, not only this computer's. A wallet switch
 * there and back left the first wallet's deposits of its replaced device out of every list. A row of another
 * device carries `device`; its open deposits are `unverified` while that device can still spend.
 */
export async function readSettlements(other?: string): Promise<PendingSettlement[]> {
  const owner = ownerAddress();
  if (!owner) return [];
  if (other && other === daemonInfo().device) throw new Error(`That is ${isAndroid() ? 'this phone' : 'this computer'}'s device: leave out --device.`);
  // This computer's device, when its record is the loaded wallet's (a record naming another wallet: none is).
  const mine = recordFor(owner)?.device ?? null;
  const [chans, cfg, live] = await Promise.all([channelsByOwner(owner), fetchConfig(), other ? Promise.resolve({ channels: [], cumulative: new Map<string, string>() }) : liveFromDaemon()]);
  const others = [...new Set(chans.map((raw) => toChain(raw).opener).filter((d) => d !== mine && (!other || d === other)))];
  const spends = new Map(await Promise.all(others.map(async (d) => [d, await canStillSpend(owner, d)] as const)));
  const now = Math.floor(Date.now() / 1000);
  // In use = what the daemon itself is running, not what this process remembers: the CLI
  // (or an app started after the session) has no session in memory. Another device has no
  // session here, and with its permission removed it cannot have one anywhere.
  const inUse = new Set(other ? [] : [...live.channels, ...(snapshot().session?.channel ? [snapshot().session!.channel] : [])]);
  const out: PendingSettlement[] = [];
  for (const raw of chans) {
    const ch = toChain(raw);
    if (other && ch.opener !== other) continue;
    const fromOther = ch.opener !== mine;
    const a = planChannel(ch, { now, graceSeconds: cfg.channelCloseGraceSeconds, inUse: fromOther ? new Set<string>() : inUse });
    out.push({
      ...(fromOther ? { device: ch.opener } : {}),
      ...(fromOther && a.kind === 'start-close' && spends.get(ch.opener) !== false ? { unverified: true } : {}),
      channel: ch.address, node: ch.node, mode: ch.mode, escrow: ch.escrow, redeemed: ch.redeemed,
      status: a.kind === 'in-use' ? 'in-use' : a.kind === 'start-close' ? 'open' : a.kind === 'wait' ? 'closing' : 'ready',
      readyAt: a.kind === 'wait' ? a.readyAt : null,
      openedAt: Number((raw as { openedAt?: unknown }).openedAt ?? 0) || undefined,
      ...(reuseRefused(ch.address) ? { reuseRefused: true } : {}),
      ...(ch.mode === MODE_STREAM && /^[1-9]\d*$/.test(String((raw as { ratePerHour?: unknown }).ratePerHour ?? '')) ? { ratePerHour: String((raw as { ratePerHour?: unknown }).ratePerHour) } : {}),
      // Per hour: the node is owed elapsed time (closing settles it), so only the unspent time comes back.
      // Per GB: on-chain redeemed lags until the node redeems; the daemon's last signed voucher is the real spend.
      refundable: (ch.mode === MODE_STREAM
        ? streamLeft(raw as unknown as StreamFields, now)
        : refundable({ ...ch, redeemed: maxBig(ch.redeemed, live.cumulative.get(ch.address) ?? '0') })).toString(),
    });
  }
  if (!other) patch({ settlements: out }); // the app's list: every device's deposits, other devices' rows marked
  return out;
}

/** How many refund starts / closes share one transaction. Kept small: a close carries ~8 accounts, and a
 *  transaction is 1232 bytes; the devnet run in docs/MONEY-FLOW.md records what fits. */
export const STARTS_PER_TX = 4;
export const CLOSES_PER_TX = 2;
/**
 * Project rule: what is signed changes only after it has landed on devnet. Until the combined transactions have
 * a devnet signature in docs/MONEY-FLOW.md this stays false and refunds go out exactly as before (one deposit per
 * transaction, then a separate withdraw). DVPN_REFUNDS_TOGETHER=1 turns it on for that devnet run only.
 */
export const refundsTogether = (): boolean => REFUNDS_TOGETHER_PROVEN || process.env.DVPN_REFUNDS_TOGETHER === '1';
const REFUNDS_TOGETHER_PROVEN = false;
function groupsOf<T>(items: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/**
 * UI-072: each deposit uses up part of the wallet's token approval and a refund does not give it back, so
 * the wallet had to sign "raise the limit" every ~10 deposits. A refund is already signed by the wallet:
 * put the approval back to this computer's own spending limit in that same transaction. Only ever raises
 * it, only up to the limit the user already set (the grant caps what this computer can spend either way).
 * Empty when there is nothing to do, for another computer's deposits, or when the read fails.
 */
async function approvalTopUp(owner: string, other?: string): Promise<TransactionInstruction[]> {
  const device = daemonInfo().device;
  if (other || !device) return [];
  try {
    const st = await readWalletStatus(owner, device);
    const limit = BigInt(st.grant?.allowance ?? '0');
    if (limit === 0n || st.ownerAta === false || BigInt(st.delegated) >= limit) return [];
    return [approveDelegate({ owner, amount: limit.toString() })];
  } catch (err) {
    log.warn('settle: could not read the token approval, refund goes without topping it up', { err: (err as Error).message });
    return [];
  }
}

// Row 73: the project's 7 s between transactions is for the public Solana endpoint, which answers "busy" to a
// quick second one. A refund run sent its transactions back to back (five in 15 s on 2026-11-15). On the public
// endpoint each one now waits until 7 s after the one before; on the user's own endpoint nothing waits.
export const SETTLE_TX_GAP_MS = 7000;
let lastTxAt = 0;
function onPublicEndpoint(): boolean {
  try {
    return overLimitState().inUse === 'public';
  } catch (err) {
    log.info('settle: endpoint in use not known, sending without the wait', { err: (err as Error).message });
    return false;
  }
}
/** Exported for tests: how long the next refund transaction waits (ms). */
export function settleWaitMs(now = Date.now(), isPublic = onPublicEndpoint()): number {
  return isPublic && lastTxAt ? Math.max(0, lastTxAt + SETTLE_TX_GAP_MS - now) : 0;
}
async function paced(signer: Parameters<typeof signAndSend>[0], ixs: TransactionInstruction[], label: string): Promise<{ signature: string }> {
  const wait = settleWaitMs();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  try {
    return await signAndSend(signer, ixs, label);
  } finally {
    lastTxAt = Date.now();
  }
}

/** Do every step that is due now. `only` limits it to some channels; `other` settles another device's (gap #95). Returns signatures. */
export async function runSettlement(only?: string[], other?: string): Promise<Result<string[]>> {
  if (running) return { ok: false, error: tr('A refund is already running.'), code: 'busy' };
  running = true;
  const sigs: string[] = [];
  try {
    const owner = ownerAddress();
    if (!owner) return { ok: false, ...noWallet() };
    const signer = ownerSigner();
    const chans = await channelsByOwner(owner);
    const byAddr = new Map(chans.map((c) => [String(c.address), toChain(c)]));
    // One deposit failing never stops the rest; a deposit closed elsewhere meanwhile is skipped.
    const failed: string[] = [];
    let due = 0;
    // UI-069/070/072: the steps due now go out together. Refund starts share a transaction; closes share one
    // with the move back to the wallet and, when this computer's token approval has run below its spending
    // limit, the approval put back to that limit (never above it, never lowered). So a refund lands in the
    // wallet in one signature and there is no separate "add to wallet" step. Every transaction is simulated
    // before it is signed; a group that does not pass is done one deposit at a time, as before.
    // CODE-AUDIT U-33: a refund start is marked closing BEFORE it is sent, so a Connect in this process never
    // reuses that deposit meanwhile ("position closing", ui-win-3); a start that did not go through is unmarked.
    const markStart = (c: string): void => { closing.set(c, Date.now()); };
    const unmarkStart = (c: string): void => { closing.delete(c); };
    const one = async (p: PendingSettlement, ch: ChainChannel): Promise<void> => {
      if (p.status === 'open') markStart(p.channel);
      try {
        if (p.status === 'open') sigs.push((await paced(signer, [await startCloseChannel({ owner, channel: ch.address })], 'start_close_channel')).signature);
        else sigs.push((await paced(signer, [await closeChannel({ signer: owner, ch })], 'close_channel')).signature);
      } catch (err) {
        const msg = describeInstructionError(err) ?? (err as Error).message;
        if (channelGone(msg)) { log.info('settle: deposit already closed elsewhere, skipped', { channel: p.channel }); return; }
        if (p.status === 'open') unmarkStart(p.channel);
        failed.push(msg);
        log.warn('settle: one deposit failed, going on', { channel: p.channel, err: msg });
      }
    };
    const starts: Array<{ p: PendingSettlement; ch: ChainChannel }> = [];
    const closes: Array<{ p: PendingSettlement; ch: ChainChannel }> = [];
    for (const p of await readSettlements(other)) {
      if (only && !only.includes(p.channel)) continue;
      if (p.status !== 'open' && p.status !== 'ready') continue;
      // rc.4 E-17: an open deposit whose device is not known to be this computer's is never started here
      // unless named (`only`): it may be in use on another computer of this wallet.
      if (p.unverified && !only?.includes(p.channel)) continue;
      due++;
      const ch = byAddr.get(p.channel);
      if (!ch) continue;
      (p.status === 'open' ? starts : closes).push({ p, ch });
    }
    const together = refundsTogether();
    for (const group of groupsOf(starts, together ? STARTS_PER_TX : 1)) {
      if (group.length === 1) { await one(group[0].p, group[0].ch); continue; }
      for (const g of group) markStart(g.p.channel);
      try {
        const ixs = await Promise.all(group.map((g) => startCloseChannel({ owner, channel: g.ch.address })));
        sigs.push((await paced(signer, ixs, 'start_close_channel')).signature);
      } catch (err) {
        log.info('settle: refund starts did not pass together, doing them one at a time', { n: group.length, err: describeInstructionError(err) ?? (err as Error).message });
        for (const g of group) await one(g.p, g.ch);
      }
    }
    const user = await userByOwner(owner);
    const closeGroups = groupsOf(closes, together ? CLOSES_PER_TX : 1);
    let withdrawn = false;
    for (const [gi, group] of closeGroups.entries()) {
      const last = gi === closeGroups.length - 1;
      // the move to the wallet rides on the last close; it needs the account that holds refunds to exist already
      const tail = together && last && user ? [await withdrawUserBalance({ owner, userRentPayer: String(user.rentRecipient) }), ...(await approvalTopUp(owner, other))] : [];
      if (group.length === 1 && !tail.length) { await one(group[0].p, group[0].ch); continue; }
      try {
        const ixs = [...(await Promise.all(group.map((g) => closeChannel({ signer: owner, ch: g.ch })))), ...tail];
        sigs.push((await paced(signer, ixs, tail.length ? 'close_channel+withdraw' : 'close_channel')).signature);
        if (tail.length) withdrawn = true;
      } catch (err) {
        log.info('settle: closes did not pass together, doing them one at a time', { n: group.length, withWithdraw: tail.length > 0, err: describeInstructionError(err) ?? (err as Error).message });
        for (const g of group) await one(g.p, g.ch);
      }
    }
    if (!withdrawn) {
      // Nothing was closed with a withdraw (no close due, or the group fell back): move what is waiting, if any.
      // Read again: a close above may have just added to it, and an empty withdraw is never sent (UI-175).
      const now = closes.length ? await userByOwner(owner) : user;
      if (now && BigInt(String(now.balance)) > 0n) {
        try {
          sigs.push((await paced(signer, [await withdrawUserBalance({ owner, userRentPayer: String(now.rentRecipient) }), ...(together ? await approvalTopUp(owner, other) : [])], 'withdraw_user_balance')).signature);
        } catch (err) {
          const msg = describeInstructionError(err) ?? (err as Error).message;
          if (!balanceGone(msg)) throw err;
          log.info('settle: refund already withdrawn by another settle, skipped', { err: msg });
        }
      }
    }
    await readSettlements();
    // UI-068: one thing for the user, money coming back: say what happened to it, not "refund steps".
    if (sigs.length) toast('success', withdrawn || (closes.length && !failed.length) ? tr('Refund added to your wallet.') : starts.length && !closes.length ? (starts.length > 1 ? trPlural({ one: '{count} refund started.', other: '{count} refunds started.' }, starts.length, { count: starts.length }) : tr('Refund started.')) : tr('Refund confirmed.'));
    if (failed.length) {
      log.error('settlement partly failed', { err: `${failed.length} of ${due} deposits could not be refunded yet (${failed[0]})`, done: sigs });
      const error = trPlural({
        one: '{failed} of {count} deposit could not be refunded yet ({reason}). The others are done; it tries again automatically.',
        other: '{failed} of {count} deposits could not be refunded yet ({reason}). The others are done; it tries again automatically.',
      }, due, { failed: failed.length, count: due, reason: failed[0] });
      return { ok: false, error, code: 'settle-failed', data: sigs };
    }
    return { ok: true, data: sigs };
  } catch (err) {
    const msg = describeInstructionError(err) ?? (err as Error).message;
    if (daemonWentAway(err)) {
      log.warn('settlement deferred: the VPN service stopped, settle runs again later', { err: msg, done: sigs });
      return { ok: false, error: tr('The VPN service stopped during the refund. Nothing was lost; it runs again shortly.'), code: 'daemon-gone', data: sigs };
    }
    log.error('settlement failed', { err: msg, done: sigs });
    return { ok: false, error: msg, code: 'settle-failed', data: sigs };
  } finally {
    running = false;
  }
}

/** After a session ends, settle its channel later (a reconnect within SETTLE_AFTER_MS reuses it). */
export function settleChannelSoon(channel: string, delayMs = SETTLE_AFTER_MS): void {
  if (soon.has(channel)) return;
  soon.set(channel, setTimeout(() => {
    soon.delete(channel);
    // A per-GB deposit is kept for a reconnect (autoRefundIdle refunds it after a day idle).
    const known = snapshot().settlements?.find((x) => x.channel === channel);
    if (!known || known.mode !== MODE_STREAM) { log.info('per-GB deposit kept for a reconnect', { channel }); return; }
    closing.set(channel, Date.now());
    void runSettlement([channel]).then((r) => { if (!r.ok) log.warn('auto-settle deferred', { channel, err: r.error }); });
  }, delayMs));
}

/**
 * A connect wants to reuse this deposit. A close still waiting is cancelled (the deposit carries
 * on); one that already fired makes the deposit unusable, so the caller pays a new one. Without
 * this, Disconnect then Connect within ~20 s reused a deposit the app was closing and the node
 * ended the new session with "position closing" (ui-win-3 route run, 2026-10-22).
 */
export function claimForReuse(channel: string): boolean {
  const t = soon.get(channel);
  if (t) {
    clearTimeout(t);
    soon.delete(channel);
    log.info('queued close cancelled: a new session reuses the deposit', { channel });
    return true;
  }
  const since = closing.get(channel);
  if (since !== undefined && Date.now() - since < CLOSING_MS) return false;
  closing.delete(channel);
  return true;
}

/** Withdraw the refundable User.balance now (explicit button). */
export async function withdraw(): Promise<Result<string>> {
  const owner = ownerAddress();
  if (!owner) return { ok: false, ...noWallet() };
  const user = await userByOwner(owner);
  if (!user || BigInt(String(user.balance)) === 0n) return { ok: false, error: tr('Nothing to refund.'), code: 'nothing' };
  try {
    const r = await paced(ownerSigner(), [await withdrawUserBalance({ owner, userRentPayer: String(user.rentRecipient) })], 'withdraw_user_balance');
    return { ok: true, data: r.signature };
  } catch (err) {
    return { ok: false, error: describeInstructionError(err) ?? (err as Error).message, code: 'withdraw-failed' };
  }
}

// ─── Idle deposits (owner 2026-11-12) ───
const AUTO_EVERY_MS = 10 * 60_000;
let lastAuto = 0;

/**
 * Refund deposits that sat idle past their keep time (per GB a day, per hour 10 min). Runs with the
 * settlements poll, at most every 10 min, from what the chain and dvpnd say, so an app restart loses
 * nothing (the old in-memory 10-min timer was lost on every restart).
 */
export async function autoRefundIdle(nowMs = Date.now()): Promise<void> {
  if (nowMs - lastAuto < AUTO_EVERY_MS) return;
  lastAuto = nowMs;
  // rc.3.1 F1: another device's deposit is never auto-refunded: this computer cannot see that device's sessions.
  const all = (snapshot().settlements ?? []).filter((x) => !x.device);
  const open = all.filter((x) => idleCandidate(x, MODE_STREAM));
  if (!open.length) { if (all.length) log.info('idle deposits checked', { open: 0, statuses: all.map((x) => x.status) }); return; }
  const lastActive = new Map<string, number>();
  try {
    for (const ses of await daemon().listSessions()) {
      const t = ses.endedAt ? Number(ses.endedAt.seconds) : Math.floor(nowMs / 1000);
      if (t > (lastActive.get(ses.channel) ?? 0)) lastActive.set(ses.channel, t);
    }
  } catch (err) {
    log.warn('auto refund skipped: the VPN service did not list its sessions', { err: (err as Error).message });
    return;
  }
  const due = dueForAutoRefund(open, lastActive, Math.floor(nowMs / 1000), MODE_STREAM).filter((c) => !soon.has(c));
  log.info('idle deposits checked', { open: open.map((x) => ({ channel: x.channel.slice(0, 6), perHour: x.mode === MODE_STREAM })), due: due.map((c) => c.slice(0, 6)) });
  if (!due.length) return;
  for (const c of due) closing.set(c, Date.now());
  log.info('auto refund of idle deposits', { channels: due });
  const r = await runSettlement(due);
  if (!r.ok) log.warn('auto refund deferred', { err: r.error });
}
