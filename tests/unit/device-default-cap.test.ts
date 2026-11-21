// ─── W91 (the agent kit rc.9, review rc.8 live): device setup with no --allowance agrees with agent up (never refused) ───
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({ grant: null as null | { allowance: string }, own: '0', setup: [] as string[] }));
vi.mock('../../src/main/wallet/vault', async (orig) => ({ ...(await orig<object>()), ownerAddress: () => 'Owner1' }));
vi.mock('../../src/main/services/wallet', async (orig) => ({
  ...(await orig<object>()),
  deviceSetupPlan: async () => ({ ok: true, data: { steps: ['step'], topUpLamports: 0, approveTo: null } }),
  deviceSetup: async (allowance: string) => { st.setup.push(allowance); return { ok: true, data: 'SigDev' }; },
  refreshWallet: async () => ({ ownerTdvpn: st.own, grant: st.grant }),
}));
vi.mock('../../src/main/daemon/manager', async (orig) => ({
  ...(await orig<object>()),
  daemonInfo: () => ({ device: 'Dev1', version: '1', reachable: true }),
  startServiceIfStopped: async () => 'running',
}));

const { COMMANDS } = await import('../../src/cli/commands');
const { parseArgs } = await import('../../src/cli/args');
const { getSettings } = await import('../../src/main/system/settings');
const { toBaseUnits, tdvpn } = await import('../../src/core/chain/amounts');

const run = async (line: string): Promise<string> => {
  let human = '';
  const [cmd] = line.split(' ');
  await COMMANDS[cmd].run(parseArgs(line.split(' ')), { json: false, print: (h: string) => { human = h; } });
  return human;
};
const setting = (): bigint => BigInt(toBaseUnits(getSettings().allowanceTdvpn));

beforeEach(() => { st.grant = null; st.setup = []; });

describe('W91: the default limit on a wallet that holds less than the Settings limit', () => {
  it('review shape: wallet below the Settings limit, no --allowance: setup runs at the wallet amount, plan warns', async () => {
    st.own = (setting() * 2n / 3n).toString(); // 100 against 150
    await run('device setup --yes');
    expect(st.setup).toEqual([tdvpn(st.own)]);
    expect(await run('device plan')).toMatch(/Warning: No --allowance: the spending limit is this wallet's .* below the Settings limit/);
  });
  it('an explicit --allowance above the wallet is still refused (W-A3), nothing signed', async () => {
    st.own = '1000000';
    await expect(run('device setup --allowance 5 --yes')).rejects.toMatchObject({ code: 'allowance-above-balance' });
    expect(st.setup).toEqual([]);
  });
  it('an existing limit is kept (LIM-2) even above the wallet: no cap, no refusal', async () => {
    st.own = '1000000'; st.grant = { allowance: '150005000' };
    await run('device setup --yes');
    expect(st.setup).toEqual(['150.005']);
  });
  it('a 0 tDVPN wallet: the Settings limit with a warning, never a refusal', async () => {
    st.own = '0';
    expect(await run('device plan')).toMatch(/Warning: This wallet holds 0 tDVPN/);
    await run('device setup --yes');
    expect(st.setup).toEqual([getSettings().allowanceTdvpn]);
  });
  it('negative control: a wallet at or above the Settings limit: the Settings limit, no warning', async () => {
    st.own = (setting() * 2n).toString();
    expect(await run('device plan')).not.toMatch(/Warning/);
    await run('device setup --yes');
    expect(st.setup).toEqual([getSettings().allowanceTdvpn]);
  });
});
