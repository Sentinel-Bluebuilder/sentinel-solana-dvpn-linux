// ─── Blind round 2 (no-context agent, public rc2): settle run says what is left, nodes list --limit, no-service note ───
import { describe, it, expect, vi } from 'vitest';

const st = vi.hoisted(() => ({ closing: [] as unknown[], svc: 'running' as string }));
const node = (address: string, gb: string) => ({ address, countryCode: 'DE', pricePerGb: gb, pricePerHour: '0', protocolNames: ['wireguard'], probe: { ok: true }, listingFresh: true });
vi.mock('../../src/main/wallet/vault', async (orig) => ({ ...(await orig<object>()), ownerAddress: () => 'Owner1' }));
vi.mock('../../src/main/services/settlement', async (orig) => ({
  ...(await orig<object>()),
  readSettlements: async () => st.closing,
  runSettlement: async () => ({ ok: true, data: ['SigA'] }),
}));
vi.mock('../../src/main/services/wallet', async (orig) => ({
  ...(await orig<object>()),
  deviceSetupPlan: async () => ({ ok: true, data: { steps: ['approve 1 tDVPN'], topUpLamports: 0, approveTo: null } }),
  deviceSetup: async () => ({ ok: true, data: 'SigDev' }),
  refreshWallet: async () => null, // W-A3 (rc.8): device plan/setup reads the balance first
}));
vi.mock('../../src/main/daemon/manager', async (orig) => ({
  ...(await orig<object>()),
  daemonInfo: () => ({ device: 'Dev1', version: '1' }),
  startServiceIfStopped: async () => st.svc,
}));
vi.mock('../../src/main/services/nodes', async (orig) => ({
  ...(await orig<object>()),
  refreshNodes: async () => undefined,
  nodeViews: () => [node('C', '3000'), node('A', '1000'), node('B', '2000')],
}));

const { COMMANDS, NO_SERVICE_NOTE } = await import('../../src/cli/commands');
const { parseArgs } = await import('../../src/cli/args');

const run = async (line: string): Promise<{ human: string; data: Record<string, unknown> & unknown[] }> => {
  let out = { human: '', data: undefined as unknown };
  const [cmd] = line.split(' ');
  await COMMANDS[cmd].run(parseArgs(line.split(' ')), { json: false, print: (human: string, data?: unknown) => { out = { human, data }; } });
  return out as never;
};

describe('blind round 2', () => {
  it('(a) settle run names what is still closing, its time left and the next command', async () => {
    st.closing = [{ channel: 'ChanX', status: 'closing', refundable: '1500000', readyAt: Date.now() / 1000 + 3600 }, { channel: 'ChanDone', status: 'ready', refundable: '1', readyAt: null }];
    const { human, data } = await run('settle run --yes');
    const lines = human.split('\n');
    expect(lines[0]).toBe('Done. Transactions (1): SigA.');
    expect(lines[1]).toMatch(/^Still closing: ChanX, refundable 1\.5 tDVPN, ready in .+\.$/);
    expect(lines[2]).toBe('Next: run "settle run --yes" again once it is ready; it closes it and moves the refund to your wallet. "settle list" shows the time left.');
    expect(lines).toHaveLength(3); // the ready one is not "still closing"
    expect(data.signatures).toEqual(['SigA']);
    expect(data.stillClosing).toEqual([{ channel: 'ChanX', refundable: '1500000', readyAt: (st.closing[0] as { readyAt: number }).readyAt }]);
  });
  it('(a) negative control: nothing closing prints the head only; next = wallet show (R2: one runnable next on every answer)', async () => {
    st.closing = [];
    const { human, data } = await run('settle run --yes');
    expect(human).toBe('Done. Transactions (1): SigA.');
    expect(data.next).toBe('devnet-dvpn wallet show --json');
  });
  it('(b) nodes list --limit N keeps the first N after the sort; without it, all', async () => {
    expect(((await run('nodes list --no-probe --sort price --limit 2')).data as unknown as { address: string }[]).map((n) => n.address)).toEqual(['A', 'B']);
    expect((await run('nodes list --no-probe')).data).toHaveLength(3);
  });
  it('(b) a bad --limit is a usage error', async () => {
    for (const bad of ['0', '-1', '1.5', 'x']) await expect(run(`nodes list --no-probe --limit ${bad}`)).rejects.toThrow(/--limit N/);
  });
  it('(d) device setup before daemon install says what to run; another state adds no note', async () => {
    st.svc = 'no-service';
    const r = await run('device setup --yes');
    expect(r.human).toBe(`Device ready. Transaction: SigDev.\n${NO_SERVICE_NOTE}`);
    expect(r.data).toMatchObject({ service: 'no-service', serviceNote: NO_SERVICE_NOTE });
    st.svc = 'running';
    const ok = await run('device setup --yes');
    expect(ok.human).toBe('Device ready. Transaction: SigDev.');
    expect(ok.data).not.toHaveProperty('serviceNote');
  });
});
