// UI pass rows 119-142: the VPN service's state comes from facts, and each state has one title, one
// sentence and at most one action. The raw strings below are the ones in the owner's laptop log
// (docs/LOG-AUDIT.md L01-L05).
import { describe, it, expect } from 'vitest';
import {
  SERVICE_STATES, START_GRACE_MS, RETRY_FAST_MS, RETRY_SLOW_MAX_MS, OS_STATE_UNKNOWN,
  connectMove, linkFault, parseScQuery, retryDelayMs, scErrorCode, scStateNumber, serviceState, serviceView, serviceViewFor,
  type ServiceFacts,
} from '../../src/core/daemon/service-state';
import { lostSetupCopy } from '../../src/core/session/setup-gate';
import { RESTARTING_COPY } from '../../src/core/daemon/link-copy';

const base: ServiceFacts = { answered: false, networkOk: null, transition: false, installed: true, running: true, link: 'unknown', startedAgoMs: null };
const facts = (over: Partial<ServiceFacts>): ServiceFacts => ({ ...base, ...over });

describe('linkFault: the raw link error decides only the kind of failure', () => {
  it('reads the strings from the laptop log', () => {
    expect(linkFault('daemon pipe \\\\.\\pipe\\ProtectedPrefix\\Administrators\\sentinel-dvpn\\c0: open \\\\.\\pipe\\ProtectedPrefix\\Administrators\\sentinel-dvpn\\c0: The system cannot find the file specified.')).toBe('absent');
    expect(linkFault('dial daemon: open \\\\.\\pipe\\ProtectedPrefix\\Administrators\\sentinel-dvpn\\c0: Access is denied.')).toBe('denied');
    expect(linkFault('GetVersion: Deadline exceeded after 5.001s,LB pick: 0.001s')).toBe('timeout');
    expect(linkFault('GetVersion: No connection established. Last error: connect ECONNREFUSED 127.0.0.1:50071')).toBe('absent');
    expect(linkFault('connect ENOENT /run/sentinel-dvpn/c0.sock')).toBe('absent');
    expect(linkFault('connect EACCES /run/sentinel-dvpn/c0.sock')).toBe('denied');
    expect(linkFault('GetVersion: Connection dropped')).toBe('unknown');
    expect(linkFault('')).toBe('unknown');
    expect(linkFault(null)).toBe('unknown');
  });

  it('row 124: the service saying the Solana network is busy is not a link failure', () => {
    // The old rule matched "unavailable" anywhere and said "The VPN service is not running" (LOG-AUDIT L16).
    expect(linkFault('StartSession: unavailable: the network is unreachable or busy right now; try again in a moment')).toBe('unknown');
  });
});

describe('parseScQuery: what Windows says about the service', () => {
  const q = (n: number, name: string): string => `\r\nSERVICE_NAME: sentinel-dvpnd$c0\r\n        TYPE               : 10  WIN32_OWN_PROCESS\r\n        STATE              : ${n}  ${name}\r\n        WIN32_EXIT_CODE    : 0  (0x0)\r\n`;
  it('reads running, stopped, start pending and not installed', () => {
    expect(parseScQuery(q(4, 'RUNNING'))).toEqual({ installed: true, running: true, startPending: false });
    expect(parseScQuery(q(1, 'STOPPED'))).toEqual({ installed: true, running: false, startPending: false });
    expect(parseScQuery(q(2, 'START_PENDING'))).toEqual({ installed: true, running: false, startPending: true });
    expect(parseScQuery(q(3, 'STOP_PENDING'))).toEqual({ installed: true, running: false, startPending: false });
    expect(parseScQuery('[SC] EnumQueryServicesStatus:OpenService FAILED 1060:\r\n\r\nThe specified service does not exist as an installed service.\r\n')).toEqual({ installed: false, running: false, startPending: false });
  });
  // CODE-AUDIT L-30: the labels are in the language of Windows; the numbers and state names are not.
  it('reads the same facts from a Windows in another language', () => {
    const de = (n: number, name: string): string => `\r\nSERVICE_NAME: sentinel-dvpnd$c0\r\n        TYP                : 10  WIN32_OWN_PROCESS\r\n        STATUS             : ${n}  ${name}\r\n        WIN32_EXITCODE     : 0  (0x0)\r\n`;
    expect(parseScQuery(de(4, 'RUNNING'))).toEqual({ installed: true, running: true, startPending: false });
    expect(parseScQuery(de(1, 'STOPPED'))).toEqual({ installed: true, running: false, startPending: false });
    expect(parseScQuery(de(2, 'START_PENDING'))).toEqual({ installed: true, running: false, startPending: true });
    expect(parseScQuery('[SC] EnumQueryServicesStatus:OpenService FEHLER 1060:\r\n\r\nDer angegebene Dienst ist kein installierter Dienst.\r\n')).toEqual({ installed: false, running: false, startPending: false });
    expect(scErrorCode('[SC] StartService FEHLER 1056:\r\n')).toBe(1056);
    expect(scErrorCode('[SC] OpenService FAILED 5:\r\n\r\nAccess is denied.\r\n')).toBe(5);
    expect(scErrorCode(de(4, 'RUNNING'))).toBeNull();
    expect(scStateNumber('TYPE : 10  WIN32_OWN_PROCESS')).toBeNull(); // the type line is never taken for a state
  });
  it('anything else is unknown, never "not installed"', () => {
    expect(parseScQuery('')).toEqual(OS_STATE_UNKNOWN);
    expect(parseScQuery('[SC] OpenService FAILED 5:\r\n\r\nAccess is denied.\r\n')).toEqual(OS_STATE_UNKNOWN);
  });
});

