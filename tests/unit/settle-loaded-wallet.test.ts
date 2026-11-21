// rc.4 E-17 / E-55 (Windows rc.3 VM 2026-11-16, Linux rc2 review): with device.json naming another wallet,
// `settle list` filtered the loaded wallet's deposits by that other wallet's device and listed none. Now all
// of the loaded wallet's deposits are listed; open ones are marked `unverified` (they may be in use on another
// computer of this wallet) and `settle run` never starts them on its own; closing/ready ones settle as before.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { OWNER, OTHER, MINE, RECORDED } = vi.hoisted(() => ({
  OWNER: '7agSTgUnxYSim28TWXQ12mPy2XE8xrAuEKUHhYMSdvLL',
  OTHER: '9enW4xCJrmytnEC6VsJYPbcT2ng3QTUwUkAHSrKR9Xrj',
  MINE: '7DTn37iX1DSZj84sqY8iFcXm2whGASuzRsVdFEYeMdab',
  RECORDED: 'EnVkxskKRR8xbLWZNcUKqML1rNT22T65skUxYXnAhZ4N',
}));
const s = vi.hoisted(() => ({ recOwner: '', recDevice: '', rows: [] as Array<Record<string, unknown>>, sent: [] as string[], spending: new Set<string>() }));

vi.mock('../../src/core/chain/accounts', () => ({ channelsByOwner: async () => s.rows, userByOwner: async () => null }));
vi.mock('../../src/core/chain/program', () => ({ fetchConfig: async () => ({ channelCloseGraceSeconds: 7200 }) }));
vi.mock('../../src/core/chain/builders', () => ({
  startCloseChannel: async ({ channel }: { channel: string }) => `start:${channel}`,
  closeChannel: async ({ ch }: { ch: { address: string } }) => `close:${ch.address}`,
  withdrawUserBalance: vi.fn(),
}));
vi.mock('../../src/core/app/signer', () => ({ signAndSend: async (_s: unknown, ixs: string[]) => { s.sent.push(...ixs); return { signature: `sig-${s.sent.length}` }; } }));
vi.mock('../../src/core/app/wallet-status', () => ({ readWalletStatus: async (_o: string, d: string) => ({ grant: s.spending.has(d) ? { allowance: '1' } : null }), lowFundsWarnings: () => [] }));
vi.mock('../../src/main/wallet/vault', () => ({ ownerAddress: () => OWNER, ownerKeypair: () => null, ownerSigner: () => ({}), noWallet: () => ({ error: 'no wallet' }) }));
vi.mock('../../src/main/system/settings', () => ({ getSettings: () => ({ autoDevicePermission: true, allowanceTdvpn: '50' }), updateSettings: vi.fn() }));
vi.mock('../../src/main/daemon/manager', () => ({
  daemon: () => ({ listSessions: async () => [], listChannels: async () => [] }),
  daemonInfo: () => ({ reachable: true, device: s.recDevice }),
  deviceRecord: () => ({ device: s.recDevice, owner: s.recOwner, home: '/c0', at: 1 }),
  startServiceIfStopped: vi.fn(),
}));
vi.mock('../../src/main/app-state', () => ({ patch: vi.fn(), snapshot: () => ({ session: null }), toast: vi.fn() }));
vi.mock('../../src/main/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { readSettlements, runSettlement } = await import('../../src/main/services/settlement');

const chan = (address: string, opener: string, status: number, closeStartedAt = '0') =>
  ({ address, owner: OWNER, node: 'N', opener, mode: 0, status, escrow: '1000', redeemed: '0', closeStartedAt, rentPayer: opener });

beforeEach(() => {
  s.rows = [chan('mine-open', MINE, 0), chan('mine-ready', MINE, 1, '1')];
  s.sent = [];
  s.spending = new Set();
});

describe('device.json names another wallet (the E-55 state)', () => {
  // MINE still holds a spending permission: it may be in a session on another computer of this wallet.
  beforeEach(() => { s.recOwner = OTHER; s.recDevice = RECORDED; s.spending = new Set([MINE]); });

  it('settle list still shows the loaded wallet\'s deposits', async () => {
    const list = await readSettlements();
    expect(list.map((p) => p.channel).sort()).toEqual(['mine-open', 'mine-ready']);
  });
  it('the open one is unverified; the ready one is not', async () => {
    const list = await readSettlements();
    expect(list.find((p) => p.channel === 'mine-open')).toMatchObject({ status: 'open', unverified: true });
    expect(list.find((p) => p.channel === 'mine-ready')?.unverified).toBeUndefined();
  });
  it('settle run closes the ready one and does not start the unverified open one', async () => {
    const r = await runSettlement();
    expect(r.ok).toBe(true);
    expect(s.sent).toContain('close:mine-ready');
    expect(s.sent).not.toContain('start:mine-open');
  });
  it('naming it starts it (the user chose it)', async () => {
    await runSettlement(['mine-open']);
    expect(s.sent).toContain('start:mine-open');
  });
});

describe('negative control: device.json is the loaded wallet\'s', () => {
  const ELSE = 'ElseDev11111111111111111111111111111111111';
  beforeEach(() => { s.recOwner = OWNER; s.recDevice = MINE; s.spending = new Set([MINE, ELSE]); s.rows.push(chan('else-open', ELSE, 0)); });
  it('this computer\'s deposits carry no device and are not unverified; its open one starts as before', async () => {
    const list = await readSettlements();
    expect(list.filter((p) => !p.device).map((p) => p.channel).sort()).toEqual(['mine-open', 'mine-ready']);
    expect(list.filter((p) => !p.device).some((p) => p.unverified)).toBe(false);
    await runSettlement();
    expect(s.sent).toContain('start:mine-open');
  });
  it('rc.3.1 F1: another device\'s deposit is listed with its device, unverified while it can spend, not started', async () => {
    const list = await readSettlements();
    expect(list.find((p) => p.channel === 'else-open')).toMatchObject({ device: ELSE, unverified: true });
    await runSettlement();
    expect(s.sent).not.toContain('start:else-open');
  });
});
