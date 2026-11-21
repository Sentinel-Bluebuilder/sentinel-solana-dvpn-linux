// ─── The state of the VPN service, from facts (UI pass rows 119-142) ───
// One sentence, "The VPN service is not running.", used to cover five different situations (not
// installed, installed but stopped, still starting, restarting, the app's own link failing), each with
// a different fix. Here the state is derived from facts, never from the wording of an error, and each
// state has exactly one title, one sentence and at most one action. Every screen, the CLI and the
// connect path read this table (docs/LOG-AUDIT.md L01-L10 are the log lines behind it).
// Pure: no Electron, no fs, no clock. The caller gathers the facts (main/daemon/manager.ts).

import { tr } from '../../shared/i18n';
export type ServiceState =
  | 'ready'
  | 'not-installed'
  | 'stopped'
  | 'starting'
  | 'restarting'
  | 'no-permission'
  | 'wrong-network'
  | 'link-broken';

export const SERVICE_STATES: readonly ServiceState[] = ['ready', 'not-installed', 'stopped', 'starting', 'restarting', 'no-permission', 'wrong-network', 'link-broken'];

/** What the one button does. `null` = nothing to press: the app is already doing it, wait. */
export type ServiceAction = 'install' | 'start' | 'finish-setup' | 'reinstall' | 'repair';

/** How the last attempt to reach the service failed. */
export type LinkFault =
  | 'none'            // it answered
  | 'absent'          // the pipe / socket is not there
  | 'denied'          // it is there, this account may not open it
  | 'timeout'         // it is there, no answer in time
  | 'helper-missing'  // the app's own link program is missing or blocked
  | 'unknown';

export interface ServiceFacts {
  /** GetVersion answered on the current link. */
  answered: boolean;
  /** The service's program id and mint match this app (null = not answered yet). */
  networkOk: boolean | null;
  /** A restart is in progress (an Apply in any process, a crash restart): services/service-transition.ts. */
  transition: boolean;
  /** The service is registered with the OS. null = this OS cannot tell, or not asked yet. */
  installed: boolean | null;
  /** Its process is running. null = cannot tell, or not asked yet. */
  running: boolean | null;
  /** The OS says it is starting right now (Windows START_PENDING). */
  startPending?: boolean;
  link: LinkFault;
  /** ms since the service was last known to be starting (this app asked it to start, an install or update
   *  finished, the computer started). null = no such moment known. */
  startedAgoMs: number | null;
}

/** A service that was started this recently is "starting", whatever the link says meanwhile. Windows starts
 *  it delayed after log-in and re-grants the pipe a moment after the service is up (Q0488), so an "access is
 *  denied" or a missing pipe inside this window is not a fault (LOG-AUDIT L04: 35 lines told the user to sign out). */
export const START_GRACE_MS = 60_000;

/** The raw text of a failed link attempt -> what kind of failure it was. The text is used for nothing else. */
export function linkFault(raw: string | null | undefined): LinkFault {
  const t = String(raw ?? '');
  if (!t) return 'unknown';
  if (/access is denied|permission denied|EACCES|EPERM/i.test(t)) return 'denied';
  if (/deadline|timed? ?out/i.test(t)) return 'timeout';
  if (/cannot find the file|no such file|ENOENT|ECONNREFUSED|connection refused|No connection established/i.test(t)) return 'absent';
  return 'unknown';
}

/** What the OS says about the service. null = it did not say. */
export interface OsServiceState { installed: boolean | null; running: boolean | null; startPending: boolean }
export const OS_STATE_UNKNOWN: OsServiceState = { installed: null, running: null, startPending: false };

// CODE-AUDIT L-30: sc.exe prints its labels in the language of Windows ("STATE" is "STATUS" and "FAILED" is
// "FEHLER" on a German system), so reading those words made every answer "unknown" there: a service that
// was not installed read as "off", and a running one was started again. The state number with its constant
// name (RUNNING, STOPPED…) and the error number are the same in every language; only those are read.
const SC_STATE_RE = /:\s*([1-7])\s+(?:STOPPED|START_PENDING|STOP_PENDING|RUNNING|CONTINUE_PENDING|PAUSE_PENDING|PAUSED)\b/;
/** The service state number in `sc query` output (1 stopped … 4 running … 7 paused), or null. */
export function scStateNumber(stdout: string): number | null {
  const m = SC_STATE_RE.exec(String(stdout ?? ''));
  return m ? Number(m[1]) : null;
}
/** The Windows error number on sc.exe's "[SC] … FAILED <n>:" line (1060 = no such service, 1056 = already running, 5 = access denied), or null. */
export function scErrorCode(stdout: string): number | null {
  const m = /\[SC\][^\r\n]*?\s(\d{1,5}):/.exec(String(stdout ?? ''));
  return m ? Number(m[1]) : null;
}

/** Windows `sc query <service>` output -> the OS facts. Any other text (sc missing, access denied, empty) = unknown. */
export function parseScQuery(stdout: string): OsServiceState {
  const t = String(stdout ?? '');
  if (scErrorCode(t) === 1060) return { installed: false, running: false, startPending: false };
  const n = scStateNumber(t);
  if (n === null) return { ...OS_STATE_UNKNOWN };
  // 1 stopped, 2 start pending, 3 stop pending, 4 running, 5 continue pending, 6 pause pending, 7 paused
  return { installed: true, running: n === 4, startPending: n === 2 };
}

