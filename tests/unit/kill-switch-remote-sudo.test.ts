// ─── rc.10 KS-SUDO (review H): the kill switch is refused under sudo / su over SSH too ───
// sudo's env_reset drops SSH_*; the login (logind Remote) and the parent chain (sshd) still say "remote".
import { describe, it, expect, vi } from 'vitest';
import { ksRemoteCheck, ksRemoteRiskFields } from '../../src/cli/remote-session';

type Anc = typeof import('../../src/shared/remote-ancestry');
const { remoteAncestry } = await vi.importActual<Anc>('../../src/shared/remote-ancestry');
const SUDO = { SUDO_USER: 'ubuntu', USER: 'root', HOME: '/root' }; // what `sudo -i` leaves: no SSH_*
const chain = (rows: Record<number, [number, string]>) => (pid: number) => (rows[pid] ? { ppid: rows[pid][0], name: rows[pid][1] } : null);

describe('KS-SUDO: the CLI refusal', () => {
  it('SSH_* removed, SUDO_USER set, an sshd parent: refused (it returned null before)', () => {
    const e = ksRemoteCheck('on', false, SUDO, 'linux', () => 'ssh') as Error & { code?: string };
    expect(e).not.toBeNull();
    expect(e.code).toBe('kill-switch-remote');
    expect(ksRemoteCheck('on', true, SUDO, 'linux', () => 'ssh')).toBeNull(); // --allow-remote-lockout
    expect(ksRemoteCheck('on', false, SUDO, 'linux', () => null)).toBeNull(); // a local sudo
  });
  it('agent status warns the same way', () => {
    expect(ksRemoteRiskFields('persist', SUDO, 'linux', () => 'ssh').killSwitchRemoteRisk).toBe(true);
    expect(ksRemoteRiskFields('persist', SUDO, 'linux', () => null)).toEqual({});
  });
});

describe('KS-SUDO: remoteAncestry', () => {
  it('sudo under an SSH login: devnet-dvpn <- sudo <- bash <- sshd-session', () => {
    const proc = chain({ 100: [50, 'devnet-dvpn'], 50: [40, 'sudo'], 40: [30, 'bash'], 30: [20, 'sshd-session'], 20: [1, 'sshd'] });
    expect(remoteAncestry('linux', { pid: 100, proc, loginRemote: () => null })).toBe('ssh');
    expect(remoteAncestry('darwin', { pid: 100, proc })).toBe('ssh');
  });
  it('Windows: sshd.exe in the chain', () => {
    const proc = chain({ 9: [8, 'node.exe'], 8: [7, 'powershell.exe'], 7: [4, 'sshd.exe'] });
    expect(remoteAncestry('win32', { pid: 9, proc })).toBe('ssh');
  });
  it('logind Remote=yes is enough (tmux reattached, the chain ends at the tmux server)', () => {
    const proc = chain({ 100: [60, 'devnet-dvpn'], 60: [1, 'tmux: server'] });
    expect(remoteAncestry('linux', { pid: 100, proc, loginRemote: () => true })).toBe('ssh');
  });
  it('negative controls: a local console chain, an unreadable process, a loop', () => {
    const local = chain({ 100: [50, 'devnet-dvpn'], 50: [40, 'sudo'], 40: [30, 'bash'], 30: [1, 'login'] });
    expect(remoteAncestry('linux', { pid: 100, proc: local, loginRemote: () => false })).toBeNull();
    expect(remoteAncestry('linux', { pid: 100, proc: () => null, loginRemote: () => null })).toBeNull();
    const loop = chain({ 100: [101, 'a'], 101: [100, 'b'] });
    expect(remoteAncestry('linux', { pid: 100, proc: loop, loginRemote: () => null })).toBeNull();
    expect(remoteAncestry('android', { pid: 100, proc: local })).toBeNull();
  });
  it('the real Linux readers run here (ctl): /proc/self/stat parses and the walk ends', () => {
    if (process.platform !== 'linux') return;
    expect(['ssh', null]).toContain(remoteAncestry('linux'));
  });
});
