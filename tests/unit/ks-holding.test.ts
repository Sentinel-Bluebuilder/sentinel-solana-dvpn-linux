// ─── WIN-W5 (the agent kit rc.9, review K3-L / audit W-5): status says when the kill switch is on but not blocking ───
// Windows rc.7 K3: kill switch on, tunnel dropped. The block held while dvpnd reconnected, but once dvpnd ended the
// session itself the block was released: traffic went out directly, the setting still read on, and status showed
// server-stopped with no `blocked` field. The real fix (hold the block) is upstream; rc.9 tells the truth.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({ ks: 'on' as string, internet: true, ended: true, settingsThrow: false }));
vi.mock('../../src/core/chain/clock', async (orig) => ({ ...(await orig<object>()), chainClockSkew: async () => 0 }));
vi.mock('../../src/cli/commands', () => ({ confirm: () => undefined, disconnectCmd: async () => undefined }));
vi.mock('../../src/main/wallet/vault', () => ({ ownerAddress: () => 'Owner1', noWallet: () => ({ error: 'no wallet', code: 'no-wallet' }) }));
vi.mock('../../src/main/services/wallet', () => ({ refreshWallet: async () => ({ owner: 'Owner1', ready: true, ownerLamports: 50_000_000, ownerTdvpn: '10000000', userBalance: '0' }) }));
vi.mock('../../src/main/services/connection', () => ({ adoptRunningSession: async () => undefined, sessionStateUnknown: () => false, connect: async () => { throw new Error('must not connect'); } }));
vi.mock('../../src/main/app-state', () => ({ snapshot: () => ({ session: null, publicIp: null, homeIp: '198.51.100.7' }) }));
vi.mock('../../src/main/daemon/manager', () => ({ daemonInfo: () => ({ reachable: true, device: 'Dev1' }), initDevice: async () => ({ ok: true }), deviceRecord: () => null }));
vi.mock('../../src/main/services/settlement', () => ({ readSettlements: async () => [], runSettlement: async () => ({ ok: true }) }));
vi.mock('../../src/main/services/history', () => ({
  listHistory: () => (st.ended ? [{ node: 'NodeA', endedAt: Date.now() - 60_000, closeReason: 'the connection to this server stopped working' }] : []),
}));
vi.mock('../../src/main/daemon/settings', () => ({
  serviceUsesTun: () => false,
  getDaemonSettings: () => { if (st.settingsThrow) throw new Error('config.toml unreadable'); return { readable: true, settings: { killSwitch: st.ks } }; },
}));
vi.mock('../../src/cli/status-cmd', async (orig) => ({ ...(await orig<object>()), internetProbe: async () => st.internet }));

const agent = await import('../../src/cli/agent-cmd');

async function status(): Promise<Record<string, unknown>> {
  let data: Record<string, unknown> = {};
  await agent.agentCmd({ _: ['agent', 'status'], flags: { json: true } } as never, { json: true, print: (_h: string, d?: unknown) => { data = d as Record<string, unknown>; } });
  return data;
}

beforeEach(() => { st.ks = 'on'; st.internet = true; st.ended = true; st.settingsThrow = false; });

describe('WIN-W5: kill switch on, session ended by dvpnd, traffic direct', () => {
  it('K3-L shape: killSwitchHolding false + the sentence; next stays the reconnect', async () => {
    const s = await status();
    expect(s.killSwitchHolding).toBe(false);
    expect(String(s.killSwitch)).toBe('The kill switch is on but is not blocking: the server ended the session and traffic now goes out directly, not through the VPN.');
    expect(s.next).toBe('devnet-dvpn agent up --yes');
  });
  it('persist is the same', async () => {
    st.ks = 'persist';
    expect((await status()).killSwitchHolding).toBe(false);
  });
  it('negative controls: kill switch off; no internet (the block holds); no ended session; settings unreadable', async () => {
    st.ks = 'off';
    expect((await status()).killSwitchHolding).toBeUndefined();
    st.ks = 'on'; st.internet = false;
    const held = await status();
    expect(held.killSwitchHolding).toBeUndefined();
    expect(held.blocked).toBe(true);
    st.internet = true; st.ended = false;
    expect((await status()).killSwitchHolding).toBeUndefined();
    st.ended = true; st.settingsThrow = true;
    expect((await status()).killSwitchHolding).toBeUndefined();
  });
});
