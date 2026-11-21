// ─── LIM-2 (the agent kit rc.9, T-A 5): device plan/setup without --allowance keep this computer's current limit ───
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({ grant: null as null | { allowance: string }, planned: [] as string[], setup: [] as string[] }));
vi.mock('../../src/main/wallet/vault', async (orig) => ({ ...(await orig<object>()), ownerAddress: () => 'Owner1' }));
vi.mock('../../src/main/services/wallet', async (orig) => ({
  ...(await orig<object>()),
  deviceSetupPlan: async (allowance: string) => { st.planned.push(allowance); return { ok: true, data: { steps: ['step'], topUpLamports: 0, approveTo: null } }; },
  deviceSetup: async (allowance: string) => { st.setup.push(allowance); return { ok: true, data: 'SigDev' }; },
  refreshWallet: async () => ({ ownerTdvpn: '1000000000000', grant: st.grant }),
}));
vi.mock('../../src/main/daemon/manager', async (orig) => ({
  ...(await orig<object>()),
  daemonInfo: () => ({ device: 'Dev1', version: '1', reachable: true }),
  startServiceIfStopped: async () => 'running',
}));

const { COMMANDS } = await import('../../src/cli/commands');
const { parseArgs } = await import('../../src/cli/args');
const { getSettings } = await import('../../src/main/system/settings');

const run = async (line: string): Promise<void> => {
  const [cmd] = line.split(' ');
  await COMMANDS[cmd].run(parseArgs(line.split(' ')), { json: false, print: () => undefined });
};

beforeEach(() => { st.grant = null; st.planned = []; st.setup = []; });

describe('LIM-2: device plan/setup keep the current limit', () => {
  it('T-A shape: a limit of 150.005 and no --allowance: plan and setup keep 150.005 (not the Settings amount)', async () => {
    st.grant = { allowance: '150005000' };
    await run('device plan');
    await run('device setup --yes');
    expect(st.planned).toEqual(['150.005', '150.005']);
    expect(st.setup).toEqual(['150.005']);
  });
  it('--allowance N still sets N', async () => {
    st.grant = { allowance: '150005000' };
    await run('device setup --allowance 20 --yes');
    expect(st.setup).toEqual(['20']);
  });
  it('negative control: a first setup (no grant yet) uses the Settings amount, as before', async () => {
    await run('device setup --yes');
    expect(st.setup).toEqual([getSettings().allowanceTdvpn]);
  });
});
