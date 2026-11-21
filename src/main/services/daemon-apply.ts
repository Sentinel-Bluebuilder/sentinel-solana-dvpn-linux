// ─── One way to change the VPN service's settings: the app's Apply buttons AND `daemon set` (Q0508) ───
// Owner 2026-11-12: switching apps, the kill switch and settings back and forth "broke everything", and the
// CLI must behave exactly like the buttons. Before this file the two paths differed (Q0509-Q0514):
//   F1 the app never ended the session it restarted, so a V2Ray/Xray system proxy pointed at a dead port
//   F2 two applies at once raced the same staged folder and two service restarts
//   F4 the CLI and the app refused different inputs with different words
//   F5/F6 different session handling, and no guard while a connection was starting or stopping
// Both callers now go through applyServiceSettings; the CLI only parses flags and prints.
import { validateForApply, type DaemonSettings } from '../../core/daemon/config';
import { closeReasonCopy, fullSplit } from '../../core/session/state';
import { applyDaemonSettings, getDaemonSettings } from '../daemon/settings';
import { daemonInfo } from '../daemon/manager';
import { snapshot } from '../app-state';
import { adoptRunningSession, checkLeftoverBlock, connectRunningElsewhere, endAfterServiceRestart, releaseKeptKillSwitch } from './connection';
import { applyMarkerFresh, clearApplyMarker, writeApplyMarker } from './service-transition';
import { log } from '../logger';
import { SERVICE_WAIT_MS, waitForDaemon } from './daemon-wait';
import { tr } from '../../shared/i18n';

/** Q0534: release the block the restart kept, once the restarted service answers. True when released. */
export async function releaseAfterRestart(
  maxMs = SERVICE_WAIT_MS,
  deps: { release: () => Promise<boolean>; waitLink: (ms: number) => Promise<unknown>; sleep: (ms: number) => Promise<void> } = {
    release: releaseKeptKillSwitch,
    waitLink: (ms) => waitForDaemon(ms, daemonInfo),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  },
): Promise<boolean> {
  const until = Date.now() + maxMs;
  await deps.waitLink(maxMs);
  let last = '';
  for (;;) {
    try {
      const released = await deps.release();
      if (released) log.info('settings change ended the session: released the kill switch it left holding');
      return released;
    } catch (err) {
      last = (err as Error).message;
      if (Date.now() >= until) break;
      await deps.sleep(1000);
    }
  }
  log.warn('settings change ended the session; the kill switch block could not be released (Restore network)', { err: last });
  return false;
}

export interface ApplyOutcome {
  ok: boolean;
  error?: string;
  code?: 'apply-busy' | 'apply-while-connecting' | 'invalid-daemon-setting' | 'apply-failed';
  /** The restart ended the session that was running (the screen and the CLI both say so). */
  sessionEnded: boolean;
}

export const APPLY_BUSY = (): string => tr('Another settings change is still being applied. Wait for it to finish, then try again.');
export const APPLY_WHILE_CONNECTING = (): string => tr('A connection is starting or stopping. Wait until it finishes, then apply the settings.');
export const WHOLE_DEVICE_NEEDS_UPDATE = (): string => tr('"Whole computer" for V2Ray and Xray needs a newer VPN service on this computer (Update the VPN service). Until then they work as a proxy.');
// Q0516 (Linux hunt): Linux has no whole-computer V2Ray/Xray at all, so 'update the service' was wrong advice.
export const WHOLE_DEVICE_NOT_ON_LINUX = (): string => tr('"Whole computer" for V2Ray and Xray is not available on Linux: they work as a proxy (apps set to use it go through the VPN). WireGuard, AmneziaWG, OpenVPN and Hysteria2 cover the whole computer.');
export const APPS_NOT_ON_LINUX = (): string => tr('Choosing apps does not work on Linux. Split by address range instead: --split-routes CIDR,... with --split-mode include or exclude.');
export const APPS_NEED_UPDATE = (): string => tr('Choosing apps needs a newer VPN service (Update the VPN service). Until then, split by address range: --split-routes CIDR,... with --split-mode include or exclude.');

/**
 * Every refusal the app and the CLI share, checked against the stored settings, with the same words.
 * Only a CHANGE is refused: a value already stored (from an older app) never blocks an unrelated edit.
 */
