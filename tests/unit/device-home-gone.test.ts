// Q0431 (TLX2, Debian 12, 0.1.11): /var/lib/sentinel-dvpn moved aside, ~/.config kept. The app's device
// record pointed at the removed c0 home: "device setup" said already set up and "daemon install" failed
// in the root step with "nothing to install". Now install names it before the password prompt, and
// "daemon init" makes a new device instead of returning the dead one.
import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { homeLooksInstalled, recordedHomeGone } from '../../src/main/daemon/manager';

const rec = { device: 'HyiPh2b9w3QeDLBhcqWZr8yZ3nYdqJ2Lw8pUo6hKKtn', home: '/var/lib/sentinel-dvpn/c0', owner: 'x', at: 0 };

describe('device record whose service home is gone', () => {
  it('names the device, the folder and the way out; changes nothing', () => {
    const msg = recordedHomeGone(rec, false, false, false)!;
    expect(msg).toContain(rec.device);
    expect(msg).toContain('/var/lib/sentinel-dvpn/c0');
    expect(msg).toContain('devnet-dvpn daemon init');
    expect(msg).toContain('Nothing was changed.');
  });
  it('is not raised when something can be installed', () => {
    expect(recordedHomeGone(rec, true, false, false)).toBeNull(); // staged home
    expect(recordedHomeGone(rec, false, true, false)).toBeNull(); // pre-cb33 upgrade
    expect(recordedHomeGone(rec, false, false, true)).toBeNull(); // service home there (reinstall)
  });
  it('install checks it before the administrator step, and init does not return the dead device', () => {
    const src = fs.readFileSync('src/main/daemon/manager.ts', 'utf8');
    const install = src.slice(src.indexOf('export async function installService'));
    expect(install.indexOf('if (gone) return { ok: false, error: gone };')).toBeGreaterThan(0);
    expect(install.indexOf('if (gone) return')).toBeLessThan(install.indexOf("runElevated(scriptPath('setup-daemon.sh')"));
    const init = src.slice(src.indexOf('export function initDevice'), src.indexOf('const exe = dvpndPath();', src.indexOf('export function initDevice')));
    expect(init).toMatch(/if \(!recordedHomeGone\(existing,[^\n]*\)\) \{\n\s+return Promise\.resolve\(\{ ok: true, device: existing\.device \}\);/);
  });
  // TLX 0.1.15 (u22b): "device setup" started the service, systemd created c0 EMPTY, and from then on the
  // check took that empty folder as a home, so every "daemon install" got the root step's raw error.
  it('an empty service folder is not a home; device.pub, config.toml or an unreadable folder are', () => {
    expect(homeLooksInstalled(true, false, () => [])).toBe(false); // systemd's empty state folder
    expect(homeLooksInstalled(false, false, () => [])).toBe(false); // gone
    expect(homeLooksInstalled(true, false, () => ['config.toml', 'keys'])).toBe(true);
    expect(homeLooksInstalled(false, true, () => [])).toBe(true); // device.pub copy readable
    expect(homeLooksInstalled(true, false, () => { throw new Error('EACCES'); })).toBe(true); // 0750 home, not ours to list
  });
  it('device setup and the service start check the gone home before starting anything', () => {
    const cli = fs.readFileSync('src/cli/commands.ts', 'utf8');
    const setup = cli.slice(cli.indexOf("sub === 'plan' || sub === 'setup'"));
    expect(setup.indexOf('if (gone) throw new Error(gone);')).toBeGreaterThan(0);
    expect(setup.indexOf('if (gone) throw new Error(gone);')).toBeLessThan(setup.indexOf('await startServiceIfStopped()'));
    const src = fs.readFileSync('src/main/daemon/manager.ts', 'utf8');
    const start = src.slice(src.indexOf('export function startServiceIfStopped'));
    expect(start.indexOf('deviceHomeGone()')).toBeGreaterThan(0);
    expect(start.indexOf('deviceHomeGone()')).toBeLessThan(start.indexOf("run(['start', '--no-ask-password', service])"));
  });
});
