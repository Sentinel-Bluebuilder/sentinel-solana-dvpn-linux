import { describe, expect, it } from 'vitest';
import { leftoverDns, parseAdapterDns } from '../../src/main/system/dns-check';
import { benchMs, resetRpcTransport } from '../../src/core/chain/rpc';

describe('DNS leftover check (UPSTREAM-GAPS #25) — Linux', () => {
  // `resolvectl dns` + /etc/resolv.conf on the GCP Ubuntu VM after a session ended.
  const after = parseAdapterDns('Global:\nLink 2 (ens4): 169.254.169.254\n', 'nameserver 127.0.0.53\noptions edns0 trust-ad\n');

  it('treats the daemon report as a false alarm when no link keeps the VPN DNS', () => {
    expect(after).toEqual([{ alias: 'ens4', servers: ['169.254.169.254'] }]);
    expect(leftoverDns(after, ['1.1.1.1', '1.0.0.1'])).toEqual([]);
  });

  it('flags a real leftover on a physical link or resolv.conf, never the tunnel itself', () => {
    const rows = parseAdapterDns('Global: \nLink 2 (ens4): 1.1.1.1#cloudflare-dns.com\nLink 7 (dvpn-wg-client): 1.0.0.1 fd00::1%7\n', 'nameserver 1.0.0.1\n');
    expect(rows.find((r) => r.alias === 'ens4')?.servers).toEqual(['1.1.1.1']);
    expect(leftoverDns(rows, ['1.1.1.1', '1.0.0.1']).map((a) => a.alias)).toEqual(['ens4', 'resolv.conf']);
  });

  it('ignores the systemd-resolved stub address in resolv.conf', () => {
    expect(parseAdapterDns('', 'nameserver 127.0.0.53\n')).toEqual([]);
  });
});

describe('RPC bench after a route change', () => {
  it('benches briefly while routes settle, a minute otherwise, 8 s on 429', () => {
    resetRpcTransport();
    const now = Date.now();
    expect(benchMs(new Error('fetch failed'), now + 1_000)).toBe(3_000);
    expect(benchMs(new Error('fetch failed'), now + 60_000)).toBe(60_000);
    expect(benchMs(new Error('429 Too Many Requests'), now + 1_000)).toBe(8_000);
  });
});
