// ─── State matrix (hub docs/STATE-MATRIX.md): mocks copied from agent-cmd.test.ts (keep the two in step) ───
// Services injected as in status-no-hang.test.ts: nothing touches the chain, the daemon or the network.
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
vi.mock('../../src/main/scheduler', () => ({ runJobNow: async () => ({ ok: true }) }));
// E-73: `walletAfter` is what a read after connect() returns (connect may have raised the limit).
vi.mock('../../src/main/services/wallet', () => ({ refreshWallet: async () => (st.calls.connect.length && st.walletAfter ? st.walletAfter : st.wallet) }));
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
const nw = vi.hoisted(() => ({ code: 'no-wallet' as 'no-wallet' | 'keyfile-missing' }));
vi.mock('../../src/main/wallet/vault', () => ({ ownerAddress: () => st.owner, noWallet: () => (nw.code === 'keyfile-missing' ? { error: 'The key file /home/a/key.json is missing.', code: 'keyfile-missing' } : { error: 'Set up a wallet first.', code: 'no-wallet' }) }));

const { agentCmd, agentInputs, filterNodes, statusNext, nextFor, AGENT_SOL_MIN } = await import('../../src/cli/agent-cmd');

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
});

// ─── The state matrix (hub docs/STATE-MATRIX.md, review R3): one expected answer per state × command ───
// The mocks above are agent-cmd.test.ts's, unchanged, plus `nw` (the vault's no-wallet reason). Each cell checks code,
// exit (exit-codes.ts), money (money-note.ts), next / action and alsoNext. Cells for the rc.7 gaps are `it.fails`
// with the gap number: they fail on today's code by design, and the lead flips each to `it` as its fix lands.
const { exitCodeFor } = await import('../../src/cli/exit-codes');
const { moneyOf } = await import('../../src/cli/money-note');
const { errorOutput } = await import('../../src/cli/error-out');
const { SWEEP1_NEXT } = await import('../../src/cli/agent-cmd');
const { CONNECT_CODES } = await import('../../src/core/session/state');

beforeEach(() => { nw.code = 'no-wallet'; });

/** One failing cell: code, exit, money and the start of its `action` (= the matrix's next). */
async function failCell(line: string, want: { code: string; exit: number; money: string; next: RegExp }): Promise<Error & { code?: string; action?: string }> {
  const r = await run(line);
  expect(r.error, `${line} should fail`).not.toBeNull();
  expect(r.error!.code).toBe(want.code);
  expect(exitCodeFor(r.error!.code)).toBe(want.exit);
  expect(moneyOf(r.error!.code)).toBe(want.money);
  expect(r.error!.action ?? '').toMatch(want.next);
  return r.error!;
}
const statusOf = async (): Promise<Record<string, unknown>> => { const r = await run('agent status'); expect(r.error).toBeNull(); return r.data[0]; };
const connectFails = (code: string, error = 'x'): void => { st.connectResult = { ok: false, error, code }; };

// ─── 1. Wallet and funds ───
describe('matrix 1: wallet and funds', () => {
  it('no wallet: status next = wallet create; up no-wallet exit 4 none; down no-wallet exit 4', async () => {
    st.owner = null; st.wallet = null;
    expect((await statusOf()).next).toMatch(/^devnet-dvpn wallet create --keyfile/);
    await failCell('agent up --yes', { code: 'no-wallet', exit: 4, money: 'none', next: /^devnet-dvpn wallet create --keyfile/ });
    await failCell('agent down --yes', { code: 'no-wallet', exit: 4, money: 'none', next: /^devnet-dvpn disconnect to leave the VPN now/ });
  });
  it('key file missing: up keyfile-missing, money none, next = restore it', async () => {
    st.owner = null; st.wallet = null; nw.code = 'keyfile-missing';
    const e = await run('agent up --yes');
    expect(e.error?.code).toBe('keyfile-missing');
    expect(moneyOf('keyfile-missing')).toBe('none');
    expect(e.error?.action).toMatch(/^restore the key file/);
  });
  it('gap 5: keyfile-missing exits 4 (needs a person), like no-wallet', () => {
    expect(exitCodeFor('keyfile-missing')).toBe(4);
  });
  it('gap 1: a key file readable by others has its own code, exit 4, next chmod 600', () => {
    expect(exitCodeFor('keyfile-mode')).toBe(4);
    expect(moneyOf('keyfile-mode')).toBe('none');
    expect(nextFor('keyfile-mode')).toMatch(/^chmod 600 /);
  });
  it('no SOL before setup: status and up both name 0.06 SOL (R7: the device float + fees); up not-funded exit 4 none', async () => {
    st.wallet = { ...st.wallet!, ready: false, ownerLamports: 1_000 };
    expect((await statusOf()).next).toMatch(/^send at least 0\.06 SOL to /);
    await failCell('agent up --yes', { code: 'not-funded', exit: 4, money: 'none', next: /^send at least 0\.06 SOL/ });
  });
  it('tDVPN = 0: status names the tDVPN', async () => {
    st.wallet = { ...st.wallet!, ownerTdvpn: '0' };
    expect((await statusOf()).next).toMatch(/^send at least tDVPN/);
  });
  it('0 < tDVPN < deposit: up not-funded names the deposit', async () => {
    st.wallet = { ...st.wallet!, ownerTdvpn: '500000' };
    await failCell('agent up --yes', { code: 'not-funded', exit: 4, money: 'none', next: /^send at least 0.5 tDVPN / });
  });
  it('gap 2: 0 < tDVPN < deposit: status does not send the agent into that refusal', async () => {
    st.wallet = { ...st.wallet!, ownerTdvpn: '500000' };
    expect((await statusOf()).next).not.toBe('devnet-dvpn agent up --yes');
  });
});

