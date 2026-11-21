// ─── `agent up | down | status` (the agent kit): thin commands over the existing services ───
// Services injected as in status-no-hang.test.ts: nothing touches the chain, the daemon or the network.
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync as bMkdtemp, writeFileSync as bWrite, existsSync as bExists, rmSync as bRm } from 'node:fs';
import { tmpdir as bTmp } from 'node:os';
import { join as bJoin } from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OWNER = 'Owner1111111111111111111111111111111111111';
const rb = vi.hoisted(() => ({ next: null as string | null })); // E-87: the blocked-reconnect next, per test
const units = vi.hoisted(() => ({ now: { installed: null as boolean | null, serviceActive: false, socketActive: false } })); // RC8 W47
const st = vi.hoisted(() => ({
  owner: 'Owner1111111111111111111111111111111111111' as string | null,
  session: null as Record<string, unknown> | null,
  publicIp: null as Record<string, unknown> | null,
  nodes: [] as Record<string, unknown>[],
  wallet: null as Record<string, unknown> | null,
  walletAfter: null as Record<string, unknown> | null,
  allowanceTdvpn: null as string | null,
  device: 'Dev1111' as string | null,
  reachable: true,
  connectResult: null as Record<string, unknown> | null,
  settlements: [] as Record<string, unknown>[],
  settleBusy: false,
  disconnectThrows: null as (Error & { code?: string }) | null,
  tun: false,
  marker: [] as unknown[],
  internet: true,
  homeIp: '198.51.100.7' as string | null,
  calls: { connect: [] as unknown[], init: 0, settle: 0, disconnect: 0, settleOnly: undefined as string[] | undefined },
}));

vi.mock('../../src/cli/commands', () => ({
  confirm: (a: { flags: Record<string, unknown> }, o: { print: (h: string, d?: unknown) => void }, what: string) => {
    if (a.flags.yes === true) return;
    o.print(what, { needsConfirm: true, what });
    throw new Error('needs --yes');
  },
  disconnectCmd: async (_a: unknown, o: { print: (h: string, d?: unknown) => void }) => { st.calls.disconnect++; if (st.disconnectThrows) throw st.disconnectThrows; st.session = null; o.print('Disconnected.', { ok: true }); },
}));
vi.mock('../../src/cli/status-cmd', () => ({ within: <T>(p: Promise<T>) => p, STATUS_NET_BUDGET_MS: 2500, internetProbe: async () => st.internet, reconnectBlockedNext: () => rb.next, RECONNECT_BLOCKED_ALSO: 'then devnet-dvpn agent up --yes to reconnect, or devnet-dvpn agent down --yes to close the deposit' }));
vi.mock('../../src/main/app-state', () => ({ snapshot: () => ({ session: st.session, publicIp: st.publicIp, homeIp: st.homeIp }) }));
vi.mock('../../src/main/daemon/settings', () => ({ serviceUsesTun: () => st.tun }));
vi.mock('../../src/main/home-ip', () => ({ loadHomeIp: () => undefined }));
vi.mock('../../src/main/services/agent-marker', () => ({ writeAgentMarker: (m: unknown) => { st.marker.push(m); } }));
const hostDir = vi.hoisted(() => ({ dir: '' })); // B-UP: the agent up lock lives in the data dir
vi.mock('../../src/main/host', () => ({ getHost: () => ({ dataDir: hostDir.dir }) }));
vi.mock('../../src/main/scheduler', () => ({ runJobNow: async () => ({ ok: true }) }));
// E-73: `walletAfter` is what a read after connect() returns (connect may have raised the limit).
const setups = vi.hoisted(() => [] as string[]); // LIM-5: what device setup was asked to set
vi.mock('../../src/main/services/wallet', () => ({ refreshWallet: async () => (st.calls.connect.length && st.walletAfter ? st.walletAfter : st.wallet), deviceSetup: async (allowance: string) => { setups.push(allowance); return { ok: true, data: 'SigLim' }; } }));
vi.mock('../../src/main/services/nodes', () => ({ refreshNodes: async () => st.nodes, nodeViews: () => st.nodes }));
// Skip the server that just failed: the file is faked, the pool logic (withoutFailed / skippedNote) is real.
const hist = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock('../../src/main/services/history', () => ({ listHistory: () => hist.rows }));
const lf = vi.hoisted(() => ({ failed: null as null | { node: string; code: string; at: number }, recorded: [] as unknown[][], cleared: 0 }));
vi.mock('../../src/cli/last-failed', async (orig) => ({
  ...(await orig<object>()),
  recentFailed: () => lf.failed,
  recordFailed: (...x: unknown[]) => { lf.recorded.push(x); },
  clearFailed: () => { lf.cleared++; },
}));
vi.mock('../../src/main/services/connection', () => ({
  adoptRunningSession: async () => undefined,
  sessionStateUnknown: () => false,
  connect: async (req: unknown) => { st.calls.connect.push(req); return st.connectResult; },
}));
vi.mock('../../src/main/services/settlement', () => ({
  readSettlements: async () => st.settlements,
  runSettlement: async (only?: string[]) => { if (st.settleBusy) return { ok: false, error: 'A refund is already running.', code: 'busy' }; st.calls.settle++; st.calls.settleOnly = only; st.settlements = st.settlements.map((s) => (s.device ? s : { ...s, status: 'closing', readyAt: 1_900_000_000 })); /* E-72: another device's open deposit is not started here */ return { ok: true, data: ['Sig1'] }; },
}));
vi.mock('../../src/main/services/plans', () => ({
  refreshSubscriptions: async () => [{ address: 'Sub111', plan: 'Plan111', provider: 'Prov111', active: true }],
  roster: async () => [{ node: 'NodeB', live: true }, { node: 'NodeC', live: false }],
}));
vi.mock('../../src/main/daemon/manager', () => ({
  linuxUnits: async () => units.now, SERVICE_NAME: 'sentinel-dvpnd@c0', // RC8 W47
  daemonInfo: () => ({ reachable: st.reachable, device: st.device }),
  initDevice: async () => { st.calls.init++; st.device = 'DevNew'; return { ok: true, device: 'DevNew' }; },
  deviceRecord: () => null, // E-18: no device record, so no-wallet keeps the plain create step
}));
vi.mock('../../src/main/system/tunnels', () => ({ rivalVpns: async () => [] }));
vi.mock('../../src/main/system/settings', () => ({ getSettings: () => ({ defaultBasis: 'per_gb', defaultGb: 1, defaultHours: 1, ...(st.allowanceTdvpn ? { allowanceTdvpn: st.allowanceTdvpn } : {}) }) }));
vi.mock('../../src/main/wallet/vault', () => ({ ownerAddress: () => st.owner, noWallet: () => ({ error: 'Set up a wallet first.', code: 'no-wallet' }) }));

const { agentCmd, agentInputs, filterNodes, statusNext, statusAlso, nextFor, AGENT_SOL_MIN } = await import('../../src/cli/agent-cmd');

const node = (address: string, o: Record<string, unknown> = {}): Record<string, unknown> => ({
  address, countryCode: 'DE', protocolNames: ['v2ray'], pricePerGb: '1000000', pricePerHour: '0', probe: { ok: true, latencyMs: 50 }, favourite: false, ...o,
});
const args = (line: string): { _: string[]; flags: Record<string, string | true> } => {
  const out = { _: [] as string[], flags: {} as Record<string, string | true> };
  const w = line.split(' ');
  for (let i = 0; i < w.length; i++) {
    if (w[i].startsWith('--')) { const k = w[i].slice(2); if (w[i + 1] && !w[i + 1].startsWith('--')) out.flags[k] = w[++i]; else out.flags[k] = true; } else out._.push(w[i]);
  }
  return out;
};
async function run(line: string): Promise<{ data: Record<string, unknown>[]; error: (Error & { code?: string; action?: string }) | null }> {
  const data: Record<string, unknown>[] = [];
  try {
    await agentCmd(args(line) as never, { json: true, print: (_h: string, d?: unknown) => { data.push(d as Record<string, unknown>); } });
    return { data, error: null };
  } catch (err) {
    return { data, error: err as Error & { code?: string; action?: string } };
  }
}
const funded = { owner: OWNER, ready: true, ownerLamports: 50_000_000, ownerTdvpn: '10000000', userBalance: '0' };
const live = { id: 'S1', node: 'NodeA', service: 'v2ray', channel: 'Chan1', proxyEndpoint: '127.0.0.1:1080', spent: '250000' };

beforeEach(() => {
  st.owner = OWNER; st.session = null; st.publicIp = null; st.wallet = { ...funded }; st.walletAfter = null; st.device = 'Dev1111'; st.reachable = true; st.allowanceTdvpn = null;
  st.nodes = [node('NodeA', { probe: { ok: true, latencyMs: 90 } }), node('NodeB', { countryCode: 'NL', protocolNames: ['wireguard'], probe: { ok: true, latencyMs: 20 } }), node('NodeD', { probe: { ok: false, latencyMs: 5 } })];
  st.connectResult = { ok: true, data: { ...live } };
  st.settlements = []; st.settleBusy = false; st.disconnectThrows = null; st.tun = false; st.homeIp = '198.51.100.7'; st.marker = []; st.internet = true;
  st.calls = { connect: [], init: 0, settle: 0, disconnect: 0, settleOnly: undefined };
  lf.failed = null; lf.recorded = []; lf.cleared = 0; hist.rows = [];
  hostDir.dir = bMkdtemp(bJoin(bTmp(), 'b-up-'));
});

describe('agent up: skip the server that just failed', () => {
  it('picks the same server by default (positive control for the pick)', async () => {
    await run('agent up --yes');
    expect((st.calls.connect[0] as { node: string }).node).toBe('NodeB');
    expect(lf.cleared).toBe(1);
  });
  it('a server that failed within 10 min is left out, and the answer says so', async () => {
    lf.failed = { node: 'NodeB', code: 'node-offline', at: Date.now() - 3 * 60_000 };
    const r = await run('agent up --yes');
    expect((st.calls.connect[0] as { node: string }).node).toBe('NodeA');
    expect(r.data[0]).toMatchObject({ skipped: { node: 'NodeB', code: 'node-offline' }, skippedNote: 'skipped NodeB: it failed 3 min ago (node-offline); --node NodeB tries it anyway' });
  });
  it('--node names it: tried anyway, nothing skipped', async () => {
    lf.failed = { node: 'NodeB', code: 'node-offline', at: Date.now() };
    const r = await run('agent up --node NodeB --yes');
    expect((st.calls.connect[0] as { node: string }).node).toBe('NodeB');
    expect(r.data[0].skipped).toBeUndefined();
  });
  it('a failure on the server is recorded; one that is not the server is not', async () => {
    st.connectResult = { ok: false, error: 'x', code: 'tunnel-failed' };
    await run('agent up --yes');
    expect(lf.recorded).toEqual([['NodeB', 'tunnel-failed']]);
    lf.recorded = [];
    st.connectResult = { ok: false, error: 'x', code: 'dns-apply' };
    await run('agent up --yes');
    expect(lf.recorded).toEqual([]);
  });
});

describe('agent inputs', () => {
  const d = { basis: 'per_gb', gb: 1, hours: 1 };
  it('refuses a bad basis, protocol, country or price before anything runs', () => {
    expect(() => agentInputs(args('agent up --basis per_week') as never, d)).toThrow(/--basis/);
    expect(() => agentInputs(args('agent up --protocol ipsec') as never, d)).toThrow(/--protocol/);
    expect(() => agentInputs(args('agent up --country Germany') as never, d)).toThrow(/--country/);
    expect(() => agentInputs(args('agent up --max-price cheap') as never, d)).toThrow(/--max-price/);
    expect(() => agentInputs(args('agent up --units 0') as never, d)).toThrow(/--units/);
  });
  it('normalises the good ones (any = no protocol filter, country upper-case, price in base units)', () => {
    expect(agentInputs(args('agent up --protocol any --country de --max-price 0.5') as never, d)).toMatchObject({ protocol: undefined, country: 'DE', maxPrice: '500000', basis: 'per_gb', units: 1 });
  });
});

