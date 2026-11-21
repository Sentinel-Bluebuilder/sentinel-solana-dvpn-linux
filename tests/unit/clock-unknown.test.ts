// ─── CLOCK-UNKNOWN (rc9-c, review L3 w11) on the WIN-W7 + WIN-W8 mocks (the agent kit rc.9, review audit W-7/W-8): the clock is named before the device gate, and in status ───
// review rc.8 edge row 2: the VM clock +10 min. `agent status` was ok with no clock field and `agent up --json`
// answered not-funded (no device in that data dir), so an agent would fund a device before learning of the clock.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clockCheck } from '../../src/cli/clock-gate';

const ck = vi.hoisted(() => ({ skew: 600 as number | null, reads: 0, hang: false }));
vi.mock('../../src/core/chain/clock', async (orig) => ({
  ...(await orig<object>()),
  chainClockSkew: async () => { ck.reads++; if (ck.hang) await new Promise(() => undefined); return ck.skew; },
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

type Out = { data: Record<string, unknown> | null; error: Error | null };
async function status(): Promise<Out> {
  const out: Out = { data: null, error: null };
  try {
    await agent.agentCmd({ _: ['status'], flags: { json: true } } as never, { json: true, print: (_h: string, d?: unknown) => { out.data = d as Record<string, unknown>; } });
  } catch (e) { out.error = e as Error; }
  return out;
}
beforeEach(() => { ck.skew = 600; ck.reads = 0; ck.hang = false; });

describe('CLOCK-UNKNOWN: agent status never drops the clock silently', () => {
  it('the chain clock misses the status budget (public RPC 429): clock "unknown", no skew claim, still ok', async () => {
    ck.hang = true;
    const r = await status();
    expect(r.error).toBeNull();
    expect(r.data?.clock).toBe('unknown');
    expect(r.data?.clockSkewSec).toBeUndefined();
    expect(String(r.data?.clockNote)).toMatch(/not checked/);
  }, 10_000);
  it('no chain time: clock "unknown"', async () => {
    ck.skew = null;
    expect((await status()).data?.clock).toBe('unknown');
  });
  it('controls: a +10 min clock keeps the skew sentence; inside the limit adds no clock field', async () => {
    const off = await status();
    expect(off.data?.clockSkewSec).toBe(600);
    expect(String(off.data?.clock)).toMatch(/about 10 min ahead/);
    ck.skew = 3;
    const fine = await status();
    expect(fine.data?.clock).toBeUndefined();
  });
  it('clockCheck keeps the outcome', async () => {
    expect(await clockCheck(async () => 3)).toEqual({ kind: 'ok' });
    expect(await clockCheck(async () => null)).toEqual({ kind: 'unknown' });
    expect(await clockCheck(async () => { throw new Error('429'); })).toEqual({ kind: 'unknown' });
    expect((await clockCheck(async () => 600)).kind).toBe('block');
  });
});
