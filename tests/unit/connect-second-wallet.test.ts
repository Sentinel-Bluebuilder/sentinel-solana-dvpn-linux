// rc.4 E-55 at the connect() level (other fleet, macOS rc.3: `agent up` refused first, but plain `connect <node>`
// and the app's Connect ran initDevice before the SOL check; Windows rc.3 VM repro 2026-11-16 02:52Z: device.json
// rewritten to the second wallet, a staging folder made). Drives connect() itself with the real wallet.ts and the
// real device record / staging / switch folders on a temp data folder: a second wallet short of SOL is refused and
// device.json, daemon-staging and daemon-switch are byte-identical afterwards.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const W1 = 'W1111zqJ5VnSxW4wZGkdcwF5ydW3z7jRMNTgZyU2LvcF';
const W2 = 'W2222zqJ5VnSxW4wZGkdcwF5ydW3z7jRMNTgZyU2LvcF';
const st = vi.hoisted(() => ({
  dir: '', kind: 'keyfile', lamports: 10_000_000,
  state: { session: null as unknown, conn: { phase: 'idle' } as Record<string, unknown>, lastConnectError: null as unknown },
}));
vi.mock('../../src/main/host', () => ({ getHost: () => ({ name: 'cli', dataDir: st.dir, resourcesDir: st.dir, keyStore: { kind: st.kind }, emit: () => undefined }) }));
vi.mock('../../src/main/app-state', () => ({
  snapshot: () => st.state,
  patch: vi.fn((p: Record<string, unknown>) => { Object.assign(st.state, p); }),
  setSplitInEffect: vi.fn(), setWholeDeviceInEffect: vi.fn(), setRedialFollow: vi.fn(), toast: vi.fn(),
}));
vi.mock('../../src/main/daemon/manager', async (orig) => ({
  ...(await orig<object>()), // the real deviceRecord, stagingHome, switchHome, stageSwitchDevice on st.dir
  daemon: () => new Proxy({}, { get: () => async () => { throw new Error('reached the daemon'); } }),
  daemonInfo: () => ({ reachable: true, device: 'D1', networkOk: true }),
  startServiceIfStopped: async () => 'running',
  withLinkWatch: async <T,>(fn: () => Promise<T>): Promise<T> => fn(),
  installService: async () => { throw new Error('reached the installer'); },
}));
vi.mock('../../src/main/services/daemon-wait', () => ({ SERVICE_WAIT_MS: 1, waitForDaemon: async () => ({ reachable: true, device: 'D1', networkOk: true }) }));
vi.mock('../../src/main/wallet/vault', () => ({ ownerAddress: () => W2, hasWallet: () => true, ownerSigner: () => ({}), noWallet: () => ({ error: 'no wallet', code: 'no-wallet' }) }));
vi.mock('../../src/main/system/settings', () => ({ getSettings: () => ({ allowanceTdvpn: '50', autoDevicePermission: true }), updateSettings: vi.fn() }));
vi.mock('../../src/core/app/wallet-status', () => ({
  readWalletStatus: async (owner: string) => ({ owner, device: null, ownerLamports: st.lamports, ownerTdvpn: '2000000', delegated: '0', userBalance: '0', grant: null, deviceLamports: 0, needsPermission: true }),
  lowFundsWarnings: () => [],
}));
vi.mock('../../src/core/app/device-setup', async (orig) => ({ ...(await orig<object>()), runDeviceSetup: async () => { throw new Error('reached the setup'); } }));
vi.mock('../../src/main/services/connect-checks', () => ({
  preflight: async () => null, reusableChannel: async () => null, prepayCost: () => '1',
  planLimitReached: async () => null, heldTicket: async () => null, nodeHasRoom: async () => false,
}));
vi.mock('../../src/main/home-ip', () => ({ ensureHomeIp: async () => undefined }));
vi.mock('../../src/core/nodes/discovery', () => ({ discoverNode: async () => ({ pricePerGb: '1000', pricePerHour: '1000', country: 'US' }) }));
vi.mock('../../src/main/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/main/services/history', () => ({ recordStart: vi.fn(), recordEnd: vi.fn() }));
vi.mock('../../src/main/services/settlement', () => ({ claimForReuse: () => true, settleChannelSoon: vi.fn(), settlesOnEnd: () => true, readSettlements: async () => [] }));
vi.mock('../../src/main/system/proxy', () => ({ setSystemProxy: vi.fn(), clearSystemProxy: async () => undefined }));
vi.mock('../../src/main/system/tunnels', () => ({ leftoverTunnels: async () => [], rivalVpns: async () => [], removeTunnelServices: async () => undefined }));
vi.mock('../../src/main/system/dns-check', () => ({ dnsReallyLeftOver: async () => false, flushDnsCache: vi.fn() }));
vi.mock('../../src/core/chain/rpc', () => ({ getRpcUrls: () => [], resetRpcTransport: vi.fn(), onRpcRetry: () => () => undefined, overLimitState: () => ({ inUse: 'private' }) }));
vi.mock('../../src/main/daemon/settings', () => ({ getDaemonSettings: () => ({ settings: { killSwitch: 'off', dnsServers: [] } }), serviceUsesTun: () => false, splitForSession: vi.fn() }));
vi.mock('../../src/main/services/stop-session', () => ({ stopLiveOrCurrent: async () => ({ session: null, dnsRevertFailed: false }) }));
vi.mock('../../src/main/services/first-data', () => ({ firstData: async () => undefined }));
vi.mock('../../src/main/services/net-settle', () => ({ waitForDirectPath: async () => true }));

