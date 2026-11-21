// ─── Gap #95: remove another device and settle its deposits ───
// A computer that is gone (key lost) left a grant and deposits stuck in "closing" (Phase 8,
// 2026-10-24). The owner can now remove it and settle its deposits, but only once it can no longer
// spend: closing the deposits of a device that may be live elsewhere could cut its session.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Real on-curve addresses: the device check parses them (isWalletAddress needs a key on the curve).
const { OWNER, MINE, LOST } = vi.hoisted(() => ({
  OWNER: '7agSTgUnxYSim28TWXQ12mPy2XE8xrAuEKUHhYMSdvLL',
  MINE: '7DTn37iX1DSZj84sqY8iFcXm2whGASuzRsVdFEYeMdab',
  LOST: '9enW4xCJrmytnEC6VsJYPbcT2ng3QTUwUkAHSrKR9Xrj',
}));

const s = vi.hoisted(() => ({
  grants: new Map<string, unknown>(),
  rows: [] as Array<Record<string, unknown>>,
  sent: [] as string[],
  revoked: [] as string[],
  failSend: false,
  grantsFail: false,
}));
vi.mock('../../src/core/chain/accounts', () => ({
  channelsByOwner: async () => s.rows,
  userByOwner: async () => null,
}));
vi.mock('../../src/core/chain/program', () => ({ fetchConfig: async () => ({ channelCloseGraceSeconds: 7200 }) }));
vi.mock('../../src/core/chain/builders', () => ({
  startCloseChannel: async ({ channel }: { channel: string }) => `start:${channel}`,
  closeChannel: async ({ ch }: { ch: { address: string } }) => `close:${ch.address}`,
  withdrawUserBalance: vi.fn(),
}));
vi.mock('../../src/core/app/signer', () => ({ signAndSend: async (_s: unknown, ixs: string[]) => { if (s.failSend) throw new Error('simulation failed: blockhash not found'); s.sent.push(...ixs); return { signature: `sig-${s.sent.length}` }; } }));
vi.mock('../../src/core/app/wallet-status', () => ({
  readWalletStatus: async (_owner: string, device: string) => { if (s.grantsFail) throw new Error('429'); return { grant: s.grants.get(device) ?? null }; },
  lowFundsWarnings: () => [],
}));
vi.mock('../../src/core/app/device-setup', () => ({
  planDeviceSetup: vi.fn(), runDeviceSetup: vi.fn(),
  autoSetupDecision: () => 'off', needsPermission: () => false,
  revokeDevice: async (_signer: unknown, device: string) => { s.revoked.push(device); s.grants.delete(device); return 'revoke-sig'; },
}));
vi.mock('../../src/main/wallet/vault', () => ({ ownerAddress: () => OWNER, ownerKeypair: () => null, ownerSigner: () => ({}) }));
vi.mock('../../src/main/system/settings', () => ({ getSettings: () => ({ autoDevicePermission: true, allowanceTdvpn: '50' }), updateSettings: vi.fn() }));
vi.mock('../../src/main/daemon/manager', () => ({
  daemon: () => ({ listSessions: async () => [], listChannels: async () => [] }),
  daemonInfo: () => ({ reachable: true, device: MINE }),
  startServiceIfStopped: vi.fn(),
}));
vi.mock('../../src/main/app-state', () => ({ patch: vi.fn(), snapshot: () => ({ session: null }), toast: vi.fn() }));
vi.mock('../../src/main/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { readSettlements, runSettlement, claimForReuse } = await import('../../src/main/services/settlement');
const { revokeOtherDevice } = await import('../../src/main/services/wallet');

const chan = (address: string, opener: string, status: number, closeStartedAt = '0') =>
  ({ address, owner: OWNER, node: 'N', opener, mode: 0, status, escrow: '1000', redeemed: '0', closeStartedAt, rentPayer: opener });

beforeEach(() => {
  s.grants = new Map([[MINE, { allowance: '1' }], [LOST, { allowance: '1' }]]);
  s.rows = [chan('mine-open', MINE, 0), chan('lost-open', LOST, 0), chan('lost-ready', LOST, 1, '1')];
  s.sent = [];
  s.revoked = [];
  s.grantsFail = false;
});

describe('rc.3.1 F1: another device\'s deposit is never reused or auto-refunded here', () => {
  const row = (device?: string) => ({ channel: 'c1', node: 'N', mode: 0, escrow: '1000', redeemed: '0', status: 'open' as const, readyAt: null, refundable: '900', ...(device ? { device } : {}) });
  const node = { address: 'N', pricePerGb: '1', pricePerHour: '1' };
  it('openDepositFor offers this computer\'s open deposit, never another device\'s', async () => {
    const { openDepositFor, closingDepositFor } = await import('../../src/core/session/open-deposit');
    expect(openDepositFor([row()], node)?.channel).toBe('c1');
    expect(openDepositFor([row(LOST)], node)).toBeNull();
    expect(closingDepositFor([{ ...row(LOST), status: 'closing' }], node)).toBeNull();
  });
  it('autoRefundIdle drops rows that carry a device before choosing', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('src/main/services/settlement.ts', 'utf8')).toContain('(snapshot().settlements ?? []).filter((x) => !x.device)');
  });
});

