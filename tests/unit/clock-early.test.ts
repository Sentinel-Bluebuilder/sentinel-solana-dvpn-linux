// ─── WIN-W7 + WIN-W8 (the agent kit rc.9, review audit W-7/W-8): the clock is named before the device gate, and in status ───
// review rc.8 edge row 2: the VM clock +10 min. `agent status` was ok with no clock field and `agent up --json`
// answered not-funded (no device in that data dir), so an agent would fund a device before learning of the clock.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clockBlock } from '../../src/cli/clock-gate';

const ck = vi.hoisted(() => ({ skew: 600 as number | null, reads: 0 }));
vi.mock('../../src/core/chain/clock', async (orig) => ({
  ...(await orig<object>()),
  chainClockSkew: async () => { ck.reads++; return ck.skew; },
}));
vi.mock('../../src/cli/commands', () => ({
  confirm: (a: { flags: Record<string, unknown> }) => { if (a.flags.yes !== true) throw new Error('needs --yes'); },
  disconnectCmd: async () => undefined,
}));
vi.mock('../../src/main/wallet/vault', () => ({ ownerAddress: () => 'Owner1', noWallet: () => ({ error: 'no wallet', code: 'no-wallet' }) }));
vi.mock('../../src/main/services/wallet', () => ({ refreshWallet: async () => ({ owner: 'Owner1', ready: false, ownerLamports: 16_000_000, ownerTdvpn: '46495', userBalance: '0' }) }));
vi.mock('../../src/main/services/connection', () => ({ adoptRunningSession: async () => undefined, sessionStateUnknown: () => false, connect: async () => { throw new Error('must not connect'); } }));
vi.mock('../../src/main/app-state', () => ({ snapshot: () => ({ session: null, publicIp: null, homeIp: null }) }));
const dm = vi.hoisted(() => ({ init: 0 }));
vi.mock('../../src/main/daemon/manager', () => ({
  daemonInfo: () => ({ reachable: true, device: null }),
  initDevice: async () => { dm.init++; return { ok: true, device: 'DevNew' }; },
  deviceRecord: () => null,
}));
vi.mock('../../src/main/services/settlement', () => ({ readSettlements: async () => [], runSettlement: async () => ({ ok: true }) }));
vi.mock('../../src/cli/status-cmd', async (orig) => ({ ...(await orig<object>()), internetProbe: async () => true }));

const agent = await import('../../src/cli/agent-cmd');

// The same line parser as state-matrix.test.ts.
const args = (line: string): { _: string[]; flags: Record<string, string | true> } => {
  const out = { _: [] as string[], flags: {} as Record<string, string | true> };
  const w = line.split(' ');
  for (let i = 0; i < w.length; i++) {
    if (w[i].startsWith('--')) { const k = w[i].slice(2); if (w[i + 1] && !w[i + 1].startsWith('--')) out.flags[k] = w[++i]; else out.flags[k] = true; } else out._.push(w[i]);
  }
  return out;
};

type Out = { data: Record<string, unknown> | null; error: (Error & { code?: string; action?: string }) | null };
async function run(line: string): Promise<Out> {
  const out: Out = { data: null, error: null };
  try {
    await agent.agentCmd(args(line) as never, { json: true, print: (_h: string, d?: unknown) => { out.data = d as Record<string, unknown>; } });
  } catch (e) { out.error = e as Error & { code?: string; action?: string }; }
  return out;
}

beforeEach(() => { ck.skew = 600; ck.reads = 0; dm.init = 0; });

describe('WIN-W7: the clock before the device gate', () => {
  it('agent up with a +10 min clock: clock-skew (not not-funded), before any device is made', async () => {
    const r = await run('agent up --json');
    expect(r.error?.code).toBe('clock-skew');
    expect(r.error?.message).toMatch(/about 10 min ahead/);
    expect(r.error?.action).toMatch(/then devnet-dvpn agent up --yes$/);
    expect(dm.init).toBe(0);
  });

  it('agent status with a +10 min clock: ok, clockSkewSec + the sentence, next = the clock line', async () => {
    const r = await run('agent status --json');
    expect(r.error).toBeNull();
    expect(r.data?.clockSkewSec).toBe(600);
    expect(String(r.data?.clock)).toMatch(/about 10 min ahead/);
    expect(String(r.data?.next)).toMatch(/then devnet-dvpn agent up --yes$/);
  });

  it('negative controls: inside the limit, and an unreadable chain time, add nothing and never block', async () => {
    for (const skew of [3, null]) {
      ck.skew = skew;
      const s = await run('agent status --json');
      expect(s.data?.clockSkewSec).toBeUndefined();
      const u = await run('agent up --json');
      expect(u.error?.code).not.toBe('clock-skew');
    }
  });

  it('clockBlock: a reader that throws is skipped (null), never a refusal', async () => {
    expect(await clockBlock(async () => { throw new Error('rpc down'); })).toBeNull();
    expect(await clockBlock(async () => -120)).toMatchObject({ skewS: -120, code: 'clock-skew' });
  });
});

describe('WIN-W8: the Windows clock line starts W32Time first', () => {
  it('names Start-Service w32time before w32tm /resync /force', () => {
    expect(agent.CLOCK_NEXT('win32')).toBe('Start-Service w32time; w32tm /resync /force (elevated PowerShell), then devnet-dvpn agent up --yes');
    expect(agent.CLOCK_NEXT('linux')).toMatch(/^sudo timedatectl set-ntp true/);
  });
});
