// ─── LIM-4 (the agent kit rc.9, T-A): device plan/setup carry the agent's own --max-price into their next ───
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/main/wallet/vault', async (orig) => ({ ...(await orig<object>()), ownerAddress: () => 'Owner1' }));
vi.mock('../../src/main/services/wallet', async (orig) => ({
  ...(await orig<object>()),
  deviceSetupPlan: async () => ({ ok: true, data: { steps: ['step'], topUpLamports: 0, approveTo: null } }),
  deviceSetup: async () => ({ ok: true, data: 'SigDev' }),
  refreshWallet: async () => ({ ownerTdvpn: '1000000000000', grant: null }),
}));
vi.mock('../../src/main/daemon/manager', async (orig) => ({
  ...(await orig<object>()),
  daemonInfo: () => ({ device: 'Dev1', version: '1', reachable: true }),
  startServiceIfStopped: async () => 'running',
}));

const { COMMANDS } = await import('../../src/cli/commands');
const { parseArgs } = await import('../../src/cli/args');

const run = async (line: string): Promise<Record<string, unknown>> => {
  let data: unknown;
  const [cmd] = line.split(' ');
  await COMMANDS[cmd].run(parseArgs(line.split(' ')), { json: true, print: (_h: string, d?: unknown) => { data = d; } });
  return data as Record<string, unknown>;
};

describe('LIM-4: the next keeps --max-price', () => {
  it('device setup --max-price 0.01: next = agent up --max-price 0.01 --yes', async () => {
    expect((await run('device setup --allowance 5 --max-price 0.01 --yes')).next).toBe('devnet-dvpn agent up --max-price 0.01 --yes');
  });
  it('device plan --max-price 0.01: next = device setup with the same --max-price', async () => {
    expect((await run('device plan --allowance 5 --max-price 0.01')).next).toBe('devnet-dvpn device setup --allowance 5 --max-price 0.01 --yes');
  });
  it('negative control: without --max-price the next is unchanged', async () => {
    expect((await run('device setup --allowance 5 --yes')).next).toBe('devnet-dvpn agent up --yes');
  });
  it('a bad --max-price is a usage error', async () => {
    await expect(run('device setup --allowance 5 --max-price abc --yes')).rejects.toThrow(/--max-price needs a number/);
  });
});
