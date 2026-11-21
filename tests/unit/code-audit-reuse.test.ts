// ─── CODE-AUDIT E3/E4/E5/E7: a reused deposit, a refused ticket, a refused second start ───
// E3 (money): the Connect dialog said "nothing new is paid" for an open deposit; when the server refused it (or its
// refund had started), connect() paid a NEW deposit in an amount never shown. Now nothing is paid and the deposit is
// not offered again. E4: a refreshed plan ticket skipped the Cancel checks. E5: a refused second start (a session
// already live) cleared the shown session while the tunnel stayed up. E7: an open per-hour deposit (listed 'ready')
// was not offered by the dialog and was called closing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { DEPOSITS_UNREAD_COPY } = vi.hoisted(() => ({ DEPOSITS_UNREAD_COPY: 'Your open deposits could not be read, so nothing was paid (a second deposit with this server is never opened beside one you have). Try again in a moment.' }));
const st = vi.hoisted(() => ({
  starts: [] as unknown[],
  startImpl: (async () => { throw new Error('unset'); }) as (cred: unknown) => Promise<unknown>,
  sessions: [] as Array<{ id: string; status: string; error?: string; channel?: string }>,
  reuse: 'ChOld' as string | null,
  claim: true,
  refused: [] as string[],
  cancelAt: -1,
  firstData: 0,
  state: { session: null as unknown, conn: { phase: 'idle' } as Record<string, unknown>, lastConnectError: null as unknown },
}));
vi.mock('../../src/main/app-state', () => ({
  snapshot: () => st.state,
  patch: vi.fn((p: Record<string, unknown>) => { Object.assign(st.state, p); }),
  setSplitInEffect: vi.fn(), setWholeDeviceInEffect: vi.fn(), setRedialFollow: vi.fn(), toast: vi.fn(),
}));
vi.mock('../../src/main/daemon/manager', () => ({
  daemon: () => ({
    listChannels: async () => [],
    listSessions: async () => st.sessions,
    listTickets: async () => [],
    startSession: async (_node: string, cred: unknown) => { st.starts.push(cred); return st.startImpl(cred); },
  }),
  daemonInfo: () => ({ reachable: true, device: 'Dev', networkOk: true }),
  deviceRecord: () => ({ owner: 'Owner', home: '/h' }),
  startServiceIfStopped: async () => 'running',
  withLinkWatch: async <T,>(fn: () => Promise<T>): Promise<T> => fn(),
}));
vi.mock('../../src/main/services/daemon-wait', () => ({ SERVICE_WAIT_MS: 1, waitForDaemon: async () => ({ reachable: true, device: 'Dev', networkOk: true }) }));
vi.mock('../../src/main/wallet/vault', () => ({ ownerAddress: () => 'Owner' }));
vi.mock('../../src/main/services/wallet', () => ({ ensureDevicePermission: async () => null, serviceSwitchPending: () => false }));
vi.mock('../../src/main/services/connect-checks', () => ({
  preflight: async () => null, prepayCost: () => 1n,
  reusableChannel: async () => { if (st.reuse === 'THROW') throw new Error(DEPOSITS_UNREAD_COPY); return st.reuse; },
  planLimitReached: async () => null, heldTicket: async () => 'TicketHash', nodeHasRoom: async () => true,
  markReuseRefused: (c: string) => { st.refused.push(c); },
}));
vi.mock('../../src/main/home-ip', () => ({ ensureHomeIp: async () => undefined }));
vi.mock('../../src/core/nodes/discovery', () => ({ discoverNode: async () => ({ pricePerGb: '1000', pricePerHour: '1000', country: 'US' }) }));
vi.mock('../../src/main/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../src/main/services/history', () => ({ recordStart: vi.fn(), recordEnd: vi.fn() }));
vi.mock('../../src/main/services/settlement', () => ({ claimForReuse: () => st.claim, readSettlements: async () => [], settleChannelSoon: vi.fn(), settlesOnEnd: () => true }));
vi.mock('../../src/main/system/proxy', () => ({ setSystemProxy: vi.fn(), clearSystemProxy: async () => undefined }));
vi.mock('../../src/main/system/tunnels', () => ({ leftoverTunnels: async () => [], rivalVpns: async () => [], removeTunnelServices: async () => undefined }));
vi.mock('../../src/main/system/dns-check', () => ({ dnsReallyLeftOver: async () => false, flushDnsCache: vi.fn() }));
vi.mock('../../src/core/chain/rpc', () => ({ getRpcUrls: () => [], resetRpcTransport: vi.fn(), onRpcRetry: () => () => undefined, overLimitState: () => ({ inUse: 'custom' }) }));
vi.mock('../../src/main/daemon/settings', () => ({ getDaemonSettings: () => ({ settings: { killSwitch: 'off', dnsServers: [] } }), serviceUsesTun: () => false, splitForSession: vi.fn() }));
vi.mock('../../src/main/services/stop-session', () => ({ stopLiveOrCurrent: async () => ({ session: null, dnsRevertFailed: false }) }));
vi.mock('../../src/main/services/first-data', () => ({ firstData: async () => { st.firstData += 1; } }));
vi.mock('../../src/main/services/net-settle', () => ({ waitForDirectPath: async () => true }));
vi.mock('../../src/main/services/connect-marker', () => ({
  cancelRequested: () => st.starts.length === st.cancelAt, clearConnecting: vi.fn(), markConnecting: vi.fn(),
  otherConnect: () => null, requestCancel: vi.fn(), waitConnectEnded: async () => true,
}));