// ─── 2. Device ───
describe('matrix 2: device', () => {
  it('no device, service up: status next agent up; up makes the device itself', async () => {
    st.device = null;
    expect((await statusOf()).next).toBe('devnet-dvpn agent up --yes');
    await run('agent up --yes');
    expect(st.calls.init).toBe(1);
  });
  it('fresh box (no device, no service): status next = daemon install (E-84)', async () => {
    st.device = null; st.reachable = false;
    expect((await statusOf()).next).toMatch(/^devnet-dvpn daemon install --yes/);
  });
  it('device revoked (no grant): status says agent up, which signs a new grant at connect (needsPermission). Lead: a gap or not?', async () => {
    st.wallet = { ...st.wallet!, grant: null, needsPermission: true };
    expect((await statusOf()).next).toBe('devnet-dvpn agent up --yes');
  });
  it('approval revoked at connect: approval-revoked, money open, next device setup', async () => {
    connectFails('approval-revoked');
    await failCell('agent up --yes', { code: 'approval-revoked', exit: 1, money: 'open', next: /^devnet-dvpn device setup --yes, then devnet-dvpn agent up --yes/ });
  });
  it('set up for another wallet: wallet-switch-needed, money none', async () => {
    connectFails('wallet-switch-needed');
    await failCell('agent up --yes', { code: 'wallet-switch-needed', exit: 1, money: 'none', next: /^load the key file of the wallet named in "error"/ });
  });
  it('deposits opened by another device: agent down ok, notClosed, next = revoke + settle --device (E-72)', async () => {
    st.settlements = [{ channel: 'ChanX', node: 'NodeA', status: 'open', device: 'DevOld', escrow: '1000000', refundable: '1000000', mode: 0 }];
    const r = await run('agent down --yes');
    expect(r.error).toBeNull();
    expect(r.data.at(-1)).toMatchObject({ notClosed: [{ channel: 'ChanX', device: 'DevOld' }] });
    expect(r.data.at(-1)!.next).toMatch(/^devnet-dvpn device revoke --device DevOld --yes/);
  });
});

// ─── 3. Service and build ───
describe('matrix 3: service and build', () => {
  it('service not installed or stopped: status next = daemon install', async () => {
    st.reachable = false;
    const s = await statusOf();
    expect(s.service).toBe(false);
    expect(s.next).toMatch(/^devnet-dvpn daemon install --yes/);
  });
  it('service missing at connect: daemon-missing, money none, next daemon install', async () => {
    connectFails('daemon-missing');
    await failCell('agent up --yes', { code: 'daemon-missing', exit: 1, money: 'none', next: /^devnet-dvpn daemon install --yes/ });
  });
  it('service restarting: daemon-restarting, next agent up again', async () => {
    connectFails('daemon-restarting');
    await failCell('agent up --yes', { code: 'daemon-restarting', exit: 1, money: 'none', next: /^devnet-dvpn agent up --yes again in a few seconds/ });
  });
  it('wrong build: network-mismatch, next daemon install', async () => {
    connectFails('network-mismatch');
    await failCell('agent up --yes', { code: 'network-mismatch', exit: 1, money: 'none', next: /^devnet-dvpn daemon install --yes/ });
  });
});