export function settingsProblem(next: DaemonSettings, stored: Partial<DaemonSettings>, platform: string, daemonVersion: () => string | null | undefined): { code: 'invalid-daemon-setting'; error: string } | null {
  try {
    validateForApply(next, stored);
  } catch (err) {
    return { code: 'invalid-daemon-setting', error: (err as Error).message };
  }
  // Read the service version only when a change needs it (it reads the device record).
  // Agent M KSM13: a service that is not running has no version; that is not an old service. Unknown is not
  // refused ("needs a newer VPN service" was wrong); after the restart, splitNotApplied says so if it really is old.
  // Linux never has these (a platform refusal, whatever the version).
  const full = (): boolean => { if (platform === 'linux') return false; const v = daemonVersion(); return !v || fullSplit(platform, v); };
  if (next.wholeDevice === true && stored.wholeDevice !== true && !full()) return { code: 'invalid-daemon-setting', error: platform === 'linux' ? WHOLE_DEVICE_NOT_ON_LINUX() : WHOLE_DEVICE_NEEDS_UPDATE() };
  const had = new Set(stored.split?.apps ?? []);
  const added = (next.split?.apps ?? []).filter((p) => !had.has(p));
  if (added.length && !full()) return { code: 'invalid-daemon-setting', error: platform === 'linux' ? APPS_NOT_ON_LINUX() : APPS_NEED_UPDATE() };
  return null;
}

let busy = false;
/** True while an apply runs; the screens disable every Apply button with it. */
export function applyRunning(): boolean { return busy; }

const BUSY_PHASES = new Set(['connecting', 'disconnecting']);

export async function applyServiceSettings(next: DaemonSettings): Promise<ApplyOutcome> {
  if (busy) return { ok: false, code: 'apply-busy', error: APPLY_BUSY(), sessionEnded: false };
  busy = true;
  try {
    // DVPN-WIN KSM9: the same refusals across processes. Another process's Apply (its marker) got a raw SCM
    // error from the second restart; a connect running in the CLI was cut by the restart ('service is not running').
    if (applyMarkerFresh()) return { ok: false, code: 'apply-busy', error: APPLY_BUSY(), sessionEnded: false };
    if (connectRunningElsewhere()) return { ok: false, code: 'apply-while-connecting', error: APPLY_WHILE_CONNECTING(), sessionEnded: false };
    if (BUSY_PHASES.has(snapshot().conn.phase)) return { ok: false, code: 'apply-while-connecting', error: APPLY_WHILE_CONNECTING(), sessionEnded: false };
    const problem = settingsProblem(next, getDaemonSettings().settings, process.platform, () => daemonInfo().version);
    if (problem) return { ok: false, ...problem, sessionEnded: false };
    // The CLI has no shown session until it reads one; the app already has it (no second stream).
    if (!snapshot().session) await adoptRunningSession({ watch: false });
    const live = snapshot().session;
    // Every process (this one, the open app, a CLI) sees the marker and makes no verdict until the service settles.
    writeApplyMarker();
    let r: Awaited<ReturnType<typeof applyDaemonSettings>>;
    try { r = await applyDaemonSettings(next); } finally { clearApplyMarker(); }
    log.info('service settings apply', { ok: r.ok, liveSession: live?.id ?? null });
    // The restart ends a running session (ok or not: a failed step may still have restarted it). End it
    // the app's way: history, system proxy back, "Blocking internet" when the kill switch holds.
    const sessionEnded = live ? await endAfterServiceRestart(live.id) : false;
    // Q0534 (DVPN-WIN KSM5, release blocker): with the kill switch on 'persist' the restarted service keeps
    // the block of the session it ended, so a settings change left the internet blocked with no session.
    // The user's own Apply is not a VPN drop: it ends the session like Disconnect does, internet back.
    // DVPN-WIN 8c0f488 proof: called at once, the release hit the service mid-restart ("StopSession: No
    // connection established ... connect ENOENT \\.\pipe\devnet-dvpn-...") and the block stayed (CLI and
    // buttons, 2/2). Wait for the service link, then retry the release until it answers or SERVICE_WAIT_MS.
    // AND-34 8669819: not released (nothing held, or the release failed): the restart is over (marker cleared),
    // so one block check shows the blocked screen only if the internet really is still blocked.
    if (sessionEnded && !(await releaseAfterRestart())) {
      await checkLeftoverBlock(closeReasonCopy('settings changed')).catch((err: unknown) => log.warn('block check after the settings-change release failed', { err: (err as Error).message }));
    }
    return r.ok ? { ok: true, sessionEnded } : { ok: false, code: 'apply-failed', error: r.error, sessionEnded };
  } finally {
    busy = false;
  }
}
