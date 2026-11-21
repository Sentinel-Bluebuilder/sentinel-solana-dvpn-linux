// ─── "Protected" only when the exit IP proves it (owner 2026-10-21: "it says connected, IP not changed") ───
import { describe, expect, it } from 'vitest';
import { coverageCopy, coverageOf } from '../../src/core/session/coverage';

const HOME = '198.51.100.6';
const NODE = '203.0.113.17';

describe('coverageOf', () => {
  it('V2Ray/Xray with the system proxy off covers only proxy apps', () => {
    expect(coverageOf({ proxyEndpoint: '127.0.0.1:1080', proxyActive: false, directIp: HOME, homeIp: HOME })).toBe('proxy-only');
  });
  it('V2Ray/Xray with the system proxy on covers browsers once the proxy IP is checked', () => {
    expect(coverageOf({ proxyEndpoint: '127.0.0.1:1080', proxyActive: true, directIp: HOME, proxyIp: NODE, homeIp: HOME })).toBe('proxy-apps');
    expect(coverageOf({ proxyEndpoint: '127.0.0.1:1080', proxyActive: true, directIp: HOME, proxyIp: null, homeIp: HOME })).toBe('unchecked');
    expect(coverageOf({ proxyEndpoint: '127.0.0.1:1080', proxyActive: true, directIp: HOME, proxyIp: HOME, homeIp: HOME })).toBe('leaking');
  });
  it('Xray whole-device mode (TUN): direct exit is the node, so every app is covered', () => {
    expect(coverageOf({ proxyEndpoint: '127.0.0.1:1080', proxyActive: false, directIp: NODE, proxyIp: NODE, homeIp: HOME, nodeIp: NODE })).toBe('device');
    expect(coverageOf({ proxyEndpoint: '127.0.0.1:1080', proxyActive: true, directIp: NODE, proxyIp: NODE, homeIp: null, nodeIp: NODE })).toBe('device');
    // Node exits by another address: direct == proxy exit and not the user's own IP.
    expect(coverageOf({ proxyEndpoint: '127.0.0.1:1080', proxyActive: false, directIp: '1.2.3.4', proxyIp: '1.2.3.4', homeIp: HOME, nodeIp: NODE })).toBe('device');
    // Direct still home: not device, whatever the proxy says.
    expect(coverageOf({ proxyEndpoint: '127.0.0.1:1080', proxyActive: false, directIp: HOME, proxyIp: NODE, homeIp: HOME, nodeIp: NODE })).toBe('proxy-only');
  });
  it('whole-device V2Ray/Xray (no system proxy, the macOS app): judged as a full tunnel, never "proxy-only"', () => {
    const wd = { proxyEndpoint: '127.0.0.1:1080', proxyActive: false, homeIp: HOME, nodeIp: NODE, wholeDevice: true };
    expect(coverageOf({ ...wd, directIp: null })).toBe('unchecked');
    expect(coverageOf({ ...wd, directIp: NODE })).toBe('device');
    expect(coverageOf({ ...wd, directIp: HOME })).toBe('leaking');
    expect(coverageOf({ ...wd, directIp: NODE, split: 'exclude' })).toBe('split-exclude');
    // Negative control: the same reading without wholeDevice is the proxy-mode verdict.
    expect(coverageOf({ ...wd, wholeDevice: undefined, directIp: null })).toBe('proxy-only');
  });
  it('full tunnel with the node IP is the whole device', () => {
    expect(coverageOf({ proxyEndpoint: '', proxyActive: false, directIp: NODE, homeIp: HOME })).toBe('device');
  });
  it('full tunnel still showing the own IP is leaking', () => {
    expect(coverageOf({ proxyEndpoint: '', proxyActive: false, directIp: HOME, homeIp: HOME })).toBe('leaking');
  });
  it('full tunnel not measured yet is unchecked, never protected', () => {
    expect(coverageOf({ proxyEndpoint: '', proxyActive: false, directIp: null, homeIp: HOME })).toBe('unchecked');
    expect(coverageOf({ proxyEndpoint: '', proxyActive: false, directIp: NODE, homeIp: null })).toBe('unchecked');
  });
});

describe('coverageCopy', () => {
  it('says Protected only for the whole device', () => {
    for (const c of ['proxy-apps', 'proxy-only', 'leaking', 'unchecked'] as const) expect(coverageCopy(c).title).not.toBe('Protected');
    expect(coverageCopy('device').title).toBe('Protected');
  });
  it('never claims protection when apps keep the own IP', () => {
    expect(coverageCopy('proxy-only').ok).toBe(false);
    expect(coverageCopy('leaking').ok).toBe(false);
    expect(coverageCopy('unchecked').ok).toBe(false);
    // 2026-11-12: no IP in the text (chips show it, hidden until clicked); it still says sites see you.
    expect(coverageCopy('leaking', { homeIp: HOME }).detail).not.toContain(HOME);
    expect(coverageCopy('leaking', { homeIp: HOME }).detail).toMatch(/your own address/);
  });
  it('says what sites see', () => {
    expect(coverageCopy('device', { vpnIp: NODE }).detail).not.toContain(NODE);
  });
  it('IP checks off: cannot confirm', () => {
    expect(coverageCopy('unchecked', { checksOff: true }).detail).toMatch(/cannot confirm/);
  });
});