describe('filterNodes (the plain filter before pickQuickNode)', () => {
  it('keeps nodes by protocol, country, the basis on sale and the price cap', () => {
    const l = [node('A'), node('B', { countryCode: 'NL' }), node('C', { pricePerGb: '3000000' }), node('E', { pricePerGb: '0', pricePerHour: '5' })];
    expect(filterNodes(l as never, { basis: 'per_gb', country: 'DE', maxPrice: '2000000' }).map((n) => n.address)).toEqual(['A']);
    expect(filterNodes(l as never, { basis: 'per_hour' }).map((n) => n.address)).toEqual(['E']);
  });
  it('prefers nodes that offer only the asked protocol (dvpnd picks the service on a multi-protocol node)', () => {
    const l = [node('Multi', { protocolNames: ['v2ray', 'wireguard'] }), node('Only', { protocolNames: ['wireguard'] })];
    expect(filterNodes(l as never, { basis: 'per_gb', protocol: 'wireguard' }).map((n) => n.address)).toEqual(['Only']);
  });
  it('a plan session ignores prices and keeps the live roster only', () => {
    const l = [node('NodeB', { pricePerGb: '0' }), node('NodeX')];
    expect(filterNodes(l as never, { basis: 'per_gb', only: ['NodeB'] }).map((n) => n.address)).toEqual(['NodeB']);
  });
});