// ─── 4. Limits and price ───
describe('matrix 4: limits and price', () => {
  it('spending limit below the deposit: spending-limit exit 4 none, the line with --raise-limit --yes', async () => {
    st.allowanceTdvpn = '50'; st.wallet = { ...st.wallet!, grant: { allowance: '1000', rentPayer: 'Dev1111', permissions: 7 } };
    await failCell('agent up --yes', { code: 'spending-limit', exit: 4, money: 'none', next: /^devnet-dvpn device setup --allowance [\d.]+ --yes, then devnet-dvpn agent up --node NodeB .*--yes$/ }); // LIM-1 (rc.9)
  });
  it('gap 2: limit below the deposit: status does not send the agent into that refusal', async () => {
    st.allowanceTdvpn = '50'; st.wallet = { ...st.wallet!, grant: { allowance: '1000', rentPayer: 'Dev1111', permissions: 7 } };
    expect((await statusOf()).next).not.toBe('devnet-dvpn agent up --yes');
  });
  it('price above the cap: price-cap exit 4 none, the pinned line with --max-price', async () => {
    st.allowanceTdvpn = '50'; st.nodes = [node('NodeA', { pricePerGb: '10000000' })];
    await failCell('agent up --node NodeA --yes', { code: 'price-cap', exit: 4, money: 'none', next: /^devnet-dvpn agent up --node NodeA --basis per_gb --units 1 --max-price 10 --yes/ }); // L-DROP (rc.8): --node keeps the refusal
  });
  it('rule 5: price above the market cap names the number and the flag', async () => {
    st.allowanceTdvpn = '50'; st.nodes = [node('NodeA', { pricePerGb: '10000000' })];
    const r = await run('agent up --node NodeA --yes'); // L-DROP (rc.8): --node keeps the refusal
    expect(r.error?.message).toMatch(/cheapest matching node above the cap: 10 tDVPN\/GB; add --max-price 10/);
  });
  it('no node within --max-price: no-nodes exit 1 none, next = nodes list + widen', async () => {
    await failCell('agent up --max-price 0.0001 --yes', { code: 'no-nodes', exit: 1, money: 'none', next: /--max-price 1 --yes$/ }); // R7 rule 5: a runnable line at the cheapest price
  });
  it('rule 5: no node within the limit names the cheapest price above it and the flag', async () => {
    const r = await run('agent up --max-price 0.0001 --yes');
    expect(r.error?.message).toMatch(/cheapest matching node above your --max-price: 1 tDVPN\/GB/);
    expect(r.error?.action).toMatch(/--max-price 1 --yes/);
  });
});

// ─── 5. Session ───
describe('matrix 5: session', () => {
  it('session live: status connected, next agent down; up reuses it', async () => {
    st.session = { ...live }; st.publicIp = { ip: '203.0.113.9', sid: 'S1' };
    const s = await statusOf();
    expect(s).toMatchObject({ connected: true, next: 'devnet-dvpn agent down --yes' });
    const u = await run('agent up --yes');
    expect(u.data[0]).toMatchObject({ reused: true });
    expect(st.calls.connect.length).toBe(0);
  });
  it('reconnecting under the kill switch: connected false, blocked, next restore-network (E-87)', async () => {
    st.session = { ...live }; st.publicIp = { ip: '203.0.113.9', sid: 'S1' }; rb.next = 'devnet-dvpn daemon restore-network';
    const s = await statusOf();
    rb.next = null;
    expect(s).toMatchObject({ connected: false, reconnecting: true, blocked: true, next: 'devnet-dvpn daemon restore-network' });
  });
  it('gap 3: block with no session: next = agent up --yes, alsoNext = daemon restore-network', async () => {
    st.internet = false;
    const s = await statusOf();
    expect(s).toMatchObject({ blocked: true, next: 'devnet-dvpn agent up --yes', alsoNext: 'devnet-dvpn daemon restore-network' });
  });
  it('kill switch held at connect: kill-switch-held, exit 5, none, next restore-network', async () => {
    connectFails('kill-switch-held');
    await failCell('agent up --yes', { code: 'kill-switch-held', exit: 5, money: 'none', next: /^devnet-dvpn daemon restore-network, then devnet-dvpn agent up --yes/ });
  });
  it('a session is active in the service: session-active, none, next agent down then up', async () => {
    connectFails('session-active');
    await failCell('agent up --yes', { code: 'session-active', exit: 1, money: 'none', next: /^devnet-dvpn agent status --json$/ }); // B-UP (rc.8): look, never end the other session
  });
});

// ─── 6. Deposits ───
describe('matrix 6: deposits', () => {
  it('deposit open, no session: status next agent down', async () => {
    st.settlements = [{ channel: 'Chan1', node: 'NodeA', status: 'open', escrow: '1000000', refundable: '1000000', mode: 0 }];
    expect((await statusOf()).next).toBe('devnet-dvpn agent down --yes');
  });
  it('agent down with an open deposit: next = settle run after readyAt', async () => {
    st.settlements = [{ channel: 'Chan1', node: 'NodeA', status: 'open', escrow: '1000000', refundable: '1000000', mode: 0 }];
    const r = await run('agent down --yes');
    expect(r.data.at(-1)!.next).toMatch(/^devnet-dvpn settle run --yes after /);
  });
  it('refund run busy: busy, next settle run', async () => {
    st.settlements = [{ channel: 'Chan1', node: 'NodeA', status: 'open', escrow: '1000000', refundable: '1000000', mode: 0 }]; st.settleBusy = true;
    await failCell('agent down --yes', { code: 'busy', exit: 1, money: 'none', next: /^devnet-dvpn settle run --yes$/ });
  });
});

