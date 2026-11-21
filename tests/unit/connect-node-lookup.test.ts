// Row 74: a connect asks the chain for the server once, not once per step (connection.ts keeps the answer for the
// length of a connect). Source scan + behaviour through a server test's connect, which needs the fewest stand-ins.
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const st = vi.hoisted(() => ({ lookups: 0, failLookup: false }));
vi.mock('../../src/main/app-state', () => ({ snapshot: () => ({ session: null, conn: { phase: 'idle' }, lastConnectError: null }), patch: vi.fn(), setSplitInEffect: vi.fn(), setWholeDeviceInEffect: vi.fn(), setRedialFollow: vi.fn(), toast: vi.fn() }));
vi.mock('../../src/main/daemon/manager', () => ({
  daemon: () => ({ listChannels: async () => [], listSessions: async () => [], startSession: async () => { throw new Error('429 Too Many Requests'); } }),
  daemonInfo: () => ({ reachable: true, device: 'Dev', networkOk: true }),
  deviceRecord: () => ({ owner: 'Owner', home: '/h' }),
  startServiceIfStopped: async () => 'running',
  withLinkWatch: async <T,>(fn: () => Promise<T>): Promise<T> => fn(),
}));
vi.mock('../../src/main/wallet/vault', () => ({ ownerAddress: () => 'Owner' }));
vi.mock('../../src/main/services/wallet', () => ({ ensureDevicePermission: async () => null, serviceSwitchPending: () => false }));
vi.mock('../../src/main/services/connect-checks', () => ({ preflight: async () => null, reusableChannel: async () => null, prepayCost: () => '1', planLimitReached: async () => null, heldTicket: async () => null, nodeHasRoom: async () => false }));
vi.mock('../../src/main/home-ip', () => ({ ensureHomeIp: async () => undefined }));
vi.mock('../../src/core/nodes/discovery', () => ({ discoverNode: async () => { st.lookups += 1; if (st.failLookup) throw new Error('rpc down'); return { pricePerGb: '1000', pricePerHour: '1000', country: 'US' }; } }));
vi.mock('../../src/main/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/main/services/history', () => ({ recordStart: vi.fn(), recordEnd: vi.fn() }));
vi.mock('../../src/main/services/settlement', () => ({ claimForReuse: () => true, settleChannelSoon: vi.fn(), settlesOnEnd: () => true }));
vi.mock('../../src/main/system/proxy', () => ({ setSystemProxy: vi.fn(), clearSystemProxy: async () => undefined }));
vi.mock('../../src/main/system/tunnels', () => ({ leftoverTunnels: async () => [], rivalVpns: async () => [], removeTunnelServices: async () => undefined }));
vi.mock('../../src/main/system/dns-check', () => ({ dnsReallyLeftOver: async () => false, flushDnsCache: vi.fn() }));
vi.mock('../../src/core/chain/rpc', () => ({ getRpcUrls: () => [], resetRpcTransport: vi.fn(), onRpcRetry: () => () => undefined }));
vi.mock('../../src/main/daemon/settings', () => ({ getDaemonSettings: () => ({ settings: { killSwitch: 'off', dnsServers: [] } }), serviceUsesTun: () => false, splitForSession: vi.fn() }));
vi.mock('../../src/main/services/stop-session', () => ({ stopLiveOrCurrent: async () => ({ session: null, dnsRevertFailed: false }) }));
vi.mock('../../src/main/services/first-data', () => ({ firstData: async () => undefined }));
vi.mock('../../src/main/services/net-settle', () => ({ waitForDirectPath: async () => true }));

const { connect, resetNodeLookups, NODE_LOOKUP_KEEP_MS } = await import('../../src/main/services/connection');
const req = { node: 'NodeA', basis: 'per_gb' as const, units: 1, confirmed: true as const };

describe('one server lookup per connect (row 74)', () => {
  beforeEach(() => { st.lookups = 0; st.failLookup = false; resetNodeLookups(); });

  it('the user\'s Connect reads the server from the chain once, however many steps need it', async () => {
    const r = await connect(req);
    expect(r.ok).toBe(false); // the start fails in this stand-in; every lookup before it has happened
    expect(st.lookups).toBe(1);
  }, 120_000);

  it('negative control: a failed read is not kept, the next connect asks again', async () => {
    st.failLookup = true;
    await connect(req).catch(() => undefined);
    const afterFirst = st.lookups;
    expect(afterFirst).toBeGreaterThanOrEqual(1);
    st.failLookup = false;
    await connect(req);
    expect(st.lookups).toBe(afterFirst + 1);
  }, 120_000);

  it('the answer is kept for seconds, not minutes, and only connection.ts wraps the lookup', () => {
    expect(NODE_LOOKUP_KEEP_MS).toBeLessThanOrEqual(30_000);
    const src = fs.readFileSync(path.join(__dirname, '../../src/main/services/connection.ts'), 'utf8');
    expect(src.match(/lookupNode\(/g)?.length).toBe(1); // the one real call, inside the wrapper
  });
});
