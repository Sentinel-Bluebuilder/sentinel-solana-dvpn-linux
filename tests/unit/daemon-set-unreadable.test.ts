// ─── daemon set with no readable service config (port of #31 732c03d) ───
// Bad values are refused first (usage error, exit 3); then the error says whether the service was
// never set up (no config file, ENOENT) or is installed but not readable as this user.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({ missing: true, applies: 0 }));
vi.mock('../../src/main/daemon/settings', () => ({
  getDaemonSettings: () => ({ readable: false, missing: st.missing, settings: {} }),
  applyDaemonSettings: vi.fn(async () => { st.applies++; return { ok: true }; }),
}));
vi.mock('../../src/main/services/connection', () => ({ restoreNetwork: vi.fn(), adoptRunningSession: vi.fn() }));
vi.mock('../../src/main/app-state', () => ({ snapshot: () => ({ session: null }) }));
vi.mock('../../src/main/system/proxy', () => ({ clearSystemProxy: vi.fn() }));
vi.mock('../../src/main/system/drivers', () => ({ driversStatus: vi.fn(), repairDrivers: vi.fn(), driverLines: vi.fn() }));
vi.mock('../../src/main/daemon/manager', () => ({ daemon: vi.fn(), daemonInfo: vi.fn(), deviceRecord: () => null, runDoctor: vi.fn(), initDevice: vi.fn(), installService: vi.fn() }));
vi.mock('../../src/main/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/main/system/dns-probe', () => ({ dnsDoctorRow: vi.fn(), probeDns: vi.fn(async () => []), dnsProbeProblem: () => null }));
vi.mock('../../src/main/system/tunnels', () => ({ rivalVpnRow: vi.fn() }));
vi.mock('../../src/main/wallet/vault', () => ({ ownerAddress: () => null }));

import { daemonCmd } from '../../src/cli/daemon-cmd';
import { parseArgs, UsageError } from '../../src/cli/args';

const out = { json: false, print: vi.fn() };
const set = (...flags: string[]): Promise<void> => daemonCmd(parseArgs(['daemon', 'set', ...flags, '--yes']), out);

describe('daemon set, service config not readable', () => {
  beforeEach(() => { st.missing = true; st.applies = 0; });

  it('a bad value is a usage error before anything else', async () => {
    await expect(set('--kill-switch', 'sometimes')).rejects.toBeInstanceOf(UsageError);
    await expect(set('--dns', '300.1.1.1')).rejects.toBeInstanceOf(UsageError);
  });
  it('a good value on a computer where the service was never set up says so', async () => {
    await expect(set('--kill-switch', 'on')).rejects.toThrow(/not set up on this computer yet/);
    expect(st.applies).toBe(0);
  });
  it('installed but unreadable stays "not readable as this user"', async () => {
    st.missing = false;
    await expect(set('--kill-switch', 'on')).rejects.toThrow(/not readable as this user/);
    expect(st.applies).toBe(0);
  });
});