describe('agent up', () => {
  it('no wallet: error with the next command, nothing else runs', async () => {
    st.owner = null;
    const r = await run('agent up --yes');
    expect(r.error?.code).toBe('no-wallet');
    expect(r.error?.action).toMatch(/^devnet-dvpn wallet create --keyfile/);
    expect(st.calls.connect).toEqual([]);
  });
  it('without --yes: shows the deposit and stops (no connect)', async () => {
    const r = await run('agent up');
    expect(r.data[0]).toMatchObject({ needsConfirm: true });
    expect(st.calls.connect).toEqual([]);
  });
  it('picks the lowest-latency online match and calls connect() exactly as `connect` does', async () => {
    st.publicIp = { ip: '203.0.113.9', sid: 'S1', viaProxy: true, directIp: '198.51.100.7' };
    const r = await run('agent up --protocol v2ray --country DE --yes');
    expect(r.error).toBeNull();
    expect(st.calls.connect).toEqual([{ node: 'NodeA', basis: 'per_gb', units: 1, confirmed: true, subscription: undefined, shownEscrow: '1000000' }]);
    // The app shows 'Agentic connection is on' from this marker (agent-marker.ts, connect-5e).
    expect(st.marker).toEqual([{ session: 'S1', node: 'NodeA', protocol: 'v2ray' }]);
    expect(r.data).toHaveLength(1);
    expect(r.data[0]).toMatchObject({
      ok: true, connected: true, session: 'S1', node: 'NodeA', protocol: 'v2ray', country: 'DE', exitIp: '203.0.113.9', directIp: '198.51.100.7',
      socks: 'socks5h://127.0.0.1:1080', deposit: { basis: 'per_gb', units: 1, tdvpn: '1', baseUnits: '1000000' },
    });
    expect(r.data[0]).toMatchObject({ wholeDevice: false });
    expect(r.data[0].next).toBe('devnet-dvpn agent down --yes'); // E-38: one plain command
    expect(r.data[0].note).toBe('send traffic through socks5h://127.0.0.1:1080 (e.g. curl --proxy socks5h://127.0.0.1:1080 https://api.ipify.org); only apps that use it go through the node; when done: devnet-dvpn agent down --yes');
  });
  it('V2Ray whole-device (tun on, Windows rc2): directIp is the own address read before, never the node; next says the whole computer', async () => {
    st.tun = true;
    // What Windows rc2 measured: direct and via SOCKS both exit by the node.
    st.publicIp = { ip: '203.0.113.9', sid: 'S1', viaProxy: true, directIp: '203.0.113.9' };
    const r = await run('agent up --protocol v2ray --country DE --yes');
    expect(r.data[0]).toMatchObject({ wholeDevice: true, exitIp: '203.0.113.9', directIp: '198.51.100.7', socks: 'socks5h://127.0.0.1:1080' });
    expect(r.data[0].next).toBe('devnet-dvpn agent down --yes');
    expect(r.data[0].note).toBe('the whole computer goes through the node (socks5h://127.0.0.1:1080 works too); when done: devnet-dvpn agent down --yes');
    st.homeIp = null;
    st.session = { ...live };
    const n = await run('agent up --yes');
    expect(n.data[0]).toMatchObject({ wholeDevice: true, reused: true, directIp: null }); // unknown, never the node's
  });
  it('with no filter, lowest latency wins (NodeB, 20 ms); an offline node never does', async () => {
    st.connectResult = { ok: true, data: { ...live, node: 'NodeB', service: 'wireguard', proxyEndpoint: '' } };
    const r = await run('agent up --yes');
    expect((st.calls.connect[0] as { node: string }).node).toBe('NodeB');
    expect(r.data[0]).toMatchObject({ socks: null, protocol: 'wireguard', wholeDevice: true });
    expect(r.data[0].note).toMatch(/whole|traffic now goes through the node/);
  });
  it('already connected: answers the live session, pays nothing (idempotent)', async () => {
    st.session = { ...live };
    const r = await run('agent up --yes');
    expect(st.calls.connect).toEqual([]);
    expect(r.data[0]).toMatchObject({ reused: true, session: 'S1', deposit: null });
  });
  it('already connected to the asked node: reused, no switch', async () => {
    st.session = { ...live };
    const r = await run('agent up --node NodeA --protocol wireguard --yes');
    expect(st.calls.connect).toEqual([]);
    expect(r.data[0]).toMatchObject({ reused: true, country: 'DE' });
  });
  it('connected elsewhere than asked: one connect() through the switch path (kill switch kept), never disconnect', async () => {
    st.session = { ...live };
    st.connectResult = { ok: true, data: { ...live, id: 'S2', node: 'NodeB', service: 'wireguard', proxyEndpoint: '' } };
    const r = await run('agent up --country NL --yes');
    expect(st.calls.disconnect).toBe(0);
    expect(st.calls.connect).toEqual([{ node: 'NodeB', basis: 'per_gb', units: 1, confirmed: true, subscription: undefined, switch: true, shownEscrow: '1000000' }]);
    expect(r.data[0]).toMatchObject({ session: 'S2', node: 'NodeB', country: 'NL' });
  });
  it('a switch never re-picks the live server (Q0559): the only match being the current node is no-nodes', async () => {
    st.session = { ...live, service: 'xray' };
    const r = await run('agent up --protocol v2ray --country DE --yes');
    expect(r.error?.code).toBe('no-nodes');
    expect(st.calls.connect).toEqual([]);
  });
  it('without --yes, a switch says so first', async () => {
    st.session = { ...live };
    const r = await run('agent up --country NL');
    expect(String(r.data[0].what)).toMatch(/^Switch from NodeA\. Connect to NodeB/);
    expect(st.calls.connect).toEqual([]);
  });
  it('protocol-missing names a protocol this computer has, or the driver repair', () => {
    expect(nextFor('protocol-missing')).toBe('devnet-dvpn daemon drivers (it lists the protocols ready on this computer), then devnet-dvpn agent up --protocol <a ready one> --yes; or devnet-dvpn daemon repair-drivers --yes'); // E-5: never a fixed protocol
    expect(nextFor('daemon-missing', 'linux')).toMatch(/passwordless sudo, or a person types the password/);
    expect(nextFor('daemon-missing', 'darwin')).toMatch(/passwordless sudo/);
    // Windows: no sudo; one UAC prompt an agent cannot answer (review review).
    expect(nextFor('daemon-missing', 'win32')).toMatch(/^devnet-dvpn daemon install --yes from an elevated shell or an administrator SSH login/);
    expect(nextFor('daemon-relogin', 'win32')).toMatch(/once from an elevated shell .*does not accept this account yet/);
    expect(nextFor('daemon-missing', 'win32')).not.toMatch(/sudo/);
    // Matched without the CLI name in front: the docs/UI-CONTROLS.md scanner would list this file as running `test stop`.
    expect(nextFor('test-running')).toMatch(/ test stop, then .* agent up --yes$/);
    expect(nextFor('rpc-busy')).toMatch(/^devnet-dvpn agent up --yes again in a minute/);
    // E-1: a screen ('Open Wallet') is no next step; the device limit is raised with one command.
    expect(nextFor('spending-limit')).toBe('devnet-dvpn device setup --allowance <N> --yes (N = grant.allowance from "devnet-dvpn device show --json" divided by 1000000, plus the deposit, in tDVPN), then devnet-dvpn agent up --yes');
    // Refused before paying (CODE-AUDIT U-13 / E3 / E12): try again, not agent status.
    for (const c of ['price-changed', 'deposit-unusable', 'deposits-unread']) expect(nextFor(c)).toBe('devnet-dvpn agent up --yes again (nothing was paid; it reads the price fresh)');
    expect(nextFor('something-new')).toBe('devnet-dvpn agent status');
  });
  it('no device key yet: runs daemon init first, then connects', async () => {
    st.device = null;
    await run('agent up --yes');
    expect(st.calls.init).toBe(1);
    expect(st.calls.connect).toHaveLength(1);
  });
  // K4: reuse compares node / protocol / country only; deposit flags are ignored while a session is live.
  it('a live session is reused whatever --basis / --units / --max-price / --plan say', async () => {
    st.session = { ...live };
    const r = await run('agent up --basis per_hour --units 3 --max-price 9 --plan Sub1 --yes');
    expect(r.data[0]).toMatchObject({ reused: true, session: 'S1', deposit: null });
    expect(st.calls.connect).toHaveLength(0);
  });
  // Pins what AGENT-COMMANDS.md says runs without --yes: the device key (local, no transaction), never the connect.
  it('no device key, WITHOUT --yes: runs daemon init once, never connects, answers needsConfirm', async () => {
    st.device = null;
    const r = await run('agent up');
    expect(st.calls.init).toBe(1);
    expect(st.calls.connect).toHaveLength(0);
    expect(r.error?.message).toBe('needs --yes');
    expect(r.data[0]).toMatchObject({ needsConfirm: true });
  });
  it('a plan: only its live roster, the subscription passed to connect(), no deposit', async () => {
    st.nodes = [...st.nodes, node('NodeC')];
    const r = await run('agent up --plan Sub111 --yes');
    expect(st.calls.connect).toEqual([{ node: 'NodeB', basis: 'per_gb', units: 1, confirmed: true, subscription: { provider: 'Prov111', subscription: 'Sub111' } }]);
    expect(r.data[0].deposit).toEqual({ plan: 'Sub111', tdvpn: '0' });
  });
  it('nothing matches: no-nodes with the command that widens the search', async () => {
    const r = await run('agent up --country JP --yes');
    expect(r.error?.code).toBe('no-nodes');
    expect(r.error?.action).toBe('devnet-dvpn agent up --basis per_gb --units 1 --yes'); // A-NODES (rc.8): the line without the country no node answers in
  });
  it('not funded: says exactly what to send where, before any --yes prompt', async () => {
    st.wallet = { ...funded, ready: false, ownerLamports: 0, ownerTdvpn: '0' };
    const r = await run('agent up');
    expect(r.error?.code).toBe('not-funded');
    expect(r.error?.action).toBe(`send at least 0.06 SOL and 1 tDVPN (2 recommended: it also covers a reconnect) to ${OWNER}, then devnet-dvpn agent up --yes`);
    expect(AGENT_SOL_MIN).toBe(60_000_000); // R7: the device float + fees (0.02 was below the float)
  });
  it('a connect() failure keeps its code and names the fix', async () => {
    st.connectResult = { ok: false, error: 'The VPN service is not installed.', code: 'daemon-missing' };
    const r = await run('agent up --yes');
    expect(r.error?.code).toBe('daemon-missing');
    expect(r.error?.action).toBe(nextFor('daemon-missing'));
    expect(r.error?.action).toMatch(/daemon install --yes/);
  });
  it('E-22 (a): a failed start with a deposit open on that server names the deposit, never device setup', async () => {
    st.connectResult = { ok: false, error: 'The server refused the session.', code: 'unauthorized' };
    st.settlements = [{ channel: 'ChanSkew', node: 'NodeA', mode: 0, escrow: '1500000', status: 'open', refundable: '1500000', readyAt: null }];
    const r = await run('agent up --node NodeA --yes');
    expect(r.error?.code).toBe('unauthorized');
    expect(r.error?.action).toBe('a deposit of 1.5 tDVPN is open with this node (ChanSkew): devnet-dvpn agent up --yes picks another node (this node is skipped), or devnet-dvpn agent down --yes closes it and refunds the unused part 2 h after it starts the close (per GB)');
    expect(r.error?.action).not.toMatch(/device setup/);
  });
  it('E-22 (a): a per-hour deposit says it bills until closed; another server\'s deposit is not named', async () => {
    st.connectResult = { ok: false, error: 'x', code: 'tunnel-failed' };
    st.settlements = [{ channel: 'ChanH', node: 'NodeA', mode: 1, escrow: '2000000', status: 'in-use', refundable: '2000000', readyAt: null }];
    expect((await run('agent up --node NodeA --yes')).error?.action).toMatch(/closes it and refunds the unused part at once \(per hour: it bills until closed\)$/);
    st.settlements = [{ channel: 'ChanZ', node: 'NodeZ', mode: 1, escrow: '2000000', status: 'open', refundable: '2000000', readyAt: null }];
    expect((await run('agent up --node NodeA --yes')).error?.action).toBe(nextFor('tunnel-failed'));
  });
  it('E-22 negative control: a refusal before paying never reads or names a deposit', async () => {
    st.connectResult = { ok: false, error: 'x', code: 'node-offline' };
    st.settlements = [{ channel: 'ChanOld', node: 'NodeA', mode: 1, escrow: '2000000', status: 'open', refundable: '2000000', readyAt: null }];
    expect((await run('agent up --node NodeA --yes')).error?.action).toBe(nextFor('node-offline'));
  });
  it('E-22 (b): unauthorized with no deposit checks the grant and the clock first; clock-skew names the minutes', () => {
    expect(nextFor('unauthorized')).toMatch(/^devnet-dvpn device show --json: if the grant is there and not revoked, set this computer's clock/);
    expect(nextFor('clock-skew', 'linux', { error: 'This computer\'s clock is off by about 7 minutes.' })).toBe('sudo timedatectl set-ntp true && (sudo chronyc makestep 2>/dev/null || true), then devnet-dvpn agent up --yes'); // C-CLOCK (rc.8)
  });
  it('negative control: an unknown subcommand is a usage error', async () => {
    const r = await run('agent teleport');
    expect(r.error?.message).toMatch(/unknown: agent teleport/);
  });
});

describe('agent down', () => {
  it('--yes: disconnects, starts the refund, says when the rest is ready', async () => {
    st.session = { ...live };
    st.settlements = [{ channel: 'Chan1', mode: 0, status: 'open', refundable: '750000', readyAt: null }];
    const r = await run('agent down --yes');
    expect(st.calls.disconnect).toBe(1);
    expect(st.calls.settle).toBe(1);
    expect(st.calls.settleOnly).toBeUndefined();
    expect(r.data[0]).toMatchObject({ ok: true, spent: '0.25', refundable: '0.75', signatures: ['Sig1'], readyAt: 1_900_000_000 });
    expect(r.data[0].next).toMatch(/^devnet-dvpn settle run --yes after 2030-/);
  });
  it('E-89: with escrow on the rows, deposited = spent + refundable from the same rows (not the session figure)', async () => {
    st.session = { ...live };
    st.settlements = [{ channel: 'Chan1', mode: 0, escrow: '1999000', status: 'open', refundable: '1883000', readyAt: null }];
    const r = await run('agent down --yes');
    expect(r.data[0]).toMatchObject({ ok: true, deposited: '1.999', spent: '0.116', refundable: '1.883' });
    const e89 = r.data[0] as Record<string, string>;
    expect(BigInt(e89.depositedBase)).toBe(BigInt(e89.spentBase) + BigInt(e89.refundableBase));
  });
  it('E-89 negative control: refundable above the rows\' escrow keeps the session figure, never a negative spent', async () => {
    st.session = { ...live };
    st.settlements = [{ channel: 'Chan1', mode: 0, escrow: '500000', status: 'open', refundable: '750000', readyAt: null }];
    const r = await run('agent down --yes');
    expect(r.data[0].spent).toBe('0.25');
    expect(r.data[0].deposited).toBeUndefined();
  });
  it('without --yes: says what it would do (per-hour and per-GB counted apart) and does nothing', async () => {
    const { MODE_STREAM } = await import('../../src/core/chain/idl');
    st.session = { ...live };
    st.settlements = [{ channel: 'Hour1', mode: MODE_STREAM, status: 'open', refundable: '400000', readyAt: null }, { channel: 'Gb1', mode: 0, status: 'ready', refundable: '1', readyAt: null }];
    const r = await run('agent down');
    expect(r.error?.message).toBe('needs --yes');
    expect(r.data[0]).toMatchObject({ needsConfirm: true });
    expect(r.data[0].what).toBe('Disconnect from NodeA, then close 1 per-hour deposit(s) (they bill until closed) and start closing 1 per-GB deposit(s); refunds go to your wallet.');
    expect(st.calls.disconnect).toBe(0);
    expect(st.calls.settle).toBe(0);
  });
  // Linux walk c2 S6: the live session's own deposit reads 'in-use'; the preview said 0 while --yes then closed it.
  it('without --yes: counts the live per-GB session\'s deposit; not another session\'s, not one already closing', async () => {
    st.session = { ...live };
    st.settlements = [{ channel: 'Chan1', mode: 0, status: 'in-use', refundable: '0', readyAt: null },
      { channel: 'Other1', mode: 0, status: 'in-use', refundable: '0', readyAt: null },
      { channel: 'Old1', mode: 0, status: 'closing', refundable: '5', readyAt: 1_900_000_000 }];
    const r = await run('agent down');
    expect(r.data[0].what).toBe('Disconnect from NodeA, then close 0 per-hour deposit(s) (they bill until closed) and start closing 1 per-GB deposit(s); refunds go to your wallet.');
    expect(st.calls.settle).toBe(0);
  });
  it('without --yes: counts the live per-hour session\'s deposit as per-hour', async () => {
    const { MODE_STREAM } = await import('../../src/core/chain/idl');
    st.session = { ...live };
    st.settlements = [{ channel: 'Chan1', mode: MODE_STREAM, status: 'in-use', refundable: '0', readyAt: null }];
    const r = await run('agent down');
    expect(r.data[0].what).toMatch(/close 1 per-hour deposit\(s\) .* start closing 0 per-GB/);
  });
  it('without --yes and no session: an open deposit is counted as before, an in-use one is not', async () => {
    st.settlements = [{ channel: 'Gb1', mode: 0, status: 'open', refundable: '1', readyAt: null }, { channel: 'Other1', mode: 0, status: 'in-use', refundable: '0', readyAt: null }];
    const r = await run('agent down');
    expect(r.data[0].what).toBe('Close 0 per-hour deposit(s) (they bill until closed) and start closing 1 per-GB deposit(s); refunds go to your wallet.');
  });
  it('--yes: a busy refund run is a failure (code busy), never ok with the deposits left open', async () => {
    st.session = { ...live };
    st.settleBusy = true;
    const r = await run('agent down --yes');
    expect(st.calls.disconnect).toBe(1);
    expect(r.error).toMatchObject({ code: 'busy', action: 'devnet-dvpn settle run --yes' });
    expect(r.data.find((d: { ok?: boolean }) => d?.ok === true && 'signatures' in d)).toBeUndefined();
  });
  it('--yes: a disconnect that throws settles nothing and says the deposit is still open (A5)', async () => {
    const { MODE_STREAM } = await import('../../src/core/chain/idl');
    st.session = { ...live };
    st.settlements = [{ channel: 'Chan1', mode: MODE_STREAM, status: 'in-use', refundable: '0', readyAt: null }];
    st.disconnectThrows = Object.assign(new Error('the VPN service did not answer'), { code: 'daemon-unavailable' });
    const r = await run('agent down --yes');
    expect(st.calls.settle).toBe(0);
    expect(r.error).toMatchObject({ code: 'daemon-unavailable', action: 'devnet-dvpn daemon doctor, then devnet-dvpn agent down --yes again' });
    expect(r.error?.message).toMatch(/^Could not disconnect, so no deposit was closed \(a per-hour deposit keeps billing\)/);
  });
  // The printed line: index.ts rewrites an error whose message daemonErrorCopy / rpcUnavailableCopy match. A raw
  // service failure is turned into its plain copy HERE, so index.ts leaves our message and action alone.
  it('--yes: a raw service failure on disconnect keeps "no deposit was closed" and our action through index.ts', async () => {
    const { daemonErrorCopy } = await import('../../src/core/daemon/link-copy');
    const { rpcUnavailableCopy } = await import('../../src/core/chain/rpc');
    st.session = { ...live };
    st.disconnectThrows = new Error('14 UNAVAILABLE: No connection established. connect ECONNREFUSED /var/lib/dvpnd/client/daemon.sock');
    const r = await run('agent down --yes');
    expect(r.error?.code).toBe('service-down');
    expect(r.error?.message).toMatch(/^Could not disconnect, so no deposit was closed \(a per-hour deposit keeps billing\)\. The VPN service is off\.$/);
    expect(r.error?.action).toBe('devnet-dvpn daemon doctor, then devnet-dvpn agent down --yes again');
    // What index.ts does next: neither rewrite matches, so this line is printed as is.
    expect(daemonErrorCopy(r.error!.message)).toBeNull();
    expect(rpcUnavailableCopy(r.error)).toBeNull();
  });
  it('--yes: a disconnect that throws with no code answers stop-failed', async () => {
    st.session = { ...live };
    st.disconnectThrows = new Error('stop refused');
    const r = await run('agent down --yes');
    expect(r.error?.code).toBe('stop-failed');
  });
  it('a connect that failed after paying: agent down --yes settles the open deposit it left', async () => {
    st.connectResult = { ok: false, error: 'The tunnel did not come up.', code: 'tunnel-failed' };
    const up = await run('agent up --yes');
    expect(up.error?.code).toBe('tunnel-failed');
    // What connection.ts leaves on the chain after such a failure (not modelled here): one open per-GB deposit.
    st.settlements = [{ channel: 'Paid1', mode: 0, status: 'open', refundable: '2000', readyAt: null }];
    const r = await run('agent down --yes');
    expect(st.calls.settle).toBe(1);
    expect(r.data[0]).toMatchObject({ ok: true, signatures: ['Sig1'], readyAt: 1_900_000_000 });
    expect(r.data[0].pending).toEqual([expect.objectContaining({ channel: 'Paid1', status: 'closing' })]);
  });
  it('no wallet: refuses before reading deposits (never "close 0 deposits" while some are open)', async () => {
    st.owner = null;
    st.settlements = [{ channel: 'Gb1', mode: 0, status: 'open', refundable: '1', readyAt: null }];
    const r = await run('agent down');
    // Matched without the CLI name: the UI-CONTROLS.md scanner would list this file as running that command.
    expect(r.error?.code).toBe('no-wallet');
    // First the way off the VPN (needs no wallet), then how to close the deposits.
    expect(r.error?.action).toMatch(/^\S+ disconnect to leave the VPN now; \S+ wallet import <file> \(the wallet that paid\), then \S+ agent down --yes to close the deposits$/);
    expect(r.data).toEqual([]);
    expect(st.calls.disconnect).toBe(0);
  });
  it('nothing left: next is to connect again', async () => {
    const r = await run('agent down --yes');
    expect(r.data[0]).toMatchObject({ spent: null, refundable: '0', next: 'devnet-dvpn agent up --yes to connect again' });
  });
});

describe('agent status', () => {
  it('connected: one line with session, exit IP, SOCKS and next = agent down', async () => {
    st.session = { ...live };
    st.publicIp = { ip: '203.0.113.9', sid: 'S1' };
    const r = await run('agent status');
    expect(r.data).toHaveLength(1);
    expect(r.data[0]).toMatchObject({ ok: true, address: OWNER, connected: true, session: 'S1', exitIp: '203.0.113.9', socks: 'socks5h://127.0.0.1:1080', spent: '0.25', next: 'devnet-dvpn agent down --yes' });
    // P8 R-12: the wallet's held balance is `held`; `refundable` is only the sum over deposits in `agent down`.
    expect(r.data[0]).toMatchObject({ held: '0' });
    expect(r.data[0].refundable).toBeUndefined();
  });
  it('statusNext walks the first run in order', () => {
    const base = { owner: OWNER, live: false, reachable: true, device: 'Dev1' };
    expect(statusNext({ ...base, owner: null, wallet: null })).toMatch(/wallet create --keyfile/);
    expect(statusNext({ ...base, wallet: undefined })).toMatch(/could not be read/);
    expect(statusNext({ ...base, wallet: { ...funded, ready: false, ownerLamports: 0, ownerTdvpn: '0' } as never })).toBe(`send at least 0.06 SOL and tDVPN (enough for one deposit: node price x units) to ${OWNER}, then devnet-dvpn agent up --yes`);
    expect(statusNext({ ...base, reachable: false, wallet: funded as never })).toMatch(/daemon install --yes/);
    expect(statusNext({ ...base, wallet: funded as never })).toBe('devnet-dvpn agent up --yes');
    expect(statusNext({ ...base, live: true, wallet: funded as never })).toBe('devnet-dvpn agent down --yes');
  });
});

// ─── CODE-AUDIT M13 (A): no session, internet blocked (kill switch held) ───
describe('agent: blocked with no session', () => {
  const BOTH = 'devnet-dvpn agent up --yes to reconnect through a node (protection stays), or devnet-dvpn daemon restore-network to go direct (protection off until the next connect)';
  it('agent status: blocked true, next names both ways out', async () => {
    st.internet = false;
    const r = await run('agent status');
    // R3 gap 3: ONE runnable next; the other way out is alsoNext (BOTH was prose an agent could not run as printed).
    expect(r.data[0]).toMatchObject({ connected: false, blocked: true, next: 'devnet-dvpn agent up --yes', alsoNext: 'devnet-dvpn daemon restore-network' });
    expect(BOTH).toContain(r.data[0].alsoNext);
  });
  it('negative control: internet answers: no blocked field, next is agent up', async () => {
    const r = await run('agent status');
    expect(r.data[0].blocked).toBeUndefined();
    expect(r.data[0].next).toBe('devnet-dvpn agent up --yes');
  });
  it('a live session is never "blocked" (the probe is not even asked)', async () => {
    st.internet = false;
    st.session = { ...live };
    const r = await run('agent status');
    expect(r.data[0].blocked).toBeUndefined();
  });
  it('agent up out of a block: connects (no second gate) and says blockedBefore', async () => {
    st.internet = false;
    const r = await run('agent up --protocol v2ray --country DE --yes');
    expect(st.calls.connect).toHaveLength(1);
    expect(r.data[0]).toMatchObject({ ok: true, connected: true, blockedBefore: true });
  });
  it('agent up with the internet up: no blockedBefore', async () => {
    const r = await run('agent up --protocol v2ray --country DE --yes');
    expect(r.data[0].blockedBefore).toBeUndefined();
  });
  it('statusNext: blocked with no wallet names restore-network first', () => {
    expect(statusNext({ owner: null, wallet: null, live: false, reachable: true, device: null, blocked: true })).toBe('devnet-dvpn daemon restore-network');
    expect(statusAlso({ owner: null, live: false, blocked: true })).toMatch(/^then devnet-dvpn wallet create/);
    expect(statusAlso({ owner: null, live: false, blocked: false })).toBeNull();
  });
});

// ─── A-NODES (the agent kit rc.8, T-C edge pass + T-A money audit): the no-nodes next names what the pick would take ───
describe('A-NODES: no-nodes never loops and never repeats the failing value', () => {
  const lapsed = (address: string, pricePerGb: string, o: Record<string, unknown> = {}): Record<string, unknown> => node(address, { pricePerGb, listingFresh: false, ...o });
  const unprobed = (address: string, pricePerGb: string, o: Record<string, unknown> = {}): Record<string, unknown> => node(address, { pricePerGb, probe: undefined, ...o });
  const up = (address: string, pricePerGb: string, o: Record<string, unknown> = {}): Record<string, unknown> => node(address, { pricePerGb, listingFresh: true, ...o });
  const notArgv = (r: { error: { action?: string } | null }, line: string): void => expect(r.error?.action).not.toBe(`devnet-dvpn ${line}`);
  it('T-C 1: --max-price 0: the exact price of the cheapest node that answers (0.0015), never a lapsed one at 0.001', async () => {
    st.nodes = [lapsed('X', '1000'), up('Y', '1500'), up('Z', '50000000')];
    const r = await run('agent up --max-price 0 --yes');
    expect(r.error?.code).toBe('no-nodes');
    expect(r.error?.message).toMatch(/The cheapest matching node above your --max-price: 0\.0015 tDVPN\/GB\. Nothing was paid\.$/);
    expect(r.error?.action).toBe('devnet-dvpn agent up --basis per_gb --units 1 --max-price 0.0015 --yes');
    expect(st.calls.connect).toHaveLength(0);
  });
  it('T-C 2: --max-price 0.001 with a lapsed node at 0.001: says why it is not taken, names 0.0015, never 0.001 again', async () => {
    st.nodes = [lapsed('X', '1000'), up('Y', '1500'), up('Z', '50000000')];
    const r = await run('agent up --max-price 0.001 --yes');
    expect(r.error?.message).toBe('No online node matches at --max-price 0.001 tDVPN/GB. 1 node at or under it does not answer its check or its listing lapsed. The cheapest matching node above your --max-price: 0.0015 tDVPN/GB. Nothing was paid.');
    expect(r.error?.action).toBe('devnet-dvpn agent up --basis per_gb --units 1 --max-price 0.0015 --yes');
    notArgv(r, 'agent up --max-price 0.001 --yes');
  });
  it('T-C 3: --country US --max-price 0.01 with no US node answering: the country is named as the blocker, next drops it', async () => {
    st.nodes = [lapsed('US1', '1000', { countryCode: 'US' }), unprobed('US2', '50000000', { countryCode: 'US' }), up('DE1', '2000')];
    const r = await run('agent up --country US --max-price 0.01 --yes');
    expect(r.error?.message).toBe('No node in US answers its check at --max-price 0.01 tDVPN/GB right now; 1 node elsewhere does. Nothing was paid.');
    expect(r.error?.action).toBe('devnet-dvpn agent up --basis per_gb --units 1 --max-price 0.01 --yes');
    expect(r.error?.action).not.toMatch(/--max-price 0\.001|--max-price 50/);
  });
  it('the protocol is the blocker: named, and next drops --protocol', async () => {
    st.nodes = [up('W1', '2000', { protocolNames: ['wireguard'], probe: { ok: false, latencyMs: 0 } }), up('V1', '2000')];
    const r = await run('agent up --protocol wireguard --yes');
    expect(r.error?.message).toBe('No wireguard node answers its check right now; 1 node with another protocol does. Nothing was paid.');
    expect(r.error?.action).toBe('devnet-dvpn agent up --basis per_gb --units 1 --yes');
  });
  it('T-A 1: --node N8 (0.002, no answer) --max-price 0.01: why N8 is not picked; another node\'s price is never named', async () => {
    st.nodes = [up('N8', '2000', { probe: { ok: false, latencyMs: 0 } }), up('C', '1000')];
    const r = await run('agent up --node N8 --max-price 0.01 --yes');
    expect(r.error?.message).toBe('Node N8 is not picked: it does not answer its check right now. Nothing was paid.');
    expect(r.error?.action).toBe('devnet-dvpn nodes list --online --json');
    expect(st.calls.connect).toHaveLength(0);
  });
  it('T-A 1b: --node above --max-price: its exact price, and the next keeps --node', async () => {
    st.nodes = [up('N8', '50000000'), up('C', '1000')];
    const r = await run('agent up --node N8 --max-price 0.01 --yes');
    expect(r.error?.message).toBe('Node N8 is not picked: its price is 50 tDVPN/GB, above your --max-price 0.01. Nothing was paid.');
    expect(r.error?.action).toBe('devnet-dvpn agent up --node N8 --basis per_gb --units 1 --max-price 50 --yes');
  });
  it('T-A 1c: --node with the wrong --protocol / --country: the next keeps --node and drops only that flag', async () => {
    st.nodes = [up('N8', '2000')];
    expect((await run('agent up --node N8 --protocol wireguard --yes')).error?.action).toBe('devnet-dvpn agent up --node N8 --basis per_gb --units 1 --yes');
    expect((await run('agent up --node N8 --country US --yes')).error?.message).toBe('Node N8 is not picked: it is in DE, not US. Nothing was paid.');
  });
  it('negative controls: a node that answers under the cap is picked; with nothing listed at all the old generic answer stays', async () => {
    st.nodes = [lapsed('X', '1000'), up('Y', '1500')];
    await run('agent up --max-price 0.002 --yes');
    expect((st.calls.connect[0] as { node: string }).node).toBe('Y');
    st.nodes = []; st.calls.connect.length = 0;
    const r = await run('agent up --max-price 0.01 --yes');
    expect(r.error?.message).toBe('No online node matches these filters.');
    expect(st.calls.connect).toHaveLength(0);
  });
});

// ─── E-1: the preflight's approval shortfall gets a command, not "Raise it in Wallet → Device" ───
describe('agent up: approval below the deposit', () => {
  it("code 'preflight' with fundingBlocker's text: next = device setup --allowance", async () => {
    st.connectResult = { ok: false, error: 'Your spending approval is lower than this deposit. Raise it in Wallet → Device.', code: 'preflight', action: 'Open Wallet' };
    const r = await run('agent up --protocol v2ray --country DE --yes');
    expect(r.error?.code).toBe('preflight');
    expect(r.error?.action).toBe('devnet-dvpn device setup --allowance <N> --yes (N = grant.allowance from "devnet-dvpn device show --json" divided by 1000000, plus the deposit, in tDVPN), then devnet-dvpn agent up --yes');
  });
  it('negative control: another preflight refusal keeps its own next', async () => {
    st.connectResult = { ok: false, error: 'Something else.', code: 'preflight' };
    const r = await run('agent up --protocol v2ray --country DE --yes');
    expect(r.error?.action).toBe('read "error": it names what to change (nothing was paid), then devnet-dvpn agent up --yes'); // sweep 1: not agent status
  });
});

// ─── B-UP agent (the agent kit rc.8, T-C edge pass): a second `agent up --yes` waits for the first, then reuses its session ───
describe('B-UP: two agent up --yes at once', () => {
  it('the second waits on the lock, then answers reused:true for the first one\'s session; nothing is paid twice', async () => {
    const lock = bJoin(hostDir.dir, 'agent-up.lock');
    bWrite(lock, JSON.stringify({ pid: process.pid, at: Date.now() })); // the first run, still connecting
    setTimeout(() => { st.session = { ...live }; bRm(lock, { force: true }); }, 700); // it connects and lets go
    const r = await run('agent up --yes');
    expect(r.error).toBeNull();
    expect(r.data[0]).toMatchObject({ reused: true, session: 'S1', node: 'NodeA' });
    expect(st.calls.connect).toHaveLength(0);
    expect(st.calls.disconnect).toBe(0);
    expect(bExists(lock)).toBe(false);
  });
  it('a run that connects takes and releases the lock (negative control: no lock is left behind)', async () => {
    await run('agent up --yes');
    expect(st.calls.connect).toHaveLength(1);
    expect(bExists(bJoin(hostDir.dir, 'agent-up.lock'))).toBe(false);
  });
  it('session-active never ends the other session: next = agent status --json', async () => {
    st.connectResult = { ok: false, error: 'A VPN session is already running (started from the command line or another window). Disconnect it first, then connect again. Nothing was paid.', code: 'session-active' };
    const r = await run('agent up --yes');
    expect(r.error?.code).toBe('session-active');
    expect(r.error?.action).toBe('devnet-dvpn agent status --json');
    expect(r.error?.action).not.toMatch(/agent down/);
    expect(nextFor('session-active')).toBe('devnet-dvpn agent status --json');
  });
});

// ─── E-21 (money): an empty value flag is a usage error, never a paid connect ───
describe('agent up: empty value flags', () => {
  for (const line of ['agent up --plan --yes', 'agent up --plan= --yes', 'agent up --node --yes', 'agent up --country= --yes', 'agent up --max-price --yes']) {
    it(`${line}: usage error, nothing connected`, async () => {
      // The real parser: this file's args() has no "=" form.
      const { parseArgs } = await import('../../src/cli/args');
      let r: { error: Error | null } = { error: null };
      try { await agentCmd(parseArgs(line.split(' ')) as never, { json: true, print: () => undefined }); } catch (err) { r = { error: err as Error }; }
      expect(r.error?.message ?? '').toMatch(/needs a value/);
      expect(st.calls.connect).toEqual([]);
    });
  }
});

// ─── M-S (the agent kit rc.8, macOS kit): `agent status` names a key file others can read; next = the chmod line ───
describe('M-S: agent status and a key file others can read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-keyfile-'));
  const keyfile = (mode: number): string => {
    const f = path.join(dir, `key${mode.toString(8)}.json`);
    fs.writeFileSync(f, '[]');
    fs.chmodSync(f, mode);
    return f;
  };
  it.skipIf(process.platform === 'win32')('mode 644: ok (a read), keyfileMode named, next = the chmod line', async () => {
    const f = keyfile(0o644);
    const r = await run(`agent status --keyfile ${f}`);
    expect(r.error).toBeNull();
    expect(r.data[0]).toMatchObject({ ok: true, keyfileMode: `The key file ${f} can be read by other users (mode 644).`, next: `chmod 600 ${f}, then devnet-dvpn agent up --yes` });
  });
  it.skipIf(process.platform === 'win32')('negative control: mode 600 answers as with no key file at all', async () => {
    const f = keyfile(0o600);
    const plain = (await run('agent status')).data[0];
    const r = (await run(`agent status --keyfile ${f}`)).data[0];
    expect(r.keyfileMode).toBeUndefined();
    expect(r.next).toBe(plain.next);
    expect(r.next).not.toMatch(/^chmod/);
  });
  it.skipIf(process.platform === 'win32')('under a block the way out stays first; the field still names the key file', async () => {
    const f = keyfile(0o640);
    st.session = { ...live };
    rb.next = 'devnet-dvpn daemon restore-network';
    try {
      const r = (await run(`agent status --keyfile ${f}`)).data[0];
      expect(r).toMatchObject({ reconnecting: true, next: 'devnet-dvpn daemon restore-network', keyfileMode: `The key file ${f} can be read by other users (mode 640).` });
    } finally { rb.next = null; }
  });
  it.skipIf(process.platform === 'win32')('agent up keeps refusing the same file with the same line (keyfile-mode, nothing connected)', async () => {
    const f = keyfile(0o644);
    const r = await run(`agent up --keyfile ${f} --yes`);
    expect(r.error?.code).toBe('keyfile-mode');
    expect(r.error?.action).toBe(`chmod 600 ${f}, then devnet-dvpn agent up --yes`);
    expect(st.calls.connect).toHaveLength(0);
  });
});

