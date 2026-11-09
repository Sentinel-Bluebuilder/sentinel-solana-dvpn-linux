// ─── `status` — wallet, device, service, session and what the session really covers ───
// Split from commands.ts (500-line rule). Same snapshot the app shows; a live session is
// titled by core/session/coverage, measured here because the CLI runs no scheduler.
import type { Cmd } from './commands';
import { log } from '../main/logger';
import { runJobNow } from '../main/scheduler';
import { patch, snapshot } from '../main/app-state';
import { refreshWallet } from '../main/services/wallet';
import { adoptRunningSession, sessionStateUnknown } from '../main/services/connection';
import { daemonInfo } from '../main/daemon/manager';
import { getDaemonSettings } from '../main/daemon/settings';
import { clearSystemProxy, systemProxyActive } from '../main/system/proxy';
import { leftoverTunnels } from '../main/system/tunnels';
import { formatBytes } from '../shared/format';
import { tdvpn, sol } from '../core/chain/amounts';
import { MODE_STREAM } from '../core/chain/idl';
import { channelByPda } from '../core/chain/accounts';
import { internetReachable as coreInternetReachable } from '../core/quality/reachability';
import { getRpcUrls } from '../core/chain/rpc';

/** How the live session is paid: a plan has no channel; a deposit is per hour (stream) or per GB. */
export function paymentLabel(channel: string, mode: number | null): string {
  if (!channel) return 'plan';
  if (mode === null) return 'deposit';
  return mode === MODE_STREAM ? 'per hour' : 'per GB';
}

/** Plain-internet probe for the blocked-internet advice: the core's TCP-only check (no data sent,
 *  never the RPC hosts the kill switch leaves open), so it honours "IP check and speed test: Off
 *  = never contacted" (builder-kb C15: this used to fetch two third-party check sites). */
async function internetReachable(timeoutMs: number): Promise<boolean> {
  // Each dial gets what is left of the status budget: with the kill switch blocking, every dial waits it out (DROP).
  const ok = await coreInternetReachable(getRpcUrls(), { timeoutMs });
  if (!ok) log.info('status: internet probe failed (no TCP connect to any plain target)');
  return ok;
}

// Q0372 (FLX2, TWD; port of #31 dc885db): during a tunnel cut with the kill switch on, every network
// read waits for its own timeout (the RPC and IP services sit behind the dead tunnel), one after
// another: status took 71-90 s. Each read now gets STATUS_NET_BUDGET_MS, the wallet read and IP check
// run together, and a read that misses the budget shows as unknown (the CLI exits 400 ms after
// printing, so an abandoned read cannot hold it open).
export const STATUS_NET_BUDGET_MS = 2500;
// Q0372 pass 2 (TLX u24, wg KS on, 90 s cut: 20.4 s per call, 3.8 s before the cut): the reads ran in
// three rounds of up to 2.5 s each, the session read opened a watch stream, and the payment label
// scanned every channel on chain plus a second listSessions. Now one deadline covers the whole
// command: the session and wallet reads start together, the reads that need the session get what is
// left (at least STATUS_MIN_READ_MS), the session read is one listSessions with no stream, and the
// payment mode is one account read of the live channel.
export const STATUS_MIN_READ_MS = 400;

/** ms left before the deadline, never under STATUS_MIN_READ_MS. Exported for tests. */
export function remainingMs(deadline: number, now = Date.now()): number {
  return Math.max(STATUS_MIN_READ_MS, deadline - now);
}

/** p, or undefined once ms have passed (logged). */
export async function within<T>(p: Promise<T>, ms: number, what: string): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => { log.warn(`status: ${what} took over ${ms} ms; shown as unknown`); resolve(undefined); }, ms);
  });
  try {
    return await Promise.race([p, late]);
  } finally {
    clearTimeout(timer);
  }
}

const short = (s: string): string => (s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s);

/** The live channel's payment mode from its one account (null when unreadable); no daemon call. */
async function channelMode(channel: string): Promise<number | null> {
  try {
    const c = await channelByPda(channel);
    return c ? Number(c.mode) : null;
  } catch (err) {
    log.warn('status: channel read failed', { err: (err as Error).message });
    return null;
  }
}

