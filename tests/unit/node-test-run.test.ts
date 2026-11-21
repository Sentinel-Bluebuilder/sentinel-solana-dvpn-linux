// ─── Node test run: the service on the engine (rows 149–156) ───
// One real session per server through the app's own connect; a failing server never stops the
// run; the deposit is on disk the moment it is known and closed right after its server; Stop
// works mid-server and the run can be continued; a deposit the user already had is left alone.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Status = 'open' | 'closing' | 'ready' | 'in-use';
const h = vi.hoisted(() => ({
  dir: '',
  session: null as null | { channel: string },
  connects: [] as string[],
  shown: [] as string[],
  purposes: [] as string[],
  hook: true,
  atDeposit: (() => undefined) as () => void,
  foreign: new Set<string>(),
  foreignPay: false,
  limitLeft: null as string | null,
  listFails: false,
  escrows: [] as Array<string | undefined>,
  stuck: new Set<string>(),
  deviceOwner: 'Owner' as string | null,
  disconnects: 0,
  failCode: {} as Record<string, string>,
  payThenFail: '',
  onConnect: (() => undefined) as () => void,
  chain: new Map<string, { node: string; status: 'open' | 'closing' | 'ready' | 'in-use'; mode: number }>(),
  settled: [] as string[],
  onSettle: ((_c: string) => undefined) as (c: string) => void,
  price: { pricePerGb: '0', pricePerHour: '1000' } as { pricePerGb: string; pricePerHour: string },
  prices: {} as Record<string, { pricePerGb: string; pricePerHour: string }>,
  protocols: {} as Record<string, string[]>,
  speed: { ok: true, figure: { method: 'steady-v1', mbps: 100, basis: 'steady', p90Mbps: 100, rampSeconds: 0, falling: false, bytes: 1e8, ms: 8000, streams: 4 }, source: 'test' } as unknown,
}));
vi.mock('../../src/main/store', () => ({ storePath: (n: string) => `${h.dir}/${n}` }));
vi.mock('../../src/main/logger', () => ({ log: { warn: () => undefined, info: () => undefined, error: () => undefined } }));
vi.mock('../../src/main/wallet/vault', () => ({ ownerAddress: () => 'Owner' }));
vi.mock('../../src/main/app-state', () => ({
  snapshot: () => ({ session: h.session, dns: null }),
  setNodeTestProgress: (v: null | { done: number; total: number; server: string }) => { h.shown.push(v ? `${v.done}/${v.total} ${v.server}`.trim() : 'none'); },
}));
vi.mock('../../src/core/chain/idl', () => ({ CHANNEL_STATUS_OPEN: 0 }));
vi.mock('../../src/core/chain/accounts', () => ({
  channelsByOwner: async () => { if (h.listFails) throw new Error('429 Too Many Requests'); return [...h.chain].filter(([, c]) => c.status === 'open' || c.status === 'in-use').map(([address, c]) => ({ address, node: c.node, status: 0 })); },
  // the Solana network itself: this wallet's deposits, and deposits another wallet paid (never in our list)
  channelByPda: async (a: string) => (h.chain.has(a) ? { owner: 'Owner', status: ['open', 'in-use'].includes(h.chain.get(a)!.status) ? 0 : 1 } : h.foreign.has(a) ? { owner: 'Other', status: 0 } : null),
}));
vi.mock('../../src/main/services/wallet', () => ({ refreshWallet: async () => (h.limitLeft === null ? null : { grant: { allowance: h.limitLeft } }) }));
vi.mock('../../src/main/daemon/manager', () => ({ deviceRecord: () => (h.deviceOwner ? { owner: h.deviceOwner, device: 'Dev' } : null) }));
vi.mock('../../src/main/services/settlement', () => ({
  readSettlements: async () => [...h.chain].map(([channel, c]) => ({ channel, node: c.node, mode: c.mode, status: c.status, readyAt: c.status === 'closing' ? Math.floor(Date.now() / 1000) + 7200 : null })),
  // start the close (per hour: ready at once; per GB: a 2 h wait), then close
  runSettlement: async (only: string[]) => {
    for (const ch of only) {
      const c = h.chain.get(ch);
      if (!c || h.stuck.has(ch)) continue;
      h.onSettle(ch);
      h.settled.push(ch);
      if (c.status === 'open') c.status = c.mode === 1 ? 'ready' : 'closing';
      else if (c.status === 'ready') h.chain.delete(ch);
    }
    return { ok: true, data: [] };
  },
}));
vi.mock('../../src/core/nodes/discovery', () => ({
  discoverNode: async (a: string) => (a === 'GONE' ? null : {
    address: a, owner: 'Op', listed: true, expiresAt: Math.floor(Date.now() / 1000) + 3600, country: 'US', countryCode: 'US',
    protocolNames: h.protocols[a] ?? ['wireguard'], uri: 'https://10.0.0.1:443', ...(h.prices[a] ?? h.price),
  }),
  probeNode: async () => ({
    ok: true, reachable: true, latencyMs: 40, signatureValid: true, claimsMatch: true, signerIsOwner: true, signerAuthorized: true, metadataExpired: false,
    tlsPinMatch: true, peers: 1, maxPeers: 50, downloadMbps: null, uploadMbps: null, city: null, serviceType: 'wireguard', version: '1', error: null, probedAt: Date.now(),
  }),
}));
vi.mock('../../src/core/quality/quality', () => ({ publicIp: async () => ({ ip: '10.0.0.1' }) }));
vi.mock('../../src/core/quality/steady-download', () => ({ steadyDownload: async () => h.speed, SPEED_SOURCES: [] }));
vi.mock('../../src/core/quality/pinned-origin', () => ({ originSource: () => ({}), parseSpeedOrigin: () => null }));
vi.mock('../../src/main/services/connection', () => ({
  connect: async (r: { node: string; basis: string; purpose?: string; shownEscrow?: string }, hooks: { onDeposit?: (channel: string) => void } = {}) => {
    h.connects.push(r.node);
    h.escrows.push(r.shownEscrow);
    h.purposes.push(String(r.purpose));
    if (h.failCode[r.node]) return { ok: false, error: 'x', code: h.failCode[r.node], paid: false };
    const ch = `ch-${r.node}`;
    if (h.foreignPay) {
      // the service paid from another wallet: the deposit is on the network but not in this wallet's list
      h.foreign.add(ch);
      hooks.onDeposit?.(ch);
      h.onConnect();
      return { ok: true, data: { service: 'wireguard', channel: ch, proxyEndpoint: '' } };
    }
    if (!h.chain.has(ch)) {
      h.chain.set(ch, { node: r.node, status: 'open', mode: r.basis === 'per_hour' ? 1 : 0 });
      if (h.hook) hooks.onDeposit?.(ch); // the engine reports a deposit paid for this start
      h.atDeposit();
    }
    // paid: undefined = an engine that does not say (the service then looks on chain itself)
    if (r.node === h.payThenFail) return { ok: false, error: 'x', code: 'timeout', ...(h.hook ? { paid: true, channel: ch } : {}) };
    h.onConnect();
    return { ok: true, data: { service: 'wireguard', channel: ch, proxyEndpoint: '' } };
  },
  disconnect: async (o: { purpose?: string } = {}) => { h.disconnects++; h.purposes.push(`end:${o.purpose}`); return { ok: true }; },
}));
vi.mock('node:dns', () => ({ default: { promises: { lookup: async () => ({ address: '1.1.1.1' }) } } }));
const svc = await import('../../src/main/services/node-test');

