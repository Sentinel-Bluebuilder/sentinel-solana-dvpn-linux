// ─── Split tunnelling capability (apps: V2Ray/Xray ddv11+; routes: all six from ddv12) ───
import { describe, expect, it } from 'vitest';
import { daemonSupportsSplit, splitNotApplied } from '../../src/core/session/state';

describe('split capability', () => {
  it('needs ddv11', () => {
    expect(daemonSupportsSplit('cf4c372-ddv10')).toBe(false);
    expect(daemonSupportsSplit('cf4c372-ddv11')).toBe(true);
    expect(daemonSupportsSplit(null)).toBe(false);
  });
  it('V2Ray/Xray: apps and routes in whole-device mode', () => {
    const ok = { daemonVersion: 'cf4c372-ddv11', service: 'xray', killSwitch: 'off', wholeDevice: true, hasApps: true };
    expect(splitNotApplied(ok)).toBeNull();
    expect(splitNotApplied({ ...ok, service: 'V2Ray' })).toBeNull();
    expect(splitNotApplied({ ...ok, wholeDevice: false })).toMatch(/Whole computer/);
    expect(splitNotApplied({ ...ok, daemonVersion: 'cf4c372-ddv9' })).toMatch(/newer/);
  });
  it('other protocols: routes from ddv12, never apps', () => {
    const ok = { daemonVersion: 'cf4c372-ddv12', service: 'wireguard', killSwitch: 'off', hasApps: false };
    for (const service of ['wireguard', 'amneziawg', 'openvpn', 'hysteria2']) expect(splitNotApplied({ ...ok, service })).toBeNull();
    expect(splitNotApplied({ ...ok, daemonVersion: 'cf4c372-ddv11' })).toMatch(/newer/);
    expect(splitNotApplied({ ...ok, hasApps: true })).toMatch(/works on Windows/);
    const win = { ...ok, hasApps: true, platform: 'win32' };
    expect(splitNotApplied({ ...win, daemonVersion: 'cf4c372-ddv13' })).toMatch(/newer/);
    for (const service of ['wireguard', 'amneziawg', 'openvpn']) expect(splitNotApplied({ ...win, daemonVersion: 'cf4c372-ddv14', service })).toBeNull();
    expect(splitNotApplied({ ...win, daemonVersion: 'cf4c372-ddv14', service: 'hysteria2' })).toMatch(/newer/);
    expect(splitNotApplied({ ...win, daemonVersion: 'cf4c372-ddv15', service: 'hysteria2' })).toBeNull();
    expect(splitNotApplied({ ...ok, service: null })).toMatch(/not available/);
  });
  it('kill switch on: Windows ddv13+ only', () => {
    const o = { daemonVersion: 'cf4c372-ddv12', service: 'xray', killSwitch: 'on', wholeDevice: true, platform: 'win32' };
    expect(splitNotApplied(o)).toMatch(/kill switch off/);
    expect(splitNotApplied({ ...o, daemonVersion: 'cf4c372-ddv13' })).toBeNull();
    expect(splitNotApplied({ ...o, daemonVersion: 'cf4c372-ddv13', service: 'wireguard' })).toBeNull();
    expect(splitNotApplied({ ...o, daemonVersion: 'cf4c372-ddv13', platform: 'linux' })).toMatch(/kill switch off/);
  });
});
