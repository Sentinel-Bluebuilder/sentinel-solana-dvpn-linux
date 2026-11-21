// Row 75: the check before paying reads the wallet beside the server lookup and the server check, not after them.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const st = vi.hoisted(() => ({ events: [] as string[], walletFails: false, walletReads: 0 }));
const later = <T,>(ms: number, v: T): Promise<T> => new Promise((r) => setTimeout(() => r(v), ms));

vi.mock('../../src/main/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../src/main/app-state', () => ({ snapshot: () => ({ session: null }), patch: vi.fn() }));
vi.mock('../../src/main/daemon/manager', () => ({ daemon: () => ({}), daemonInfo: () => ({ version: 'x' }), binPath: (n: string) => `/app/bin/${n}` }));
vi.mock('../../src/main/daemon/settings', () => ({ getDaemonSettings: () => ({ settings: { killSwitch: 'off' } }) }));
vi.mock('../../src/main/wallet/vault', () => ({ ownerAddress: () => 'Owner' }));
vi.mock('../../src/main/services/device-topup', () => ({ topUpDeviceIfLow: async () => ({ done: false }) }));
vi.mock('../../src/main/system/drivers', () => ({ amneziawgBlocker: async () => null, driversStatus: async () => ({ supported: true, live: null, installer: null, error: 'not checked here' }), openvpnAdapterMissing: async () => false, recreateOpenvpnAdapter: async () => ({ ok: true }) }));
vi.mock('../../src/core/chain/accounts', () => ({ channelsByOwner: async () => [] }));
vi.mock('../../src/core/plans/plans', () => ({ subscriptionsOf: async () => [] }));
vi.mock('../../src/core/nodes/discovery', () => ({
  discoverNode: async () => { st.events.push('node:start'); await later(40, 0); st.events.push('node:end'); return { pricePerGb: '1000', pricePerHour: '1000', listingFresh: true }; },
  probeNode: async () => { st.events.push('probe:start'); await later(40, 0); st.events.push('probe:end'); return { ok: true, serviceType: 'wireguard' }; },
}));
vi.mock('../../src/core/app/wallet-status', () => ({
  readWalletStatus: async () => {
    st.walletReads += 1; st.events.push('wallet:start'); await later(20, 0); st.events.push('wallet:end');
    if (st.walletFails) throw new Error('rpc down');
    return { ownerTdvpn: '1000000000', userBalance: '0', delegated: '1000000000', grant: { allowance: '1000000000' }, deviceLamports: 10_000_000 };
  },
}));
vi.mock('../../src/core/pricing/cost', () => ({ costPreview: () => ({ available: true, escrow: '1000' }), fundingBlocker: () => null, fundingProblem: () => null }));

const { preflight } = await import('../../src/main/services/connect-checks');
const req = { node: 'NodeA', basis: 'per_gb' as const, units: 1, confirmed: true as const };

describe('the check before paying (row 75)', () => {
  beforeEach(() => { st.events = []; st.walletFails = false; st.walletReads = 0; });

  it('starts the wallet read before the server lookup has answered, and reads it once', async () => {
    expect(await preflight(req, 'Owner', 'Dev')).toBeNull();
    expect(st.events.indexOf('wallet:start')).toBeLessThan(st.events.indexOf('node:end'));
    expect(st.events.indexOf('wallet:end')).toBeLessThan(st.events.indexOf('probe:end'));
    expect(st.walletReads).toBe(1);
  });

  it('a wallet read that fails still stops the connect (thrown where the read used to be), with no unhandled rejection', async () => {
    st.walletFails = true;
    await expect(preflight(req, 'Owner', 'Dev')).rejects.toThrow('rpc down');
  });

  it('negative control: a plan connect never reads the wallet', async () => {
    expect(await preflight({ ...req, subscription: { provider: 'P', subscription: 'S' } }, 'Owner', 'Dev')).toBeNull();
    expect(st.walletReads).toBe(0);
  });
});