const latest = (): { openDeposits: Array<{ deposit: string }>; results: unknown[] } => JSON.parse(fs.readFileSync(path.join(h.dir, 'node-tests', 'latest.json'), 'utf8'));

beforeEach(() => {
  h.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddv-nodetest-'));
  // The service waits 7 s between transactions and 2 s before the exit check: run those waits at once.
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => { queueMicrotask(fn); return 0; }) as unknown as typeof setTimeout);
  h.session = null; h.connects = []; h.shown = []; h.purposes = []; h.hook = true; h.atDeposit = () => undefined; h.disconnects = 0;
  h.foreign.clear(); h.foreignPay = false; h.deviceOwner = 'Owner'; h.limitLeft = null; h.listFails = false; h.stuck.clear(); h.escrows = []; h.failCode = {}; h.payThenFail = ''; h.onConnect = () => undefined;
  h.chain.clear(); h.settled = []; h.onSettle = () => undefined; h.price = { pricePerGb: '0', pricePerHour: '1000' }; h.prices = {}; h.protocols = {};
});
afterEach(() => { vi.restoreAllMocks(); });
const run = (nodes: string[], extra: Record<string, unknown> = {}) => svc.runNodeTest({ nodes, maxSpend: '1000000000', confirmed: true, ...extra }, () => undefined);
const verdicts = (r: { data?: { results: Array<{ verdict: string }> } }): string[] => r.data!.results.map((x) => x.verdict);