// ─── 7. Network, clock, concurrency ───
describe('matrix 7: network, clock, concurrency', () => {
  it('RPC 429: rpc-busy exit 6, money unclear, next again in a minute', async () => {
    connectFails('rpc-busy');
    await failCell('agent up --yes', { code: 'rpc-busy', exit: 6, money: 'unclear', next: /^devnet-dvpn agent up --yes again in a minute/ });
  });
  it('RPC down: rpc-unavailable exit 6, money unclear', async () => {
    connectFails('rpc-unavailable');
    await failCell('agent up --yes', { code: 'rpc-unavailable', exit: 6, money: 'unclear', next: /^devnet-dvpn / });
  });
  it('gap 4: rpc-unavailable and rpc-ws name the RPC fix (daemon set --rpc)', () => {
    expect(nextFor('rpc-unavailable')).toMatch(/daemon set --rpc/);
    expect(nextFor('rpc-ws')).toMatch(/daemon set --rpc/);
  });
  it('RPC down at status: balances null, next = status again', async () => {
    st.wallet = null;
    expect((await statusOf()).next).toMatch(/^devnet-dvpn agent status \(the balances could not be read/);
  });
  it('wrong clock: clock-skew names the minutes', async () => {
    connectFails('clock-skew', 'The clock is off by about 7 min.');
    await failCell('agent up --yes', { code: 'clock-skew', exit: 4, money: 'none', next: /^(sudo timedatectl set-ntp true && \(sudo chronyc makestep 2>\/dev\/null \|\| true\)|sudo sntp -sS time\.apple\.com|Start-Service w32time; w32tm \/resync \/force \(elevated PowerShell\)|w32tm \/resync \(from an elevated shell\)), then devnet-dvpn agent up --yes$/ }); // C-CLOCK (rc.8)
  });
  it('two agents at once: busy, next again in a few seconds', async () => {
    connectFails('busy');
    await failCell('agent up --yes', { code: 'busy', exit: 1, money: 'none', next: /^devnet-dvpn agent up --yes again in a few seconds/ });
  });
});

// ─── Every next is runnable or a named human step ───
/** The steps only a person (or the agent's own tools) can do; each is named, never a vague "fix it". */
const HUMAN = [/^send /, /^set this computer's clock/, /^sudo timedatectl set-ntp true && \(sudo chronyc makestep /, /^sudo sntp -sS time\.apple\.com, then /, /^w32tm \/resync /, /^Start-Service w32time; w32tm \/resync \/force /, /^load the key file/, /^restore the key file/, /^read "error"/, /^chmod 600 /, /^icacls "/,
  /^a deposit of /]; // a deposit of …: openDepositNext names two commands (pick another node, or agent down)

describe('every next is a command or a named human step', () => {
  const codes = [...new Set([...Object.keys(SWEEP1_NEXT), ...(CONNECT_CODES as readonly string[]), 'no-wallet', 'no-device', 'spending-limit', 'daemon-missing', 'protocol-missing'])];
  it('positive control: nextFor answers for every code', () => {
    expect(codes.length).toBeGreaterThan(50);
    for (const c of codes) expect(typeof nextFor(c)).toBe('string');
  });
  it('negative control: a vague step is caught', () => {
    const ok = (s: string): boolean => s.startsWith('devnet-dvpn ') || HUMAN.some((r) => r.test(s));
    expect(ok('try again later')).toBe(false);
  });
  it('every nextFor(code) starts with devnet-dvpn or a named human step', () => {
    const bad = codes.map((c) => [c, nextFor(c)] as const).filter(([, s]) => !s.startsWith('devnet-dvpn ') && !HUMAN.some((r) => r.test(s)));
    expect(bad).toEqual([]);
  });
});

// ─── Gap 6: a failure carries `next` (= action) in its JSON line ───
describe('gap 6: failures carry next', () => {
  it('positive control: a failure line carries action today', async () => {
    st.owner = null; st.wallet = null;
    const r = await run('agent up --yes');
    const line = JSON.parse(errorOutput(r.error, true, 'agent').text);
    expect(line).toMatchObject({ ok: false, code: 'no-wallet' });
    expect(line.action).toMatch(/^devnet-dvpn wallet create/);
  });
  it('gap 6: the same line carries next = action', async () => {
    st.owner = null; st.wallet = null;
    const r = await run('agent up --yes');
    const line = JSON.parse(errorOutput(r.error, true, 'agent').text);
    expect(line.next).toBe(line.action);
  });
});
