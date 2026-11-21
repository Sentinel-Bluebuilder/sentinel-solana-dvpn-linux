// ─── E-55 CLI half: device switch / device discard-setup, and the wallet-switch-needed next ───
// Engine half (connect-5e): switchWallet() in services/wallet.ts, discardHalfFinishedSetup() in daemon/manager.ts,
// 'wallet-switch-needed' in CONNECT_CODES. Here: both commands need --yes, switch refuses with nothing to switch, and
// the agent next names the key file or device switch, never wallet create / device setup.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({
  owner: 'BBBBloaded' as string | null, rec: { owner: 'AAAArecorded', device: 'Dev1' } as null | { owner: string; device: string },
  switchCalls: [] as unknown[][], switchResult: null as null | { error: string; action: string | null; code?: string }, removed: [] as string[],
}));
vi.mock('../../src/main/wallet/vault', async (orig) => ({ ...(await orig<object>()), ownerAddress: () => st.owner, noWallet: () => ({ error: 'Set up a wallet first.', code: 'no-wallet' }) }));
vi.mock('../../src/main/services/wallet', async (orig) => ({
  ...(await orig<object>()),
  switchWallet: async (...args: unknown[]) => { st.switchCalls.push(args); return st.switchResult; },
}));
vi.mock('../../src/main/daemon/manager', async (orig) => ({
  ...(await orig<object>()),
  deviceRecord: () => st.rec,
  discardHalfFinishedSetup: () => ({ removed: st.removed }),
}));

const { COMMANDS } = await import('../../src/cli/commands');
const { parseArgs } = await import('../../src/cli/args');
const { nextFor } = await import('../../src/cli/agent-cmd');

async function run(line: string): Promise<{ text: string; data: unknown; error?: Error & { code?: string; action?: string } }> {
  const argv = line.split(' ');
  const a = parseArgs(argv);
  let text = ''; let data: unknown;
  try {
    await COMMANDS[argv[0]].run(a, { json: false, print: (t: string, d?: unknown) => { text = t; data = d; } } as never);
    return { text, data };
  } catch (err) { return { text, data, error: err as Error & { code?: string; action?: string } }; }
}

beforeEach(() => { st.owner = 'BBBBloaded'; st.rec = { owner: 'AAAArecorded', device: 'Dev1' }; st.switchCalls = []; st.switchResult = null; st.removed = []; });

describe('E-55: device switch', () => {
  it('without --yes nothing is switched', async () => {
    const r = await run('device switch');
    expect(st.switchCalls).toEqual([]);
    expect(r.error).toBeDefined();
  });
  it('F2: the confirm names the new device, the 0.05 SOL float left on the old one, and where its deposits are', async () => {
    const r = await run('device switch');
    expect(r.text).toContain('Switch this computer from AAAArecorded to BBBBloaded. This sets this computer up as a new device for the loaded wallet, which pays about 0.05 SOL of fee float for it. About 0.05 SOL of fee float stays on the previous device and cannot be sent back yet. Deposits made with the previous device stay refundable: settle list shows them.');
    expect(r.data).toMatchObject({ needsConfirm: true, from: 'AAAArecorded', to: 'BBBBloaded', floatSol: '0.05' });
  });
  it('--yes switches to the loaded wallet, confirmed', async () => {
    const r = await run('device switch --yes');
    expect(st.switchCalls).toEqual([['BBBBloaded', 'AAAArecorded', '0', true]]);
    expect(r.text).toBe('This computer is now set up for BBBBloaded.');
  });
  it('already set up for the loaded wallet: nothing to switch, no call', async () => {
    st.rec = { owner: 'BBBBloaded', device: 'Dev1' };
    const r = await run('device switch --yes');
    expect(st.switchCalls).toEqual([]);
    expect(r.text).toMatch(/already set up for BBBBloaded: nothing to switch/);
  });
  it('an engine refusal keeps its code and sentence', async () => {
    st.switchResult = { error: 'Not enough SOL to set up the device.', action: null, code: 'device-sol' };
    const r = await run('device switch --yes');
    expect(r.error?.code).toBe('device-sol');
    expect(r.error?.message).toBe('Not enough SOL to set up the device.');
  });
  it('no device record: points at device setup, no call', async () => {
    st.rec = null;
    expect((await run('device switch --yes')).error?.message).toMatch(/device setup --yes/);
    expect(st.switchCalls).toEqual([]);
  });
});

describe('E-55: device discard-setup', () => {
  it('without --yes nothing is removed', async () => {
    st.removed = ['/x/staging'];
    expect((await run('device discard-setup')).error).toBeDefined();
  });
  it('--yes names the folders removed, or nothing to remove', async () => {
    st.removed = ['/x/staging', '/x/switch'];
    expect((await run('device discard-setup --yes')).text).toBe('Removed:\n  /x/staging\n  /x/switch');
    st.removed = [];
    expect((await run('device discard-setup --yes')).text).toBe('Nothing to remove.');
  });
});

describe('E-55: wallet-switch-needed next', () => {
  it('names the key file or device switch, never wallet create or device setup', () => {
    const n = nextFor('wallet-switch-needed');
    expect(n).toMatch(/^load the key file of the wallet named in "error", or devnet-dvpn device switch --yes/);
    expect(n).not.toMatch(/wallet create|device setup/);
  });
});
