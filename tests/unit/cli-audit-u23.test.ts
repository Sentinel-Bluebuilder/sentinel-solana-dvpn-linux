// ─── CODE-AUDIT U-23..U-25 (CLI half): the deposit shown is the most paid; bad amounts refused before --yes ───
// U-23: `connect` and `agent up` called connect() without shownEscrow, so connection.ts's price-raised refusal
// ('price-changed', nothing paid) never applied to the CLI. U-24/U-25: Number() let "1e3" / "0x10" past the
// free checks, and send() / fundChannel() refused them only after --yes.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({ connect: [] as Record<string, unknown>[], send: 0, fund: 0, sub: [] as unknown[], order: [] as string[] }));

vi.mock('../../src/main/services/connection', async (orig) => ({
  ...(await orig<object>()),
  adoptRunningSession: async () => undefined,
  connect: async (req: Record<string, unknown>) => { st.connect.push(req); st.order.push('connect'); return { ok: true, data: { id: 'S1', node: 'NodeA', service: 'wireguard', proxyEndpoint: '', channel: 'Ch1', spent: '0', rxBytes: 0, txBytes: 0 } }; },
}));
vi.mock('../../src/main/system/tunnels', async (orig) => ({ ...(await orig<object>()), rivalVpns: async () => [] }));
vi.mock('../../src/core/nodes/discovery', async (orig) => ({ ...(await orig<object>()), discoverNode: async () => ({ address: 'NodeA' }) }));
vi.mock('../../src/core/pricing/cost', async (orig) => ({ ...(await orig<object>()), costPreview: () => ({ escrow: '2000000', escrowText: '2 tDVPN' }) }));
vi.mock('../../src/main/services/wallet', async (orig) => ({ ...(await orig<object>()), send: async () => { st.send++; return { ok: true, data: 'Sig' }; }, refreshWallet: async () => { st.order.push('wallet'); return null; } }));
vi.mock('../../src/main/services/activity', async (orig) => ({ ...(await orig<object>()), fundChannel: async () => { st.fund++; return { ok: true, data: 'Sig' }; } }));
vi.mock('../../src/main/services/plans', async (orig) => ({ ...(await orig<object>()), refreshPlans: async () => [{ address: 'Plan1', price: '5000000' }], subscribe: async (req: unknown) => { st.sub.push(req); return { ok: true, data: { subscription: 'Sub1', signature: 'Sig' } }; } }));
vi.mock('../../src/main/services/agent-marker', () => ({ writeAgentMarker: () => undefined, clearAgentMarker: () => undefined }));
// E-27: connect names the wallet that paid against the loaded one.
vi.mock('../../src/main/wallet/vault', async (orig) => ({ ...(await orig<object>()), ownerAddress: () => 'Own1' }));

const { COMMANDS } = await import('../../src/cli/commands');
const { parseArgs, UsageError } = await import('../../src/cli/args');

const run = async (line: string): Promise<unknown> => {
  const a = parseArgs(line.split(' '));
  try {
    await COMMANDS[a._[0]].run(a, { json: true, print: () => undefined });
    return null;
  } catch (err) {
    return err;
  }
};

beforeEach(() => { st.connect = []; st.send = 0; st.fund = 0; st.sub = []; st.order = []; });

describe('E-1: connect reads the wallet before connect()', () => {
  it('a fresh CLI process (snapshot wallet null): refreshWallet runs first, so the limit raise is decided on real balances', async () => {
    expect(await run('connect NodeA --yes')).toBeNull();
    expect(st.order).toEqual(['wallet', 'connect']);
  });
  it('the shortfall refusal names a command, not "Wallet → Device"', async () => {
    const { cliActionHint } = await import('../../src/cli/action-hint');
    for (const m of ['Your spending approval is lower than this deposit. Raise it in Wallet → Device.', "This device's spending limit is lower than this deposit. Raise it in Wallet → Device."]) {
      expect(cliActionHint('Open Wallet', m)).toBe('devnet-dvpn device setup --allowance <N> --yes (N = grant.allowance from "devnet-dvpn device show --json" divided by 1000000, plus the deposit, in tDVPN), then connect again');
    }
    expect(cliActionHint('Open Wallet', 'Something else.')).toBe('devnet-dvpn wallet show'); // negative control
  });
});

describe('U-23: connect passes the deposit it showed', () => {
  it('connect <node> --yes: the request carries shownEscrow = the preview', async () => {
    expect(await run('connect NodeA --yes')).toBeNull();
    expect(st.connect).toHaveLength(1);
    expect(st.connect[0].shownEscrow).toBe('2000000');
  });
});

describe('U-24/U-25: amounts refused before --yes', () => {
  for (const bad of ['1e3', '0x10']) {
    it(`wallet send --tdvpn ${bad}: usage error, nothing sent`, async () => {
      const e = await run(`wallet send --to 11111111111111111111111111111111 --tdvpn ${bad}`);
      expect(e).toBeInstanceOf(UsageError);
      expect((e as Error).message).toMatch(/is not a tDVPN amount/);
      expect(st.send).toBe(0);
    });
    it(`channels fund --tdvpn ${bad}: usage error, nothing paid`, async () => {
      const e = await run(`channels fund Ch1 --tdvpn ${bad}`);
      expect(e).toBeInstanceOf(UsageError);
      expect(st.fund).toBe(0);
    });
  }
  it('wallet send --sol 1e3: usage error', async () => {
    expect(await run('wallet send --to 11111111111111111111111111111111 --sol 1e3')).toBeInstanceOf(UsageError);
  });
  it('negative control: a plain amount still reaches the --yes prompt (not a usage error)', async () => {
    const e = await run('channels fund Ch1 --tdvpn 2.5');
    expect(e).not.toBeInstanceOf(UsageError);
    expect(st.fund).toBe(0); // no --yes: asked, not paid
  });
});

describe('E11 (CLI half): plans subscribe passes the price it printed', () => {
  it('the request carries shownPrice = the plan price', async () => {
    expect(await run('plans subscribe Plan1 --yes')).toBeNull();
    expect(st.sub).toEqual([{ plan: 'Plan1', confirmed: true, shownPrice: '5000000' }]);
  });
});

describe('E-21 (money): connect with an empty --plan', () => {
  for (const line of ['connect NodeA --plan --yes', 'connect NodeA --plan= --yes', 'connect NodeA --yes --plan']) {
    it(`${line}: usage error, nothing paid`, async () => {
      const e = await run(line);
      expect(e).toBeInstanceOf(UsageError);
      expect((e as Error).message).toMatch(/--plan needs a value/);
      expect(st.connect).toEqual([]);
    });
  }
  it('negative control: no --plan at all still connects with a deposit', async () => {
    expect(await run('connect NodeA --yes')).toBeNull();
    expect(st.connect).toHaveLength(1);
  });
});

describe('W-A2 (rc.8): wallet send refuses before the preview', () => {
  it('--tdvpn 0: "amount must be more than 0", nothing sent', async () => {
    const e = await run('wallet send --to SysvarRent111111111111111111111111111111111 --tdvpn 0');
    expect(e).toBeInstanceOf(UsageError);
    expect((e as Error).message).toMatch(/amount must be more than 0/);
    expect(st.send).toBe(0);
  });
  it('to the system program: bad-recipient before any balance read, nothing sent', async () => {
    const e = await run('wallet send --to 11111111111111111111111111111111 --tdvpn 1');
    expect((e as { code?: string }).code).toBe('bad-recipient');
    expect(st.order).not.toContain('wallet');
    expect(st.send).toBe(0);
  });
});