describe('settle another device (gap #95)', () => {
  // rc.3.1 F1: a wallet switch there and back left the first wallet's deposits of its replaced device out of
  // `settle list`, and `--device` refused "revoke first" (Windows proof VM, b15c05f, 2026-11-16 05:00Z).
  it('without --device every device\'s deposits are listed, another device\'s rows carry its address', async () => {
    const l = await readSettlements();
    expect(l.map((p) => `${p.channel}:${p.status}:${p.device ?? '-'}:${p.unverified ? 'u' : '-'}`))
      .toEqual(['mine-open:open:-:-', `lost-open:open:${LOST}:u`, `lost-ready:ready:${LOST}:-`]);
  });
  it('while the other device can still spend: its ready deposit settles, its open one only when named', async () => {
    const l = await readSettlements(LOST);
    expect(l.map((p) => `${p.channel}:${p.unverified ? 'u' : '-'}`)).toEqual(['lost-open:u', 'lost-ready:-']);
    expect((await runSettlement(undefined, LOST)).ok).toBe(true);
    expect(s.sent).toEqual(['close:lost-ready']);
    s.sent = [];
    expect((await runSettlement(['lost-open'], LOST)).ok).toBe(true);
    expect(s.sent).toEqual(['start:lost-open']);
  });
  it('plain settle run never starts another device\'s open deposit while it can spend', async () => {
    expect((await runSettlement()).ok).toBe(true);
    expect(s.sent).toEqual(['start:mine-open', 'close:lost-ready']);
  });
  it('a device whose permission is gone: its open deposit settles with plain settle run', async () => {
    s.grants.delete(LOST);
    expect((await readSettlements()).find((p) => p.channel === 'lost-open')?.unverified).toBeUndefined();
    expect((await runSettlement()).ok).toBe(true);
    expect(s.sent).toEqual(['start:mine-open', 'start:lost-open', 'close:lost-ready']);
  });
  it('a failed permission read counts as "can still spend"', async () => {
    s.grantsFail = true;
    expect((await readSettlements()).find((p) => p.channel === 'lost-open')?.unverified).toBe(true);
  });
  it('refuses this computer\'s own device as "another" device', async () => {
    await expect(readSettlements(MINE)).rejects.toThrow(/this computer/);
  });
  it('after removal: only that device\'s deposits, start_close for open, close for ready', async () => {
    s.grants.delete(LOST);
    expect((await readSettlements(LOST)).map((p) => `${p.channel}:${p.status}`)).toEqual(['lost-open:open', 'lost-ready:ready']);
    const r = await runSettlement(undefined, LOST);
    expect(r.ok).toBe(true);
    expect(s.sent).toEqual(['start:lost-open', 'close:lost-ready']);
  });
});

describe('CODE-AUDIT U-33: a refund started by settle run is never reused by a Connect in this process', () => {
  it('after the start: claimForReuse refuses that deposit', async () => {
    s.rows = [chan('mine-open', MINE, 0)];
    expect((await runSettlement(['mine-open'])).ok).toBe(true);
    expect(s.sent).toEqual(['start:mine-open']);
    expect(claimForReuse('mine-open')).toBe(false);
  });
  it('negative control: a start that did not go through leaves the deposit usable', async () => {
    s.rows = [chan('mine-open2', MINE, 0)];
    s.failSend = true;
    expect((await runSettlement(['mine-open2'])).ok).toBe(false);
    s.failSend = false;
    expect(claimForReuse('mine-open2')).toBe(true);
  });
});

describe('remove another device (gap #95)', () => {
  it('rejects a bad address and this computer\'s own device', async () => {
    expect((await revokeOtherDevice('not-an-address')).code).toBe('bad-device');
    expect((await revokeOtherDevice(MINE)).code).toBe('own-device');
    expect(s.revoked).toEqual([]);
  });
  it('removes the named device', async () => {
    const r = await revokeOtherDevice(LOST);
    expect(r).toMatchObject({ ok: true, data: 'revoke-sig' });
    expect(s.revoked).toEqual([LOST]);
  });
});