const { connect, DEPOSIT_UNUSABLE_COPY, PRICE_CHANGED_COPY, priceRaised, txGapMs } = await import('../../src/main/services/connection');
const { connectActionButton } = await import('../../src/shared/connect-action');
// U-M4-1 (rc9-c2): every caller that opens a new deposit sends the amount it showed; a shown amount at or above
// the fresh one never blocks (priceRaised), so the fixtures send one well above the mocked price.
const req = { node: 'NodeA', basis: 'per_gb' as const, units: 1, confirmed: true as const, shownEscrow: '1000000000000000' };
const isNew = (c: unknown): boolean => !!c && typeof c === 'object' && 'newChannel' in c;

beforeEach(() => {
  st.starts = []; st.sessions = []; st.reuse = 'ChOld'; st.claim = true; st.refused = []; st.cancelAt = -1; st.firstData = 0;
  st.state = { session: null, conn: { phase: 'idle' }, lastConnectError: null };
});

describe('E3: a reused deposit the server refuses is never replaced by an unshown payment', () => {
  it.each(['cannot cover the prepay', 'channel_not_open', 'peer_limit_reached'])('%s: nothing new paid, deposit marked, the button reopens the dialog', async (why) => {
    st.startImpl = async () => { throw new Error(`StartSession: ${why}`); };
    const r = await connect(req);
    expect(st.starts).toHaveLength(1);
    expect(st.starts.some(isNew)).toBe(false);
    expect(r.code).toBe('deposit-unusable');
    expect(r.error).toBe(DEPOSIT_UNUSABLE_COPY());
    expect(r.error).toMatch(/nothing new was paid/);
    expect(st.refused).toEqual(['ChOld']);
    expect(connectActionButton(r.action)).toEqual({ target: 'same-node', label: 'Connect again' });
  });

  it('the offered deposit started closing meanwhile: nothing paid, nothing started', async () => {
    st.claim = false;
    const r = await connect(req);
    expect(st.starts).toHaveLength(0);
    expect(r.code).toBe('deposit-unusable');
    expect(st.refused).toEqual(['ChOld']);
  });

  it('negative control: with no open deposit the new deposit is paid as shown', async () => {
    st.reuse = null;
    st.startImpl = async () => { throw new Error('StartSession: handshake did not complete'); };
    await connect(req);
    expect(st.starts).toHaveLength(1);
    expect(isNew(st.starts[0])).toBe(true);
    expect(st.refused).toEqual([]);
  });

  it('negative control: another failure on a reused deposit is reported, not marked', async () => {
    st.startImpl = async () => { throw new Error('StartSession: handshake did not complete'); };
    const r = await connect(req);
    expect(r.code).not.toBe('deposit-unusable');
    expect(st.refused).toEqual([]);
  });
});

