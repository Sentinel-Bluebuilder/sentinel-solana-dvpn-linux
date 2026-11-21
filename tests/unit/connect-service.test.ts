// ─── Connect with the VPN service absent vs stopped ───
// A reinstall removes the service (the setup does not register it): "not running" sent the user to
// Diagnostics for a service that did not exist (ddv-win-2 kse-pk-215). Missing = set up; stopped = start it.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({
  svc: 'no-service' as string,
  reachable: [] as boolean[],
  starts: 0,
  watched: 0,
  service: undefined as unknown,
  up: false,
  recOwner: 'Owner' as string,
  ensured: 0,
  switchWorks: true,
  daemonImpl: null as Record<string, (...a: unknown[]) => Promise<unknown>> | null,
  state: { session: null as unknown, conn: { phase: 'idle' } as Record<string, unknown>, lastConnectError: null as unknown },
}));
vi.mock('../../src/main/app-state', () => ({
  snapshot: () => st.state,
  patch: vi.fn((p: Record<string, unknown>) => { Object.assign(st.state, p); }),
  setSplitInEffect: vi.fn(),
  setWholeDeviceInEffect: vi.fn(),
  setRedialFollow: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('../../src/main/daemon/manager', () => ({
  daemon: () => st.daemonImpl ?? new Proxy({}, { get: () => async () => { throw new Error('reached the daemon'); } }),
  daemonInfo: () => ({ reachable: st.up, device: 'Dev', networkOk: true, service: st.service }),
  deviceRecord: () => ({ owner: st.recOwner, home: '/h' }),
  startServiceIfStopped: async () => { st.starts += 1; return st.svc; },
  withLinkWatch: async <T,>(fn: () => Promise<T>): Promise<T> => { st.watched += 1; return fn(); },
}));
vi.mock('../../src/main/services/daemon-wait', () => ({ SERVICE_WAIT_MS: 1, waitForDaemon: async () => ({ reachable: st.reachable.shift() ?? false, device: 'Dev', networkOk: true, service: st.service }) }));
vi.mock('../../src/main/wallet/vault', () => ({ ownerAddress: () => 'Owner' }));
// The switch of the service to the current wallet (services/wallet.ts): counted; it moves the record when it works.
vi.mock('../../src/main/services/wallet', () => ({
  ensureDevicePermission: async () => { st.ensured += 1; if (st.switchWorks) st.recOwner = 'Owner'; return null; },
  serviceSwitchPending: () => false,
}));
vi.mock('../../src/main/services/connect-checks', () => ({
  preflight: async () => null, reusableChannel: async () => null, prepayCost: () => '1',
  planLimitReached: async () => null, heldTicket: async () => null, nodeHasRoom: async () => false,
}));
vi.mock('../../src/main/home-ip', () => ({ ensureHomeIp: async () => undefined }));
vi.mock('../../src/core/nodes/discovery', () => ({ discoverNode: async () => ({ pricePerGb: '1000', pricePerHour: '1000', country: 'US' }) }));
vi.mock('../../src/main/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/main/services/history', () => ({ recordStart: vi.fn(), recordEnd: vi.fn() }));
vi.mock('../../src/main/services/settlement', () => ({ claimForReuse: () => true, settleChannelSoon: vi.fn(), settlesOnEnd: (r: string) => !/switching servers/i.test(r) }));
vi.mock('../../src/main/system/proxy', () => ({ setSystemProxy: vi.fn(), clearSystemProxy: async () => undefined }));
vi.mock('../../src/main/system/tunnels', () => ({ leftoverTunnels: async () => [], rivalVpns: async () => [], removeTunnelServices: async () => undefined }));
vi.mock('../../src/main/system/dns-check', () => ({ dnsReallyLeftOver: async () => false, flushDnsCache: vi.fn() }));
vi.mock('../../src/core/chain/rpc', () => ({ getRpcUrls: () => [], resetRpcTransport: vi.fn(), onRpcRetry: () => () => undefined }));
vi.mock('../../src/main/daemon/settings', () => ({ getDaemonSettings: () => ({ settings: { killSwitch: 'off', dnsServers: [] } }), serviceUsesTun: () => false, splitForSession: vi.fn() }));
vi.mock('../../src/main/services/stop-session', () => ({ stopLiveOrCurrent: async () => ({ session: null, dnsRevertFailed: false }) }));
vi.mock('../../src/main/services/first-data', () => ({ firstData: async () => undefined }));
vi.mock('../../src/main/services/net-settle', () => ({ waitForDirectPath: async () => true }));

const { connect } = await import('../../src/main/services/connection');
const { connectActionButton } = await import('../../src/shared/connect-action');
// U-M4-1 (rc9-c2): every caller that opens a new deposit sends the amount it showed; a shown amount at or above
// the fresh one never blocks (priceRaised), so the fixtures send one well above the mocked price.
const req = { node: 'NodeA', basis: 'per_gb' as const, units: 1, confirmed: true as const, shownEscrow: '1000000000000000' };

const { serviceView } = await import('../../src/core/daemon/service-state');
beforeEach(() => { st.state = { session: null, conn: { phase: 'idle' }, lastConnectError: null }; st.reachable = []; st.starts = 0; st.watched = 0; st.service = undefined; st.up = false; st.recOwner = 'Owner'; st.ensured = 0; st.switchWorks = true; st.daemonImpl = null; });

describe('connect when the VPN service cannot be reached', () => {
  it('service not installed: says so, points to device setup (Wallet), nothing paid', async () => {
    st.svc = 'no-service';
    const r = await connect(req);
    expect(r.code).toBe('daemon-missing');
    expect(r.error).toMatch(/not installed/);
    expect(r.error).toMatch(/daemon install --yes/);
    expect(r.error).toMatch(/Nothing was paid/);
    expect(connectActionButton(r.action)?.target).toBe('wallet');
  });

  it('service stopped: started without elevation, then waited for again', async () => {
    st.svc = 'started';
    st.reachable = [false, false];
    const r = await connect(req);
    expect(st.starts).toBe(1);
    expect(r.code).toBe('daemon-unavailable');  // still down after the start: the old copy
  });

  it('service running but not answering: Diagnostics, and never the old "is not running"', async () => {
    st.svc = 'running';
    const r = await connect(req);
    expect(r.code).toBe('daemon-unavailable');
    expect(r.action).toBe('Open diagnostics');
    expect(r.error).not.toMatch(/is not running/);
  });
});

describe('the VPN service is set up for another wallet (Windows VM 2026-11-15)', () => {
  it('the user\'s Connect switches the service first, whatever the wallet read says', async () => {
    st.up = true;
    st.recOwner = 'OtherWallet';
    st.daemonImpl = { listChannels: async () => [], startSession: async () => { throw new Error('429 Too Many Requests'); }, listSessions: async () => [] };
    const r = await connect(req);
    expect(st.ensured).toBe(1);
    expect(r.error).not.toMatch(/set up for another wallet/); // it went on to the start, which fails in this stand-in
  }, 120_000);

  it('a switch that did not happen stops Connect before the service is asked: nothing paid', async () => {
    st.up = true;
    st.recOwner = 'OtherWallet';
    st.switchWorks = false;
    let asked = 0;
    st.daemonImpl = { listChannels: async () => { asked += 1; return []; }, startSession: async () => { asked += 1; throw new Error('must not start'); }, listSessions: async () => [] };
    const r = await connect(req);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('no-device');
    expect(r.error).toMatch(/set up for another wallet/);
    expect(r.error).toMatch(/Nothing was paid\.$/);
    expect(asked).toBe(0);
  }, 120_000);

  it('negative control: the same wallet never runs the switch', async () => {
    st.up = true;
    st.daemonImpl = { listChannels: async () => [], startSession: async () => { throw new Error('429 Too Many Requests'); }, listSessions: async () => [] };
    await connect(req);
    expect(st.ensured).toBe(0);
  }, 120_000);
});

describe('a server test\'s connect (purpose: test) is quiet and reports its deposit', () => {
  const testReq = { ...req, purpose: 'test' as const };
  const sess = { id: 'S1', node: 'NodeA', status: 'SESSION_STATUS_CONNECTED', service: 'wireguard', usage: null, spent: '0', startedAt: null, endedAt: null, error: '', channel: 'ChNew', ticketHash: '', proxyEndpoint: '' };
  const watchScreen = (): { patches: string[] } => {
    const seen = { patches: [] as string[] };
    const real = st.state;
    st.state = new Proxy(real, { set: (t, k, v) => { seen.patches.push(String(k)); (t as Record<string | symbol, unknown>)[k] = v; return true; } });
    return seen;
  };

  it('success: the session comes back, the deposit is reported once, the Connect screen is never touched', async () => {
    st.up = true;
    let chans: Array<{ address: string; node: string }> = [];
    st.daemonImpl = {
      listChannels: async () => chans,
      startSession: async () => { chans = [{ address: 'ChNew', node: 'NodeA' }]; return sess; },
      listSessions: async () => [],
      stopSession: async () => ({ session: null, killSwitchReleased: false, dnsRevertFailed: false }),
    };
    const seen = watchScreen();
    const deposits: string[] = [];
    const { toast } = await import('../../src/main/app-state');
    (toast as ReturnType<typeof vi.fn>).mockClear();
    const r = await connect(testReq, { onDeposit: (ch) => deposits.push(ch) });
    expect(r.ok).toBe(true);
    expect(r.data?.channel).toBe('ChNew');
    expect(deposits).toEqual(['ChNew']);
    expect(seen.patches.filter((k) => k === 'conn' || k === 'session' || k === 'lastConnectError' || k === 'lastCloseMessage' || k === 'connectTarget')).toEqual([]);
    expect(toast).not.toHaveBeenCalled();
    // while the test holds the service: the user's Connect is refused with its own code, and nothing adopts the session
    const mine = await connect(req);
    expect(mine.code).toBe('test-running');
    // the test ends it quietly
    const { disconnect } = await import('../../src/main/services/connection');
    const d = await disconnect({ purpose: 'test' });
    expect(d.ok).toBe(true);
    st.daemonImpl = null; // the next start fails in the stand-in: only the refusal code matters here
    expect((await connect(req)).code).not.toBe('test-running');
  });

  it('failure after paying: paid + channel come back with a fixed code, and the screen is untouched', async () => {
    st.up = true;
    let chans: Array<{ address: string; node: string }> = [{ address: 'Other', node: 'NodeB' }];
    st.daemonImpl = {
      listChannels: async () => chans,
      startSession: async () => { chans = [...chans, { address: 'ChPaid', node: 'NodeA' }]; throw new Error('starting service: handshake did not complete'); },
      listSessions: async () => [],
    };
    const seen = watchScreen();
    const deposits: string[] = [];
    const r = await connect(testReq, { onDeposit: (ch) => deposits.push(ch) });
    expect(r).toMatchObject({ ok: false, code: 'tunnel-failed', paid: true, channel: 'ChPaid' });
    expect(deposits).toEqual(['ChPaid']);
    expect(seen.patches.filter((k) => k === 'conn' || k === 'lastConnectError')).toEqual([]);
    expect((await connect(req)).code).not.toBe('test-running'); // a failed test connect does not hold the service
  });

  it('the VPN service is set up for another wallet: refused before the service is asked, nothing paid (Windows VM 2026-11-15)', async () => {
    st.up = true;
    st.recOwner = 'OtherWallet';
    let asked = 0;
    st.daemonImpl = { listChannels: async () => { asked += 1; return []; }, startSession: async () => { asked += 1; throw new Error('must not start'); }, listSessions: async () => [] };
    const r = await connect(testReq);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('no-device');
    expect(r.error).toMatch(/set up for another wallet/);
    expect(r.paid).toBe(false);
    expect(asked).toBe(0);
  });

  it('failure before paying: paid is false and there is no channel', async () => {
    st.up = true;
    st.daemonImpl = { listChannels: async () => [], startSession: async () => { throw new Error('429 Too Many Requests'); }, listSessions: async () => [] };
    const r = await connect(testReq);
    expect(r.ok).toBe(false);
    expect(r.paid).toBe(false);
    expect(r.channel).toBeUndefined();
  }, 120_000);

  it('refused while the user\'s own session is up or connecting, and on a plan', async () => {
    st.up = true;
    st.state.session = { id: 'Mine' };
    expect((await connect(testReq)).code).toBe('session-active');
    st.state.session = null;
    st.state.conn = { phase: 'connecting' };
    expect((await connect(testReq)).code).toBe('session-active');
    st.state.conn = { phase: 'idle' };
    expect((await connect({ ...testReq, subscription: { provider: 'P', subscription: 'S' } })).code).toBe('unsupported');
  });

  it('service not answering: the state\'s sentence, nothing shown', async () => {
    st.service = serviceView('stopped');
    const seen = watchScreen();
    const r = await connect(testReq);
    expect(r).toMatchObject({ ok: false, code: 'daemon-unavailable', error: serviceView('stopped').sentence, paid: false });
    expect(seen.patches).toEqual([]);
  });
});

describe('rows 120/125: Connect follows the service state', () => {
  it('off: starts it BEFORE waiting (it never comes back by waiting), waits with the fast retry, then connects on', async () => {
    st.service = serviceView('stopped');
    st.svc = 'started';
    st.reachable = [true];
    const seen: string[] = [];
    const real = st.state;
    st.state = new Proxy(real, { set: (t, k, v) => { if (k === 'conn') seen.push(String((v as { detail?: string }).detail ?? '')); (t as Record<string | symbol, unknown>)[k] = v; return true; } });
    const r = await connect(req);
    expect(st.starts).toBe(1);
    expect(st.watched).toBe(1);
    expect(seen.some((d) => /Starting the VPN service/.test(d))).toBe(true);
    expect(r.code).not.toBe('daemon-unavailable'); // it got past the service step
  });

  it('off and it will not start: one start only, the "off" sentence, Diagnostics', async () => {
    st.service = serviceView('stopped');
    st.svc = 'failed';
    const r = await connect(req);
    expect(st.starts).toBe(1);
    expect(r.error).toBe(serviceView('stopped').sentence);
    expect(r.code).toBe('daemon-unavailable');
    expect(r.action).toBe('Open diagnostics');
  });

  it('not installed: said at once, no start, no wait', async () => {
    st.service = serviceView('not-installed');
    const r = await connect(req);
    expect(r.code).toBe('daemon-missing');
    expect(st.starts).toBe(0);
    expect(st.watched).toBe(0);
  });

  it('starting: waits; if it still has not answered, says it is starting and offers Try again', async () => {
    st.service = serviceView('starting');
    st.svc = 'running';
    const r = await connect(req);
    expect(st.watched).toBe(1);
    expect(r.error).toBe(serviceView('starting').sentence);
    expect(r.action).toBe('Try again');
  });

  it('rows 119/122: with the service not answering, the session read makes no call and writes no log line', async () => {
    const { adoptRunningSession, sessionsKnown, sessionStateUnknown } = await import('../../src/main/services/connection');
    const { log } = await import('../../src/main/logger');
    (log.warn as ReturnType<typeof vi.fn>).mockClear();
    await Promise.all([adoptRunningSession({ applyProxy: true, startedElsewhere: true }), adoptRunningSession({ applyProxy: true, startedElsewhere: true }), adoptRunningSession()]);
    expect((log.warn as ReturnType<typeof vi.fn>).mock.calls.filter((c) => /could not list daemon sessions/.test(String(c[0])))).toEqual([]);
    expect(sessionsKnown()).toBe(true);          // a service that is down proves no session of ours runs
    expect(sessionStateUnknown()).toBe(false);
  });

  it('row 124: the service saying the Solana network is busy is never "the VPN service is off"', async () => {
    const { connectErrorCopy } = await import('../../src/core/session/state');
    const c = connectErrorCopy('StartSession: unavailable: the network is unreachable or busy right now; try again in a moment');
    expect(c.code).toBe('rpc-busy');
    expect(c.message).toMatch(/Solana network is busy/);
    expect(c.message).toMatch(/nothing was paid/);
    expect(c.message).not.toMatch(/VPN service/);
    // a real dropped link still reads as the service, with the table's sentence
    const d = connectErrorCopy('14 UNAVAILABLE: No connection established');
    expect(d.code).toBe('daemon-unavailable');
    expect(d.message).toBe(serviceView('stopped').sentence);
  });

  it('UI-188: the old failure is cleared in the very first patch of the next Connect, before any chain read', async () => {
    st.service = serviceView('link-broken');
    st.svc = 'running';
    st.state.lastConnectError = { code: 'tunnel-failed', message: 'old failure', action: null, node: 'NodeA' };
    st.state.conn = { phase: 'error', title: "Couldn't connect", detail: 'old failure' };
    const firsts: Array<Record<string, unknown>> = [];
    const { patch } = await import('../../src/main/app-state');
    const spy = vi.mocked(patch);
    const before = spy.mock.calls.length;
    await connect(req);
    firsts.push(spy.mock.calls[before][0] as Record<string, unknown>);
    expect(firsts[0]).toHaveProperty('connectTarget');
    expect(firsts[0].lastConnectError).toBeNull();
    expect((firsts[0].conn as { phase: string }).phase).toBe('preflight');
  });

  it('UI-188 negative control: a switch with a live session keeps its view in that first patch', async () => {
    st.service = serviceView('link-broken');
    st.svc = 'running';
    st.state.session = { id: 'S0', node: 'NodeB', channel: 'Ch0' };
    st.state.conn = { phase: 'connected', title: 'Protected' };
    const { patch } = await import('../../src/main/app-state');
    const spy = vi.mocked(patch);
    const before = spy.mock.calls.length;
    await connect({ ...req, switch: true });
    const first = spy.mock.calls[before][0] as Record<string, unknown>;
    expect(first).toHaveProperty('connectTarget');
    expect(first).not.toHaveProperty('conn');
    st.state.session = null;
  });

  it('UI-007/UI-012: the server being connected to is in the snapshot from the first step and cleared when Connect ends', async () => {
    st.service = serviceView('link-broken');
    st.svc = 'running';
    const targets: unknown[] = [];
    const real = st.state;
    st.state = new Proxy(real, { set: (t, k, v) => { if (k === 'connectTarget') targets.push(v); (t as Record<string | symbol, unknown>)[k] = v; return true; } });
    await connect(req);
    expect(targets).toEqual([{ node: 'NodeA', switching: false }, null]);
    // not confirmed: nothing starts, nothing is shown
    targets.length = 0;
    await connect({ ...req, confirmed: false as unknown as true });
    expect(targets).toEqual([]);
  });

  it('running but unreachable: the link sentence, not "off"', async () => {
    st.service = serviceView('link-broken');
    st.svc = 'running';
    const r = await connect(req);
    expect(r.error).toBe(serviceView('link-broken').sentence);
    expect(r.action).toBe('Open diagnostics');
  });
});
