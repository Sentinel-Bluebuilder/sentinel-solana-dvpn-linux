// UI pass rows 119-142: the link manager says the service's state from facts, logs a repeated failure once,
// and retries every second while someone is watching (row 121). No bridge, no service: the link is pointed at a
// target nothing listens on (DVPN_DAEMON_TARGET), and the gRPC client is a stand-in.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const warn = vi.fn();
// a service that is simply off / starting / not installed is logged at info, a real link fault at warn: count both
const info = vi.fn();
const said = (what: string): number => [...warn.mock.calls, ...info.mock.calls].filter((c) => c[0] === what).length;
vi.mock('../../src/main/logger', () => ({ log: { info, warn, error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../src/main/store', () => ({ readJson: () => null, writeJson: vi.fn() }));
vi.mock('../../src/main/system/elevate', () => ({ runElevated: vi.fn() }));
vi.mock('../../src/main/host', () => ({ getHost: () => ({ resourcesDir: '/nonexistent' }) }));

const answer = vi.hoisted(() => ({ fail: 'connect ENOENT /run/x.sock' as string | null, calls: 0 }));
vi.mock('../../src/core/daemon/client', async (orig) => {
  const real = await orig<typeof import('../../src/core/daemon/client')>();
  class FakeClient {
    async getVersion(): Promise<{ tag: string; commit: string; network: string; programId: string; mint: string }> {
      answer.calls += 1;
      if (answer.fail) throw new Error(answer.fail);
      const { PROGRAM_ID, MINT } = await import('../../src/core/chain/idl');
      return { tag: 't', commit: 'c', network: 'devnet', programId: PROGRAM_ID.toBase58(), mint: MINT.toBase58() };
    }
    close(): void { /* nothing to close */ }
  }
  return { ...real, DaemonClient: FakeClient };
});

const M = await import('../../src/main/daemon/manager');
const tick = async (ms: number): Promise<void> => { await vi.advanceTimersByTimeAsync(ms); };

describe('the link manager and the service state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.DVPN_DAEMON_TARGET = '127.0.0.1:1';
    answer.fail = 'connect ENOENT /run/x.sock';
    answer.calls = 0;
    warn.mockClear();
    info.mockClear();
    M.resetLinkState();
  });
  afterEach(() => {
    M.stopDaemonLink();
    delete process.env.DVPN_DAEMON_TARGET;
    vi.useRealTimers();
  });

  it('a link that fails says a state, and info.error is that state\'s sentence', async () => {
    M.startDaemonLink();
    await tick(0);
    const d = M.daemonInfo();
    expect(d.reachable).toBe(false);
    expect(d.service?.state).toBe('stopped'); // no OS facts here (not Windows / no sc): a missing socket = off
    expect(d.error).toBe(d.service?.sentence);
    expect(d.error).not.toMatch(/is not running/);
  });

  it('a refusal right after a start is "starting" (row 127); a restart in progress is "restarting"', async () => {
    answer.fail = 'open pipe: Access is denied.';
    M.noteServiceStarting();
    M.startDaemonLink();
    await tick(0);
    expect(M.daemonInfo().service?.state).toBe('starting');
    M.setTransitionProbe(() => true);
    expect(M.daemonInfo().service?.state).toBe('restarting');
  });

  it('row 121: watched = a try every second; unwatched = 2 s, 4 s, 8 s', async () => {
    M.startDaemonLink();
    await tick(0);
    expect(answer.calls).toBe(1);
    await tick(1_999); expect(answer.calls).toBe(1);
    await tick(1); expect(answer.calls).toBe(2);          // 2 s
    await tick(3_999); expect(answer.calls).toBe(2);
    await tick(1); expect(answer.calls).toBe(3);          // +4 s
    M.setLinkWatching(true);                               // the window came to the front: try now
    await tick(0); expect(answer.calls).toBe(4);
    await tick(5_000); expect(answer.calls).toBe(9);      // then every second
  });

  it('row 121: a button that needs the service retries at once and keeps the fast pace while it waits', async () => {
    M.startDaemonLink();
    await tick(0);
    expect(answer.calls).toBe(1);
    const waited = M.withLinkWatch(async () => { await new Promise((r) => setTimeout(r, 3_000)); });
    await tick(0); expect(answer.calls).toBe(2);
    await tick(3_000); await waited;
    expect(answer.calls).toBeGreaterThanOrEqual(4);
  });

  it('the service coming back is seen within a second while watched, and the state is ready', async () => {
    M.setLinkWatching(true);
    M.startDaemonLink();
    await tick(2_500);
    answer.fail = null;
    await tick(1_000);
    const d = M.daemonInfo();
    expect(d.reachable).toBe(true);
    expect(d.service?.state).toBe('ready');
    expect(d.error).toBeNull();
  });

  it('row 139: the same failure every second is logged once, not once a second', async () => {
    M.setLinkWatching(true);
    M.startDaemonLink();
    await tick(30_000);
    expect(answer.calls).toBeGreaterThan(25);
    expect(said('daemon attach failed')).toBe(1);
    await tick(40_000);
    expect(said('daemon attach failed')).toBe(2); // one a minute
  });

  it('the one button on a starting service waits for it and answers ok when it is up', async () => {
    M.noteServiceStarting();
    M.startDaemonLink();
    await tick(0);
    expect(M.serviceNow().action).toBeNull();
    const fixed = M.fixService();
    await tick(2_000);
    answer.fail = null;
    await tick(1_500);
    const r = await fixed;
    expect(r).toEqual({ ok: true, data: { did: 'wait', state: 'ready' } });
  });

  it('the one button on a service that never answers gives the state\'s sentence and code, never a raw error', async () => {
    M.noteServiceStarting();
    M.startDaemonLink();
    await tick(0);
    const fixed = M.fixService();
    await tick(31_000);
    const r = await fixed;
    expect(r.ok).toBe(false);
    expect(r.error).toBe(M.serviceNow().sentence);
    expect(r.code).toBe('daemon-starting');
  });

  it('the one button on a ready service does nothing', async () => {
    answer.fail = null;
    M.startDaemonLink();
    await tick(0);
    expect(await M.fixService()).toEqual({ ok: true, data: { did: 'none', state: 'ready' } });
  });

  it('a different kind of failure is logged at once', async () => {
    M.setLinkWatching(true);
    M.startDaemonLink();
    await tick(3_000);
    answer.fail = 'open pipe: Access is denied.';
    await tick(1_000);
    expect(said('daemon attach failed')).toBe(2);
  });
});