describe('node address wins (app started during a tunnel: own IP not known yet)', () => {
  it('full tunnel exiting at the node is the whole device even without a home IP', () => {
    expect(coverageOf({ proxyEndpoint: '', proxyActive: false, directIp: NODE, homeIp: null, nodeIp: NODE })).toBe('device');
  });
  it('a wrong home IP equal to the node never reads as leaking', () => {
    expect(coverageOf({ proxyEndpoint: '', proxyActive: false, directIp: NODE, homeIp: NODE, nodeIp: NODE })).toBe('device');
  });
  it('proxy exit at the node covers browsers', () => {
    expect(coverageOf({ proxyEndpoint: '127.0.0.1:1080', proxyActive: true, directIp: HOME, proxyIp: NODE, homeIp: null, nodeIp: NODE })).toBe('proxy-apps');
  });
});

describe('coverage with split tunnelling', () => {
  it('include: this app sees the home IP by design, still protected for the chosen apps', async () => {
    const { coverageOf, coverageCopy } = await import('../../src/core/session/coverage');
    const c = coverageOf({ proxyEndpoint: '', proxyActive: false, directIp: '1.2.3.4', homeIp: '1.2.3.4', nodeIp: '9.9.9.9', split: 'include' });
    expect(c).toBe('split-include');
    expect(coverageCopy(c).ok).toBe(true);
  });
  it('exclude: checked like a full tunnel, titled as split', async () => {
    const { coverageOf } = await import('../../src/core/session/coverage');
    expect(coverageOf({ proxyEndpoint: '', proxyActive: false, directIp: '9.9.9.9', homeIp: '1.2.3.4', nodeIp: '9.9.9.9', split: 'exclude' })).toBe('split-exclude');
    // The check itself may be left out (its addresses or this app): not a proven leak, never "Protected".
    expect(coverageOf({ proxyEndpoint: '', proxyActive: false, directIp: '1.2.3.4', homeIp: '1.2.3.4', nodeIp: '9.9.9.9', split: 'exclude' })).toBe('split-exclude-unconfirmed');
    const { coverageCopy } = await import('../../src/core/session/coverage');
    const copy = coverageCopy('split-exclude-unconfirmed', { homeIp: '1.2.3.4' });
    expect(copy.ok).toBe(false);
    expect(copy.title).not.toMatch(/Protected/);
    expect(copy.detail).not.toContain('1.2.3.4');
    // Without a split, a home-IP reading is still a leak.
    expect(coverageOf({ proxyEndpoint: '', proxyActive: false, directIp: '1.2.3.4', homeIp: '1.2.3.4', nodeIp: '9.9.9.9' })).toBe('leaking');
  });
});

describe('whole-device scope (Android names the phone and its per-app / per-address split)', () => {
  it('names the device: this computer by default, this phone on Android', () => {
    expect(coverageCopy('device').detail).toBe('Every app on this computer uses the VPN.');
    expect(coverageCopy('device', { scope: { place: 'this phone' } }).detail).toBe('Every app on this phone uses the VPN.');
  });
  it('says what the per-app split includes or leaves out', () => {
    const scope = (mode: 'include' | 'exclude', count: number) => ({ scope: { place: 'this phone', split: { mode, count } } });
    expect(coverageCopy('device', scope('exclude', 1)).detail).toBe('Every app on this phone uses the VPN except the one you chose.');
    expect(coverageCopy('device', scope('exclude', 3)).detail).toBe('Every app on this phone uses the VPN except the 3 you chose.');
    expect(coverageCopy('device', scope('include', 1)).detail).toBe('Only the app you chose uses the VPN.');
    expect(coverageCopy('device', scope('include', 2)).detail).toBe('Only the 2 apps you chose use the VPN.');
    // an empty list is no split (the VPN service treats it as all apps)
    expect(coverageCopy('device', scope('include', 0)).detail).toBe('Every app on this phone uses the VPN.');
  });
  it('adds the address split in one more sentence', () => {
    const r = (routeMode: 'include' | 'exclude', routeCount: number) => ({ scope: { place: 'this phone', split: { mode: 'all' as const, count: 0, routeMode, routeCount } } });
    expect(coverageCopy('device', r('include', 1)).detail).toBe('Every app on this phone uses the VPN. Only the address you chose goes through it.');
    expect(coverageCopy('device', r('exclude', 2)).detail).toBe('Every app on this phone uses the VPN. The 2 addresses you chose go direct.');
  });
});