// ─── E-8 (money): no --max-price = the cheapest band, never the fastest at any price ───
describe('agent up: default price band', () => {
  const dear = (): Record<string, unknown> => node('NodeX', { pricePerGb: '5000000', probe: { ok: true, latencyMs: 5 } }); // 5 tDVPN/GB (5x the cheapest; the wallet holds 10), fastest
  it('no --max-price: a fast server at 5x the price is not picked', async () => {
    st.nodes = [...st.nodes, dear()];
    await run('agent up --yes');
    expect((st.calls.connect[0] as { node: string }).node).toBe('NodeB'); // 1 tDVPN/GB, 20 ms
  });
  it('with --max-price the agent chose its cap: lowest latency under it wins', async () => {
    st.nodes = [...st.nodes, dear()];
    await run('agent up --max-price 100 --yes');
    expect((st.calls.connect[0] as { node: string }).node).toBe('NodeX');
  });
  it('pickPool: offline or lapsed servers never set the floor', async () => {
    const { pickPool } = await import('../../src/cli/agent-cmd');
    const cheapOffline = node('NodeO', { pricePerGb: '1', probe: { ok: false } });
    const lapsed = node('NodeL', { pricePerGb: '1', listingFresh: false });
    const band = pickPool([cheapOffline, lapsed, node('NodeA'), dear()] as never, { basis: 'per_gb', units: 1 }, false);
    expect(band.map((n) => n.address)).toEqual(['NodeA']);
    expect(pickPool([dear()] as never, { basis: 'per_gb', units: 1 }, true)).toHaveLength(1); // a plan: no band
  });
});