describe('serviceState: every state from its facts', () => {
  it('ready and wrong-network need an answer', () => {
    expect(serviceState(facts({ answered: true, networkOk: true, link: 'none' }))).toBe('ready');
    expect(serviceState(facts({ answered: true, networkOk: null, link: 'none' }))).toBe('ready');
    expect(serviceState(facts({ answered: true, networkOk: false, link: 'none' }))).toBe('wrong-network');
  });

  it('an answer wins over everything else (a stale "transition" or "not running" reading)', () => {
    expect(serviceState(facts({ answered: true, networkOk: true, transition: true, running: false, installed: false, link: 'absent' }))).toBe('ready');
  });

  it('restarting: a restart in progress, whatever the link says', () => {
    for (const link of ['absent', 'denied', 'timeout', 'unknown'] as const) {
      expect(serviceState(facts({ transition: true, link, running: false }))).toBe('restarting');
    }
  });

  it('not-installed: the OS has no such service', () => {
    expect(serviceState(facts({ installed: false, running: false, link: 'absent' }))).toBe('not-installed');
    // not installed, yet "started a moment ago" from an old reading: there is nothing to wait for
    expect(serviceState(facts({ installed: false, running: false, link: 'absent', startedAgoMs: 1000 }))).toBe('not-installed');
  });

  it('stopped: installed, not running, not starting', () => {
    expect(serviceState(facts({ running: false, link: 'absent' }))).toBe('stopped');
    expect(serviceState(facts({ running: false, link: 'absent', startedAgoMs: START_GRACE_MS }))).toBe('stopped');
  });

  it('starting: the OS says so, or it was started less than the grace ago', () => {
    expect(serviceState(facts({ running: false, startPending: true, link: 'absent' }))).toBe('starting');
    expect(serviceState(facts({ running: false, startedAgoMs: 0, link: 'absent' }))).toBe('starting');
    expect(serviceState(facts({ running: true, startedAgoMs: START_GRACE_MS - 1, link: 'timeout' }))).toBe('starting');
    expect(serviceState(facts({ running: null, installed: null, startedAgoMs: 5_000, link: 'absent' }))).toBe('starting');
  });

  it('row 127: "access is denied" while the service is still starting is starting, never a permission message', () => {
    // 19 times on 2026-11-11 the app said "sign out of Windows" while the service was simply not up yet.
    expect(serviceState(facts({ running: true, startedAgoMs: 3_000, link: 'denied' }))).toBe('starting');
    expect(serviceState(facts({ running: false, startPending: true, link: 'denied' }))).toBe('starting');
    expect(serviceState(facts({ running: false, link: 'denied' }))).toBe('stopped');
  });

  it('no-permission: running (or not knowable), not starting, and the pipe refuses this account', () => {
    expect(serviceState(facts({ running: true, link: 'denied' }))).toBe('no-permission');
    expect(serviceState(facts({ running: true, link: 'denied', startedAgoMs: START_GRACE_MS + 1 }))).toBe('no-permission');
    expect(serviceState(facts({ running: null, installed: null, link: 'denied' }))).toBe('no-permission');
  });

  it('link-broken: the service runs and the app still cannot reach it, or the link program is missing', () => {
    expect(serviceState(facts({ running: true, link: 'absent' }))).toBe('link-broken');
    expect(serviceState(facts({ running: true, link: 'timeout' }))).toBe('link-broken');
    expect(serviceState(facts({ running: true, link: 'unknown' }))).toBe('link-broken');
    expect(serviceState(facts({ running: false, link: 'helper-missing' }))).toBe('link-broken');
    expect(serviceState(facts({ running: null, installed: null, link: 'timeout' }))).toBe('link-broken');
  });

  it('an OS that cannot say whether the service runs: a missing socket means stopped', () => {
    expect(serviceState(facts({ running: null, installed: null, link: 'absent' }))).toBe('stopped');
  });

  it('a negative "started ago" (clock stepped back) is not a start', () => {
    expect(serviceState(facts({ running: false, startedAgoMs: -5, link: 'absent' }))).toBe('stopped');
  });
});