const { connect } = await import('../../src/main/services/connection');
const { initStore } = await import('../../src/main/store');
const req = { node: 'NodeA', basis: 'per_gb' as const, units: 1, confirmed: true as const };

/** Every file under the data folder with its bytes (device.json, daemon-staging, daemon-switch). */
function snapshotDir(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = fs.readFileSync(p).toString('base64');
    }
  };
  walk(dir);
  return out;
}

beforeEach(() => {
  st.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddv-e55c-'));
  initStore(st.dir); // device.json is read through the store (main/store.ts)
  fs.writeFileSync(path.join(st.dir, 'device.json'), JSON.stringify({ device: 'D1', home: '/c0', owner: W1, at: 1 }));
  fs.mkdirSync(path.join(st.dir, 'daemon-staging'));
  fs.writeFileSync(path.join(st.dir, 'daemon-staging', 'config.toml'), 'kill_switch = "off"\n');
  st.kind = 'keyfile'; st.lamports = 10_000_000;
  st.state = { session: null, conn: { phase: 'idle' }, lastConnectError: null };
});

describe('connect() with a second wallet short of SOL (rc.3: device.json rewritten)', () => {
  it('key-file wallet, plain connect: wallet-switch-needed, the data folder byte-identical', async () => {
    const before = snapshotDir(st.dir);
    const r = await connect(req);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('wallet-switch-needed');
    expect(r.error).toMatch(/Nothing was paid/);
    expect(snapshotDir(st.dir)).toEqual(before);
    expect(fs.existsSync(path.join(st.dir, 'daemon-switch'))).toBe(false);
  });

  it('app wallet, the user said yes to the switch: refused on SOL first, the data folder byte-identical', async () => {
    st.kind = 'dpapi';
    const before = snapshotDir(st.dir);
    const r = await connect({ ...req, confirmWalletSwitch: true });
    expect(r.code).toBe('device-sol');
    expect(r.error).toMatch(/Add devnet SOL/);
    expect(snapshotDir(st.dir)).toEqual(before);
  });

  it('negative control: with enough SOL the confirmed switch does go on to stage a key (and only then writes)', async () => {
    st.kind = 'dpapi'; st.lamports = 1_000_000_000;
    const before = snapshotDir(st.dir);
    const r = await connect({ ...req, confirmWalletSwitch: true });
    expect(r.ok).toBe(false); // the fake service binary is missing, so staging refuses: it was reached
    expect(r.error).toMatch(/VPN service is missing from this install|Could not set up/);
    expect(JSON.parse(fs.readFileSync(path.join(st.dir, 'device.json'), 'utf8')).owner).toBe(W1);
    expect(snapshotDir(st.dir)).toEqual(before);
  });
});