// ─── Band M (hub docs/BAND-M-RESULTS.md): the server stops serving ───
describe('agent: the server stopped serving (E-35 / E-36)', () => {
  const dep = { channel: 'ChanM', node: 'NodeA', mode: 0, escrow: '1000000', redeemed: '0', status: 'open', readyAt: null, refundable: '1000000' };
  it('E-35 status: exit address == this computer\'s own: connected false, code server-stopped, next agent up --yes', async () => {
    st.session = { ...live };
    st.publicIp = { ip: '198.51.100.7', sid: 'S1' }; // the direct address read before the session
    const r = await run('agent status');
    expect(r.data[0]).toMatchObject({ ok: true, connected: false, code: 'server-stopped', next: 'devnet-dvpn agent up --yes', alsoNext: 'devnet-dvpn agent down --yes' });
    expect(r.data[0].message).toMatch(/^The node stopped serving; your traffic is NOT going through it\./);
    expect(r.data[0].exitIp).toBeUndefined();
    expect(lf.recorded[0]).toEqual(['NodeA', 'server-stopped']);
  });
  it('E-36 status: the daemon ended the session ("stopped working"): same answer, deposit safe + refund path', async () => {
    st.settlements = [dep];
    hist.rows = [{ node: 'NodeA', endedAt: Date.now() - 20_000, closeReason: 'the connection to this server stopped working' }];
    const r = await run('agent status');
    expect(r.data[0]).toMatchObject({ connected: false, code: 'server-stopped', next: 'devnet-dvpn agent up --yes' });
    expect(r.data[0].message).toMatch(/Your deposit is safe: devnet-dvpn agent down --yes closes it and the unused 1 tDVPN is refunded/);
    expect(r.data[0].deposits).toEqual([{ channel: 'ChanM', node: 'NodeA', status: 'open', refundable: '1', readyAt: null }]);
  });
  it('E-82: the server stopped AND the kill switch holds the block: next names restore-network first (Linux rc.4 T7)', async () => {
    st.settlements = [dep]; st.internet = false;
    hist.rows = [{ node: 'NodeA', endedAt: Date.now() - 20_000, closeReason: 'the connection to this server stopped working' }];
    const r = await run('agent status');
    expect(r.data[0]).toMatchObject({ connected: false, code: 'server-stopped', blocked: true, alsoNext: 'then devnet-dvpn agent up --yes to reconnect, or devnet-dvpn agent down --yes to close the deposit' });
    expect(r.data[0].next).toBe('devnet-dvpn daemon restore-network'); // E-86: one runnable command
  });
  it('E-87: a live session that reconnects with the internet held: connected false, reconnecting + blocked, next = one command (Linux rc.6 Q5)', async () => {
    st.session = { ...live }; st.settlements = [dep];
    rb.next = 'devnet-dvpn daemon restore-network';
    try {
      const r = await run('agent status');
      expect(r.data[0]).toMatchObject({ ok: true, connected: false, reconnecting: true, blocked: true, node: live.node, next: 'devnet-dvpn daemon restore-network', alsoNext: 'then devnet-dvpn agent up --yes to reconnect, or devnet-dvpn agent down --yes to close the deposit' });
      expect(r.data[0].code).toBeUndefined();
      expect(r.data[0].exitIp).toBeUndefined();
    } finally { rb.next = null; }
    // negative control: the same live session with no blocked reconnect is connected, next agent down
    expect((await run('agent status')).data[0]).toMatchObject({ connected: true, next: 'devnet-dvpn agent down --yes' });
  });
  it('negative controls: a normal exit address stays connected; an old or unrelated end says nothing', async () => {
    st.session = { ...live };
    st.publicIp = { ip: '203.0.113.9', sid: 'S1' };
    expect((await run('agent status')).data[0]).toMatchObject({ connected: true, next: 'devnet-dvpn agent down --yes' });
    st.session = null;
    hist.rows = [{ node: 'NodeA', endedAt: Date.now() - 3 * 3600_000, closeReason: 'the connection to this server stopped working' }];
    expect((await run('agent status')).data[0].code).toBeUndefined();
    hist.rows = [{ node: 'NodeA', endedAt: Date.now() - 5_000, closeReason: 'Disconnected by you' }];
    expect((await run('agent status')).data[0].code).toBeUndefined();
    st.homeIp = null; // home unknown: cannot tell, so never "stopped"
    st.session = { ...live };
    st.publicIp = { ip: '198.51.100.7', sid: 'S1' };
    expect((await run('agent status')).data[0].connected).toBe(true);
  });
  it('E-35 up: a session with the direct address is not reused as connected: it switches to another server, skips the dead one, says so', async () => {
    st.session = { ...live };
    st.publicIp = { ip: '198.51.100.7', sid: 'S1' };
    st.connectResult = { ok: true, data: { ...live, id: 'S2', node: 'NodeB' } };
    const r = await run('agent up --yes');
    expect(r.data[0].reused).toBeUndefined();
    expect((st.calls.connect[0] as { node: string }).node).toBe('NodeB');
    expect(r.data[0]).toMatchObject({ replaced: { node: 'NodeA', code: 'server-stopped' } });
    expect(r.data[0].replacedNote).toMatch(/^The node stopped serving; your traffic is NOT going through it\. Switched to NodeB; NodeA is skipped next time\./);
    expect(lf.recorded.some((x) => x[0] === 'NodeA' && x[1] === 'server-stopped')).toBe(true);
  });
  it('negative control up: a healthy live session is still reused and pays nothing', async () => {
    st.session = { ...live };
    st.publicIp = { ip: '203.0.113.9', sid: 'S1' };
    const r = await run('agent up --yes');
    expect(r.data[0]).toMatchObject({ reused: true, connected: true });
    expect(st.calls.connect).toHaveLength(0);
  });
});

