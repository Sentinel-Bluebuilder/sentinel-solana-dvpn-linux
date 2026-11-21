// ─── Connect checks and lookups (split from connection.ts) ───
// Zero-cost checks before paying, and the daemon/chain lookups that decide whether to reuse a
// deposit or ticket. Nothing here pays or changes the network.
import type { ConnectRequest } from '../../shared/types';
import { prepayFor } from '../../shared/prepay-cap';
import { DEPOSITS_UNREAD_COPY, killSwitchBlocksProtocol } from '../../core/session/state';
import { discoverNode, probeNode } from '../../core/nodes/discovery';
import { costPreview, fundingBlocker, fundingProblem } from '../../core/pricing/cost';
import { readWalletStatus } from '../../core/app/wallet-status';
import { CHANNEL_STATUS_OPEN, MODE_STREAM } from '../../core/chain/idl';
import { streamLeft, type StreamFields } from '../../core/settlement/settlement';
import fs from 'node:fs';
import path from 'node:path';
import { getHost } from '../host';
import { binPath, daemon, daemonInfo } from '../daemon/manager';
import { ownerAddress } from '../wallet/vault';
import { channelsByOwner } from '../../core/chain/accounts';
import { chainClockSkew, clockSkewBlocker } from '../../core/chain/clock';
import { subscriptionsOf } from '../../core/plans/plans';
import { patch, snapshot } from '../app-state';
import { log } from '../logger';
import { getDaemonSettings } from '../daemon/settings';
import { topUpDeviceIfLow } from './device-topup';
import { amneziawgBlocker, driversStatus, openvpnAdapterMissing, recreateOpenvpnAdapter, type DriverReport } from '../system/drivers';
import { tr } from '../../shared/i18n';

/** The daemon prepays this much up front (client config prepay_bytes / prepay_seconds; defaults 1 GB / 1 h). */
export function prepayCost(node: { pricePerGb: string; pricePerHour: string }, basis: 'per_gb' | 'per_hour'): bigint {
  const cfg = getDaemonSettings().settings;
  return prepayFor(node, basis, cfg.prepayBytes, cfg.prepaySeconds);
}

// prepayFor lives in shared/prepay-cap so the Connect dialog uses the same reuse rule (owner 2026-11-12).
export { prepayFor };

// ─── What this computer needs for a protocol, checked BEFORE paying (owner 2026-11-15) ───
// Until now only a missing OpenVPN adapter was found before the deposit; a missing WireGuard / AmneziaWG /
// OpenVPN driver, or a missing V2Ray / Xray / Hysteria2 program, showed only when the VPN service failed to start
// the tunnel, after paying (Windows VM 2026-11-15: "binary not found: v2ray"). Windows only: the other systems
// have their own checks. A check that cannot run never blocks a connect.
const DRIVER_OF: Record<string, string> = { wireguard: 'wireguard', amneziawg: 'amneziawg', openvpn: 'openvpn' };
const PROGRAM_DIR_OF: Record<string, string> = { v2ray: 'v2ray', xray: 'xray', hysteria2: 'hysteria2' };
const PROTOCOL_NAME: Record<string, string> = { wireguard: 'WireGuard', amneziawg: 'AmneziaWG', openvpn: 'OpenVPN', v2ray: 'V2Ray', xray: 'Xray', hysteria2: 'Hysteria2' };
const DRIVERS_GOOD_MS = 10 * 60_000;
let driversGoodAt = 0;

/** The sentence when the driver this protocol needs is not usable, from a drivers report. null = fine or not
 *  known. Exported for tests. */
export function driverBlocker(serviceType: string, report: DriverReport | null): string | null {
  const want = DRIVER_OF[serviceType];
  if (!want || !report) return null;
  const row = report.deps.find((d) => d.name === want);
  if (!row || !['missing', 'failed', 'incompatible'].includes(row.status)) return null;
  const protocol = PROTOCOL_NAME[serviceType];
  return row.status === 'missing'
    ? tr('{protocol} is not installed on this computer, so this server cannot be used yet. Open Diagnostics and press Repair drivers, or pick a server with another protocol. Nothing was paid.', { protocol })
    : tr('{protocol} is not installed on this computer properly, so this server cannot be used yet. Open Diagnostics and press Repair drivers, or pick a server with another protocol. Nothing was paid.', { protocol });
}

