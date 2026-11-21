// ─── Q0508 F1/F2/F6: one apply at a time, never while connecting, and a restarted session ends the app's way ───
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DaemonSettings } from '../../src/core/daemon/config';

const SAVED = {
  killSwitch: 'off', allowLan: false, dnsServers: ['1.1.1.1'], dnsMode: 'netsh', basis: 'per_gb', escrow: '1000000',
  prepayBytes: '0', prepaySeconds: '0', rpcUrl: 'https://api.devnet.solana.com', rpcWsUrl: 'wss://api.devnet.solana.com',
} as DaemonSettings;

let release: (() => void) | null = null;
let throwNext = false;
const applyCalls: DaemonSettings[] = [];
vi.mock('../../src/main/daemon/settings', () => ({
  getDaemonSettings: () => ({ readable: true, settings: SAVED }),
  applyDaemonSettings: (s: DaemonSettings) => { applyCalls.push(s); if (throwNext) { throwNext = false; return Promise.reject(new Error('elevation cancelled')); } return new Promise((res) => { release = () => res({ ok: true }); }); },
}));
const state = { phase: 'idle', session: null as null | { id: string } };
vi.mock('../../src/main/app-state', () => ({ snapshot: () => ({ conn: { phase: state.phase }, session: state.session }) }));
const endAfterServiceRestart = vi.fn(async () => true);
const restarting: boolean[] = [];
const releaseKeptKillSwitch = vi.fn(async () => true);
const elsewhere = { applying: false, connecting: false };
const checkLeftoverBlock = vi.fn(async () => false);
vi.mock('../../src/main/services/connection', () => ({ adoptRunningSession: vi.fn(async () => undefined), endAfterServiceRestart, releaseKeptKillSwitch, checkLeftoverBlock, connectRunningElsewhere: () => elsewhere.connecting }));
// Q0520: the apply marks itself for every process (marker), cleared even when the apply throws.
vi.mock('../../src/main/services/service-transition', () => ({
  writeApplyMarker: () => { restarting.push(true); }, clearApplyMarker: () => { restarting.push(false); }, applyMarkerFresh: () => elsewhere.applying,
}));
vi.mock('../../src/main/daemon/manager', () => ({ daemonInfo: () => ({ version: 'x', reachable: true }) }));
vi.mock('../../src/main/logger', () => ({ log: { info: vi.fn(), warn: vi.fn() } }));

const { applyServiceSettings, applyRunning, releaseAfterRestart, APPLY_BUSY, APPLY_WHILE_CONNECTING } = await import('../../src/main/services/daemon-apply');

const until = async (f: () => boolean): Promise<void> => { for (let i = 0; i < 50 && !f(); i++) await new Promise((r) => setTimeout(r, 2)); };

