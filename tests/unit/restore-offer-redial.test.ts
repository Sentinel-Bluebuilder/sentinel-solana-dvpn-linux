// ─── Restore network is never offered while dvpnd may be redialing (Q0373) ───
// TWD (Windows, Q0366 cut): dvpnd was redialing (kill switch holding, internet blocked) and one
// ListSessions call dropped. The app took that as "no session", the internet check failed (the
// block) and it offered Restore network, which drops the block mid-redial. A failed read on a
// running daemon is "unknown"; only a daemon that is not running proves no session.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({
  list: (async () => []) as () => Promise<unknown[]>,
  reachable: true,
  infoThrows: false,
  state: { session: null as unknown, conn: { phase: 'idle', title: 'Not connected' } as Record<string, unknown> },
}));
vi.mock('../../src/main/host', () => ({ getHost: () => ({ dataDir: '.' }) }));
vi.mock('../../src/main/app-state', () => ({
  snapshot: () => st.state,
  patch: (p: Record<string, unknown>) => { Object.assign(st.state, p); },
  setSplitInEffect: vi.fn(), setWholeDeviceInEffect: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('../../src/main/daemon/manager', () => {
  const d = new Proxy({}, { get: (_t, k) => (k === 'listSessions' ? () => st.list() : async () => null) });
  return {
    daemon: () => { if (!st.reachable) throw new Error('The VPN service is not running.'); return d; },
    daemonInfo: () => { if (st.infoThrows) throw new Error('store not initialised'); return { reachable: st.reachable, device: 'Dev', networkOk: true }; },
  };
});
// Q0520: the restart guard is its own unit (service-transition.test.ts); here it is pinned so each case below
// tests one thing. The last case checks the two together.
const tr = vi.hoisted(() => ({ on: false }));
vi.mock('../../src/main/services/service-transition', () => ({
  serviceInTransition: () => tr.on, beginServiceTransition: vi.fn(), applyMarkerFresh: () => false, onTransitionSettled: () => () => undefined, onTransitionBegan: () => () => undefined, RESTARTING_COPY: 'restarting',
}));
vi.mock('../../src/main/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/main/system/tunnels', () => ({ leftoverTunnels: async () => [], rivalVpns: async () => [], removeTunnelServices: async () => undefined }));
const net = vi.hoisted(() => ({ up: false }));
const ks = vi.hoisted(() => ({ mode: 'off' }));
vi.mock('../../src/main/daemon/settings', () => ({ getDaemonSettings: () => ({ settings: { killSwitch: ks.mode, dnsServers: [] } }), serviceUsesTun: () => false, splitForSession: vi.fn() }));
vi.mock('../../src/core/quality/reachability', () => ({ internetReachable: async () => net.up }));
vi.mock('../../src/core/chain/rpc', () => ({ getRpcUrls: () => [], resetRpcTransport: vi.fn(), onRpcRetry: () => () => undefined }));

const { checkLeftoverBlock, adoptRunningSession, sessionStateUnknown } = await import('../../src/main/services/connection');

describe('Restore network during a redial (Q0373)', () => {
  beforeEach(() => {
    st.state.session = null;
    st.state.conn = { phase: 'idle', title: 'Not connected' };
    st.reachable = true;
    st.infoThrows = false;
    tr.on = false;
    net.up = false;
    ks.mode = 'off';
  });

  it('DVPN-WIN Q0540 r21: with the kill switch on the blocked view states the block (same words as the Kill switch page); off keeps the hedge', async () => {
    st.list = async () => [];
    ks.mode = 'persist';
    expect(await checkLeftoverBlock()).toBe(true);
    expect(String(st.state.conn.detail ?? st.state.conn.title)).toMatch(/The kill switch is still blocking the internet from the last session/);
    st.state.conn = { phase: 'idle', title: 'Not connected' };
    ks.mode = 'off';
    expect(await checkLeftoverBlock()).toBe(true);
    expect(String(st.state.conn.detail ?? st.state.conn.title)).toMatch(/may still be blocking traffic/);
  });

  it('DVPN-LINUX KSM14: a blocked view whose block is gone (kill switch Off + Apply) is taken down, not left 61 s', async () => {
    st.list = async () => [];
    expect(await checkLeftoverBlock()).toBe(true);
    expect(st.state.conn.restoreNetwork).toBe(true);
    expect(await checkLeftoverBlock()).toBe(true);        // still blocked: the view stays
    expect(st.state.conn.phase).toBe('error');
    net.up = true;                                         // Off + Apply: internet direct again
    expect(await checkLeftoverBlock()).toBe(false);
    expect(st.state.conn.phase).toBe('idle');
    expect(st.state.conn.restoreNetwork).toBeFalsy();
  });

  it('negative control: an error view this check did not put up (a failed connect) is left alone', async () => {
    net.up = true;
    st.state.conn = { phase: 'error', title: 'Connection failed', restoreNetwork: true };
    expect(await checkLeftoverBlock()).toBe(false);
    expect(st.state.conn.title).toBe('Connection failed');
  });

  it('Q0520: while the service restarts (link lost, an apply) no Restore network is offered even with the internet down', async () => {
    st.reachable = false;
    tr.on = true;
    expect(await checkLeftoverBlock()).toBe(false);
    expect(st.state.conn.restoreNetwork).toBeFalsy();
    tr.on = false; // settled or capped (20 s): the same check now offers it
    expect(await checkLeftoverBlock()).toBe(true);
    expect(st.state.conn.restoreNetwork).toBe(true);
  });

  // FAN 47b427a: the daemon state read can throw before the host is ready; adopt must still not throw.
  it('a failed list while the daemon state cannot be read: logged, never thrown', async () => {
    st.list = async () => { throw new Error('Connection dropped'); };
    st.infoThrows = true;
    await expect(adoptRunningSession()).resolves.toBeUndefined();
    expect(sessionStateUnknown()).toBe(false);
  });

  it('a running dvpnd whose ListSessions drops: unknown, no Restore network', async () => {
    st.list = async () => { throw new Error('Connection dropped'); };
    await adoptRunningSession();
    expect(sessionStateUnknown()).toBe(true);
    expect(await checkLeftoverBlock()).toBe(false);
    expect(st.state.conn.restoreNetwork).toBeFalsy();
  });

  it('a running dvpnd that answers with a reconnecting session: adopted, no Restore network', async () => {
    st.list = async () => [{ id: 's1', node: 'N', service: 'wireguard', status: 'active', error: 'connection lost; reconnecting', channel: '', rxBytes: '0', txBytes: '0', spent: '0' }];
    expect(await checkLeftoverBlock()).toBe(false);
    expect(st.state.conn.restoreNetwork).toBeFalsy();
    expect(st.state.conn.phase).toBe('reconnecting');
  });

  // Q0366 pass 2 (FLX 3044f7e6): the blocked screen after dvpnd gave up keeps dvpnd's reason (ended() passes it).
  it('after an unexpected end the blocked screen says why it ended, with Restore network', async () => {
    st.list = async () => [];
    const { closeReasonCopy } = await import('../../src/core/session/state');
    expect(await checkLeftoverBlock(closeReasonCopy('the connection to this server stopped working'))).toBe(true);
    expect(st.state.conn.restoreNetwork).toBe(true);
    expect(JSON.stringify(st.state.conn)).toContain('The connection to this server stopped working.');
    const src = (await import('node:fs')).readFileSync(new URL('../../src/main/services/connection.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/void checkLeftoverBlock\(copy\)/);
  });

  it('dvpnd answers with no session and the internet is down: Restore network is offered', async () => {
    st.list = async () => [];
    expect(await checkLeftoverBlock()).toBe(true);
    expect(st.state.conn.restoreNetwork).toBe(true);
  });

  it('dvpnd not running and the internet is down: Restore network is offered', async () => {
    st.reachable = false;
    expect(await checkLeftoverBlock()).toBe(true);
    expect(sessionStateUnknown()).toBe(false);
    expect(st.state.conn.restoreNetwork).toBe(true);
  });

  // Q0366 pass 2 (port of the Linux app 3044f7e6): the blocked screen after dvpnd gave up keeps dvpnd's reason.
  it('after an unexpected end the blocked screen says why it ended, with Restore network', async () => {
    st.list = async () => [];
    const { closeReasonCopy } = await import('../../src/core/session/state');
    expect(await checkLeftoverBlock(closeReasonCopy('the connection to this server stopped working'))).toBe(true);
    expect(st.state.conn.restoreNetwork).toBe(true);
    expect(JSON.stringify(st.state.conn)).toContain('The connection to this server stopped working.');
    const src = (await import('node:fs')).readFileSync(new URL('../../src/main/services/connection.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/void checkLeftoverBlock\(copy\)/);
  });
});
