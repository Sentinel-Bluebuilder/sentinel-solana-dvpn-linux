// ─── LIM-2 (the agent kit rc.9, T-A 15): the shared approval is SET to the limit, never added on top of what is left ───
import { describe, it, expect, vi } from 'vitest';
import type { WalletStatus } from '../../src/core/app/wallet-status';
import { PERMS_CLIENT } from '../../src/core/chain/idl';

const OWNER = '9FNRPcj2TMFnNkxWdTtBM2PfhBLx3nU8jNJTx3zx8Bh3';
const DEVICE = '6EeUQV6ihNDFyfRdr1QhjdEnvDXAfncTPp5uouSvJ2wn';

vi.mock('../../src/core/chain/builders', () => ({
  approveDelegate: () => 'approve',
  openGrant: async () => 'grant',
  updateGrant: async () => 'update',
  closeGrant: async () => 'close',
}));
vi.mock('../../src/core/app/wallet-status', () => ({ readWalletStatus: async () => null }));
vi.mock('../../src/core/app/signer', () => ({ signAndSend: async () => ({ signature: 'sig' }) }));

const { planDeviceSetup } = await import('../../src/core/app/device-setup');

const st = (delegated: string, grant: string | null): WalletStatus => ({
  ownerLamports: 10_000_000_000, deviceLamports: 10_000_000_000, delegated, ownerAta: true, device: DEVICE,
  grant: grant === null ? null : { allowance: grant, permissions: PERMS_CLIENT },
} as unknown as WalletStatus);

describe('LIM-2: device setup approves exactly the limit', () => {
  it('T-A live shape: 149.997 still approved, limit 150 → 300: approved to 300, not 299.997', async () => {
    const p = await planDeviceSetup(OWNER, DEVICE, '300000000', st('149997000', '150000000'));
    expect(p.approveTo).toBe('300000000');
    expect(p.steps[0]).toMatch(/up to 300 tDVPN/);
  });
  it('a small raise (150 → 150.005) with 150 approved: approved to 150.005, the limit itself', async () => {
    expect((await planDeviceSetup(OWNER, DEVICE, '150005000', st('150000000', '150000000'))).approveTo).toBe('150005000');
  });
  it('already approved at or above the limit: no approve step (never raised, never lowered here)', async () => {
    const p = await planDeviceSetup(OWNER, DEVICE, '150010000', st('299997000', '150005000'));
    expect(p.approveTo).toBeNull();
    expect(p.steps.join('\n')).not.toMatch(/Approve/);
    expect(p.steps.join('\n')).toMatch(/from 150\.005 to 150\.01 tDVPN/);
  });
  it('negative control: a fresh wallet (0 approved, no grant) is approved to the limit, as before', async () => {
    expect((await planDeviceSetup(OWNER, DEVICE, '50000000', st('0', null))).approveTo).toBe('50000000');
  });
});