describe('audit U-2 and U-3: deposits the run cannot account for', () => {
  it('U-2: when the open deposits cannot be read, the run does not start and nothing is paid', async () => {
    h.listFails = true;
    const r = await run(['A']);
    expect(r).toMatchObject({ ok: false, code: 'deposits-unread' });
    expect(r.error).toContain('Nothing was paid.');
    expect(h.connects).toEqual([]);
    expect(fs.existsSync(path.join(h.dir, 'node-tests', 'latest.json'))).toBe(false);
  });

  it('U-15: each test connect carries the deposit the run planned, so a raised price is refused, not paid', async () => {
    const planned = (await svc.planNodeTest(['A'])).data!.peak;
    await run(['A']);
    expect(h.escrows).toEqual([planned]);
  });

  it('U-3: a deposit that could not be closed is still held; the next one is not paid over the limit', async () => {
    h.stuck.add('ch-A');
    const one = (await svc.planNodeTest(['A'])).data!.peak; // the limit fits exactly one deposit
    const r = await svc.runNodeTest({ nodes: ['A', 'B'], maxSpend: one, confirmed: true }, () => undefined);
    expect(h.connects).toEqual(['A']);
    expect(r.data!.results.map((x) => [x.server, x.code])).toEqual([['A', 'OK'], ['B', 'SPENDING_LIMIT']]);
    expect(latest().openDeposits.map((d) => d.deposit)).toEqual(['ch-A']);
  });
});