/** The sentence when the program this protocol runs with is not in the app's folder. exists/list are injected
 *  for tests. null = fine, or not a protocol that needs one. Exported for tests. */
export function programBlocker(serviceType: string, dirOf: (name: string) => string, exists: (p: string) => boolean = fs.existsSync, list: (p: string) => string[] = (p) => fs.readdirSync(p)): string | null {
  const dir = PROGRAM_DIR_OF[serviceType];
  if (!dir) return null;
  const full = dirOf(dir);
  let has = false;
  try {
    has = exists(full) && list(full).some((f) => /\.exe$/i.test(f));
  } catch (err) {
    log.warn('protocol program folder not readable; not blocking the connect', { dir: full, err: (err as Error).message });
    return null;
  }
  return has ? null : tr('The {PROTOCOL_NAME} program is missing from this app\'s folder, so this server cannot be used. Install the app again to put it back, or pick a server with another protocol. Nothing was paid.', { PROTOCOL_NAME: PROTOCOL_NAME[serviceType] });
}

/**
 * true when a drivers report says dvpnd's OpenVPN adapter is missing (x64: Wintun, ARM64: DCO). Read from the report
 * because tapctl needs elevation: the app's own `tapctl list` gets EACCES for a standard user (Windows VM 2026-11-15,
 * build 687e1af), so openvpnAdapterMissing() always answered "not missing" there. Exported for tests.
 */
export function adapterMissingIn(report: DriverReport | null, arch: string = process.arch): boolean {
  const key = arch === 'arm64' ? 'openvpn-dco' : 'openvpn-wintun';
  return report?.deps.some((d) => d.name === key && d.status === 'missing') === true;
}

async function protocolBlocker(serviceType: string): Promise<{ blocker: { error: string; action: string; code: string } | null; report: DriverReport | null }> {
  if (process.platform !== 'win32') return { blocker: null, report: null };
  const program = programBlocker(serviceType, binPath);
  if (program) return { blocker: { error: program, action: 'Pick another server', code: 'driver-missing' }, report: null };
  // OpenVPN is always checked afresh: an AmneziaWG session can remove its adapter at any time (gap another project).
  if (!DRIVER_OF[serviceType] || (serviceType !== 'openvpn' && Date.now() - driversGoodAt < DRIVERS_GOOD_MS)) return { blocker: null, report: null };
  const view = await driversStatus();
  if (!view.live) { log.info('drivers could not be checked before the connect; going on', { err: view.error }); return { blocker: null, report: null }; }
  const driver = driverBlocker(serviceType, view.live);
  if (driver) return { blocker: { error: driver, action: 'Open diagnostics', code: 'driver-missing' }, report: view.live };
  if (view.live.ok) driversGoodAt = Date.now();
  return { blocker: null, report: view.live };
}

/** Zero-cost checks; returns the first blocker. Each carries its code: the error is translated, so the code is never
 *  read back from its words (state.ts preflightCode is the fallback for callers that give none). action = routing key, English. */
