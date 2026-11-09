import { describe, expect, it } from 'vitest';
import { amneziawgBlockerFrom, driverCheckTimeoutMs, driverLines, parseReport } from '../../src/main/system/drivers';
import fs from 'node:fs';

// Shape written by resources/scripts/install-deps.sh --CheckOnly 1 (one JSON line).
const REAL = '{"at":"2026-10-21T15:30:00Z","ok":true,"rebootRequired":false,"deps":[{"name":"linux","wanted":"any","found":"6.8.0-1071-gcp","status":"present","detail":""},{"name":"wireguard","wanted":"any","found":"1.0.20210914","status":"present","detail":""}]}';

describe('driver report', () => {
  it('parses the script output', () => {
    const r = parseReport(REAL)!;
    expect(r.ok).toBe(true);
    expect(r.deps.map((d) => d.name)).toEqual(['linux', 'wireguard']);
  });

  it('accepts a one-driver report written as a bare object', () => {
    const r = parseReport('{"ok":false,"rebootRequired":false,"at":"x","deps":{"name":"linux","wanted":"any","found":"aarch64","status":"incompatible","detail":"64-bit x86 only"}}')!;
    expect(r.ok).toBe(false);
    expect(r.deps).toHaveLength(1);
    expect(driverLines(r)[0]).toMatch(/^FAIL\s+Linux \(64-bit\)\s+incompatible aarch64/);
  });

  it('marks missing drivers distinctly from failures', () => {
    const r = parseReport('{"ok":false,"deps":[{"name":"amneziawg","wanted":"any","found":"","status":"missing","detail":""}]}')!;
    expect(driverLines(r)[0]).toMatch(/^miss\s+AmneziaWG \(tools \+ module\)\s+missing$/);
  });
});

describe('driver check timeout', () => {
  it('defaults to 60 s and takes a sane override only', () => {
    expect(driverCheckTimeoutMs({})).toBe(60_000);
    expect(driverCheckTimeoutMs({ DVPN_DRIVER_CHECK_TIMEOUT_MS: '300000' })).toBe(300_000);
    expect(driverCheckTimeoutMs({ DVPN_DRIVER_CHECK_TIMEOUT_MS: 'abc' })).toBe(60_000);
    expect(driverCheckTimeoutMs({ DVPN_DRIVER_CHECK_TIMEOUT_MS: '5' })).toBe(60_000);
    expect(driverCheckTimeoutMs({ DVPN_DRIVER_CHECK_TIMEOUT_MS: '99999999' })).toBe(60_000);
  });
});

// TLX 0.1.11 (Ubuntu 22.04, fresh): an AmneziaWG connect paid a deposit, then cb33 failed it at
// awg-quick ("executable file not found"). The app now stops BEFORE paying, pointing at Repair drivers.
describe('AmneziaWG before paying', () => {
  const rep = (status: string, detail = ''): string => `{"ok":false,"deps":[{"name":"wireguard","wanted":"any","found":"1","status":"present","detail":""},{"name":"amneziawg","wanted":"any","found":"","status":"${status}","detail":"${detail}"}]}`;
  it('blocks when the AmneziaWG row is missing / failed / incompatible, with the reason and "Nothing was paid"', () => {
    const msg = amneziawgBlockerFrom(parseReport(rep('missing', 'awg / awg-quick not found (package amneziawg-tools)')));
    expect(msg).toMatch(/AmneziaWG/);
    expect(msg).toContain('awg-quick not found');
    expect(msg).toContain('Repair drivers');
    expect(msg).toContain('Nothing was paid.');
    expect(amneziawgBlockerFrom(parseReport(rep('failed')))).not.toBeNull();
    expect(amneziawgBlockerFrom(parseReport(rep('incompatible')))).not.toBeNull();
  });
  it('lets the connect through when it is ready, or when the check could not run', () => {
    for (const s of ['present', 'installed', 'upgraded']) expect(amneziawgBlockerFrom(parseReport(rep(s)))).toBeNull();
    expect(amneziawgBlockerFrom(null)).toBeNull();
    expect(amneziawgBlockerFrom(parseReport('{"ok":true,"deps":[]}'))).toBeNull();
  });
  it('the connect preflight asks before any payment step', () => {
    const src = fs.readFileSync('src/main/services/connect-checks.ts', 'utf8');
    const at = src.indexOf("if (probe.serviceType === 'amneziawg') {");
    expect(at).toBeGreaterThan(0);
    expect(src.slice(at, at + 200)).toContain('await amneziawgBlocker()');
    expect(at).toBeLessThan(src.indexOf('if (req.subscription) return null;'));
    expect(at).toBeLessThan(src.indexOf('costPreview(node'));
  });
});
