// Owner 2026-11-15 ("can VPN adapter not found still appear?"): what a protocol needs on this computer is checked
// BEFORE the deposit is paid, for all six protocols, and a check that cannot run never blocks a connect.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../src/main/app-state', () => ({ snapshot: () => ({ session: null }), patch: vi.fn() }));
vi.mock('../../src/main/daemon/manager', () => ({ daemon: () => ({}), daemonInfo: () => ({ version: 'x' }), binPath: (n: string) => `/app/bin/${n}` }));
vi.mock('../../src/main/daemon/settings', () => ({ getDaemonSettings: () => ({ settings: {} }) }));
vi.mock('../../src/main/wallet/vault', () => ({ ownerAddress: () => 'Owner' }));
vi.mock('../../src/main/services/device-topup', () => ({ topUpDeviceIfLow: async () => ({ done: false }) }));
vi.mock('../../src/main/system/drivers', () => ({ amneziawgBlocker: async () => null, driversStatus: async () => ({ supported: true, live: null, installer: null, error: null }), openvpnAdapterMissing: async () => false, recreateOpenvpnAdapter: async () => ({ ok: true }) }));

const { adapterMissingIn, driverBlocker, programBlocker } = await import('../../src/main/services/connect-checks');
const { preflightCode } = await import('../../src/core/session/state');

const report = (rows: Array<[string, string]>) => ({ at: '', ok: rows.every((r) => r[1] === 'present'), rebootRequired: false, deps: rows.map(([name, status]) => ({ name, wanted: '', found: '', status: status as 'present', detail: '' })) });
const dirOf = (n: string): string => `/app/bin/${n}`;

describe('drivers: WireGuard, AmneziaWG, OpenVPN', () => {
  it.each([['wireguard', 'WireGuard'], ['amneziawg', 'AmneziaWG'], ['openvpn', 'OpenVPN']])('%s missing: refused before paying, sends the user to Repair drivers', (svc, name) => {
    const msg = driverBlocker(svc, report([[svc, 'missing'], ['windows', 'present']]));
    expect(msg).toMatch(new RegExp(`^${name} is not installed on this computer`));
    expect(msg).toMatch(/Repair drivers/);
    expect(msg).toMatch(/Nothing was paid\.$/);
    expect(preflightCode(msg!)).toBe('driver-missing');
  });

  it('failed and incompatible count as not usable too', () => {
    expect(driverBlocker('wireguard', report([['wireguard', 'failed']]))).toMatch(/not installed on this computer properly/);
    expect(driverBlocker('openvpn', report([['openvpn', 'incompatible']]))).not.toBeNull();
  });

  it('negative controls: present / installed / upgraded pass; another protocol\'s missing driver does not block; no report never blocks', () => {
    for (const s of ['present', 'installed', 'upgraded']) expect(driverBlocker('wireguard', report([['wireguard', s]]))).toBeNull();
    expect(driverBlocker('wireguard', report([['wireguard', 'present'], ['openvpn', 'missing']]))).toBeNull();
    expect(driverBlocker('wireguard', null)).toBeNull();
    expect(driverBlocker('wireguard', report([]))).toBeNull();
    expect(driverBlocker('v2ray', report([['wireguard', 'missing']]))).toBeNull();
  });
});

describe('the OpenVPN adapter comes from the drivers report (tapctl needs elevation; VM 2026-11-15)', () => {
  it('x64 reads the Wintun row, ARM64 the DCO row; missing means repair before paying', () => {
    expect(adapterMissingIn(report([['openvpn', 'present'], ['openvpn-wintun', 'missing']]), 'x64')).toBe(true);
    expect(adapterMissingIn(report([['openvpn', 'present'], ['openvpn-dco', 'missing']]), 'arm64')).toBe(true);
  });

  it('negative controls: present, the other CPU\'s row, no row, no report: not missing; and it never refuses by itself', () => {
    expect(adapterMissingIn(report([['openvpn-wintun', 'present']]), 'x64')).toBe(false);
    expect(adapterMissingIn(report([['openvpn-dco', 'missing']]), 'x64')).toBe(false);
    expect(adapterMissingIn(report([['openvpn', 'present']]), 'x64')).toBe(false);
    expect(adapterMissingIn(null, 'x64')).toBe(false);
    expect(driverBlocker('openvpn', report([['openvpn', 'present'], ['openvpn-wintun', 'missing']]))).toBeNull();
  });
});

describe('programs: V2Ray, Xray, Hysteria2', () => {
  it.each([['v2ray', 'V2Ray'], ['xray', 'Xray'], ['hysteria2', 'Hysteria2']])('%s program folder missing or empty: refused before paying', (svc, name) => {
    for (const [exists, files] of [[false, []], [true, []], [true, ['readme.txt', 'geoip.dat']]] as Array<[boolean, string[]]>) {
      const msg = programBlocker(svc, dirOf, () => exists, () => files);
      expect(msg).toMatch(new RegExp(`^The ${name} program is missing from this app's folder`));
      expect(msg).toMatch(/Nothing was paid\.$/);
      expect(preflightCode(msg!)).toBe('driver-missing');
    }
  });

  it('negative controls: the program is there; a driver protocol needs no program; an unreadable folder never blocks', () => {
    expect(programBlocker('v2ray', dirOf, () => true, () => ['v2ray.exe', 'geoip.dat'])).toBeNull();
    expect(programBlocker('hysteria2', dirOf, () => true, () => ['Hysteria-Windows-amd64.EXE'])).toBeNull();
    expect(programBlocker('wireguard', dirOf, () => false, () => [])).toBeNull();
    expect(programBlocker('xray', dirOf, () => true, () => { throw new Error('EACCES'); })).toBeNull();
  });

  it('asks the folder of that protocol, not another one', () => {
    const seen: string[] = [];
    programBlocker('xray', dirOf, (p) => { seen.push(p); return true; }, () => ['xray.exe']);
    expect(seen).toEqual(['/app/bin/xray']);
  });
});