export async function preflight(req: ConnectRequest, owner: string, device: string): Promise<{ error: string; action?: string; code?: string } | null> {
  if (snapshot().session && !req.switch) return { error: tr('Disconnect the current session first.'), code: 'session-active' };
  // rc.4 E-22: the chain's time against this computer's, read beside the rest; a wrong clock is refused
  // before any deposit (servers refuse it as "unauthorized" after the deposit opened). Unreadable = skipped.
  const clockRead = chainClockSkew().catch((err: unknown) => {
    log.warn('chain time unreadable; clock check skipped', { err: (err as Error)?.message ?? String(err) });
    return null;
  });
  // Row 75: the wallet read does not depend on the server, so it starts now and runs beside the server lookup
  // and the server check instead of after them. Its failure is kept and thrown where the read used to be.
  const walletRead = req.subscription ? null : readWalletStatus(owner, device).then((w) => ({ w }), (err: unknown) => ({ err }));
  const node = await discoverNode(req.node);
  if (!node) return { error: tr('That server is not on the network any more.'), code: 'node-gone' };
  if (!node.listingFresh) return { error: tr('That server has not checked in recently. Pick another.'), code: 'node-stale' };
  const probe = await probeNode(node);
  // probe.error stays English at its source (census reads its words), so it goes in as the reason
  if (!probe.ok) return { error: probe.error ? tr('The server check failed: {reason}. Nothing was paid.', { reason: probe.error }) : tr('The server check failed. Nothing was paid.'), action: 'Pick another server', code: 'node-offline' };
  const blocked = killSwitchBlocksProtocol(process.platform, getDaemonSettings().settings.killSwitch, probe.serviceType, daemonInfo().version);
  if (blocked) return { error: blocked, action: 'Open settings', code: 'protocol-blocked' };
  const checked = await protocolBlocker(String(probe.serviceType ?? ''));
  if (checked.blocker) return checked.blocker;
  if (probe.serviceType === 'openvpn' && (adapterMissingIn(checked.report) || await openvpnAdapterMissing())) {
    // An AmneziaWG session removes it (gap another project): put it back ourselves instead of refusing.
    const fixed = await recreateOpenvpnAdapter();
    if (!fixed.ok) {
      return { error: tr('The OpenVPN network adapter is missing and could not be added back ({detail}). Repair drivers, then connect again. Nothing was paid.', { detail: fixed.detail }), action: 'Open diagnostics', code: 'driver-missing' };
    }
  }
  // Linux: the AmneziaWG kernel module / tools come from the distribution; refuse before paying when they are missing.
  // Platform export on every OS (Windows/macOS/Android return null: their AWG is bundled or embedded).
  if (probe.serviceType === 'amneziawg') {
    const awg = await amneziawgBlocker();
    if (awg) return { error: awg, action: 'Open diagnostics', code: 'driver-missing' };
  }
  const skew = await clockRead;
  const clock = skew === null ? null : clockSkewBlocker(skew);
  if (clock) { log.warn('clock off against the chain; refused before paying', { skewS: skew }); return clock; }
  if (req.subscription) return null; // plan access: the provider pays the node, no escrow
  const cost = costPreview(node, req.basis, req.units);
  if (!cost.available) return { error: req.basis === 'per_gb' ? tr('This server does not sell per GB.') : tr('This server does not sell per hour.'), code: 'basis-unavailable' };
  const got = await walletRead!;
  if ('err' in got) throw got.err;
  let w = got.w;
  if ((await topUpDeviceIfLow(w, device)).done) w = await readWalletStatus(owner, device);
  patch({ wallet: w });
  const funding = {
    escrow: cost.escrow, walletTdvpn: w.ownerTdvpn, userBalance: w.userBalance, delegated: w.delegated,
    allowance: w.grant?.allowance ?? '0', deviceLamports: w.deviceLamports,
  };
  const blocker = fundingBlocker(funding);
  const problem = fundingProblem(funding);
  return blocker ? { error: blocker, action: 'Open Wallet', code: problem === 'spending-approval' ? 'spending-limit' : problem ?? 'preflight' } : null;
}

// ─── Deposits a server refused to reuse (CODE-AUDIT E3) ───
// Kept in the data folder, so the app and the CLI (another process) agree: the Connect dialog and the reuse check
// stop offering them, and the next Connect shows the price of a new deposit. The deposit is refunded like any idle one.
const REFUSED_FILE = 'reuse-refused.json';
const REFUSED_MAX = 50;
let refusedReuse: Set<string> | null = null;
function refusedPath(): string | null {
  try { return path.join(getHost().dataDir, REFUSED_FILE); } catch (err) { log.warn('reuse-refused: no data folder', { err: (err as Error).message }); return null; }
}
function refusedSet(): Set<string> {
  if (refusedReuse) return refusedReuse;
  refusedReuse = new Set();
  const f = refusedPath();
  try {
    if (f && fs.existsSync(f)) {
      const v: unknown = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (Array.isArray(v)) for (const x of v) if (typeof x === 'string') refusedReuse.add(x);
    }
  } catch (err) {
    log.warn('reuse-refused: list unreadable, starting empty', { err: (err as Error).message });
  }
  return refusedReuse;
}
export function markReuseRefused(channel: string): void {
  const s = refusedSet();
  s.add(channel);
  const f = refusedPath();
  if (!f) return;
  try { fs.writeFileSync(f, JSON.stringify([...s].slice(-REFUSED_MAX))); } catch (err) { log.warn('reuse-refused: could not save', { err: (err as Error).message }); }
}
export function reuseRefused(channel: string): boolean { return refusedSet().has(channel); }
/** Tests only. */
export function resetReuseRefused(): void { refusedReuse = null; }