describe('agent: the server refuses after the deposit (E-37)', () => {
  const dep = { channel: 'ChanR', node: 'NodeA', mode: 0, escrow: '1000000', redeemed: '0', status: 'open', readyAt: null, refundable: '1000000' };
  it('a failure with an unknown code after the deposit is node-refused, and the action names the deposit and both ways out', async () => {
    st.connectResult = { ok: false, error: 'Something went wrong. Retry.', code: 'unknown' };
    st.settlements = [dep];
    const r = await run('agent up --node NodeA --yes');
    expect(r.error?.code).toBe('node-refused');
    expect(r.error?.action).toMatch(/^a deposit of 1 tDVPN is open with this node \(ChanR\): devnet-dvpn agent up --yes picks another node \(this node is skipped\), or devnet-dvpn agent down --yes closes it and refunds/);
    expect(lf.recorded).toContainEqual(['NodeA', 'node-refused']);
  });
  it('a closing deposit counts too, with its readyAt', async () => {
    st.connectResult = { ok: false, error: 'x', code: 'unknown' };
    st.settlements = [{ ...dep, status: 'closing', readyAt: 1_900_000_000 }];
    const r = await run('agent up --node NodeA --yes');
    expect(r.error?.action).toMatch(/closes it and refunds the unused part after 2030-03-17T/);
  });
  it('status after it lists the deposit and next is agent down --yes (never agent up, which opens a second one)', async () => {
    st.settlements = [dep];
    const r = await run('agent status');
    expect(r.data[0]).toMatchObject({ connected: false, next: 'devnet-dvpn agent down --yes' });
    expect(r.data[0].deposits).toHaveLength(1);
    st.settlements = [{ ...dep, status: 'closing', readyAt: 1_900_000_000 }];
    expect((await run('agent status')).data[0].next).toMatch(/^devnet-dvpn settle run --yes after 2030-.*then devnet-dvpn settle withdraw --yes$/);
  });
  it('S5/E-71: the catch-all "Something went wrong. Retry." never reaches the agent; it says whether a deposit was paid', async () => {
    st.connectResult = { ok: false, error: 'Something went wrong. Retry.', code: 'unknown' };
    st.settlements = [dep];
    const paid = await run('agent up --node NodeA --yes');
    expect(paid.error?.message).not.toMatch(/Something went wrong/);
    expect(paid.error?.message).toMatch(/^The node did not start the session after your deposit was paid\. The deposit is safe/);
    st.settlements = [{ ...dep, node: 'NodeZ' }];
    const unpaid = await run('agent up --node NodeA --yes');
    expect(unpaid.error).toMatchObject({ code: 'unknown' });
    expect(unpaid.error?.message).toMatch(/^Connect failed for a reason this app does not name\. Nothing was paid\./);
    // a real reason is kept, in brackets
    st.connectResult = { ok: false, error: 'tls handshake failed.', code: 'unknown' };
    expect((await run('agent up --node NodeA --yes')).error?.message).toMatch(/does not name \(tls handshake failed\)\. Nothing was paid/);
  });
  it('negative controls: no deposit with that server keeps the plain code; a refusal before paying never reads deposits', async () => {
    st.connectResult = { ok: false, error: 'x', code: 'unknown' };
    st.settlements = [{ ...dep, node: 'NodeZ' }];
    expect((await run('agent up --node NodeA --yes')).error?.code).toBe('unknown');
  });
});