export const statusCmd: Cmd = async (_a, o) => {
  const deadline = Date.now() + STATUS_NET_BUDGET_MS;
  const left = (): number => remainingMs(deadline);
  let adoptDone = false;
  // The wallet read needs no session: it starts with the session read, under the same deadline.
  const walletRead = within(refreshWallet(), STATUS_NET_BUDGET_MS, 'the wallet read');
  await within(adoptRunningSession({ watch: false }).then(() => { adoptDone = true; }), STATUS_NET_BUDGET_MS, 'reading the daemon session');
  const ipCheck = async (): Promise<void> => {
    if (!snapshot().session) return;
    // The system proxy may have been set by the app or an earlier CLI run for this user.
    patch({ proxyActive: systemProxyActive() });
    const r = await runJobNow('ip');
    if (r.error) log.warn('status: ip check failed', { err: r.error });
  };
  // Q0366 pass 2 (FLX2 fedora): with no session and the kill switch blocking, status took 5-8 s:
  // the wallet read, then the leftover check, then the internet probe, one after another. Once the
  // session read says "none", those start together with the wallet read (each still bounded).
  const noSession = adoptDone && !snapshot().session && !sessionStateUnknown();
  const leftoverRead = noSession ? within(leftoverTunnels(), left(), 'the leftover-tunnel check') : null;
  const internetMs = left();
  const internetRead = noSession ? within(internetReachable(internetMs), internetMs + 300, 'the internet check') : null;
  const live = snapshot().session;
  const modeRead = live?.channel ? within(channelMode(live.channel), left(), 'the deposit read') : Promise.resolve(undefined);
  const [wallet, , mode] = await Promise.all([walletRead, within(ipCheck(), left(), 'the IP check'), modeRead]);
  const w = wallet ?? null;
  const d = daemonInfo();
  const pay = live ? paymentLabel(live.channel, mode ?? null) : '';
  const s = snapshot();
  // Q0373 (port of #31 a67c5ef): a running dvpnd that did not answer may be redialing: never
  // "Not connected", no Restore advice.
  const unknown = !s.session && (sessionStateUnknown() || !adoptDone);
  const ipLine = s.session && s.publicIp?.sid === s.session.id
    ? `IP       ${s.publicIp.ip}${s.publicIp.viaProxy ? ` through the VPN proxy; apps not using it: ${s.publicIp.directIp ?? 'unknown'}` : ''}${s.homeIp ? `  (yours when not connected: ${s.homeIp})` : ''}`
    : null;
  const lines = [
    `Wallet   ${s.owner ?? 'none'}${w ? `  ${sol(w.ownerLamports)} SOL  ${tdvpn(w.ownerTdvpn)} tDVPN  refundable ${tdvpn(w.userBalance)}` : s.owner ? '  balances unknown (the network could not be reached)' : ''}`,
    `Device   ${d.device ?? 'not set up'}${w?.grant ? `  allowance ${tdvpn(w.grant.allowance)} tDVPN  ${sol(w.deviceLamports)} SOL` : d.device ? (w ? '  no spending permission' : '  spending limit unknown (the network could not be reached)') : ''}`,
    `Daemon   ${d.reachable ? `running ${d.version}${d.networkOk === false ? '  WRONG NETWORK' : ''}` : `not reachable (${d.error ?? d.bridge})`}`,
    `Session  ${s.session ? `${s.conn.title}  node ${short(s.session.node)}  ${s.session.service}  ${pay}  down ${formatBytes(s.session.rxBytes)}  up ${formatBytes(s.session.txBytes)}  spent ${tdvpn(s.session.spent)} tDVPN` : unknown ? 'unknown: the VPN service is running but did not answer (it may be reconnecting)' : s.conn.title}`,
  ];
  if (ipLine) lines.push(ipLine);
  if (s.session && s.conn.detail) lines.push(`         ${s.conn.detail}`);
  // A tunnel with no session behind it (gaps #29, #32) blocks or silently reroutes traffic.
  const leftover = s.session || unknown || !leftoverRead ? [] : (await leftoverRead) ?? [];
  if (leftover.length) lines.push(`Leftover ${leftover.join(', ')} still running with no session: run "daemon restore-network"`);
  // A system proxy we set for a session that has since ended (process killed, node gone, no app
  // running to restore it) points every proxy-aware app at a dead port: put the user's back.
  if (!s.session && !unknown && systemProxyActive()) {
    try {
      await clearSystemProxy();
      lines.push('Proxy    restored your own proxy setting (it still pointed at a session that has ended)');
    } catch (err) {
      lines.push(`Proxy    still points at an ended session and could not be restored (${(err as Error).message}): run "proxy off"`);
    }
  }
  // With no session the internet should work. The kill switch keeps the RPC open, so the wallet
  // line can read fine while every other site is blocked (dvpnd ddv10+ holds the block after it
  // crashed mid-session, persist mode holds it after a restart): probe an ordinary site.
  const internet = s.session || unknown || !internetRead ? null : (await internetRead) ?? null;
  // Same advice as "disconnect": with the kill switch On (= persist, Q0426) a no-session disconnect keeps the block (kdp173), so
  // pointing at "disconnect" there sent users in a circle (Linux matrix ks-persist 2026-10-22).
  if (internet === false) lines.push(blockedAdvice(getDaemonSettings().settings.killSwitch));
  o.print(lines.join('\n'), { owner: s.owner, wallet: w, daemon: d, conn: s.conn, session: s.session, payment: pay || null, coverage: s.coverage, publicIp: s.publicIp, homeIp: s.homeIp, leftover, internet });
};

/** What to tell a user whose internet is blocked with no session, per kill-switch mode. */
export function blockedAdvice(killSwitch: string | undefined): string {
  return killSwitch === 'persist'
    ? 'Internet blocked or down. The kill switch keeps it blocked after a crash or restart: reconnect, or run "daemon restore-network" to get the internet back.'
    : 'Internet blocked or down. If the kill switch is still blocking (after a crash or restart), "disconnect" gives the internet back.';
}
