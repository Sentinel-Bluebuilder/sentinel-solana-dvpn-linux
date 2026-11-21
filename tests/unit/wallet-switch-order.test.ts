// rc.4 E-55 (Windows rc.3, other fleet + UI-ENGINE read of 7e1f303): a connect with a second wallet ran
// initDevice FIRST (device.json rewritten for the new wallet, a new key staged), then refused on too little
// SOL. The first wallet's deposits went unlisted and switching back stopped on "a half-finished setup".
// Now: asked first, every refusing check before any write, the key in its own scratch folder, device.json
// written only after the service runs the new key.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const A = 'AAAAzqJ5VnSxW4wZGkdcwF5ydW3z7jRMNTgZyU2LvcFz';
const B = 'BBBBzqJ5VnSxW4wZGkdcwF5ydW3z7jRMNTgZyU2LvcFz';
const st = vi.hoisted(() => ({
  dataDir: '', kind: 'dpapi', lamports: 1_000_000_000, staged: 0, setup: 0, install: { ok: true } as { ok: boolean; error?: string }, installs: 0, commits: [] as unknown[],
}));

vi.mock('../../src/main/host', () => ({ getHost: () => ({ keyStore: { kind: st.kind }, dataDir: st.dataDir, resourcesDir: st.dataDir }), setHost: vi.fn() }));
vi.mock('../../src/main/wallet/vault', () => ({ ownerAddress: () => B, hasWallet: () => true, ownerSigner: () => ({}) }));
vi.mock('../../src/main/system/settings', () => ({ getSettings: () => ({ allowanceTdvpn: '50', autoDevicePermission: true }), updateSettings: vi.fn() }));
vi.mock('../../src/core/app/wallet-status', () => ({
  readWalletStatus: async () => ({ owner: B, device: null, ownerLamports: st.lamports, ownerTdvpn: '100000000', delegated: '0', grant: null, deviceLamports: 0 }),
  lowFundsWarnings: () => [],
}));
vi.mock('../../src/core/app/device-setup', async (orig) => ({
  ...(await orig<object>()),
  runDeviceSetup: async () => { st.setup += 1; return { signature: 'sig', plan: {} }; },
}));
vi.mock('../../src/main/daemon/manager', () => ({
  daemonInfo: () => ({ device: 'OldDev' }),
  deviceRecord: () => ({ device: 'OldDev', home: 'C:\\ProgramData\\sentinel-dvpn\\c0', owner: A, at: 0 }),
  installPending: () => false,
  startServiceIfStopped: async () => 'running',
  stageSwitchDevice: async () => { st.staged += 1; return { ok: true, device: 'NewDev' }; },
  switchHome: () => 'scratch',
  installService: async () => { st.installs += 1; return st.install; },
  commitSwitch: (s: unknown) => { st.commits.push(s); },
}));
vi.mock('../../src/main/app-state', () => ({ patch: vi.fn(), snapshot: () => ({}), toast: vi.fn() }));
vi.mock('../../src/main/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/main/services/settlement', () => ({ readSettlements: async () => [] }));
vi.mock('../../src/core/chain/accounts', async (orig) => ({ ...(await orig<object>()), grantsByOwner: async () => [] }));

const { ensureDevicePermission, switchNeededCopy } = await import('../../src/main/services/wallet');

beforeEach(() => { Object.assign(st, { kind: 'dpapi', lamports: 1_000_000_000, staged: 0, setup: 0, install: { ok: true }, installs: 0, commits: [] }); });
const wrote = () => ({ staged: st.staged, setup: st.setup, installs: st.installs, commits: st.commits.length });

describe('a connect with a wallet the computer is not set up for', () => {
  it('without the user\'s yes: wallet-switch-needed, nothing staged, signed or recorded', async () => {
    const r = await ensureDevicePermission('0');
    expect(r?.code).toBe('wallet-switch-needed');
    expect(r?.error).toBe(switchNeededCopy(B, A, false));
    expect(wrote()).toEqual({ staged: 0, setup: 0, installs: 0, commits: 0 });
  });

  it('a key file wallet is refused naming the recorded wallet and the explicit switch command', async () => {
    st.kind = 'keyfile';
    const r = await ensureDevicePermission('0');
    expect(r?.error).toMatch(/set up for another wallet \(AAAA…vcFz\)/);
    expect(r?.error).toMatch(/devnet-dvpn device switch --yes/);
    expect(wrote().staged).toBe(0);
  });

  it('confirmed but too little SOL (the rc.3 case): refused BEFORE any key is made or record written', async () => {
    st.lamports = 10_000_000;
    const r = await ensureDevicePermission('0', { confirmSwitch: true });
    expect(r?.code).toBe('device-sol');
    expect(wrote()).toEqual({ staged: 0, setup: 0, installs: 0, commits: 0 });
  });

  it('the service install fails: the record is not changed (the next Connect finishes the switch)', async () => {
    st.install = { ok: false, error: 'declined' };
    const r = await ensureDevicePermission('0', { confirmSwitch: true });
    expect(r?.error).toMatch(/stays set up for the other wallet/);
    expect(wrote()).toEqual({ staged: 1, setup: 1, installs: 1, commits: 0 });
  });

  it('negative control: confirmed with enough SOL: staged, set up, installed, THEN recorded', async () => {
    const r = await ensureDevicePermission('0', { confirmSwitch: true });
    expect(r).toBeNull();
    expect(wrote()).toEqual({ staged: 1, setup: 1, installs: 1, commits: 1 });
    expect(st.commits[0]).toMatchObject({ device: 'NewDev', owner: B });
  });
});

describe('manager: the scratch folder and the half-finished-setup removal (real files)', async () => {
  const real = await vi.importActual<typeof import('../../src/main/daemon/manager')>('../../src/main/daemon/manager');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddv-e55-'));
  st.dataDir = dir;

  it('a scratch switch for another wallet is refused, and device.json + staging stay byte-identical', async () => {
    fs.writeFileSync(path.join(dir, 'device.json'), '{"device":"OldDev","home":"h","owner":"A","at":1}');
    fs.mkdirSync(path.join(dir, 'daemon-staging'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'daemon-staging', 'config.toml'), 'x = 1\n');
    fs.mkdirSync(real.switchHome(), { recursive: true });
    fs.writeFileSync(path.join(real.switchHome(), 'switch.json'), JSON.stringify({ device: 'NewDev', owner: A, at: 1 }));
    const before = [fs.readFileSync(path.join(dir, 'device.json')), fs.readFileSync(path.join(dir, 'daemon-staging', 'config.toml'))];
    const r = await real.stageSwitchDevice(B);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/was started and not finished/);
    expect(fs.readFileSync(path.join(dir, 'device.json'))).toEqual(before[0]);
    expect(fs.readFileSync(path.join(dir, 'daemon-staging', 'config.toml'))).toEqual(before[1]);
  });

  it('the same wallet reuses its scratch key (the setup may have funded it)', async () => {
    expect(await real.stageSwitchDevice(A)).toEqual({ ok: true, device: 'NewDev' });
  });

  it('discardHalfFinishedSetup removes staging and scratch, keeps device.json', () => {
    const r = real.discardHalfFinishedSetup();
    expect(r.removed.length).toBe(2);
    expect(fs.existsSync(real.stagingHome())).toBe(false);
    expect(fs.existsSync(real.switchHome())).toBe(false);
    expect(fs.existsSync(path.join(dir, 'device.json'))).toBe(true);
  });

  it('the half-finished wording names a control that exists', async () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/main/daemon/manager.ts'), 'utf8');
    expect(src).not.toMatch(/Settings → Advanced/);
  });
});
