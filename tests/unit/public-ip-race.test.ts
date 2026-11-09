import net from 'node:net';
import { describe, expect, it } from 'vitest';
import { IP_SERVICES, firstIp, ipFromBody } from '../../src/core/quality/quality';

// Q0365 (FLX2, DIR): "checking your IP" waited on the session's slow DNS (28–111 s on Linux with
// HNSDNS). It now asks services that need no DNS at the same time as the named ones.
describe('public IP check', () => {
  it('includes services reachable without DNS (IP literals)', () => {
    const literals = IP_SERVICES.filter((u) => net.isIP(new URL(u).hostname.replace(/^\[|\]$/g, '')));
    expect(literals.length).toBeGreaterThanOrEqual(2);
    expect(literals.some((u) => u.includes('['))).toBe(true); // one IPv6 literal for v6-only paths
  });

  it('reads JSON and Cloudflare trace answers, and nothing else', () => {
    expect(ipFromBody('{"ip":"203.0.113.7"}')).toBe('203.0.113.7');
    expect(ipFromBody('fl=1\nh=1.1.1.1\nip=2001:db8::5\nts=1\n')).toBe('2001:db8::5');
    expect(ipFromBody('<html>blocked</html>')).toBeNull();
    expect(ipFromBody('{"ip":"not-an-ip"}')).toBeNull();
    expect(ipFromBody('ip=evil\n')).toBeNull();
  });

  it('answers from the first service that replies, without waiting on a stuck lookup', async () => {
    const hang = new Promise<never>(() => undefined);
    const t0 = Date.now();
    const r = await firstIp(IP_SERVICES, async (url) => {
      if (!net.isIP(new URL(url).hostname.replace(/^\[|\]$/g, ''))) return hang; // DNS stuck
      return { status: 200, body: 'ip=198.51.100.9\n' };
    });
    expect(r).toEqual({ ip: '198.51.100.9', source: '1.1.1.1' });
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('lists every error when nothing answers', async () => {
    const r = await firstIp(['https://a.test/', 'https://1.1.1.1/x'], async (url) => {
      if (url.includes('a.test')) throw new Error('ENOTFOUND');
      return { status: 503, body: '' };
    });
    expect('error' in r && r.error).toMatch(/a\.test: ENOTFOUND.*1\.1\.1\.1: HTTP 503|1\.1\.1\.1: HTTP 503.*a\.test: ENOTFOUND/);
  });
});