describe('serviceView: one title, one sentence, one action per state', () => {
  const views = SERVICE_STATES.map((s) => serviceView(s));

  it('covers every state exactly once', () => {
    expect(views.map((v) => v.state)).toEqual([...SERVICE_STATES]);
    expect(new Set(SERVICE_STATES).size).toBe(8);
  });

  it('titles and sentences are all different, so two states can never read the same', () => {
    expect(new Set(views.map((v) => v.title)).size).toBe(views.length);
    const sentences = views.filter((v) => v.state !== 'ready').map((v) => v.sentence);
    expect(new Set(sentences).size).toBe(sentences.length);
    for (const s of sentences) expect(s.length).toBeGreaterThan(20);
    expect(serviceView('ready').sentence).toBe('');
  });

  it('the action per state is the one in the plan', () => {
    expect(Object.fromEntries(views.map((v) => [v.state, v.action]))).toEqual({
      'ready': null, 'not-installed': 'install', 'stopped': 'start', 'starting': null, 'restarting': null,
      'no-permission': 'finish-setup', 'wrong-network': 'reinstall', 'link-broken': 'repair',
    });
  });

  it('a state with an action names its button in the sentence; a waiting state has no button and a calm tone', () => {
    for (const v of views) {
      if (v.action) {
        expect(v.actionLabel).toBeTruthy();
        expect(v.sentence).toContain(`Press ${v.actionLabel}`);
        expect(v.tone).toBe('warn');
        expect(v.cli).toMatch(/^devnet-dvpn daemon /);
      } else {
        expect(v.actionLabel).toBeNull();
        expect(v.cli).toBeNull();
        expect(v.tone).not.toBe('warn');
      }
    }
  });

  it('the old catch-all sentence is gone, and no text is an object or a raw error', () => {
    for (const v of views) {
      const all = `${v.title} ${v.sentence} ${v.actionLabel ?? ''}`;
      expect(all).not.toMatch(/is not running/i);
      expect(all).not.toMatch(/object Object|undefined|null|daemon|dvpnd|pipe|socket|gRPC|rpc error/i);
      expect(all).not.toMatch(/sign out/i);
    }
  });

  it('builds on c16bdee: the stopped words and the restarting words are the ones already on screen', () => {
    expect(serviceView('stopped').sentence).toBe(lostSetupCopy('service')!.text);
    expect(serviceView('stopped').actionLabel).toBe('Start the VPN service');
    expect(serviceView('restarting').sentence).toBe(RESTARTING_COPY);
  });

  it('failure codes: the ones callers already match on are kept, and every non-ready state has one', () => {
    expect(serviceView('stopped').code).toBe('daemon-unavailable');
    expect(serviceView('restarting').code).toBe('daemon-restarting');
    expect(serviceView('not-installed').code).toBe('daemon-missing');
    expect(serviceView('no-permission').code).toBe('daemon-relogin');
    expect(serviceView('wrong-network').code).toBe('network-mismatch');
    const codes = views.filter((v) => v.state !== 'ready').map((v) => v.code);
    expect(codes.every((c) => typeof c === 'string' && c.length > 0)).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
    expect(serviceView('ready').code).toBeNull();
  });

  it('serviceViewFor goes from facts to the view', () => {
    expect(serviceViewFor(facts({ running: false, link: 'absent' })).action).toBe('start');
    expect(serviceViewFor(facts({ answered: true, networkOk: true, link: 'none' })).state).toBe('ready');
  });
});

describe('connectMove: what Connect does in each state', () => {
  it('waits for a starting or restarting service and starts a stopped one (rows 120, 125)', () => {
    expect(connectMove('ready')).toBe('go');
    expect(connectMove('starting')).toBe('wait');
    expect(connectMove('restarting')).toBe('wait');
    expect(connectMove('stopped')).toBe('start');
    expect(connectMove('no-permission')).toBe('fix');
  });

  it('stops only where nothing can be done from Connect, and those states all carry an action', () => {
    for (const s of SERVICE_STATES) {
      if (connectMove(s) === 'stop') expect(serviceView(s).action).not.toBeNull();
    }
    expect(SERVICE_STATES.filter((s) => connectMove(s) === 'stop').sort()).toEqual(['link-broken', 'not-installed', 'wrong-network']);
  });
});

describe('retryDelayMs (row 121)', () => {
  it('every second while the user is watching or waiting, at any attempt', () => {
    for (const n of [0, 1, 5, 50]) expect(retryDelayMs(n, true)).toBe(RETRY_FAST_MS);
  });

  it('backs off only in the background: 2 s doubling, capped at 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 20].map((n) => retryDelayMs(n, false))).toEqual([2000, 4000, 8000, 16000, RETRY_SLOW_MAX_MS, RETRY_SLOW_MAX_MS, RETRY_SLOW_MAX_MS]);
    expect(retryDelayMs(-3, false)).toBe(2000);
    expect(retryDelayMs(1e9, false)).toBe(RETRY_SLOW_MAX_MS);
  });
});