describe('agent up over SOCKS: next is one plain command (E-38)', () => {
  it('next has no shell characters; the SOCKS words are in note', async () => {
    st.publicIp = { ip: '203.0.113.9', sid: 'S1', viaProxy: true, directIp: '198.51.100.7' };
    const r = await run('agent up --protocol v2ray --country DE --yes');
    expect(r.data[0].next).toBe('devnet-dvpn agent down --yes');
    expect(String(r.data[0].next)).not.toMatch(/[;()&|<>$`]/);
    expect(String(r.data[0].note)).toMatch(/socks5h:\/\/127\.0\.0\.1:1080/);
  });
});

describe('agent up dry run (P8 S-3)', () => {
  it('without --yes the sentence ends by saying nothing was signed; with --yes there is no dry run', async () => {
    const r = await run('agent up --node NodeA');
    expect(r.data[0]).toMatchObject({ needsConfirm: true });
    expect(String(r.data[0].what)).toMatch(/unused part refunded\. Nothing is signed until you pass --yes\.$/);
    expect((await run('agent up --node NodeA --yes')).data[0].needsConfirm).toBeUndefined();
  });
});

// ─── C-CLOCK (the agent kit rc.8, T-C edge pass): clock-skew = the command that fixes the clock, exit 4, never a deposit ───
describe('C-CLOCK: agent up with a wrong clock', () => {
  const SKEW = 'This computer\'s clock is about 7 min ahead of the network\'s time, so servers would refuse the connection. Set the date and time to automatic, then connect again. Nothing was paid.';
  it('T-C shape: a CLOSING deposit with that node is never named; next = the clock command; exit 4, nothing paid', async () => {
    const { exitCodeFor } = await import('../../src/cli/exit-codes');
    const { moneyOf } = await import('../../src/cli/money-note');
    st.connectResult = { ok: false, error: SKEW, code: 'clock-skew' };
    st.settlements = [{ channel: 'ChanClosing', node: 'NodeB', mode: 0, escrow: '2000000', status: 'closing', refundable: '1883', readyAt: null }];
    const r = await run('agent up --yes');
    expect(r.error?.code).toBe('clock-skew');
    expect(r.error?.message).toBe(SKEW);
    expect(r.error?.action).toBe(nextFor('clock-skew', process.platform));
    expect(r.error?.action).not.toMatch(/deposit|picks another node/);
    expect(exitCodeFor('clock-skew')).toBe(4);
    expect(moneyOf('clock-skew')).toBe('none');
  });
  it('one command per OS', () => {
    expect(nextFor('clock-skew', 'linux')).toBe('sudo timedatectl set-ntp true && (sudo chronyc makestep 2>/dev/null || true), then devnet-dvpn agent up --yes');
    expect(nextFor('clock-skew', 'darwin')).toBe('sudo sntp -sS time.apple.com, then devnet-dvpn agent up --yes');
    expect(nextFor('clock-skew', 'win32')).toBe('Start-Service w32time; w32tm /resync /force (elevated PowerShell), then devnet-dvpn agent up --yes');
  });
  it('negative control: after a code that may leave a deposit open, that deposit is still named (E-22 a)', async () => {
    st.connectResult = { ok: false, error: 'x', code: 'tunnel-failed' };
    st.settlements = [{ channel: 'ChanOpen', node: 'NodeB', mode: 0, escrow: '2000000', status: 'open', refundable: '2000000', readyAt: null }];
    expect((await run('agent up --yes')).error?.action).toMatch(/^a deposit of 2 tDVPN is open with this node \(ChanOpen\)/);
  });
});

// ─── L-RPC (the agent kit rc.8, Linux R4): waiting-for-network = nothing paid, exit 6, next = the daemon set --rpc line ───
describe('L-RPC: agent up while the service cannot reach its RPC', () => {
  const WFN = 'Waiting for the network. The VPN service started before this device was online and is still trying to reach the Solana network. Nothing was paid.';
  const SET_RPC = 'devnet-dvpn daemon set --rpc <https url> --yes (the VPN service\'s Solana connection), then devnet-dvpn agent up --yes';
  it('an older deposit with that node is never named: next = the daemon set --rpc line', async () => {
    st.connectResult = { ok: false, error: WFN, code: 'waiting-for-network' };
    st.settlements = [{ channel: 'ChanOld', node: 'NodeB', mode: 0, escrow: '2000000', status: 'closing', refundable: '1883', readyAt: null }];
    const r = await run('agent up --yes');
    expect(r.error?.code).toBe('waiting-for-network');
    expect(r.error?.message).toBe(WFN);
    expect(r.error?.action).toBe(SET_RPC);
  });
  it('its class: nothing was paid, exit 6 (network: retry later)', async () => {
    const { moneyOf } = await import('../../src/cli/money-note');
    const { exitCodeFor } = await import('../../src/cli/exit-codes');
    expect(moneyOf('waiting-for-network')).toBe('none');
    expect(exitCodeFor('waiting-for-network')).toBe(6);
  });
  it('negative control: a code after which a deposit may be open still names it (E-22 a), and stays exit 1', async () => {
    const { exitCodeFor } = await import('../../src/cli/exit-codes');
    st.connectResult = { ok: false, error: 'x', code: 'tunnel-failed' };
    st.settlements = [{ channel: 'ChanOld', node: 'NodeB', mode: 0, escrow: '2000000', status: 'open', refundable: '2000000', readyAt: null }];
    expect((await run('agent up --yes')).error?.action).toMatch(/^a deposit of 2 tDVPN is open with this node \(ChanOld\)/);
    expect(exitCodeFor('tunnel-failed')).toBe(1);
    expect(exitCodeFor('rpc-timeout')).toBe(1);
  });
});

// ─── E-73 (blind round 3 T-A, Linux rc.4): a limit raise is said in the preview and the answer ───
describe('agent up: spending limit below the deposit (E-73)', () => {
  // The T-A numbers: a 0.001 cap, a 0.002 deposit; after the connect the allowance reads 50 tDVPN minus the deposit.
  const cheap = (): void => { st.nodes = [node('NodeA', { pricePerGb: '2000' })]; };
  it('preview without --yes says --yes also raises the limit, and to what', async () => {
    cheap(); st.wallet = { ...funded, grant: { allowance: '1000' } };
    const r = await run('agent up --node NodeA');
    expect(r.data[0]).toMatchObject({ needsConfirm: true });
    expect(String(r.data[0].what)).toContain("This computer's spending limit (0.001 tDVPN) is below this deposit. It is raised only with --raise-limit: then --yes raises it to 0.02 tDVPN.");
    expect(r.data[0].limitRaise).toBeUndefined(); // the line rides in `what`; the confirm mock keeps only that
    expect(String(r.data[0].what)).toMatch(/Nothing is signed until you pass --yes\.$/);
  });
  it('S7: --yes alone never raises the limit: refused with spending-limit, nothing paid, next = the line + --raise-limit', async () => {
    cheap(); st.wallet = { ...funded, grant: { allowance: '1000' } }; st.calls.connect.length = 0;
    const r = await run('agent up --node NodeA --yes');
    expect(r.error?.code).toBe('spending-limit');
    expect(r.error?.message).toBe('Spending limit 0.001 tDVPN is below this deposit (0.002 tDVPN). Nothing was paid. next sets the limit to this deposit (0.002 tDVPN); alsoNext raises it to 0.02 tDVPN with --raise-limit.');
    expect(r.error?.action).toBe('devnet-dvpn device setup --allowance 0.002 --yes, then devnet-dvpn agent up --node NodeA --basis per_gb --units 1 --yes'); // LIM-1 (rc.9)
    expect((r.error as { alsoNext?: string }).alsoNext).toBe('devnet-dvpn agent up --node NodeA --basis per_gb --units 1 --raise-limit --yes');
    expect(st.calls.connect).toHaveLength(0);
  });
  it('LIM-1 (rc.9, T-A 3): next sets the limit to this deposit only; the Settings-wide raise is alsoNext; nothing paid', async () => {
    cheap(); st.wallet = { ...funded, grant: { allowance: '1000' } }; st.calls.connect.length = 0;
    const r = await run('agent up --node NodeA --max-price 0.01 --yes');
    expect(r.error?.code).toBe('spending-limit');
    expect(r.error?.action).toMatch(/^devnet-dvpn device setup --allowance 0\.002 --yes, then devnet-dvpn agent up --node NodeA .*--max-price 0\.01 --yes$/);
    expect(r.error?.action).not.toMatch(/--raise-limit/);
    expect((r.error as { alsoNext?: string }).alsoNext).toMatch(/--max-price 0\.01 --raise-limit --yes$/);
    expect(st.calls.connect).toHaveLength(0);
    const { errorOutput } = await import('../../src/cli/error-out');
    const j = JSON.parse(errorOutput(r.error, true, 'agent up').text);
    expect(j.alsoNext).toBe((r.error as { alsoNext?: string }).alsoNext);
    expect(JSON.parse(errorOutput(Object.assign(new Error('x'), { code: 'node-gone', action: 'y' }), true, 'agent up').text).alsoNext).toBeUndefined(); // negative control
  });
  it('LIM-5 (rc.9, T-A 4): --raise-limit-to 0.005 sets the limit to exactly 0.005 before the deposit, then connects', async () => {
    cheap(); st.wallet = { ...funded, grant: { allowance: '1000' } }; st.calls.connect.length = 0; setups.length = 0;
    const r = await run('agent up --node NodeA --raise-limit-to 0.005 --yes');
    expect(r.error).toBeNull();
    expect(setups).toEqual(['0.005']);
    expect(st.calls.connect).toHaveLength(1);
  });
  it('LIM-5: --raise-limit-to below this deposit is refused, nothing signed or paid; next = the line with the deposit', async () => {
    cheap(); st.wallet = { ...funded, grant: { allowance: '1000' } }; st.calls.connect.length = 0; setups.length = 0;
    const r = await run('agent up --node NodeA --raise-limit-to 0.001 --yes');
    expect(r.error?.code).toBe('spending-limit');
    expect(r.error?.action).toBe('devnet-dvpn agent up --node NodeA --basis per_gb --units 1 --raise-limit-to 0.002 --yes');
    expect(setups).toEqual([]);
    expect(st.calls.connect).toHaveLength(0);
  });
  it('LIM-5 negative control: a limit already above the deposit: --raise-limit-to signs nothing extra', async () => {
    cheap(); st.wallet = { ...funded, grant: { allowance: '9000000' } }; st.calls.connect.length = 0; setups.length = 0;
    expect((await run('agent up --node NodeA --raise-limit-to 0.005 --yes')).error).toBeNull();
    expect(setups).toEqual([]);
  });
  it('E-88 (blind T-A, rc.6): the refusal line keeps the agent\'s own --protocol and --max-price', async () => {
    cheap(); st.wallet = { ...funded, grant: { allowance: '1000' } }; st.calls.connect.length = 0;
    const r = await run('agent up --protocol v2ray --node NodeA --max-price 0.01 --yes');
    expect(r.error?.code).toBe('spending-limit');
    expect(r.error?.action).toBe('devnet-dvpn device setup --allowance 0.002 --yes, then devnet-dvpn agent up --node NodeA --protocol v2ray --basis per_gb --units 1 --max-price 0.01 --yes'); // LIM-1 (rc.9)
    expect((r.error as { alsoNext?: string }).alsoNext).toBe('devnet-dvpn agent up --node NodeA --protocol v2ray --basis per_gb --units 1 --max-price 0.01 --raise-limit --yes');
    expect(st.calls.connect).toHaveLength(0);
  });
  it('answer after --raise-limit --yes names the raise: limitRaised {from,to} and limitNote with the command that lowers it', async () => {
    cheap(); st.wallet = { ...funded, grant: { allowance: '1000' } }; st.walletAfter = { ...funded, grant: { allowance: '49998000' } };
    const r = await run('agent up --node NodeA --raise-limit --yes');
    expect(r.error).toBeNull();
    expect(r.data[0].limitRaised).toEqual({ from: '0.001', to: '50', fromBase: '1000', toBase: '50000000' });
    expect(r.data[0].limitNote).toBe("This computer's spending limit was 0.001 tDVPN, below this deposit, so it was raised to 50 tDVPN (the Settings limit). To lower it: devnet-dvpn device setup --allowance <N> --yes");
  });
  it('negative control: a limit already above the deposit is used, not raised: no preview line, no limitRaised', async () => {
    cheap(); st.wallet = { ...funded, grant: { allowance: '50000000' } }; st.walletAfter = { ...funded, grant: { allowance: '49998000' } };
    expect(String((await run('agent up --node NodeA')).data[0].what)).not.toContain('spending limit');
    const r = await run('agent up --node NodeA --yes');
    expect(r.data[0].limitRaised).toBeUndefined();
    expect(r.data[0].limitNote).toBeUndefined();
  });
  it('a failed re-read after the connect never breaks the answer (no limit fields)', async () => {
    cheap(); st.wallet = { ...funded, grant: { allowance: '1000' } }; st.walletAfter = { ...funded, grant: null };
    const r = await run('agent up --node NodeA --raise-limit --yes');
    expect(r.data[0]).toMatchObject({ ok: true, connected: true });
    expect(r.data[0].limitRaised).toBeUndefined();
  });
});

// ─── L-STALE (the agent kit rc.8, Linux R4): server-stopped is cleared once nothing of it is left ───
describe('L-STALE: agent status after the server stopped, agent down ran and the block lifted', () => {
  const ended = (): Record<string, unknown>[] => [{ node: 'NodeA', endedAt: Date.now() - 11 * 60_000, closeReason: 'the connection to this server stopped working' }];
  const closing = { channel: 'ChanC', node: 'NodeA', mode: 0, escrow: '2000', redeemed: '1', status: 'closing', readyAt: null, refundable: '1412' };
  const open = { ...closing, channel: 'ChanO', status: 'open' };
  it('live shape: no deposit left, the internet answers direct, 0 < tDVPN < deposit: no server-stopped, next = the funding preview', async () => {
    hist.rows = ended(); st.settlements = []; st.wallet = { ...funded, ownerTdvpn: '1000' };
    const r = (await run('agent status')).data[0];
    expect(r.code).toBeUndefined();
    expect(r.nodeStopped).toBeUndefined();
    expect(r.next).toBe('devnet-dvpn agent up');
  });
  it('the deposits are closing (agent down ran): the answer is the one with no stop at all', async () => {
    st.settlements = [closing]; st.wallet = { ...funded, ownerTdvpn: '1000' };
    const plain = (await run('agent status')).data[0];
    hist.rows = ended();
    const r = (await run('agent status')).data[0];
    expect(r.code).toBeUndefined();
    expect(r.next).toBe(plain.next);
    expect(r.alsoNext).toBe(plain.alsoNext);
  });
  it('negative control: a deposit with that server still open: server-stopped stays (the refund path is the news)', async () => {
    hist.rows = ended(); st.settlements = [open];
    expect((await run('agent status')).data[0]).toMatchObject({ code: 'server-stopped', next: 'devnet-dvpn agent up --yes' });
  });
  it('negative control: the internet does not answer (a block): server-stopped stays, next = restore-network', async () => {
    hist.rows = ended(); st.settlements = [closing]; st.internet = false;
    expect((await run('agent status')).data[0]).toMatchObject({ code: 'server-stopped', blocked: true, next: 'devnet-dvpn daemon restore-network' });
  });
});

// ─── E-75 (blind round 3 T-C, Linux rc.4): service down + a closing deposit: next = the service fix ───
describe('agent status: service down with a deposit closing (E-75)', () => {
  const closing = { channel: 'Ch1', node: 'NodeA', mode: 0, escrow: '2000', redeemed: '1', status: 'closing', readyAt: 1_900_000_000, refundable: '1883' };
  it('next names daemon install, the deposit wait moves to alsoNext', async () => {
    st.reachable = false; st.settlements = [{ ...closing }];
    const r = await run('agent status');
    expect(r.data[0]).toMatchObject({ service: false, connected: false });
    expect(String(r.data[0].next)).toMatch(/^devnet-dvpn daemon install --yes/);
    expect(r.data[0].alsoNext).toBe(`devnet-dvpn settle run --yes after ${new Date(1_900_000_000 * 1000).toISOString()} (a closing deposit waits 2 h), then devnet-dvpn settle withdraw --yes`);
  });
  it('negative control: service up keeps the deposit wait as next, no alsoNext', async () => {
    st.reachable = true; st.settlements = [{ ...closing }];
    const r = await run('agent status');
    expect(r.data[0].next).toBe(`devnet-dvpn settle run --yes after ${new Date(1_900_000_000 * 1000).toISOString()} (a closing deposit waits 2 h), then devnet-dvpn settle withdraw --yes`);
    expect(r.data[0].alsoNext).toBeUndefined();
  });
});

// ─── T-C row 16 (RC8 W47): an installed but stopped Linux service is started, not reinstalled ───
describe('agent status: installed but stopped service (T-C row 16)', () => {
  const closing = { channel: 'Ch1', node: 'NodeA', mode: 0, escrow: '2000', redeemed: '1', status: 'closing', readyAt: 1_900_000_000, refundable: '1883' };
  afterEach(() => { units.now = { installed: null, serviceActive: false, socketActive: false }; });
  it('next = sudo systemctl start <unit>.socket, agent up (and the deposit wait) in alsoNext', async () => {
    st.reachable = false; st.settlements = [{ ...closing }];
    units.now = { installed: true, serviceActive: false, socketActive: false };
    const r = await run('agent status');
    expect(r.data[0].next).toBe('sudo systemctl start sentinel-dvpnd@c0.socket');
    expect(String(r.data[0].alsoNext)).toMatch(/^then devnet-dvpn agent up --yes \(or devnet-dvpn settle run --yes after /); // W15: the deposit wait is the settle line
  });
  it('negative control: not installed keeps daemon install', async () => {
    st.reachable = false; st.settlements = [];
    units.now = { installed: false, serviceActive: false, socketActive: false };
    const r = await run('agent status');
    expect(String(r.data[0].next)).toMatch(/^devnet-dvpn daemon install --yes/);
  });
});

// ─── E-72 (Windows rc.4, review): agent down names an open deposit of another device ───
describe('agent down: a deposit another device opened stays open (E-72)', () => {
  it('warning + notClosed + next = revoke, then settle run --device', async () => {
    st.settlements = [{ channel: '5F5E', node: 'NodeA', mode: 0, escrow: '2000', redeemed: '0', status: 'open', readyAt: null, refundable: '2000', unverified: true, device: '98rw' }];
    const r = await run('agent down --yes');
    expect(r.error).toBeNull();
    const ans = r.data[r.data.length - 1];
    expect(ans.notClosed).toEqual([{ channel: '5F5E', device: '98rw' }]);
    expect(ans.warning).toBe('1 deposit(s) opened by another device of this wallet (98rw) are still open: this computer cannot close them, so nothing was refunded for them.');
    expect(ans.next).toBe('devnet-dvpn device revoke --device 98rw --yes (if it is not revoked yet), then devnet-dvpn settle run --device 98rw --yes');
  });
  it("negative control: this computer's own open deposit is closed as before, no warning", async () => {
    st.settlements = [{ channel: 'Own1', node: 'NodeA', mode: 0, escrow: '2000', redeemed: '0', status: 'open', readyAt: null, refundable: '2000' }];
    const r = await run('agent down --yes');
    const ans = r.data[r.data.length - 1];
    expect(ans.warning).toBeUndefined();
    expect(String(ans.next)).toMatch(/^devnet-dvpn settle run --yes after /);
  });
});

// ─── P3 (the agent kit plan): status survives a deposit read or a history read that throws (logged, never thrown) ───
describe('agent status: failed reads', () => {
  const throwing = <T extends object>(obj: T, key: keyof T, msg: string): (() => void) => {
    const keep = obj[key];
    Object.defineProperty(obj, key, { configurable: true, get: () => { throw new Error(msg); }, set: () => undefined });
    return () => { Object.defineProperty(obj, key, { configurable: true, writable: true, enumerable: true, value: keep }); };
  };
  it('a deposit read that throws answers status without deposits (never a crash)', async () => {
    const undo = throwing(st, 'settlements', 'rpc down');
    try {
      const r = await run('agent status');
      expect(r.error).toBeNull();
      expect(r.data[0]).toMatchObject({ ok: true });
      expect(r.data[0].deposits).toBeUndefined();
    } finally { undo(); }
  });
  it('a history read that throws answers status with no server-stopped claim', async () => {
    const undo = throwing(hist, 'rows', 'history file unreadable');
    try {
      const r = await run('agent status');
      expect(r.error).toBeNull();
      expect(r.data[0]).toMatchObject({ ok: true });
      expect(r.data[0].code).not.toBe('server-stopped');
    } finally { undo(); }
  });
});

// ─── S3 (the agent kit rc.6): one unit scheme: every amount is a decimal string, with its base-unit sibling ───
describe('agent answers: decimals plus base units (S3)', () => {
  it('status carries sol+solLamports, tdvpn+tdvpnBase, held+heldBase', async () => {
    const r = await run('agent status');
    expect(r.data[0]).toMatchObject({ sol: '0.05', solLamports: '50000000', tdvpn: '10', tdvpnBase: '10000000', held: '0', heldBase: '0' });
  });
  it('up deposit carries tdvpn+tdvpnBase', async () => {
    st.connectResult = { ok: true, data: { ...live } };
    const r = await run('agent up --node NodeA --yes');
    expect(r.data[0].deposit).toMatchObject({ tdvpn: '1', tdvpnBase: '1000000' });
  });
});

// ─── E-84 (Linux rc.5, review): a fresh computer, no device and no service ───
describe('agent status: fresh computer (E-84)', () => {
  it('next names the service install, never a bare "agent up --yes" that cannot start it', async () => {
    st.device = null; st.reachable = false;
    const r = await run('agent status');
    expect(r.data[0]).toMatchObject({ device: null, service: false });
    expect(String(r.data[0].next)).toMatch(/^devnet-dvpn daemon install --yes/);
    expect(String(r.data[0].next)).toMatch(/then devnet-dvpn agent up --yes$/);
  });
  it('negative control: service up with no device keeps agent up (it makes the device itself)', async () => {
    st.device = null; st.reachable = true;
    expect((await run('agent status')).data[0].next).toBe('devnet-dvpn agent up --yes');
  });
});

// ─── L-DROP (the agent kit rc.8, Linux R4): no --max-price, the cheap nodes offline, the 50 node up, limit 150 ───
describe('LIM-3 (rc.9, T-A 25): defaults.spendingLimit is the live limit', () => {
  it('a raised grant (299.997) with Settings at 150: spendingLimit = 299.997 (grant), configuredDefault = 150', async () => {
    st.allowanceTdvpn = '150'; st.wallet = { ...funded, ownerTdvpn: '200000000', grant: { allowance: '299997000' } };
    const r = await run('agent up --yes');
    const d = (r.data[0] as { defaults: Record<string, unknown> }).defaults;
    expect(d).toMatchObject({ spendingLimit: '299.997', spendingLimitSource: 'grant', configuredDefault: '150' });
  });
  it('negative control: no grant read: spendingLimit = the Settings amount, source settings', async () => {
    st.allowanceTdvpn = '150'; st.wallet = { ...funded, ownerTdvpn: '200000000' };
    const d = ((await run('agent up --yes')).data[0] as { defaults: Record<string, unknown> }).defaults;
    expect(d).toMatchObject({ spendingLimit: '150', spendingLimitSource: 'settings', configuredDefault: '150' });
  });
});

describe('L-DROP: the default cap widens to the cheapest answering node within the spending limit', () => {
  const off = (address: string): Record<string, unknown> => node(address, { pricePerGb: '1000', probe: { ok: false, latencyMs: 0 } });
  const live4 = (): Record<string, unknown>[] => [off('C1'), off('C2'), off('C3'), node('Dray', { pricePerGb: '50000000' })];
  const WHY = /no answering node is under the default cap of 15 tDVPN, and the cheapest one that answers \(Dray, 50 tDVPN\) is within your spending limit of 150 tDVPN, so it was picked$/;
  it('live shape: cheap nodes offline, the 50 node answers, limit 150: it is picked and defaults.reason says so', async () => {
    st.allowanceTdvpn = '150'; st.wallet = { ...funded, ownerTdvpn: '200000000' }; st.nodes = live4();
    const r = await run('agent up --yes');
    expect(r.error).toBeNull();
    expect((st.calls.connect[0] as { node: string }).node).toBe('Dray');
    const d = (r.data[0] as { defaults: Record<string, unknown> }).defaults;
    expect(d).toMatchObject({ priceCap: '15', spendingLimit: '150', capWidened: '50', capWidenedBase: '50000000' });
    expect(d.reason).toMatch(WHY);
  });
  it('the preview (no --yes) says so before anything is signed', async () => {
    st.allowanceTdvpn = '150'; st.wallet = { ...funded, ownerTdvpn: '200000000' }; st.nodes = live4();
    const r = await run('agent up');
    expect((r.data[0] as { what: string }).what).toMatch(/^The default cap was widened to 50 tDVPN: no answering node is under the default cap of 15 tDVPN, and the cheapest one that answers \(Dray, 50 tDVPN\) is within your spending limit of 150 tDVPN, so it was picked\. Connect to Dray/);
    expect(st.calls.connect).toHaveLength(0);
  });
  it('negative control: above the spending limit (limit 40): price-cap as before, nothing paid', async () => {
    st.allowanceTdvpn = '40'; st.wallet = { ...funded, ownerTdvpn: '200000000' }; st.nodes = live4();
    const r = await run('agent up --yes');
    expect(r.error?.code).toBe('price-cap');
    expect(st.calls.connect).toHaveLength(0);
  });
  it('negative control: an answering node under the cap is picked and nothing is widened', async () => {
    st.allowanceTdvpn = '150'; st.wallet = { ...funded, ownerTdvpn: '200000000' }; st.nodes = [...live4(), node('Cheap', { pricePerGb: '1000000' })];
    const r = await run('agent up --yes');
    expect((st.calls.connect[0] as { node: string }).node).toBe('Cheap');
    expect((r.data[0] as { defaults: Record<string, unknown> }).defaults.capWidened).toBeUndefined();
  });
  it('negative control: --node names the 50 node: price-cap as before (the agent chose it)', async () => {
    st.allowanceTdvpn = '150'; st.wallet = { ...funded, ownerTdvpn: '200000000' }; st.nodes = live4();
    expect((await run('agent up --node Dray --yes')).error?.code).toBe('price-cap');
    expect(st.calls.connect).toHaveLength(0);
  });
});

// ─── S7 default cap (the agent kit rc.6, review proposal): no --max-price → deposit ≤ Settings limit / 10 ───
describe('agent up: default deposit cap (S7)', () => {
  it('a 5 tDVPN/GB node with the 50 tDVPN setting (cap 5) is fine; at 6 it is refused, nothing paid', async () => {
    st.allowanceTdvpn = '50'; st.nodes = [node('NodeA', { pricePerGb: '5000000' })]; st.calls.connect.length = 0;
    expect((await run('agent up --node NodeA --yes')).error?.code).not.toBe('price-cap');
    st.nodes = [node('NodeA', { pricePerGb: '6000000' })]; st.calls.connect.length = 0;
    const r = await run('agent up --node NodeA --yes');
    expect(r.error?.code).toBe('price-cap');
    expect(r.error?.message).toBe('This deposit (6 tDVPN) is above the default cap of 5 tDVPN (your spending limit / 10). Nothing was paid. The cheapest matching node above the cap: 6 tDVPN/GB; add --max-price 6 to accept it.');
    expect(r.error?.action).toMatch(/^devnet-dvpn agent up --node NodeA --basis per_gb --units 1 --max-price 6 --yes \(you accept this price\)/);
    expect(st.calls.connect).toHaveLength(0);
  });
  it('negative controls: --max-price replaces the cap; a setting of 100 gives a cap of 10', async () => {
    st.allowanceTdvpn = '50'; st.nodes = [node('NodeA', { pricePerGb: '6000000' })];
    expect((await run('agent up --node NodeA --max-price 60 --yes')).error?.code).not.toBe('price-cap');
    st.allowanceTdvpn = '100';
    expect((await run('agent up --node NodeA --yes')).error?.code).not.toBe('price-cap');
  });
});

describe('R3 gap 2 (STATE-MATRIX): status next is the preview when agent up --yes would be refused', () => {
  const base = { owner: OWNER, live: false, reachable: true, device: 'Dev1' };
  it('a device whose spending permission reads 0: agent up (preview, pays nothing)', () => {
    expect(statusNext({ ...base, wallet: { ...funded, grant: { allowance: '0' } } as never })).toBe('devnet-dvpn agent up');
  });
  it('under 1 tDVPN held: agent up (preview names the shortfall)', () => {
    expect(statusNext({ ...base, wallet: { ...funded, ownerTdvpn: '500000', grant: { allowance: '150000000' } } as never })).toBe('devnet-dvpn agent up');
  });
  it('negative control: funded with a permission: agent up --yes', () => {
    expect(statusNext({ ...base, wallet: { ...funded, grant: { allowance: '150000000' } } as never })).toBe('devnet-dvpn agent up --yes');
  });
});

describe('R7: the market is read over the nodes that match the request (both paths agree)', () => {
  it('--protocol wireguard: p75 over the wireguard nodes only; the cheap pick still pays the cheap price', async () => {
    const wg = (a: string, p: string): Record<string, unknown> => node(a, { protocolNames: ['wireguard'], pricePerGb: p, probe: { ok: true, latencyMs: 20 } });
    const v2 = (a: string, p: string): Record<string, unknown> => node(a, { protocolNames: ['v2ray'], pricePerGb: p, probe: { ok: true, latencyMs: 20 } });
    st.allowanceTdvpn = '150';
    st.nodes = [wg('W1', '2000'), wg('W2', '50000000'), wg('W3', '50000000'), v2('V1', '90000000'), v2('V2', '90000000'), v2('V3', '90000000')];
    const r = await run('agent up --protocol wireguard --yes'); // the confirm mock keeps only `what`; the answer carries defaults too
    const a = r.data[0] as { defaults: { market: unknown; source: string }; deposit: { tdvpnBase: string } };
    const d = a.defaults;
    expect(d.market).toMatchObject({ nodes: 3, p75: '50' });
    expect(d.source).toBe('market');
    expect(a.deposit.tdvpnBase).toBe('2000');
  });
  it('negative control: with fewer than 3 matching priced nodes the fixed cap applies and says why', async () => {
    st.allowanceTdvpn = '150';
    st.nodes = [node('W1', { protocolNames: ['wireguard'], pricePerGb: '2000', probe: { ok: true, latencyMs: 20 } })];
    const r = await run('agent up --protocol wireguard --yes'); // the confirm mock keeps only `what`; the answer carries defaults too
    const b = r.data[0] as { defaults: { reason?: string } };
    expect(b.defaults).toMatchObject({ source: 'fixed', market: null });
    expect(b.defaults.reason).toMatch(/fewer than 3 priced nodes/);
  });
});

// ─── K2-T (the agent kit rc.8, Windows R4): no-nodes names a price only above --max-price; a block answers with its own code ───
describe('K2-T: no-nodes under a kill-switch block, and the price it names', () => {
  const dead = (address: string, pricePerGb: string): Record<string, unknown> => node(address, { pricePerGb, probe: { ok: false, latencyMs: 0 } });
  it('every check fails and there is no internet: kill-switch-held, next = restore-network, nothing connected', async () => {
    st.internet = false; st.nodes = [dead('NodeA', '1000'), dead('NodeB', '2000')];
    const r = await run('agent up --max-price 0.01 --yes');
    expect(r.error?.code).toBe('kill-switch-held');
    expect(r.error?.action).toBe('devnet-dvpn daemon restore-network');
    expect(r.error?.message).toBe('No server answered its check, and this computer has no internet: the kill switch is holding the block. Nothing was paid.');
    expect(st.calls.connect).toHaveLength(0);
  });
  it('negative control: every check fails but the internet answers: no-nodes, not the block', async () => {
    st.internet = true; st.nodes = [dead('NodeA', '1000')];
    const r = await run('agent up --max-price 0.01 --yes');
    expect(r.error?.code).toBe('no-nodes');
    expect(r.error?.action).not.toMatch(/restore-network/);
  });
  it('negative control: no internet but a node answers its check: the price refusal, not the block', async () => {
    st.internet = false; st.nodes = [node('NodeA', { pricePerGb: '5000000' })];
    const r = await run('agent up --max-price 1 --yes');
    expect(r.error?.code).toBe('no-nodes');
    expect(r.error?.message).toMatch(/cheapest matching node above your --max-price: 5 tDVPN\/GB/);
    expect(r.error?.action).toMatch(/--max-price 5 --yes$/);
  });
  it('a price under --max-price is never named (the R4 line read 0.001 under a 0.01 cap)', async () => {
    st.internet = true; st.nodes = [node('NodeA', { pricePerGb: '1000', probe: undefined })];
    const r = await run('agent up --max-price 0.01 --yes');
    expect(r.error?.code).toBe('no-nodes');
    expect(r.error?.message).not.toMatch(/above your --max-price/);
    expect(r.error?.action).not.toMatch(/--max-price 0\.001/);
    expect(r.error?.action).toBe('devnet-dvpn nodes list --online --json, then widen --protocol / --country / --max-price');
  });
  it('negative control: one under the cap that does not answer and one above it that does: only the one above is named', async () => {
    st.internet = true; st.nodes = [node('NodeA', { pricePerGb: '1000', probe: undefined }), node('NodeB', { pricePerGb: '3000000' })];
    const r = await run('agent up --max-price 0.01 --yes');
    expect(r.error?.message).toMatch(/cheapest matching node above your --max-price: 3 tDVPN\/GB/);
    expect(r.error?.action).toMatch(/--max-price 3 --yes$/);
  });
});
