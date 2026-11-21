// ─── Device spending permission at first connect (owner 2026-11-11) ───
// Seen 2026-11-11 on the owner's laptop: a fresh wallet (5 SOL, no tDVPN token account) pressed
// "Sign device permission" and got "[object Object]" four times. Causes: ApproveChecked on a token
// account that did not exist, and an error fallback that printed String(object). The setup step is
// gone: the first Connect signs the permission (and switches the service after a wallet change).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';

const PERMS = 0x2f000000; // PERM_OPEN|FUND|START_CLOSE|CLOSE_CHANNEL (bits 24-27); asserted below to cover PERMS_CLIENT
const OWNER = '4XrkLGdd4T7iwwFCMnKqt5yJAtWEwKTbmLXzSLvYJG6C';
const OLD_OWNER = 'CWT5iHdi76j2wGkfWcs8NXAUyPwJ44A7ZGAdGoYFRaf9';
const DEVICE = '6dJ3mFVHhYid3bgQsNyurGqNDxFnkZhbX6TgkLBeiRpQ';
const NEW_DEVICE = 'GNsVJGk6L8uhU1vNm9t1rST8Wd57Ap6HsR3dVQ78mB7G';

const st = vi.hoisted(() => ({
  wallet: null as Record<string, unknown> | null,
  settings: { autoDevicePermission: true, allowanceTdvpn: '50' } as Record<string, unknown>,
  key: true,
  rec: null as { device: string; owner: string; home: string; at: number } | null,
  pending: false,
  installOk: true,
  setupFail: null as unknown,
  allowances: [] as string[], // W91b: what the first-connect setup signed
  calls: [] as string[],
  snap: {} as Record<string, unknown>,
}));

