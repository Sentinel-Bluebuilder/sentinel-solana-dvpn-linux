// ─── Q0506: a session adopted while another process was still opening it is followed by the list too ───
// the Android app KSM13 grid (apk12): the app adopted a CLI session while dvpnd listed it "open" (shown: Connecting…).
// Its watch stream missed the step to active, and the reconcile looked only at connected/reconnecting, so
// the screen said "Connecting…" for good and every settings Apply was refused ("a connection is starting").
import { describe, it, expect, vi, beforeEach } from 'vitest';

const seen = vi.hoisted(() => ({
  session: null as null | { id: string },
  phase: 'idle',
  list: [] as Array<{ id: string; status: string; error?: string }>,
}));
vi.mock('../../src/main/system/proxy', () => ({ setSystemProxy: vi.fn(), clearSystemProxy: async () => undefined }));
vi.mock('../../src/main/app-state', () => ({
  snapshot: () => ({ session: seen.session, conn: { phase: seen.phase } }),
  patch: (p: { session?: unknown; conn?: { phase: string } }) => {
    if ('session' in p) seen.session = p.session as { id: string } | null;
    if (p.conn) seen.phase = p.conn.phase;
  },
  setSplitInEffect: vi.fn(), setWholeDeviceInEffect: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('../../src/main/daemon/manager', () => ({
  daemon: () => ({
    listSessions: async () => seen.list.map((s) => ({ node: 'N', service: 'wireguard', channel: '', ...s })),
    watchSession: () => () => undefined, // the stream that never delivers the step
  }),
  daemonInfo: () => ({ reachable: true }),
}));
vi.mock('../../src/main/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../src/main/services/history', () => ({ recordStart: vi.fn(), recordEnd: vi.fn(), closeHistoryFrom: vi.fn() }));
vi.mock('../../src/main/services/settlement', () => ({ settleChannelSoon: vi.fn(), settlesOnEnd: (r: string) => !/switching servers/i.test(r) }));
vi.mock('../../src/main/system/dns-check', () => ({ dnsReallyLeftOver: async () => false, flushDnsCache: vi.fn() }));
vi.mock('../../src/core/chain/rpc', () => ({ getRpcUrls: () => [], resetRpcTransport: vi.fn(), onRpcRetry: () => () => undefined }));
vi.mock('../../src/main/daemon/settings', () => ({ serviceUsesTun: () => false, getDaemonSettings: () => ({ settings: { dnsServers: [], killSwitch: 'off' } }), splitForSession: vi.fn() }));

const { adoptRunningSession, reconcileShownSession } = await import('../../src/main/services/connection');

describe('a session adopted while another process opened it (Q0506)', () => {
  beforeEach(() => {
    seen.session = null;
    seen.phase = 'idle';
  });

  it('adopted "open" → dvpnd lists it active → the screen takes Protected (not Connecting… for good)', async () => {
    seen.list = [{ id: 'cli1', status: 'open' }];
    await adoptRunningSession({ startedElsewhere: true });
    expect(seen.session?.id).toBe('cli1');
    expect(seen.phase).toBe('connecting');
    seen.list = [{ id: 'cli1', status: 'active' }];
    expect(await reconcileShownSession()).toBe(true);
    expect(seen.phase).toBe('connected');
    // and stays there on the next look (no flapping)
    expect(await reconcileShownSession()).toBe(false);
    expect(seen.phase).toBe('connected');
  });

  it('adopted "open" → dvpnd\'s tunnel check is shown, then Protected', async () => {
    seen.list = [{ id: 'cli2', status: 'open' }];
    await adoptRunningSession({ startedElsewhere: true });
    seen.list = [{ id: 'cli2', status: 'checking' }];
    expect(await reconcileShownSession()).toBe(true);
    expect(seen.phase).toBe('checking');
    seen.list = [{ id: 'cli2', status: 'active' }];
    expect(await reconcileShownSession()).toBe(true);
    expect(seen.phase).toBe('connected');
  });

  it('adopted "open" and then ended in dvpnd: cleared on the second look, not Connecting… for good', async () => {
    seen.list = [{ id: 'cli3', status: 'open' }];
    await adoptRunningSession({ startedElsewhere: true });
    seen.list = [{ id: 'cli3', status: 'ended', error: 'Disconnected.' }];
    expect(await reconcileShownSession()).toBe(false); // first miss
    expect(await reconcileShownSession()).toBe(true);
    expect(seen.session).toBeNull();
    expect(seen.phase).not.toBe('connecting');
  });

  it('negative control: a "connecting" view NOT from an adoption (the app\'s own connect) is left alone', async () => {
    seen.session = { id: 'own1' };
    seen.phase = 'connecting';
    seen.list = [{ id: 'own1', status: 'active' }];
    expect(await reconcileShownSession()).toBe(false);
    expect(seen.phase).toBe('connecting');
  });
});
