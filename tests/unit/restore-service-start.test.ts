// ─── Restore network with the VPN service down (C18, builder-kb; linux-app 19bff7a7) ───
// A stopped service is started without elevation and the restore runs once more; otherwise the
// person is told to restart Windows, as before.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { osWord } from '../../src/shared/os-words';

const st = vi.hoisted(() => ({
  svc: 'started' as string,
  up: false,
  reachable: [] as boolean[],
  starts: 0,
  sweeps: 0, // RC9 PF-DEAD: root sweeps run while the daemon is down
  stops: 0, // RC9 PF-DEAD-2: StopSession calls (the release of a kill switch the respawned daemon re-applied)
  state: { session: null as unknown, conn: { phase: 'idle' } as Record<string, unknown>, lastConnectError: null as unknown },
}));
vi.mock('../../src/main/app-state', () => ({
  snapshot: () => st.state,
  patch: (p: Record<string, unknown>) => { Object.assign(st.state, p); },
  setSplitInEffect: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('../../src/main/daemon/manager', () => ({
  daemon: () => ({
    listSessions: async () => { if (!st.up) throw new Error('daemon down'); return []; },
    stopSession: async () => { st.stops += 1; throw Object.assign(new Error('none'), { kind: 'not-found' }); },
  }),
  daemonInfo: () => ({ reachable: false }),
  startServiceIfStopped: async () => { st.starts += 1; if (st.svc === 'started') st.up = true; return st.svc; },
}));
vi.mock('../../src/main/services/daemon-wait', () => ({ SERVICE_WAIT_MS: 1, waitForDaemon: async () => ({ reachable: st.reachable.shift() ?? false, device: 'Dev', networkOk: true }) }));
vi.mock('../../src/main/wallet/vault', () => ({ ownerAddress: () => 'Owner' }));
vi.mock('../../src/main/services/connect-checks', () => ({
  preflight: async () => null, reusableChannel: async () => null, prepayCost: () => '1',
  planLimitReached: async () => null, heldTicket: async () => null, nodeHasRoom: async () => false,
}));
vi.mock('../../src/main/home-ip', () => ({ ensureHomeIp: async () => undefined }));
vi.mock('../../src/core/nodes/discovery', () => ({ discoverNode: async () => ({ pricePerGb: '1000', pricePerHour: '1000', country: 'US' }) }));
vi.mock('../../src/main/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/main/services/history', () => ({ recordStart: vi.fn(), recordEnd: vi.fn() }));
vi.mock('../../src/main/services/settlement', () => ({ claimForReuse: () => true, settleChannelSoon: vi.fn(), settlesOnEnd: (r: string) => !/switching servers/i.test(r) }));
vi.mock('../../src/main/system/proxy', () => ({ setSystemProxy: vi.fn(), clearSystemProxy: async () => undefined }));
vi.mock('../../src/main/system/tunnels', () => ({ restoreNetworkSweep: () => false, openvpnRunning: async () => false, leftoverTunnels: async () => [], rivalVpns: async () => [], removeTunnelServices: async () => { st.sweeps += 1; return { ok: true, detail: 'removed: kill switch (pf anchor sentinel-dvpn-c0), pf anchor attach line' }; } }));
vi.mock('../../src/main/system/dns-check', () => ({ dnsReallyLeftOver: async () => false, flushDnsCache: vi.fn() }));
vi.mock('../../src/core/chain/rpc', () => ({ getRpcUrls: () => [], resetRpcTransport: vi.fn(), onRpcRetry: () => () => undefined }));
vi.mock('../../src/main/daemon/settings', () => ({ getDaemonSettings: () => ({ settings: { killSwitch: 'off', dnsServers: [] } }), serviceUsesTun: () => false, splitForSession: vi.fn() }));
vi.mock('../../src/main/services/stop-session', () => ({ stopLiveOrCurrent: async () => ({ session: null, dnsRevertFailed: false }) }));
vi.mock('../../src/main/services/first-data', () => ({ firstData: async () => undefined }));
vi.mock('../../src/main/services/net-settle', () => ({ waitForDirectPath: async () => true }));


const { restoreNetwork } = await import('../../src/main/services/connection');

beforeEach(() => { st.state = { session: null, conn: { phase: 'idle' }, lastConnectError: null }; st.reachable = []; st.starts = 0; st.sweeps = 0; st.stops = 0; st.up = false; });

describe('restore network when the VPN service is down', () => {
  it('stopped service: started, waited for, restore runs again and succeeds', async () => {
    st.svc = 'started'; st.reachable = [true];
    const r = await restoreNetwork();
    expect(st.starts).toBe(1);
    expect(r.ok).toBe(true);
  });

  it.each(['no-right', 'failed', 'no-service'])('%s: the restart text, one start attempt only', async (svc) => {
    st.svc = svc;
    const r = await restoreNetwork();
    expect(st.starts).toBe(1);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('daemon-unavailable');
    // The OS's own words (Restart Windows / Restart the Mac / Restart the computer): osWord, all-OS port.
    expect(r.error).toContain(osWord('restartService', process.platform));
  });

  it('started but never answers: restart text, no loop', async () => {
    st.svc = 'started'; st.reachable = [false]; st.up = false;
    const r = await restoreNetwork();
    expect(r.code).toBe('daemon-unavailable');
    expect(st.starts).toBe(1);
  });
});

// ─── RC9 PF-DEAD (the macOS app live run 44808199308, pf_restore): kill -9 of the daemon, then Restore network ───
// No leftover tunnel link showed, so the root step never ran and the kill switch's pf table kept blocking.
describe('restore network right after the daemon was killed (RC9 PF-DEAD)', () => {
  it('daemon dead, no leftover link: the root sweep still runs (it empties the kill-switch firewall table)', async () => {
    st.svc = 'no-service';
    await restoreNetwork();
    expect(st.sweeps).toBe(1);
  });
  it('launchd/systemd already restarted it (running): waits, runs once more and succeeds', async () => {
    st.svc = 'running'; st.reachable = [true]; st.up = true;
    const first = { done: false };
    // the first listSessions throws (daemon still coming up); the retry sees it up
    st.up = false;
    const r = await (async () => { const p = restoreNetwork(); st.up = true; first.done = true; return p; })();
    expect(first.done).toBe(true);
    expect(st.sweeps).toBe(1);
    expect(r.ok).toBe(true);
  });
  it('negative control: running but it never answers: the restart text, no loop', async () => {
    st.svc = 'running'; st.reachable = [false];
    const r = await restoreNetwork();
    expect(r.code).toBe('daemon-unavailable');
    expect(st.starts).toBe(1);
  });
});

// ─── RC9 PF-DEAD-2 (the macOS app live run 44813895933): a normal user's kickstart is refused ('no-right'); launchd KeepAlive
// brings the daemon back on its own and it re-applies the kill switch it held. The restore must wait, run again and
// release it (StopSession), as the second restore did live. Before this fix it gave up at once (block stayed).
describe('restore network: no right to kickstart, but the service manager restarts the daemon (RC9 PF-DEAD-2)', () => {
  it.runIf(process.platform !== 'win32')('no-right + the daemon comes back: waits, runs again, releases the held kill switch, ok', async () => {
    st.svc = 'no-right'; st.reachable = [true];
    const p = restoreNetwork();
    st.up = true; // KeepAlive respawned it while the restore waited
    const r = await p;
    expect(r.ok).toBe(true);
    expect(st.sweeps).toBe(1);
    expect(st.stops).toBeGreaterThanOrEqual(1);
  });
  it('negative control: no-right and it never comes back: the restart text, no loop', async () => {
    st.svc = 'no-right'; st.reachable = [false];
    const r = await restoreNetwork();
    expect(r.code).toBe('daemon-unavailable');
    expect(st.starts).toBe(1);
  });
});