describe('E4: a refreshed plan ticket runs the same Cancel checks and first-data wait', () => {
  const sub = { ...req, subscription: { provider: 'P', subscription: 'S' } };
  it('a Cancel is checked before the new ticket is asked for, and the start falls through to the shared checks', () => {
    const src = fs.readFileSync('src/main/services/connection.ts', 'utf8');
    const refused = src.indexOf("log.warn('stored ticket refused; requesting a new one'");
    const check = src.indexOf("if (isCancelled()) return stoppedByUser(tr('Connecting stopped. Nothing was paid.'), req.node);", refused);
    const retry = src.indexOf('s = await startWithRetry(req.node, { ticketRequest: req.subscription }, true);', refused);
    expect(refused).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(refused);
    expect(retry).toBeGreaterThan(check);
    expect(src.slice(retry, retry + 200)).not.toContain('return sessionStarted(s, country);');
  });
  it('the second ticket start goes through firstData like every other start', async () => {
    let n = 0;
    st.startImpl = async () => { n += 1; if (n === 1) throw new Error('ticket refused'); return { id: 'S2', node: 'NodeA', channel: '', status: 'active' }; };
    await connect(sub).catch(() => undefined);
    expect(st.starts).toHaveLength(2);
    expect(st.firstData).toBe(1);
  });
});

describe('E5: a failed start keeps a session dvpnd still runs', () => {
  it('session live: the shown session stays', async () => {
    const live = { id: 'S1', node: 'NodeB', channel: 'ChLive' };
    st.state.session = live;
    st.sessions = [{ id: 'S1', status: 'active', channel: 'ChLive' }];
    st.reuse = null;
    st.startImpl = async () => { throw new Error('StartSession: failed precondition: a session is already active'); };
    await connect(req);
    expect(st.state.session).toBe(live);
  });
  it('negative control: dvpnd runs nothing, the session is cleared', async () => {
    st.state.session = { id: 'Gone', node: 'NodeB', channel: 'ChX' };
    st.sessions = [{ id: 'Gone', status: 'ended' }];
    st.reuse = null;
    st.startImpl = async () => { throw new Error('StartSession: handshake did not complete'); };
    await connect(req);
    expect(st.state.session).toBeNull();
  });
});

describe('U-13/U-15: a price raised after the list was read is never paid without being shown', async () => {
  const { costPreview } = await import('../../src/core/pricing/cost');
  const escrow = costPreview({ pricePerGb: '1000', pricePerHour: '1000' } as never, 'per_gb', 1).escrow;
  const lower = (BigInt(escrow) - 1n).toString();
  beforeEach(() => { st.reuse = null; st.startImpl = async () => { throw new Error('StartSession: handshake did not complete'); }; });
  it('Connect: shown deposit below the fresh one: nothing started, price-changed, Connect again', async () => {
    const r = await connect({ ...req, shownEscrow: lower });
    expect(st.starts).toHaveLength(0);
    expect(r.code).toBe('price-changed');
    expect(r.error).toBe(PRICE_CHANGED_COPY());
    expect(connectActionButton(r.action)).toEqual({ target: 'same-node', label: 'Connect again' });
  });
  it('server test: the same refusal, nothing paid', async () => {
    const r = await connect({ ...req, purpose: 'test', shownEscrow: lower });
    expect(st.starts).toHaveLength(0);
    expect(r.code).toBe('price-changed');
  });
  it('negative control: the shown deposit equals the fresh one: paid; none was sent: refused, nothing paid (U-M4-1)', async () => {
    await connect({ ...req, shownEscrow: escrow });
    const none = await connect({ ...req, shownEscrow: undefined });
    expect(st.starts.filter(isNew)).toHaveLength(1);
    expect(none.code).toBe('deposit-unusable');
  });
  it('negative control: a reused deposit pays nothing new, so a shown value never blocks it', async () => {
    st.reuse = 'ChOld';
    await connect({ ...req, shownEscrow: '1' });
    expect(st.starts).toHaveLength(1);
    expect(isNew(st.starts[0])).toBe(false);
  });
  it('priceRaised ignores a missing or malformed shown value', () => {
    expect(priceRaised('10', undefined)).toBe(false);
    expect(priceRaised('10', '9x')).toBe(false);
    expect(priceRaised('10', '9')).toBe(true);
    expect(priceRaised('10', '10')).toBe(false);
  });
});

