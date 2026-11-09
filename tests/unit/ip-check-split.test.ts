import { describe, it, expect, vi } from 'vitest';

// Every IP service "resolves" to an address of the user's exclude list: no request may be sent.
vi.mock('node:dns/promises', () => ({
  default: {
    lookup: vi.fn(async (host: string) => {
      // Q0365: an IP-literal service is checked as is, never looked up.
      if (host.includes(':') || /^[\d.]+$/.test(host)) throw new Error(`DNS asked for the literal ${host}`);
      return host === 'ifconfig.co' ? [{ address: '172.67.1.1', family: 4 }] : [{ address: '104.26.12.205', family: 4 }, { address: '2606:4700::6812:cd', family: 6 }];
    }),
  },
}));

import { inRoutes, publicIp, unbracket, IP_SERVICES } from '../../src/core/quality/quality';

describe('IP check with an exclude split (VM 2026-10-22)', () => {
  it('matches IPv4 and IPv6 addresses against split routes', () => {
    expect(inRoutes('104.26.12.205', ['104.26.12.205/32'])).toBe(true);
    expect(inRoutes('104.26.12.206', ['104.26.12.205/32'])).toBe(false);
    expect(inRoutes('10.1.2.3', ['10.0.0.0/8', '192.168.0.0/16'])).toBe(true);
    expect(inRoutes('2606:4700::6812:cd', ['2606:4700::/32'])).toBe(true);
    expect(inRoutes('2a00::1', ['2606:4700::/32'])).toBe(false);
    expect(inRoutes('1.2.3.4', [])).toBe(false);
  });

  it('skips every IP service the split leaves out instead of reporting the user\'s own IP', async () => {
    const r = await publicIp(1000, undefined, ['104.26.0.0/16', '172.67.0.0/16', '1.1.1.1/32', '1.0.0.1/32', '2606:4700:4700::/48']);
    expect(r).toHaveProperty('error');
    const err = (r as { error: string }).error;
    expect(err.match(/left out of the VPN by split tunnelling/gi)?.length, err).toBe(IP_SERVICES.length);
  });

  it('strips an IPv6 literal\'s brackets (SOCKS dial and the split check need the bare address)', () => {
    expect(unbracket('[2606:4700:4700::1111]')).toBe('2606:4700:4700::1111');
    expect(unbracket('1.1.1.1')).toBe('1.1.1.1');
    expect(unbracket('api.ipify.org')).toBe('api.ipify.org');
  });
});