vi.mock('../../src/core/chain/builders', () => ({
  approveDelegate: ({ amount }: { amount: string }) => ({ tag: `approve:${amount}` }),
  openGrant: async ({ allowance }: { allowance: string }) => ({ tag: `grant:${allowance}` }),
  updateGrant: async () => ({ tag: 'update' }),
  closeGrant: async () => ({ tag: 'close' }),
}));
vi.mock('../../src/core/app/wallet-status', async (orig) => ({
  ...(await orig<typeof import('../../src/core/app/wallet-status')>()),
  readWalletStatus: async () => ({ ...st.wallet }),
}));
vi.mock('../../src/core/app/device-setup', async (orig) => {
  const real = await orig<typeof import('../../src/core/app/device-setup')>();
  return {
    ...real,
    runDeviceSetup: async (_s: unknown, _d: unknown, allowance: string) => {
      st.calls.push('setup');
      st.allowances.push(allowance);
      if (st.setupFail) throw st.setupFail;
      st.wallet = { ...st.wallet, grant: { allowance: '50000000', rentPayer: OWNER, permissions: PERMS }, delegated: '50000000', needsPermission: false };
      return { signature: 'sig-setup', plan: {} };
    },
  };
});
vi.mock('../../src/main/wallet/vault', () => ({ ownerAddress: () => OWNER, ownerKeypair: () => (st.key ? {} : null), hasWallet: () => !!st.key, ownerSigner: () => ({}) }));
vi.mock('../../src/main/system/settings', () => ({ getSettings: () => st.settings, updateSettings: (p: Record<string, unknown>) => Object.assign(st.settings, p) }));
vi.mock('../../src/main/daemon/manager', () => ({
  daemonInfo: () => ({ device: st.rec?.device ?? null }),
  deviceRecord: () => st.rec,
  initDevice: async (owner: string) => { st.calls.push(`init:${owner.slice(0, 4)}`); st.rec = { device: NEW_DEVICE, owner, home: 'h', at: 1 }; st.pending = true; st.wallet = { ...st.wallet, device: NEW_DEVICE, grant: null, delegated: '0', needsPermission: true }; return { ok: true, device: NEW_DEVICE }; },
  installPending: () => st.pending,
  installService: async () => { st.calls.push('install'); if (!st.installOk) return { ok: false, error: 'The administrator prompt was declined.' }; st.pending = false; return { ok: true, data: { relogin: false } }; },
  startServiceIfStopped: async () => 'running',
  // rc.4 E-55: a wallet switch stages its key in a scratch folder and records it only after the install
  stageSwitchDevice: async (owner: string) => { st.calls.push(`stage:${owner.slice(0, 4)}`); return { ok: true, device: NEW_DEVICE }; },
  switchHome: () => 'scratch',
  commitSwitch: (s: { device: string; owner: string }) => { st.calls.push('commit'); st.rec = { device: s.device, owner: s.owner, home: 'h', at: 2 }; },
}));
vi.mock('../../src/main/app-state', () => ({ patch: (p: Record<string, unknown>) => Object.assign(st.snap, p), snapshot: () => ({ hasWallet: true, ...st.snap }), toast: vi.fn() }));
vi.mock('../../src/main/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
// rc.4 E-15: the plan reads the owner's other grants; none here.
vi.mock('../../src/core/chain/accounts', async (orig) => ({ ...(await orig<object>()), grantsByOwner: async () => [] }));
vi.mock('../../src/main/services/settlement', () => ({ readSettlements: async () => [] }));

const { errorText, ProgramError } = await import('../../src/core/chain/errors');
const { planDeviceSetup, autoSetupDecision, ownerSolForSetup, DEVICE_SOL_TARGET } = await import('../../src/core/app/device-setup');
const setupGate = await import('../../src/core/session/setup-gate');
const { ensureDevicePermission, revokeDeviceAccess } = await import('../../src/main/services/wallet');

const fresh = (over: Record<string, unknown> = {}) => ({
  owner: OWNER, device: DEVICE, ownerLamports: 5e9, ownerTdvpn: '20000000', delegated: '0', userBalance: '0', userExists: false,
  userOpenChannels: 0, userRentPayer: null, grant: null, deviceLamports: 0, ready: false, ownerAta: false, needsPermission: true, at: 0, ...over,
});

describe('error text is never [object Object]', () => {
  it('a simulation error object with no logs (the 2026-11-11 case)', () => {
    const e = new ProgramError({ err: { InstructionError: [0, 'InvalidAccountData'] }, logs: null });
    expect(e.message).not.toMatch(/object Object/);
    expect(e.message).toMatch(/tDVPN token account/);
  });
  it('an unknown object names its contents', () => {
    expect(errorText({ foo: 1 })).toBe('The network rejected the transaction: {"foo":1}');
    expect(new ProgramError({ err: { Weird: true } }).message).toMatch(/\{"err":\{"Weird":true\}\}|Weird/);
  });
  it('plain errors and strings pass through', () => {
    expect(errorText(new Error('Not enough SOL'))).toBe('Not enough SOL');
    expect(errorText('boom')).toBe('boom');
  });
  it('an Error whose message is literally [object Object] is replaced', () => {
    expect(errorText(new Error('[object Object]'))).not.toMatch(/object Object/);
  });
});

describe('planDeviceSetup creates a missing tDVPN token account first', () => {
  it('fresh wallet: token account, then approve, then grant, then device SOL', async () => {
    const p = await planDeviceSetup(OWNER, DEVICE, '50000000', fresh() as never);
    expect(p.ixs[0]).toHaveProperty('programId');
    expect((p.ixs[0] as unknown as { programId: { equals: (k: unknown) => boolean } }).programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
    expect((p.ixs[1] as unknown as { tag: string }).tag).toBe('approve:50000000');
    expect((p.ixs[2] as unknown as { tag: string }).tag).toBe('grant:50000000');
    expect(p.ixs).toHaveLength(4);
  });
  it('negative control: an existing token account adds no create', async () => {
    const p = await planDeviceSetup(OWNER, DEVICE, '50000000', fresh({ ownerAta: true }) as never);
    expect((p.ixs[0] as unknown as { tag: string }).tag).toBe('approve:50000000');
    expect(p.ixs).toHaveLength(3);
  });
});

describe('autoSetupDecision', () => {
  const on = { on: true, hasKey: true };
  it('runs for a funded wallet without a permission', () => expect(autoSetupDecision(fresh() as never, on)).toBe('run'));
  it('not needed once set up', () => expect(autoSetupDecision(fresh({ grant: { allowance: '1', rentPayer: OWNER, permissions: PERMS }, delegated: '5' }) as never, on)).toBe('not-needed'));
  it('off, no key, no device', () => {
    expect(autoSetupDecision(fresh() as never, { on: false, hasKey: true })).toBe('off');
    expect(autoSetupDecision(fresh() as never, { on: true, hasKey: false })).toBe('no-key');
    expect(autoSetupDecision(fresh({ device: null }) as never, on)).toBe('no-device');
  });
  it('owner short of SOL: the exact edge', () => {
    const need = ownerSolForSetup(0);
    expect(autoSetupDecision(fresh({ ownerLamports: need - 1 }) as never, on)).toBe('owner-short');
    expect(autoSetupDecision(fresh({ ownerLamports: need }) as never, on)).toBe('run');
  });
  it('the renderer copy of the SOL target matches the main one', () => expect(setupGate.SETUP_DEVICE_SOL_TARGET).toBe(DEVICE_SOL_TARGET));
});

describe('ensureDevicePermission (runs inside connect)', () => {
  beforeEach(() => {
    st.wallet = fresh();
    st.settings = { autoDevicePermission: true, allowanceTdvpn: '50' };
    st.key = true;
    st.rec = { device: DEVICE, owner: OWNER, home: 'h', at: 1 };
    st.pending = false;
    st.installOk = true;
    st.setupFail = null;
    st.calls = [];
    st.snap = {};
    st.allowances = [];
  });
  it('W91b: a fresh wallet holding 20 tDVPN with Settings at 50: the first-connect limit is 20 (the wallet), as device setup', async () => {
    expect(await ensureDevicePermission()).toBeNull();
    expect(st.allowances).toEqual(['20000000']);
  });
  it('W91b negative control: a wallet holding more than the Settings limit: the Settings limit', async () => {
    st.wallet = fresh({ ownerTdvpn: '90000000' });
    expect(await ensureDevicePermission()).toBeNull();
    expect(st.allowances).toEqual(['50000000']);
  });
  it('W91b negative control: a wallet holding 0: the Settings limit (never a 0 limit)', async () => {
    st.wallet = fresh({ ownerTdvpn: '0' });
    expect(await ensureDevicePermission()).toBeNull();
    expect(st.allowances).toEqual(['50000000']);
  });
  it('fresh wallet: signs the permission and lets the connect go on', async () => {
    expect(await ensureDevicePermission()).toBeNull();
    expect(st.calls).toEqual(['setup']);
    expect((st.snap.deviceAuto as { state: string }).state).toBe('idle');
  });
  it('already set up: nothing is signed', async () => {
    st.wallet = fresh({ grant: { allowance: '50000000', rentPayer: OWNER, permissions: PERMS }, delegated: '5', needsPermission: false });
    expect(await ensureDevicePermission()).toBeNull();
    expect(st.calls).toEqual([]);
  });
  it('wallet switched on this computer, user said yes: key staged, permission, service switch, THEN recorded (rc.4 E-55)', async () => {
    st.rec = { device: DEVICE, owner: OLD_OWNER, home: 'h', at: 1 };
    expect(await ensureDevicePermission('0', { confirmSwitch: true })).toBeNull();
    expect(st.calls).toEqual([`stage:${OWNER.slice(0, 4)}`, 'setup', 'install', 'commit']);
  });
  it('wallet switched, no yes yet: asked first, nothing staged or signed', async () => {
    st.rec = { device: DEVICE, owner: OLD_OWNER, home: 'h', at: 1 };
    const r = await ensureDevicePermission();
    expect(r?.code).toBe('wallet-switch-needed');
    expect(st.calls).toEqual([]);
  });
  it('admin prompt declined: a clear error, the record still names the old wallet, the next try finishes the switch', async () => {
    st.rec = { device: DEVICE, owner: OLD_OWNER, home: 'h', at: 1 };
    st.installOk = false;
    const r = await ensureDevicePermission('0', { confirmSwitch: true });
    expect(r?.error).toMatch(/administrator prompt was declined/);
    expect(r?.error).toMatch(/stays set up for the other wallet/);
    expect(st.rec).toMatchObject({ owner: OLD_OWNER, device: DEVICE });
    st.installOk = true; st.calls = [];
    expect(await ensureDevicePermission('0', { confirmSwitch: true })).toBeNull();
    expect(st.calls).toEqual([`stage:${OWNER.slice(0, 4)}`, 'setup', 'install', 'commit']);
  });
  it('setup throws a raw object: the error is readable', async () => {
    st.setupFail = { err: { InstructionError: [0, { Custom: 999999 }] } };
    const r = await ensureDevicePermission();
    expect(r?.error).toMatch(/^Could not set up payments for this computer: /);
    expect(r?.error).not.toMatch(/object Object/);
    st.setupFail = null;
    await ensureDevicePermission(); // clears the failure for later tests
  });
  it('wallet short of SOL: says how much, signs nothing', async () => {
    st.wallet = fresh({ ownerLamports: 1_000_000 });
    const r = await ensureDevicePermission();
    expect(r?.error).toMatch(/Add devnet SOL to your wallet first: .* about 0\.060 SOL/);
    expect(st.calls).toEqual([]);
  });
  it('setting off: points to Settings, signs nothing', async () => {
    st.settings = { autoDevicePermission: false, allowanceTdvpn: '50' };
    const r = await ensureDevicePermission();
    expect(r?.action).toBe('Open Settings');
    expect(st.calls).toEqual([]);
  });
});

describe('connect wiring', () => {
  it('connect() runs the permission before waiting for the service', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, '../../src/main/services/connection.ts'), 'utf8');
    const hook = src.indexOf('await ensureDevicePermission(floor'); // rc.4 E-55: + { confirmSwitch }
    const wait = src.indexOf('d = await whileWatched(() => waitForDaemon(SERVICE_WAIT_MS, daemonInfo));');
    expect(hook).toBeGreaterThan(0);
    expect(hook).toBeLessThan(wait);
  });
  it('onboarding has no permission step', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, '../../src/renderer/src/screens/Onboarding.tsx'), 'utf8');
    expect(src).not.toMatch(/Sign device permission|PermissionStep|Review and sign/);
  });
  it('removing the permission turns first-connect setup off (no silent re-sign)', () => {
    expect(typeof revokeDeviceAccess).toBe('function');
  });
});