describe('runNodeTest', () => {
  it('a failing server never stops the run, and reads "failed" only when the server is at fault', async () => {
    h.failCode = { B: 'timeout', C: 'rpc-busy' };
    const r = await run(['A', 'B', 'C', 'D']);
    expect(r.ok).toBe(true);
    expect(verdicts(r)).toEqual(['working', 'failed', 'not-tested', 'working']);
    expect(r.data!.results.map((x) => x.code)).toEqual(['OK', 'CONNECT_TIMEOUT', 'SOLANA_BUSY', 'OK']);
    expect(r.data!.stopped).toBe(false);
  });

  it('no cap on the number of servers', async () => {
    const many = Array.from({ length: 60 }, (_x, i) => `S${i}`);
    const r = await run(many);
    expect(r.data!.results).toHaveLength(60);
    expect(h.connects).toHaveLength(60);
  });

  it('every deposit is on disk before it is closed, and closed right after its own server', async () => {
    const order: string[] = [];
    h.onConnect = () => order.push(`connect ${h.connects[h.connects.length - 1]}`);
    h.onSettle = (ch) => {
      order.push(`settle ${ch}`);
      expect(latest().openDeposits.map((d) => d.deposit)).toContain(ch);
    };
    const r = await run(['A', 'B']);
    expect(order).toEqual(['connect A', 'settle ch-A', 'settle ch-A', 'connect B', 'settle ch-B', 'settle ch-B']);
    expect(h.chain.size).toBe(0);
    expect(r.data!.openDeposits).toEqual([]);
    expect(r.data!.results.map((x) => x.depositState)).toEqual(['closed', 'closed']);
    expect(svc.listRuns()[0]).toMatchObject({ working: 2, resumable: false, openDeposits: 0 });
  });

  it('a per-GB deposit: refund started, kept in the run until it is closed', async () => {
    h.price = { pricePerGb: '500', pricePerHour: '0' };
    const r = await run(['A']);
    expect(r.data!.results[0]).toMatchObject({ verdict: 'working', depositState: 'refund-started', basis: 'per_gb' });
    expect(r.data!.openDeposits.map((d) => d.deposit)).toEqual(['ch-A']);
    expect(svc.listRuns()[0].resumable).toBe(true);
    // two hours later the refund is ready: continuing the run closes it and tests nothing again
    h.chain.get('ch-A')!.status = 'ready';
    const again = await run([], { resume: true });
    expect(again.data!.openDeposits).toEqual([]);
    expect(h.connects).toEqual(['A']);
  });

  it('a connect that paid and then failed: the deposit is closed (reported by the connect, or found on chain)', async () => {
    h.payThenFail = 'A';
    const r = await run(['A']);
    expect(r.data!.results[0]).toMatchObject({ verdict: 'failed', code: 'CONNECT_TIMEOUT', deposit: 'ch-A', depositState: 'closed' });
    expect(h.chain.size).toBe(0);
    h.hook = false; // the connect says nothing about the deposit: the service looks on chain itself
    h.payThenFail = 'B';
    const again = await run(['B']);
    expect(again.data!.results[0]).toMatchObject({ verdict: 'failed', code: 'CONNECT_TIMEOUT', deposit: 'ch-B', depositState: 'closed' });
    expect(h.chain.size).toBe(0);
  });

  // Windows VM, 2026-11-15: the service was set up for another wallet. It paid three test deposits from
  // that wallet; the run did not find them in its own list and reported "Deposit closed".
  it('the VPN service set up for another wallet: the run is refused before anything is paid', async () => {
    h.deviceOwner = 'Other';
    const r = await run(['A']);
    expect(r).toMatchObject({ ok: false, code: 'other-wallet' });
    expect(h.connects).toEqual([]);
  });

  // Windows VM, 2026-11-15: limit 100, the first 97.5 deposit used it up, 32 servers were then refused.
  it('the spending limit of this computer cannot cover the run: refused before anything is paid, with both figures', async () => {
    h.limitLeft = '1500';
    const r = await run(['A', 'B']);
    expect(r).toMatchObject({ ok: false, code: 'spending-limit' });
    expect(r.error).toContain('0.002 tDVPN in deposits');
    expect(r.error).toContain('0.0015 tDVPN left');
    expect(h.connects).toEqual([]);
    h.limitLeft = '2000';
    expect((await run(['A', 'B'])).ok).toBe(true);
  }, 120_000);

  it('a deposit that is not in this wallet\'s list but is still on the network is never reported closed', async () => {
    h.foreignPay = true;
    const r = await run(['A']);
    expect(r.data!.results[0]).toMatchObject({ deposit: 'ch-A', depositState: 'open' });
    expect(r.data!.results[0].stages.find((s) => s.stage === 'closed')).toMatchObject({ ok: false });
    expect(latest().openDeposits.map((d) => d.deposit)).toEqual(['ch-A']);
  }, 120_000);

  it('a test connect is quiet, its deposit is on disk while the connect is still going, and it is ended as a test', async () => {
    let onDiskDuringConnect: string[] = [];
    h.atDeposit = () => { onDiskDuringConnect = latest().openDeposits.map((d) => d.deposit); };
    await run(['A']);
    expect(onDiskDuringConnect).toEqual(['ch-A']);
    expect(h.purposes).toEqual(['test', 'end:test']);
  });

  it('a deposit the user already had with that server is used and left alone', async () => {
    h.chain.set('ch-A', { node: 'A', status: 'open', mode: 1 });
    const r = await run(['A']);
    expect(r.data!.results[0]).toMatchObject({ verdict: 'working', deposit: null, depositState: 'none' });
    expect(h.settled).toEqual([]);
    expect(h.chain.has('ch-A')).toBe(true);
  });

  it('Stop during a server: disconnected, deposit closed, later servers not touched; the run continues later', async () => {
    h.onConnect = () => { svc.stopNodeTest(); };
    const r = await run(['A', 'B', 'C']);
    expect(verdicts(r)).toEqual(['stopped']);
    expect(h.connects).toEqual(['A']);
    expect(h.disconnects).toBe(1);
    expect(h.session).toBeNull();
    expect(h.chain.size).toBe(0);
    expect(r.data!.stopped).toBe(true);
    expect(svc.listRuns()[0]).toMatchObject({ done: 0, total: 3, resumable: true });
    h.onConnect = () => undefined;
    const again = await run([], { resume: true });
    expect(again.data!.id).toBe(r.data!.id);
    expect(verdicts(again)).toEqual(['working', 'working', 'working']);
    expect(h.connects).toEqual(['A', 'A', 'B', 'C']);
    expect(again.data!.stopped).toBe(false);
    expect((await run([], { resume: true })).code).toBe('nothing-to-resume');
  });

  it('a server named twice is tested once; one not on the network is left out', async () => {
    const r = await run(['A', 'A', 'B', 'GONE']);
    expect(h.connects).toEqual(['A', 'B']);
    expect(r.data!.jobs).toHaveLength(2);
  });

  it('one session per server: the other listed connection types read "not tested"', async () => {
    h.protocols = { A: ['v2ray', 'wireguard'] };
    const r = await run(['A']);
    expect(h.connects).toEqual(['A']);
    expect(r.data!.results.map((x) => [x.protocol, x.code])).toEqual(expect.arrayContaining([['wireguard', 'OK'], ['v2ray', 'PROTOCOL_NOT_CHOSEN']]));
    expect(r.data!.results).toHaveLength(2);
  });

  it('a server whose deposit is over the limit is reported, not paid', async () => {
    h.prices = { B: { pricePerGb: '0', pricePerHour: '900000000000' } };
    const r = await svc.runNodeTest({ nodes: ['A', 'B'], maxSpend: '5000', confirmed: true });
    expect(r.data!.results.map((x) => [x.server, x.code])).toEqual(expect.arrayContaining([['A', 'OK'], ['B', 'SPENDING_LIMIT']]));
    expect(h.connects).toEqual(['A']);
    expect((await svc.runNodeTest({ nodes: ['B'], maxSpend: '5000', confirmed: true })).code).toBe('over-limit');
  });

  it('the speed source refusing is our problem, no data at all is the server\'s', async () => {
    h.speed = { ok: false, reached: true, error: 'HTTP 429' };
    expect((await run(['A'])).data!.results[0]).toMatchObject({ code: 'SPEED_SOURCE_DOWN', verdict: 'not-tested', depositState: 'closed' });
    h.speed = { ok: false, reached: false, error: 'socket hang up' };
    expect((await run(['B'])).data!.results[0]).toMatchObject({ code: 'NO_DATA', verdict: 'failed' });
    h.speed = { ok: false, reached: true, tampered: true, error: 'the key did not match' };
    expect((await run(['C'])).data!.results[0]).toMatchObject({ code: 'SPEED_TAMPERED', verdict: 'failed', depositState: 'closed' });
    h.speed = { ok: true, figure: { method: 'steady-v1', mbps: 100, basis: 'steady', p90Mbps: 100, rampSeconds: 0, falling: false, bytes: 1e8, ms: 8000, streams: 4 }, source: 'test' };
  });

  it('every page can show the run: progress is published per stage and cleared when the run ends', async () => {
    await run(['A', 'B']);
    expect(h.shown).toContain('0/2 A');
    expect(h.shown).toContain('1/2 B');
    expect(h.shown.filter((x) => x === 'none')).toEqual(['none']);
    expect(h.shown[h.shown.length - 1]).toBe('none');
  });

  it('refused while the user is connected', async () => {
    h.session = { channel: 'x' };
    expect((await run(['A'])).code).toBe('vpn-active');
    expect(h.connects).toEqual([]);
  });

  it('the last run and the per-server history are read back from disk', async () => {
    h.failCode = { B: 'timeout' };
    const r = await run(['A', 'B']);
    expect(svc.getRun()?.id).toBe(r.data!.id);
    expect(svc.getRun(r.data!.id)?.results).toHaveLength(2);
    const hist = svc.serverHistory();
    expect(hist.A[0]).toMatchObject({ verdict: 'working', code: 'OK', mbps: 100 });
    expect(hist.B[0]).toMatchObject({ verdict: 'failed', code: 'CONNECT_TIMEOUT' });
    expect(fs.readFileSync(path.join(h.dir, 'node-tests', 'failures.log'), 'utf8')).toMatch(/ B wireguard failed CONNECT_TIMEOUT at /);
  });

  it('the plan: no transaction, the amount on deposit at once, what a smaller limit costs in waiting', async () => {
    h.price = { pricePerGb: '500', pricePerHour: '0' };
    const p = await svc.planNodeTest(['A', 'B', 'C', 'GONE']);
    expect(p.data).toMatchObject({ jobs: 3, servers: 3, unknown: ['GONE'], waitSeconds: 0 });
    expect(p.data!.batches).toHaveLength(1);
    const tight = await svc.planNodeTest(['A', 'B', 'C'], { limit: p.data!.smallestLimit });
    expect(tight.data!.batches).toHaveLength(3);
    expect(tight.data!.waitSeconds).toBe(2 * 7200);
    expect(h.connects).toEqual([]);
  });
});