describe('applyServiceSettings', () => {
  beforeEach(() => { applyCalls.length = 0; release = null; state.phase = 'idle'; state.session = null; endAfterServiceRestart.mockClear(); releaseKeptKillSwitch.mockClear(); checkLeftoverBlock.mockClear(); restarting.length = 0; elsewhere.applying = false; elsewhere.connecting = false; });

  it('F2: a second apply while one runs is refused, never interleaved', async () => {
    const first = applyServiceSettings({ ...SAVED, killSwitch: 'persist' });
    await until(() => release !== null);
    expect(applyRunning()).toBe(true);
    const second = await applyServiceSettings({ ...SAVED, allowLan: true });
    expect(second).toMatchObject({ ok: false, code: 'apply-busy', error: APPLY_BUSY() });
    release!();
    expect(await first).toMatchObject({ ok: true });
    expect(applyCalls).toHaveLength(1);
    expect(applyRunning()).toBe(false);
  });

  it('KSM9: another process applying (its marker) or connecting (the CLI) is refused with the same words, nothing restarts', async () => {
    elsewhere.applying = true;
    expect(await applyServiceSettings({ ...SAVED, killSwitch: 'persist' })).toMatchObject({ ok: false, code: 'apply-busy', error: APPLY_BUSY() });
    elsewhere.applying = false; elsewhere.connecting = true;
    expect(await applyServiceSettings({ ...SAVED, killSwitch: 'persist' })).toMatchObject({ ok: false, code: 'apply-while-connecting', error: APPLY_WHILE_CONNECTING() });
    expect(applyCalls).toHaveLength(0);
    expect(restarting).toHaveLength(0);
    expect(applyRunning()).toBe(false); // the refusal released the lock
  });

  it('F6: refused while a connection is starting or stopping', async () => {
    for (const phase of ['connecting', 'disconnecting']) {
      state.phase = phase;
      expect(await applyServiceSettings(SAVED)).toMatchObject({ ok: false, code: 'apply-while-connecting', error: APPLY_WHILE_CONNECTING() });
    }
    expect(applyCalls).toHaveLength(0);
  });

  it('F1: a live session is ended the app way after the restart (history, proxy back), and the result says so', async () => {
    state.phase = 'connected'; state.session = { id: 'S1' };
    const p = applyServiceSettings({ ...SAVED, killSwitch: 'persist' });
    await until(() => release !== null);
    release!();
    expect(await p).toEqual({ ok: true, sessionEnded: true });
    expect(endAfterServiceRestart).toHaveBeenCalledWith('S1');
    // Q0534: a persist kill switch kept the ended session's block; the user's Apply releases it (like Disconnect)
    expect(releaseKeptKillSwitch).toHaveBeenCalledTimes(1);
    expect(checkLeftoverBlock).not.toHaveBeenCalled(); // released: no blocked-screen check (AND-34)
  });

  it('negative control: no session, nothing is ended', async () => {
    const p = applyServiceSettings(SAVED);
    await until(() => release !== null);
    release!();
    expect(await p).toEqual({ ok: true, sessionEnded: false });
    expect(endAfterServiceRestart).not.toHaveBeenCalled();
    expect(releaseKeptKillSwitch).not.toHaveBeenCalled(); // negative control: nothing ended, nothing released
  });

  it('owner laptop 23:34Z: the apply is marked for every process while it runs (no verdicts), cleared after', async () => {
    const p = applyServiceSettings({ ...SAVED, killSwitch: 'off' });
    await until(() => release !== null);
    expect(restarting).toEqual([true]);           // marked during the restart
    release!();
    await p;
    expect(restarting).toEqual([true, false]);    // the one check runs when the service settles (service-transition)
  });

  it('the restart flag is cleared even when the apply step throws', async () => {
    throwNext = true;
    await expect(applyServiceSettings(SAVED)).rejects.toThrow('elevation cancelled');
    expect(restarting).toEqual([true, false]);
    expect(applyRunning()).toBe(false);
  });

  it('a bad value never reaches the service', async () => {
    const r = await applyServiceSettings({ ...SAVED, killSwitch: 'always' as never });
    expect(r).toMatchObject({ ok: false, code: 'invalid-daemon-setting' });
    expect(applyCalls).toHaveLength(0);
  });
});

// ─── Q0534 on RC 8c0f488 (DVPN-WIN): the release ran while the service was still restarting ───
describe('releaseAfterRestart', () => {
  const noSleep = async () => undefined;
  it('waits for the service link, then retries the release through a restart window', async () => {
    const order: string[] = [];
    let calls = 0;
    const release = vi.fn(async () => {
      calls += 1;
      order.push(`release${calls}`);
      if (calls < 3) throw new Error('StopSession: No connection established. Last error: Error: connect ENOENT \\.\pipe\devnet-dvpn-x');
      return true;
    });
    const waitLink = vi.fn(async () => { order.push('wait'); });
    expect(await releaseAfterRestart(30_000, { release, waitLink, sleep: noSleep })).toBe(true);
    expect(order).toEqual(['wait', 'release1', 'release2', 'release3']);
  });
  it('gives up after maxMs and reports false (the app then offers Restore network)', async () => {
    const release = vi.fn(async () => { throw new Error('connect ENOENT'); });
    expect(await releaseAfterRestart(0, { release, waitLink: async () => undefined, sleep: noSleep })).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });
  it('nothing held: one call, false, no retry', async () => {
    const release = vi.fn(async () => false);
    expect(await releaseAfterRestart(30_000, { release, waitLink: async () => undefined, sleep: noSleep })).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
