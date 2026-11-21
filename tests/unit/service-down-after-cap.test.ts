// ─── Q0548: a service that does not come back within the restart window is said plainly ───
// DVPN-WIN tr-kill-xr: dvpnd crashed for the 13th time in a reset period and Windows waited 300 s to restart it;
// the screen said "Checking the connection… The VPN service is restarting. This takes a few seconds." throughout.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({
  session: null as null | { id: string },
  conn: { phase: 'connected' } as Record<string, unknown>,
  closeMessage: null as unknown,
  internet: false,
  reachable: true,
  settled: [] as Array<() => void>,
  began: [] as Array<() => void>,
}));
vi.mock('../../src/main/system/proxy', () => ({ setSystemProxy: vi.fn(), clearSystemProxy: async () => undefined }));
vi.mock('../../src/main/app-state', () => ({
  snapshot: () => ({ session: st.session, conn: st.conn }),
  patch: (p: { session?: unknown; conn?: Record<string, unknown> }) => {
    if ('session' in p) st.session = p.session as { id: string } | null;
    if (p.conn) st.conn = p.conn;
    if ('lastCloseMessage' in (p as Record<string, unknown>)) st.closeMessage = (p as Record<string, unknown>).lastCloseMessage;
  },
  setSplitInEffect: vi.fn(), setWholeDeviceInEffect: vi.fn(), toast: vi.fn(),
}));
vi.mock('../../src/main/daemon/manager', () => ({
  daemon: () => ({ listSessions: async () => { throw new Error('The VPN service is not running'); }, watchSession: () => () => undefined }),
  daemonInfo: () => ({ reachable: st.reachable }),
}));
vi.mock('../../src/main/services/service-transition', () => ({
  serviceInTransition: () => false, beginServiceTransition: vi.fn(), applyMarkerFresh: () => false, RESTARTING_COPY: 'restarting',
  onTransitionSettled: (fn: () => void) => { st.settled.push(fn); return () => undefined; },
  onTransitionBegan: (fn: () => void) => { st.began.push(fn); return () => undefined; },
}));
vi.mock('../../src/core/quality/reachability', () => ({ internetReachable: async () => st.internet }));
vi.mock('../../src/main/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../src/main/services/history', () => ({ recordStart: vi.fn(), recordEnd: vi.fn() }));
vi.mock('../../src/main/services/settlement', () => ({ settleChannelSoon: vi.fn(), settlesOnEnd: () => true }));
vi.mock('../../src/main/system/dns-check', () => ({ dnsReallyLeftOver: async () => false, flushDnsCache: vi.fn() }));
vi.mock('../../src/core/chain/rpc', () => ({ getRpcUrls: () => [], resetRpcTransport: vi.fn(), onRpcRetry: () => () => undefined }));
vi.mock('../../src/main/daemon/settings', () => ({ serviceUsesTun: () => false, getDaemonSettings: () => ({ settings: { killSwitch: 'persist', dnsServers: [] } }), splitForSession: vi.fn() }));

const { serviceDownCopy, checkLeftoverBlock } = await import('../../src/main/services/connection');
const { closeReasonCopy } = await import('../../src/core/session/state');
const settle = () => new Promise((r) => setTimeout(r, 20));

describe('the restart window ended with the service still down (Q0548)', () => {
  beforeEach(() => { st.session = { id: 's1' }; st.conn = { phase: 'connected' }; });

  it('the restarting view is replaced by a plain one with Restore network', async () => {
    st.began.forEach((f) => f());
    expect(st.conn.phase).toBe('checking');
    st.reachable = false;
    st.settled.forEach((f) => f());
    await settle();
    expect(st.session).toBeNull();
    expect(st.conn.title).toBe('VPN service stopped');
    expect(st.conn.restoreNetwork).toBe(true);
    expect(String(st.conn.detail)).toBe(serviceDownCopy('persist'));
    expect(String(st.conn.detail)).not.toMatch(/few seconds/);
  });
  it('Q0551: once the service answers again the stopped view becomes the held view (still blocking, Restore network), not "has not started again"', async () => {
    st.session = null; // the first test left the stopped view up (session ended)
    st.conn = { phase: 'error', title: 'VPN service stopped', restoreNetwork: true, detail: serviceDownCopy('persist') };
    st.reachable = true;
    st.internet = false;
    expect(await checkLeftoverBlock()).toBe(true);
    expect(String(st.conn.detail)).toMatch(/^The VPN service restarted. The kill switch is still blocking/);
    expect(st.conn.restoreNetwork).toBe(true);
    expect((st.closeMessage as { message: string }).message).toBe('The VPN service restarted.');
    // and once the internet answers (kill switch off applied) it goes to Not connected
    st.internet = true;
    expect(await checkLeftoverBlock()).toBe(false);
    expect(st.conn.phase).toBe('idle');
  });

  it('the words: kill switch off does not claim a block', () => {
    expect(serviceDownCopy('off')).not.toMatch(/kill switch/);
    expect(serviceDownCopy('on')).toMatch(/kill switch keeps the internet blocked/);
    expect(closeReasonCopy('the VPN service stopped').message).toBe('The VPN service stopped and has not started again.');
  });
  it('negative control: a service that came back keeps the session (reconciled, not ended here)', async () => {
    st.reachable = true;
    st.conn = { phase: 'connected' };
    st.settled.forEach((f) => f());
    await settle();
    expect(st.conn.title).not.toBe('VPN service stopped');
  });
});
