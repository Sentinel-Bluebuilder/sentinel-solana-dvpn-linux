// ─── Q0518 class (Q0520-Q0522): no verdicts while the VPN service restarts, one check when it settles ───
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddv-transition-'));
const link = { reachable: true, stopping: false };
const reattach = vi.hoisted(() => ({ calls: 0 }));
let fire: () => void = () => undefined;
let probe: () => boolean = () => false;
vi.mock('../../src/main/daemon/manager', () => ({
  daemonInfo: () => ({ reachable: link.reachable }),
  onDaemonChange: (fn: () => void) => { fire = fn; return () => undefined; },
  reattachSoon: () => { reattach.calls += 1; },
  linkStopping: () => link.stopping,
  setTransitionProbe: (fn: () => boolean) => { probe = fn; },
}));
vi.mock('../../src/main/store', () => ({ storePath: (n: string) => path.join(dir, n) }));
vi.mock('../../src/main/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

const T = await import('../../src/main/services/service-transition');

const settled = vi.fn();
T.onTransitionSettled(settled);
const setLink = (r: boolean): void => { link.reachable = r; fire(); };
const marker = path.join(dir, T.APPLY_MARKER);

describe('service transition', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    T.setTransitionClock(() => Date.now());
    T.resetServiceTransition();
    fs.rmSync(marker, { force: true });
    link.reachable = true;
    fire();
    settled.mockClear();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('owner laptop 2026-11-11 23:34Z replayed (an Apply): no verdict until 4 s after the service is back, then one check', () => {
    T.writeApplyMarker();                                      // 23:34:30 elevated step apply-daemon-config.ps1
    vi.advanceTimersByTime(9_000);
    T.beginServiceTransition('the service is stopping');      // 23:34:39 session ended "daemon stopping"
    vi.advanceTimersByTime(1_000); setLink(false);             // 23:34:40 ListSessions dropped
    for (let s = 0; s < 21; s++) { vi.advanceTimersByTime(1_000); expect(T.serviceInTransition()).toBe(true); } // 23:34:58 was the red banner
    T.clearApplyMarker();                                      // 23:35:01 daemon settings apply ok
    vi.advanceTimersByTime(2_000);
    expect(T.serviceInTransition()).toBe(true);                // still down: no "sign out" (23:35:01) either
    setLink(true);                                             // 23:35:04 daemon attached
    vi.advanceTimersByTime(3_000);
    expect(T.serviceInTransition()).toBe(true);
    expect(settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_100);
    expect(T.serviceInTransition()).toBe(false);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('Agent M Mac T3 r6: while the link is down the guard asks for a reattach each second; once it is up, never', () => {
    T.serviceInTransition();
    reattach.calls = 0;
    link.reachable = false; fire();
    expect(T.serviceInTransition()).toBe(true);
    vi.advanceTimersByTime(3_100);
    expect(reattach.calls).toBeGreaterThanOrEqual(3); // was: the 2 s/4 s backoff alone, ~4 s unattached after ready
    link.reachable = true; fire();
    const before = reattach.calls;
    vi.advanceTimersByTime(3_000);
    expect(reattach.calls).toBeGreaterThanOrEqual(before); // while it answers the link is only re-asked (DVPN-WIN r51)
  });

  it('a service that stops answering by itself (crash, CLI restart) starts a transition', () => {
    setLink(false);
    expect(T.serviceInTransition()).toBe(true);
    expect(probe()).toBe(true); // the link's own state reads "restarting" from this
  });

  it('UI-166: the app closing its own link at quit is not a service restart', () => {
    link.stopping = true;
    try {
      setLink(false);
      expect(T.serviceInTransition()).toBe(false);
      expect(probe()).toBe(false);
    } finally {
      link.stopping = false;
    }
  });

  it('Mac T3 (launchctl kickstart -k) replayed: the link never reads down, the guard still holds 4 s from the stop', () => {
    vi.advanceTimersByTime(60_000);                            // attached long ago: an old "up since"
    T.beginServiceTransition('the service is stopping');      // session ended "daemon stopping"; health check not run yet
    expect(T.serviceInTransition()).toBe(true);                // was: settled in 3 ms
    vi.advanceTimersByTime(3_000);
    expect(T.serviceInTransition()).toBe(true);
    expect(settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_100);
    expect(T.serviceInTransition()).toBe(false);               // never longer than SETTLE_MS while it answers (DIR's > 6 s rule)
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('negative control: a service that never answered (not installed) is not a transition: setup shows at once', () => {
    T.resetServiceTransition();
    link.reachable = false; fire();
    expect(T.serviceInTransition()).toBe(false);
  });

  it('cap: a service that does not come back ends the transition at 90 s so the real problem is shown', () => {
    setLink(false);
    vi.advanceTimersByTime(T.CAP_MS - 1_500);
    expect(T.serviceInTransition()).toBe(true);
    vi.advanceTimersByTime(2_000);
    expect(T.serviceInTransition()).toBe(false);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('cross-process: an apply marker from another live process (the CLI) is a transition until it is removed', () => {
    fs.writeFileSync(marker, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
    expect(T.serviceInTransition()).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(T.serviceInTransition()).toBe(true);                // still applying
    T.clearApplyMarker();
    vi.advanceTimersByTime(100);
    expect(T.serviceInTransition()).toBe(false);               // service was up the whole time: settles at once
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('a stale marker (old, or its process gone) is ignored', () => {
    fs.writeFileSync(marker, JSON.stringify({ pid: process.pid, startedAt: Date.now() - T.MARKER_MAX_MS - 1 }));
    expect(T.serviceInTransition()).toBe(false);
    fs.writeFileSync(marker, JSON.stringify({ pid: 2 ** 22 + 12345, startedAt: Date.now() }));
    expect(T.serviceInTransition()).toBe(false);
  });

  it('fuzz: 500 seeded link/marker sequences never settle while down or applying, and always settle 4 s after back up', () => {
    let seed = 7;
    const rnd = (): number => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
    for (let run = 0; run < 500; run++) {
      T.resetServiceTransition(); fs.rmSync(marker, { force: true });
      link.reachable = true; fire();
      let upAt = Date.now(); let applying = false; let started: number | null = null;
      for (let step = 0; step < 12; step++) {
        const r = rnd();
        if (r < 0.3) { setLink(!link.reachable); if (link.reachable) upAt = Date.now(); else started ??= Date.now(); }
        else if (r < 0.4 && !applying) { T.writeApplyMarker(); applying = true; started ??= Date.now(); }
        else if (r < 0.5 && applying) { T.clearApplyMarker(); applying = false; }
        vi.advanceTimersByTime(Math.floor(rnd() * 6_000));
        const inT = T.serviceInTransition();
        if (inT && started === null) started = Date.now();
        // (b) never "settled" (no verdict allowed) while the service is down or an apply runs, within the cap
        if ((!link.reachable || applying) && started !== null && Date.now() - started < T.CAP_MS - 1_000) expect(inT, JSON.stringify({ run, step, down: !link.reachable, applying, age: Date.now() - started })).toBe(true);
        // settles within 4 s (+ timer slack) of being back up with no apply; a transition that began while the
        // link read up counts from its start (the begin event is newer than the link reading, Mac T3)
        if (link.reachable && !applying && Date.now() - Math.max(upAt, started ?? 0) > T.SETTLE_MS + 1_100) expect(inT).toBe(false);
        if (!inT) started = null;
      }
      if (applying) T.clearApplyMarker();
    }
  });
});

describe('Mac T4 (dvpnd SIGKILL): a dropped watch stream begins the transition', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'services', 'connection.ts'), 'utf8');
  it('a link-drop error begins it; a clean close by the service does not', () => {
    const at = src.indexOf("log.warn('watch stream ended; polling instead'");
    const block = src.slice(at, at + 600);
    expect(block).toMatch(/connection dropped\|unavailable\|econnreset\|enoent\|socket closed/);
    expect(block).toMatch(/beginServiceTransition\('the service link dropped'\)/);
    expect(block).toMatch(/\} else log\.info\('watch stream closed by the service'/); // negative: the clean close stays a plain end
  });
});

describe('Q0541 (DVPN-LINUX KSM3): the screen flag follows the transition to its end', () => {
  it('apply ends while the link is dropping, a second transition starts inside the settle, and still ends "up"', () => {
    vi.useFakeTimers();
    T.setTransitionClock(() => Date.now());
    T.resetServiceTransition();
    link.reachable = true; fire();
    const seen: boolean[] = [];
    const daemonView = (): void => { seen.push(T.serviceInTransition()); };   // scheduler.ts daemonView
    const offEnd = T.onTransitionSettled(daemonView);
    const offBegin = T.onTransitionBegan(daemonView);
    T.writeApplyMarker();                         // 16:38:31.154 apply begins
    vi.advanceTimersByTime(900);
    link.reachable = false;                       // the restart drops the link; no change event yet
    T.clearApplyMarker();                         // 16:38:32.113 apply over -> settle runs daemonView -> sees the drop
    vi.advanceTimersByTime(1_100);
    link.reachable = true; fire();                // 16:38:32.135 attached again
    vi.advanceTimersByTime(4_200);                // 16:38:36.137 settled
    expect(T.serviceInTransition()).toBe(false);
    expect(seen.at(-1)).toBe(false);              // the last screen value is "up", never left "restarting"
    offEnd(); offBegin();
    vi.useRealTimers();
  });
});
