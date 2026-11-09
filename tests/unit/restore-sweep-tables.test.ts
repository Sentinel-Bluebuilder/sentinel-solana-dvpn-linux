// ─── Restore network runs the root clean-up even when no tunnel is visible (Q0239) ───
// A dvpnd SIGKILLed in a Hysteria2 session left only its nft meter table `inet dvpnd_hy2`. Links and
// processes are checked unelevated, nft tables need root, so the sweep was skipped and
// "Network restored." kept the table (ddv-fix-lnx1 0.1.10, 04:24Z 10-29).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({ left: [] as string[], sweeps: 0, sweep: { ok: true, detail: 'removed: Hysteria2 meter (nft inet dvpnd_hy2)' } }));
vi.mock('../../src/main/system/proxy', () => ({ setSystemProxy: vi.fn(), clearSystemProxy: async () => undefined }));
vi.mock('../../src/main/app-state', () => ({ snapshot: () => ({ session: null }), patch: vi.fn(), setSplitInEffect: vi.fn(), toast: vi.fn() }));
vi.mock('../../src/main/services/stop-session', () => ({ stopLiveOrCurrent: async () => ({ session: null, dnsRevertFailed: false }) }));
vi.mock('../../src/main/daemon/manager', () => ({
  daemon: () => ({ listSessions: async () => [], stopSession: async () => ({ killSwitchReleased: false }) }),
  daemonInfo: () => ({ reachable: true }),
  startServiceIfStopped: async () => 'running',
}));
vi.mock('../../src/main/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/main/services/history', () => ({ recordStart: vi.fn(), recordEnd: vi.fn() }));
vi.mock('../../src/main/services/settlement', () => ({ settleChannelSoon: vi.fn(), settlesOnEnd: (r: string) => !/switching servers/i.test(r) }));
vi.mock('../../src/main/system/dns-check', () => ({ dnsReallyLeftOver: async () => false, flushDnsCache: vi.fn() }));
vi.mock('../../src/main/system/tunnels', () => ({
  leftoverTunnels: async () => st.left,
  rivalVpns: async () => [],
  removeTunnelServices: async () => { st.sweeps++; return st.sweep; },
}));
vi.mock('../../src/core/chain/rpc', () => ({ getRpcUrls: () => [], resetRpcTransport: vi.fn() }));
vi.mock('../../src/main/daemon/settings', () => ({ getDaemonSettings: () => ({ settings: { dnsServers: [] } }), splitForSession: vi.fn() }));

const { restoreNetwork } = await import('../../src/main/services/connection');

describe('restore network sweeps firewall tables (Q0239)', () => {
  beforeEach(() => { st.left = []; st.sweeps = 0; st.sweep = { ok: true, detail: 'removed: Hysteria2 meter (nft inet dvpnd_hy2)' }; });

  it('no tunnel visible: the root step still runs (it is the only one that sees nft tables)', async () => {
    const r = await restoreNetwork();
    expect(r.ok).toBe(true);
    expect(st.sweeps).toBe(1);
  });
  it('no tunnel visible and the root step cannot run: still ok, as before', async () => {
    st.sweep = { ok: false, detail: 'The administrator permission prompt was declined or closed.' };
    const r = await restoreNetwork();
    expect(r.ok).toBe(true);
    expect(st.sweeps).toBe(1);
  });
  it('a visible tunnel that will not go away is still an error', async () => {
    st.left = ['dvpn-hy2-client'];
    st.sweep = { ok: false, detail: 'still present: dvpn-hy2-client' };
    const r = await restoreNetwork();
    expect(r.ok).toBe(false);
    expect(r.code).toBe('tunnel-left');
  });
});
