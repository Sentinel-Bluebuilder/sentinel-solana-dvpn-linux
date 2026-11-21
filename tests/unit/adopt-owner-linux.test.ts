// ─── ADOPT-OWNER-LINUX (the agent kit rc.9): never adopt a service key another wallet owns ───
// Service set up for owner A; a fresh data dir connects wallet B. setup-daemon.sh keeps config.toml `owner = A`
// for the same key, so the grant's preflight would fail: B must get its own key instead.
import { describe, expect, it } from 'vitest';
import { adoptInstalledDevice, serviceOwnerFromSettings, type AdoptDeps } from '../../src/main/daemon/manager';

const SVC = 'Svc1111111111111111111111111111111111111111';
const A = 'AAAA1111111111111111111111111111111111111111';
const B = 'BBBB1111111111111111111111111111111111111111';
const deps = (serviceOwner: string | null, recorded: unknown[]): AdoptDeps => ({
  record: () => null, home: '/var/lib/sentinel-dvpn/c0', has: () => true,
  detect: async () => ({ ok: true, device: SVC }),
  register: (...a: unknown[]) => { recorded.push(a); },
  serviceOwner: () => serviceOwner,
});

describe('adoptInstalledDevice: the service owner must be this wallet (ADOPT-OWNER-LINUX)', () => {
  it('service owned by A, wallet B: not adopted, nothing recorded (a new key is made)', async () => {
    const rec: unknown[] = [];
    expect(await adoptInstalledDevice(B, deps(A, rec))).toBeNull();
    expect(rec).toEqual([]);
  });
  it('service owned by B, wallet B: adopted (E-ST unchanged)', async () => {
    const rec: unknown[] = [];
    expect(await adoptInstalledDevice(B, deps(B, rec))).toBe(SVC);
    expect(rec).toHaveLength(1);
  });
  it('owner unknown (no settings copy): adopted as before', async () => {
    expect(await adoptInstalledDevice(B, deps(null, []))).toBe(SVC);
  });
});

describe('serviceOwnerFromSettings', () => {
  it('reads the root owner line of a dvpnd config.toml', () => {
    expect(serviceOwnerFromSettings(`# c0\nowner = '${A}'\n[network]\ndns_backend = 'resolvectl'\n`)).toBe(A);
    expect(serviceOwnerFromSettings(`owner = "${B}"\n`)).toBe(B);
  });
  it('null when there is no owner line', () => {
    expect(serviceOwnerFromSettings('[network]\n')).toBeNull();
  });
});