describe('E12: the open deposits could not be read: nothing is paid', () => {
  it('Connect and server test: no start, deposits-unread, Retry', async () => {
    st.reuse = 'THROW';
    const r = await connect(req);
    expect(st.starts).toHaveLength(0);
    expect(r.code).toBe('deposits-unread');
    const t = await connect({ ...req, purpose: 'test' });
    expect(st.starts).toHaveLength(0);
    expect(t.code).toBe('deposits-unread');
  });
  it('the copy here is the one state.ts maps', async () => {
    const s = await import('../../src/core/session/state');
    expect(s.DEPOSITS_UNREAD_COPY()).toBe(DEPOSITS_UNREAD_COPY);
    expect(s.connectErrorCopy(`x: ${DEPOSITS_UNREAD_COPY}`).code).toBe('deposits-unread');
  });
  it('reusableChannel throws on a failed read instead of answering "none" (which paid a second deposit)', () => {
    const src = fs.readFileSync('src/main/services/connect-checks.ts', 'utf8');
    const at = src.indexOf('export async function reusableChannel(');
    const body = src.slice(at, src.indexOf('\n}\n', at));
    expect(body).toContain('throw new Error(DEPOSITS_UNREAD_COPY());'); // read when thrown (B3: the copy is a function)
    expect(body).not.toContain("log.warn('listChannels failed; opening a new channel'");
  });
});

describe('E10: a refused deposit is refunded now, not after the day a per-GB deposit is kept', async () => {
  const { dueForAutoRefund } = await import('../../src/core/settlement/auto-refund');
  const now = 1_000_000;
  const last = new Map([['C', now - 60]]); // its session ended a minute ago
  it('marked refused: due at once', () => {
    expect(dueForAutoRefund([{ channel: 'C', status: 'open', mode: 0, reuseRefused: true }], last, now, 1)).toEqual(['C']);
  });
  it('negative control: not marked, kept for the day', () => {
    expect(dueForAutoRefund([{ channel: 'C', status: 'open', mode: 0 }], last, now, 1)).toEqual([]);
  });
  it('a refused deposit still in use is left alone', () => {
    expect(dueForAutoRefund([{ channel: 'C', status: 'in-use', mode: 0, reuseRefused: true }], last, now, 1)).toEqual([]);
  });
});

describe('E6: the 7 s wait after a signed permission is for the public endpoint only', () => {
  it('own endpoint: no wait', () => { expect(txGapMs()).toBe(0); });
});

describe('E7 + E3 in the dialog: open-deposit.ts', async () => {
  const { openDepositFor, closingDepositFor } = await import('../../src/core/session/open-deposit');
  const node = { address: 'NodeA', pricePerGb: '1000', pricePerHour: '1000' };
  const dep = (o: Record<string, unknown>) => ({ channel: 'C', node: 'NodeA', mode: 0, escrow: '1000000', redeemed: '0', status: 'open', readyAt: null, refundable: '1000000', ...o }) as never;
  it('a refused deposit is not offered ("nothing new is paid" would be untrue)', () => {
    expect(openDepositFor([dep({ reuseRefused: true })], node)).toBeNull();
    expect(openDepositFor([dep({})], node)?.channel).toBe('C');
  });
  it('an open per-hour deposit (listed ready) is offered and is not called closing', () => {
    const ph = dep({ mode: 1, status: 'ready' });
    expect(openDepositFor([ph], node)).toEqual({ channel: 'C', basis: 'per_hour', left: '1000000' });
    expect(closingDepositFor([ph], node)).toBeNull();
  });
  it('negative control: a per-GB ready deposit is past its wait: closing, not offered', () => {
    const g = dep({ mode: 0, status: 'ready' });
    expect(openDepositFor([g], node)).toBeNull();
    expect(closingDepositFor([g], node)?.channel).toBe('C');
  });
});

describe('E3: the refused list is shared with the CLI (data folder)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reuse-'));
  vi.doUnmock('../../src/main/services/connect-checks');
  vi.doMock('../../src/main/host', () => ({ getHost: () => ({ dataDir: dir }) }));
  const real = await vi.importActual<typeof import('../../src/main/services/connect-checks')>('../../src/main/services/connect-checks');
  it('marked in one process, read by the next', () => {
    real.resetReuseRefused();
    expect(real.reuseRefused('ChOld')).toBe(false);
    real.markReuseRefused('ChOld');
    real.resetReuseRefused(); // a new process
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'reuse-refused.json'), 'utf8'))).toEqual(['ChOld']);
    expect(real.reuseRefused('ChOld')).toBe(true);
    expect(real.reuseRefused('Other')).toBe(false);
  });
});
