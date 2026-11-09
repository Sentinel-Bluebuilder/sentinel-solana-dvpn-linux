// ─── Restore network with the VPN service down starts it and finishes the restore ───
// u2404 killdaemon 2026-10-22: dvpnd killed and left stopped → `daemon restore-network` said
// "Restart it with sudo systemctl restart dvpnd-client". The package's polkit rule lets the user
// start the service without a password, so Restore network now does that and retries once.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({ up: false, starts: 0, startResult: 'started' as string, stops: 0 }));
vi.mock('../../src/main/system/proxy', () => ({ setSystemProxy: vi.fn(), clearSystemProxy: async () => undefined }));
vi.mock('../../src/main/app-state', () => ({ snapshot: () => ({ session: null }), patch: vi.fn(), setSplitInEffect: vi.fn(), toast: vi.fn() }));
vi.mock('../../src/main/services/stop-session', () => ({ stopLiveOrCurrent: async () => ({ session: null, dnsRevertFailed: false }) }));
vi.mock('../../src/main/daemon/manager', () => ({
  daemon: () => ({
    listSessions: async () => { if (!st.up) throw new Error('connect ECONNREFUSED /var/lib/dvpnd/client/daemon.sock'); return []; },
    stopSession: async () => { st.stops++; return { killSwitchReleased: true }; },
  }),
  daemonInfo: () => ({ reachable: st.up }),
  startServiceIfStopped: async () => { st.starts++; if (st.startResult === 'started') st.up = true; return st.startResult; },
}));
vi.mock('../../src/main/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/main/services/history', () => ({ recordStart: vi.fn(), recordEnd: vi.fn() }));
vi.mock('../../src/main/services/settlement', () => ({ settleChannelSoon: vi.fn(), settlesOnEnd: (r: string) => !/switching servers/i.test(r) }));
vi.mock('../../src/main/system/dns-check', () => ({ dnsReallyLeftOver: async () => false, flushDnsCache: vi.fn() }));
vi.mock('../../src/main/system/tunnels', () => ({ leftoverTunnels: async () => [], removeTunnelServices: async () => ({ ok: true }) }));
vi.mock('../../src/core/chain/rpc', () => ({ getRpcUrls: () => [], resetRpcTransport: vi.fn() }));
vi.mock('../../src/main/daemon/settings', () => ({ getDaemonSettings: () => ({ settings: { dnsServers: [] } }), splitForSession: vi.fn() }));

const { restoreNetwork } = await import('../../src/main/services/connection');

describe('restore network with the service down', () => {
  beforeEach(() => { st.up = false; st.starts = 0; st.stops = 0; st.startResult = 'started'; });

  it('starts the service, then releases what it held', async () => {
    const r = await restoreNetwork();
    expect(r.ok).toBe(true);
    expect(st.starts).toBe(1);
    expect(st.stops).toBe(1); // the kept kill switch is released on the retry
  });

  it('without the right to start it, says how (and tries once only)', async () => {
    st.startResult = 'no-right';
    const r = await restoreNetwork();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not answering/);
    expect(st.starts).toBe(1);
  });
});
