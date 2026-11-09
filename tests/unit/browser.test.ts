import { describe, it, expect } from 'vitest';
import { browserArgs, browserCandidates, findBrowser, snapName, profileDirFor, type SnapProbe } from '../../src/main/system/browser';

const probe = (real: Record<string, string>, heads: Record<string, string> = {}): SnapProbe => ({
  realpath: (p) => real[p] ?? p,
  readHead: (p) => heads[p] ?? '',
});

describe('snap browsers get a profile they may write (Ubuntu Chromium is snap-only)', () => {
  it('spots a snap from /snap/bin, a link to /usr/bin/snap, or the chromium-browser wrapper', () => {
    expect(snapName('/snap/bin/chromium', probe({}))).toBe('chromium');
    expect(snapName('/usr/local/bin/chromium', probe({ '/usr/local/bin/chromium': '/usr/bin/snap' }))).toBe('chromium');
    expect(snapName('/usr/bin/chromium-browser', probe({}, { '/usr/bin/chromium-browser': '#!/bin/sh\nexec /snap/bin/chromium "$@"\n' }))).toBe('chromium');
  });
  it('leaves deb/rpm browsers alone (an ELF binary is not a wrapper script)', () => {
    expect(snapName('/usr/bin/chromium', probe({ '/usr/bin/chromium': '/usr/lib/chromium/chromium' }, { '/usr/lib/chromium/chromium': '\x7fELF' }))).toBeNull();
    expect(snapName('/usr/bin/google-chrome-stable', probe({ '/usr/bin/google-chrome-stable': '/opt/google/chrome/google-chrome' }, { '/usr/bin/google-chrome-stable': '#!/bin/bash\nexec -a "$0" "$HERE/chrome" "$@"\n' }))).toBeNull();
  });
  it('puts a snap profile in ~/snap/<name>/common, never in a hidden folder', () => {
    const d = profileDirFor('chromium', '/snap/bin/chromium', '/home/u', probe({})).replace(/\\/g, '/');
    expect(d).toBe('/home/u/snap/chromium/common/devnet-dvpn-browser');
  });
});

describe('browser through the VPN (F16.2) — Linux', () => {
  it('sends everything to the SOCKS endpoint and keeps DNS off this computer', () => {
    const a = browserArgs('127.0.0.1:1080', '/home/u/p', 'https://api.ipify.org');
    expect(a).toContain('--proxy-server=socks5://127.0.0.1:1080');
    expect(a).toContain('--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1');
    expect(a).toContain('--user-data-dir=/home/u/p');
    expect(a).toContain('--disable-quic');
    expect(a[a.length - 1]).toBe('https://api.ipify.org');
  });
  it('refuses anything but a local SOCKS endpoint', () => {
    expect(() => browserArgs('10.0.0.1:1080', 'p', 'u')).toThrow(/not a local SOCKS endpoint/);
    expect(() => browserArgs('127.0.0.1:1080 --evil', 'p', 'u')).toThrow();
  });
  it('looks along PATH, then the usual package folders', () => {
    const c = browserCandidates('chrome', { PATH: '/x/bin' }).map((p) => p.replace(/\\/g, '/'));
    expect(c[0]).toBe('/x/bin/google-chrome-stable');
    expect(c).toContain('/usr/bin/google-chrome');
    expect(c).toContain('/snap/bin/google-chrome');
    expect(findBrowser('edge', () => false)).toBeNull();
  });
});