describe('test fixture', () => {
  it('PERMS covers the client permissions', async () => {
    const { PERMS_CLIENT } = await import('../../src/core/chain/idl');
    expect(PERMS & PERMS_CLIENT).toBe(PERMS_CLIENT);
  });
});

describe('a service switch left pending survives an app restart', () => {
  it('connect() also runs setup when a switch is pending', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, '../../src/main/services/connection.ts'), 'utf8');
    expect(src).toMatch(/\|\| serviceSwitchPending\(\)\) \{/);
  });
  it('permission already signed + pending switch: installs only, signs nothing', async () => {
    st.wallet = fresh({ grant: { allowance: '50000000', rentPayer: OWNER, permissions: PERMS }, delegated: '5', needsPermission: false });
    st.rec = { device: DEVICE, owner: OWNER, home: 'h', at: 1 };
    st.pending = true; st.installOk = true; st.calls = []; st.setupFail = null;
    const { serviceSwitchPending } = await import('../../src/main/services/wallet');
    expect(serviceSwitchPending()).toBe(true);
    expect(await ensureDevicePermission()).toBeNull();
    expect(st.calls).toEqual(['install']);
  });
});

describe('a deposit above the device limit raises it in the same Connect (owner 2026-11-11)', () => {
  beforeEach(() => {
    st.wallet = fresh({ grant: { allowance: '50000000', rentPayer: OWNER, permissions: PERMS }, delegated: '50000000', needsPermission: false, deviceLamports: 60_000_000 });
    st.settings = { autoDevicePermission: true, allowanceTdvpn: '50' };
    st.rec = { device: DEVICE, owner: OWNER, home: 'h', at: 1 };
    st.pending = false; st.calls = []; st.setupFail = null; st.key = true;
  });
  it('330 tDVPN deposit on a 50 tDVPN limit: signs the raise', async () => {
    expect(await ensureDevicePermission('330000000')).toBeNull();
    expect(st.calls).toEqual(['setup']);
  });
  it('negative control: a deposit inside the limit signs nothing', async () => {
    expect(await ensureDevicePermission('10000000')).toBeNull();
    expect(st.calls).toEqual([]);
  });
  it('setting off: no raise (the dialog keeps the old blocker)', async () => {
    st.settings = { autoDevicePermission: false, allowanceTdvpn: '50' };
    await ensureDevicePermission('330000000');
    expect(st.calls).toEqual([]);
  });
  it('the dialog shows a raise note, not a blocker, while the setting is on', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, '../../src/renderer/src/components/ConnectSheet.tsx'), 'utf8');
    expect(src).toMatch(/: firstSetup \|\| raise \? null/);
    expect(src).toMatch(/data-raise-limit/);
  });
});