/** An open channel the daemon already has with this node, reused instead of paying again (F9.3).
 *  Only when what is left covers the daemon's up-front prepay (`minLeft`), or StartSession refuses it. */
export async function reusableChannel(node: string, mode: number, minLeft: bigint): Promise<string | null> {
  try {
    const chans = await daemon().listChannels();
    // The daemon's escrow is a copy from when it opened the channel; a top-up (fund_channels) only
    // shows on chain. dvpnd reloads it from chain when it resumes the channel, so judge by chain.
    const owner = ownerAddress();
    if (!owner) return null;
    // Only channels still OPEN on chain: the daemon keeps listing ones the app has since closed.
    const onChain = new Map<string, StreamFields>();
    for (const c of await channelsByOwner(owner)) {
      if (Number(c.status) === CHANNEL_STATUS_OPEN) {
        onChain.set(String(c.address), { escrow: String(c.escrow ?? '0'), ratePerHour: String(c.ratePerHour ?? '0'), streamBase: String(c.streamBase ?? '0'), streamStartedAt: String(c.streamStartedAt ?? '0') });
      }
    }
    const now = Math.floor(Date.now() / 1000);
    const c = chans.find((ch) => {
      const chain = onChain.get(ch.address);
      if (chain === undefined || ch.node !== node || Number(ch.mode) !== mode || reuseRefused(ch.address)) return false;
      // Per hour: the node charges wall-clock time since the stream started, not traffic, so an
      // old channel can be spent even if the daemon's voucher total is small ("credit exhausted").
      if (mode === MODE_STREAM) return streamLeft(chain, now) >= minLeft;
      const chainEscrow = BigInt(chain.escrow);
      const escrow = chainEscrow > BigInt(ch.escrow) ? chainEscrow : BigInt(ch.escrow);
      return escrow - BigInt(ch.cumulative || '0') >= minLeft;
    });
    return c?.address ?? null;
  } catch (err) {
    // CODE-AUDIT E12: this used to return null, so a failed read paid a NEW deposit beside an open one (owner
    // 2026-11-12: never a second deposit with a server) and after the dialog had said "nothing new is paid".
    log.warn('open deposits could not be read; nothing paid', { err: (err as Error).message });
    throw new Error(DEPOSITS_UNREAD_COPY());
  }
}

/** The plan's device limit counts unexpired tickets; null when another ticket can still be issued. */
export async function planLimitReached(subscription: string): Promise<{ max: number; used: string[] } | null> {
  try {
    const owner = ownerAddress();
    if (!owner) return null;
    const sub = (await subscriptionsOf(owner)).find((x) => x.address === subscription);
    if (!sub || !sub.maxConnections) return null;
    const now = Math.floor(Date.now() / 1000);
    const used = [...new Set((await daemon().listTickets()).filter((t) => t.subscription === subscription && Number(t.expiresAt) > now).map((t) => t.node))];
    return used.length >= sub.maxConnections ? { max: sub.maxConnections, used } : null;
  } catch (err) {
    log.warn('plan limit check failed; asking the provider', { err: (err as Error).message });
    return null;
  }
}

/** An unexpired ticket the daemon holds for this subscription and node (hash), if any. */
export async function heldTicket(subscription: string, node: string): Promise<string | null> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const t = (await daemon().listTickets()).find((x) => x.subscription === subscription && x.node === node && Number(x.expiresAt) > now + 60);
    return t?.hash ?? null;
  } catch (err) {
    log.warn('listTickets failed; requesting a new ticket', { err: (err as Error).message });
    return null;
  }
}

export async function nodeHasRoom(address: string): Promise<boolean> {
  try {
    const n = await discoverNode(address);
    if (!n) return false;
    const pr = await probeNode(n);
    return pr.peers !== null && pr.maxPeers !== null && pr.peers < pr.maxPeers;
  } catch (err) {
    log.warn('node probe failed; not paying a second deposit', { node: address, err: (err as Error).message });
    return false;
  }
}
