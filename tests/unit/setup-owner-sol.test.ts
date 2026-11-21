// Q0484 H2 (Mac, fresh wallet funded 0.05 SOL + 70 tDVPN): `device plan` offered "Send this device
// 0.05 SOL" and `device setup` then failed as a bare "Not enough SOL" from the chain. The plan now
// carries the shortfall and setup refuses before signing, in the words the first-connect setup uses.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WalletStatus } from '../../src/core/app/wallet-status';
import { PERMS_CLIENT } from '../../src/core/chain/idl';

const OWNER = '9FNRPcj2TMFnNkxWdTtBM2PfhBLx3nU8jNJTx3zx8Bh3';
const DEVICE = '6EeUQV6ihNDFyfRdr1QhjdEnvDXAfncTPp5uouSvJ2wn';
const s = vi.hoisted(() => ({ status: null as unknown, sent: 0 }));

vi.mock('../../src/core/chain/builders', () => ({
  approveDelegate: () => 'approve',
  openGrant: async () => 'grant',
  updateGrant: async () => 'update',
  closeGrant: async () => 'close',
}));
vi.mock('../../src/core/app/wallet-status', () => ({ readWalletStatus: async () => s.status }));
vi.mock('../../src/core/app/signer', () => ({ signAndSend: async () => { s.sent += 1; return { signature: 'sig' }; } }));

const { planDeviceSetup, runDeviceSetup, ownerSolShortMessage } = await import('../../src/core/app/device-setup');

const fresh = (ownerLamports: number): WalletStatus => ({
  ownerLamports, deviceLamports: 0, delegated: '0', grant: null, ownerAta: true, device: DEVICE,
} as unknown as WalletStatus);
const signer = { publicKey: { toBase58: () => OWNER } } as never;

beforeEach(() => { s.sent = 0; });

describe('device setup checks the owner SOL before signing (Q0484 H2)', () => {
  it('a fresh wallet with 0.05 SOL: the plan names the shortfall and setup signs nothing', async () => {
    const p = await planDeviceSetup(OWNER, DEVICE, '50000000', fresh(50_000_000));
    expect(p.topUpLamports).toBe(50_000_000);
    expect(p.ownerNeedLamports).toBe(60_000_000);
    expect(p.ownerShortLamports).toBe(10_000_000);
    s.status = fresh(50_000_000);
    await expect(runDeviceSetup(signer, DEVICE, '50000000')).rejects.toThrow(ownerSolShortMessage(60_000_000));
    expect(s.sent).toBe(0);
    expect(ownerSolShortMessage(60_000_000)).toMatch(/about 0\.060 SOL/);
  });

  it('negative control: with enough SOL it signs, and an already set-up device needs nothing', async () => {
    s.status = fresh(70_000_000);
    const r = await runDeviceSetup(signer, DEVICE, '50000000');
    expect(r.plan.ownerShortLamports).toBe(0);
    expect(s.sent).toBe(1);
    const done = { ...fresh(0), deviceLamports: 50_000_000, delegated: '50000000', grant: { allowance: '50000000', permissions: PERMS_CLIENT } } as unknown as WalletStatus;
    const p = await planDeviceSetup(OWNER, DEVICE, '50000000', done);
    expect(p.ixs.length).toBe(0);
    expect(p.ownerShortLamports).toBe(0);
  });
});