export function serviceState(f: ServiceFacts): ServiceState {
  if (f.answered) return f.networkOk === false ? 'wrong-network' : 'ready';
  if (f.transition) return 'restarting';
  if (f.link === 'helper-missing') return 'link-broken';
  if (f.installed === false) return 'not-installed';
  const starting = f.startPending === true || (f.startedAgoMs !== null && f.startedAgoMs >= 0 && f.startedAgoMs < START_GRACE_MS);
  if (starting) return 'starting';
  if (f.running === false) return 'stopped';
  // From here the service is running, or this OS cannot tell.
  if (f.link === 'denied') return 'no-permission';
  if (f.running === true) return 'link-broken';
  // Cannot tell whether it runs: a missing pipe/socket means it does not; anything else is the link.
  return f.link === 'absent' ? 'stopped' : 'link-broken';
}

export interface ServiceView {
  state: ServiceState;
  /** Short heading (status card, Diagnostics row, banner title). */
  title: string;
  /** The one sentence. Empty for `ready`. */
  sentence: string;
  action: ServiceAction | null;
  /** The button's words, null when there is no action. */
  actionLabel: string | null;
  /** The same fix from a terminal, null when there is none. */
  cli: string | null;
  /** info = the app is handling it, just wait. warn = the user has one thing to press. */
  tone: 'ok' | 'info' | 'warn';
  /** The Result code a failed call carries for this state (kept from before this table where one existed). */
  code: string | null;
}

const CLI = 'devnet-dvpn';

const VIEWS = (): Record<ServiceState, Omit<ServiceView, 'state'>> => ({
  'ready': {
    title: tr('VPN service ready'), sentence: '', action: null, actionLabel: null, cli: null, tone: 'ok', code: null,
  },
  'not-installed': {
    title: tr('VPN service not installed'),
    sentence: tr('The VPN service is not installed, so you cannot connect. Press Install the VPN service to set it up.'),
    action: 'install', actionLabel: tr('Install the VPN service'), cli: `${CLI} daemon install --yes`, tone: 'warn', code: 'daemon-missing',
  },
  // The words of c16bdee (Q0576): 'keeps retrying' read as 'wait', and a stopped service never comes back by waiting.
  'stopped': {
    title: tr('VPN service off'),
    sentence: tr('The VPN service is off, so you cannot connect. Press Start the VPN service to turn it back on.'),
    action: 'start', actionLabel: tr('Start the VPN service'), cli: `${CLI} daemon install --yes`, tone: 'warn', code: 'daemon-unavailable',
  },
  'starting': {
    title: tr('VPN service starting'),
    sentence: tr('The VPN service is starting. This takes a few seconds.'),
    action: null, actionLabel: null, cli: null, tone: 'info', code: 'daemon-starting',
  },
  'restarting': {
    title: tr('VPN service restarting'),
    sentence: tr('The VPN service is restarting. This takes a few seconds.'),
    action: null, actionLabel: null, cli: null, tone: 'info', code: 'daemon-restarting',
  },
  'no-permission': {
    title: tr('Setup not finished'),
    sentence: tr('This app is not allowed to talk to the VPN service yet. Press Finish setup to allow it.'),
    action: 'finish-setup', actionLabel: tr('Finish setup'), cli: `${CLI} daemon install --yes`, tone: 'warn', code: 'daemon-relogin',
  },
  'wrong-network': {
    title: tr('VPN service on another network'),
    sentence: tr('The VPN service is set up for a different network, and this app works on devnet only. Press Reinstall the VPN service to fix it.'),
    action: 'reinstall', actionLabel: tr('Reinstall the VPN service'), cli: `${CLI} daemon install --yes`, tone: 'warn', code: 'network-mismatch',
  },
  'link-broken': {
    title: tr('VPN service not reachable'),
    sentence: tr('The VPN service is running, but this app cannot reach it. Press Repair to fix the connection to it.'),
    action: 'repair', actionLabel: tr('Repair'), cli: `${CLI} daemon doctor`, tone: 'warn', code: 'daemon-link',
  },
});

export function serviceView(state: ServiceState): ServiceView {
  return { state, ...VIEWS()[state] };
}

/** Facts -> the view, in one call. */
export function serviceViewFor(f: ServiceFacts): ServiceView {
  return serviceView(serviceState(f));
}

/**
 * What Connect (and Restore network, Quick connect, a server row, a plan button) does in each state:
 *   go    = carry on.
 *   wait  = the service is coming; wait for it (bounded), then carry on. Never an error on its own.
 *   start = start the service, then wait.
 *   fix   = run the one setup step (it may ask for an administrator once), then wait.
 *   stop  = it cannot be fixed from here: show the state's sentence and its one action.
 */
export type ConnectMove = 'go' | 'wait' | 'start' | 'fix' | 'stop';

export function connectMove(state: ServiceState): ConnectMove {
  switch (state) {
    case 'ready': return 'go';
    case 'starting':
    case 'restarting': return 'wait';
    case 'stopped': return 'start';
    case 'no-permission': return 'fix';
    case 'not-installed':
    case 'wrong-network':
    case 'link-broken': return 'stop';
  }
}

/**
 * How soon to try the link again. While the user can see the app or is waiting on a button: every second.
 * In the background: back off, 2 s doubling to 30 s (what the app did at all times before; LOG-AUDIT A4
 * measured 0, 2, 6, 14, 30, 60 s after a start, so "not running" stayed up to half a minute after the
 * service was back).
 */
export const RETRY_FAST_MS = 1_000;
export const RETRY_SLOW_MAX_MS = 30_000;
export function retryDelayMs(attempt: number, watching: boolean): number {
  if (watching) return RETRY_FAST_MS;
  const n = Math.max(0, Math.floor(attempt));
  return Math.min(2_000 * 2 ** Math.min(n, 10), RETRY_SLOW_MAX_MS);
}
