// ─── rc9-e H: the kill switch is never turned on from a remote session without --allow-remote-lockout ───
// review live (ctl ~/lnx5-lpf2b-evidence): `daemon set --kill-switch on` writes dvpnd persist; after a lost session
// dvpnd re-applies its drop-all block at every boot, so a server reached over SSH is locked out for good. review: the
// same on Windows (persistent WFP filters). These tests set the session env themselves (the suite runs over SSH on ctl).
import fs from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const applied: unknown[] = [];
vi.mock('../../src/main/daemon/settings', () => ({
  EMPTY_SETTINGS_COPY: 'empty',
  getDaemonSettings: () => ({
    readable: true,
    settings: {
      killSwitch: 'off', allowLan: false, dnsServers: ['10.8.0.1'], dnsMode: 'vpn', basis: 'per_gb', escrow: '1000000',
      prepayBytes: '0', prepaySeconds: '0', rpcUrl: 'https://api.devnet.solana.com', rpcWsUrl: 'wss://api.devnet.solana.com',
    },
  }),
  applyDaemonSettings: async (s: unknown) => { applied.push(s); return { ok: true, data: null }; },
}));

const { daemonCmd } = await import('../../src/cli/daemon-cmd');
const { parseArgs } = await import('../../src/cli/args');
const { NeedsConfirm } = await import('../../src/cli/commands');
const { remoteSession, ksRemoteRiskFields } = await import('../../src/cli/remote-session');
const { exitCodeFor } = await import('../../src/cli/exit-codes');
const { moneyOf } = await import('../../src/cli/money-note');
const { unknownFlags } = await import('../../src/cli/catalogue');

const VARS = ['SSH_CONNECTION', 'SSH_CLIENT', 'SSH_TTY', 'SESSIONNAME'] as const;
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  applied.length = 0;
  saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  for (const k of VARS) delete process.env[k];
  delete process.env.DVPN_PLATFORM;
});
afterEach(() => { for (const k of VARS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const run = (argv: string[]): Promise<void> => daemonCmd(parseArgs(['daemon', ...argv]), { json: false, print: () => undefined });
type Refusal = Error & { code?: string; action?: string; alsoNext?: string };
const refusal = async (argv: string[]): Promise<Refusal | null> => { try { await run(argv); return null; } catch (e) { return e as Refusal; } };

describe('rc9-e: remoteSession', () => {
  it('SSH (any of the three vars, the Win32-OpenSSH shape too) and Windows RDP are remote; the console is not', () => {
    expect(remoteSession({ SSH_CONNECTION: '10.0.0.5 50122 10.0.0.4 22' }, 'linux')).toBe('ssh');
    expect(remoteSession({ SSH_CLIENT: '10.0.0.5 50122 22' }, 'win32')).toBe('ssh');
    expect(remoteSession({ SSH_TTY: '/dev/pts/0' }, 'darwin')).toBe('ssh');
    expect(remoteSession({ SESSIONNAME: 'RDP-Tcp#3' }, 'win32')).toBe('rdp');
    expect(remoteSession({ SESSIONNAME: 'Console' }, 'win32')).toBeNull();
    expect(remoteSession({}, 'linux')).toBeNull();
    expect(remoteSession({ SESSIONNAME: 'RDP-Tcp#3' }, 'linux')).toBeNull(); // only Windows names its sessions so
  });
});

describe('rc9-e: daemon set --kill-switch from a remote session', () => {
  for (const [label, env] of [['SSH', { SSH_CONNECTION: '10.0.0.5 50122 10.0.0.4 22' }], ['Win32-OpenSSH', { SSH_CLIENT: '10.0.0.5 50122 22' }]] as const) {
    for (const mode of ['on', 'persist']) {
      it(`${label}: --kill-switch ${mode} is refused, kill-switch-remote, nothing applied, before the prompt`, async () => {
        Object.assign(process.env, env);
        const e = await refusal(['set', '--kill-switch', mode, '--yes']);
        expect(e?.code).toBe('kill-switch-remote');
        expect(e?.message).toMatch(/blocks every new connection to this computer, SSH included\. It keeps blocking after a reboot until `devnet-dvpn daemon restore-network` is run locally or from the provider's console\. Nothing was changed\.$/);
        expect(e?.action).toBe('devnet-dvpn agent up --yes');
        expect(e?.alsoNext).toContain(`daemon set --kill-switch ${mode} --allow-remote-lockout --yes`);
        expect(applied).toHaveLength(0);
        const noYes = await refusal(['set', '--kill-switch', mode]);
        expect(noYes?.code).toBe('kill-switch-remote'); // refused before the confirm, not after it
      });
    }
  }
  it('Windows RDP: refused too (names Remote Desktop)', async () => {
    const plat = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      process.env.SESSIONNAME = 'RDP-Tcp#0';
      const e = await refusal(['set', '--kill-switch', 'on', '--yes']);
      expect(e?.code).toBe('kill-switch-remote');
      expect(e?.message).toMatch(/Remote Desktop included/);
    } finally { Object.defineProperty(process, 'platform', plat); }
  });
  it('the override applies it (over SSH)', async () => {
    process.env.SSH_CONNECTION = '10.0.0.5 50122 10.0.0.4 22';
    await run(['set', '--kill-switch', 'on', '--allow-remote-lockout', '--yes']);
    expect(applied).toHaveLength(1);
    expect((applied[0] as { killSwitch: string }).killSwitch).toBe('on');
    expect(unknownFlags(['daemon', 'set'], { 'kill-switch': 'on', 'allow-remote-lockout': true, yes: true })).toEqual([]);
  });
  it('negative controls: a local session is not refused; --kill-switch off and other settings are never refused remotely', async () => {
    await expect(run(['set', '--kill-switch', 'on'])).rejects.toBeInstanceOf(NeedsConfirm);
    process.env.SSH_CONNECTION = '10.0.0.5 50122 10.0.0.4 22';
    await run(['set', '--kill-switch', 'off', '--yes']);
    await run(['set', '--allow-lan', 'true', '--yes']);
    expect(applied).toHaveLength(2);
  });
  it('exit 5 (safety), money none', () => {
    expect(exitCodeFor('kill-switch-remote')).toBe(5);
    expect(moneyOf('kill-switch-remote')).toBe('none');
  });
});

describe('rc9-e: agent status warns when the kill switch is already on in a remote session', () => {
  it('on/persist over SSH: killSwitchRemoteRisk + the restore line; off or local: nothing', () => {
    const ssh = { SSH_CONNECTION: '1 2 3 22' };
    for (const k of ['on', 'persist']) {
      const f = ksRemoteRiskFields(k, ssh, 'linux');
      expect(f.killSwitchRemoteRisk).toBe(true);
      expect(f.restoreNetwork).toBe('devnet-dvpn daemon restore-network');
      expect(f.killSwitchRemoteNote).toMatch(/It keeps blocking after a reboot/);
    }
    expect(ksRemoteRiskFields('off', ssh, 'linux')).toEqual({});
    expect(ksRemoteRiskFields('persist', {}, 'linux')).toEqual({});
    expect(ksRemoteRiskFields('on', { SESSIONNAME: 'RDP-Tcp#1' }, 'win32').killSwitchRemoteRisk).toBe(true);
  });
  it('agent status spreads those fields into its answer', () => {
    const s = fs.readFileSync('src/cli/agent-cmd.ts', 'utf8');
    expect(s).toMatch(/\.\.\.ksRemoteRiskFields\(ksSetting\(\)\)/);
  });
});
