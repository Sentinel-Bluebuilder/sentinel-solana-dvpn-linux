// ─── Leftover tunnels (gaps #29 / #32) and the kill-switch connect error — Linux ───
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/main/system/elevate', () => ({ runElevated: vi.fn() }));
vi.mock('../../src/main/daemon/manager', () => ({ scriptPath: (n: string) => n, binPath: (n: string) => `/opt/devnet-dvpn/resources/resources/bin/${n}` }));

import { parseTunnelLinks, orphanProcesses, parseRivalRoutes } from '../../src/main/system/tunnels';
import { connectErrorCopy } from '../../src/core/session/state';

// `ip -o link show` on Ubuntu 24.04 with dvpnd sessions and a user's own tunnel.
const IP_LINK = [
  '1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000\\    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00',
  '2: ens4: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1460 qdisc mq state UP mode DEFAULT group default qlen 1000\\    link/ether 42:01:0a:80:00:08 brd ff:ff:ff:ff:ff:ff',
  '5: dvpn-wg-client: <POINTOPOINT,NOARP,UP,LOWER_UP> mtu 1420 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000\\    link/none ',
  '6: home-office: <POINTOPOINT,NOARP,UP,LOWER_UP> mtu 1420 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000\\    link/none ',
  '7: hy2-client: <POINTOPOINT,MULTICAST,NOARP,UP,LOWER_UP> mtu 9000 qdisc fq_codel state UNKNOWN mode DEFAULT group default qlen 500\\    link/none ',
  '8: dvpn-awg-client@NONE: <POINTOPOINT,NOARP,UP,LOWER_UP> mtu 1420 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000\\    link/none ',
].join('\n');

describe('parseTunnelLinks', () => {
  it('finds our dvpnd client links only, never a user tunnel', () => {
    expect(parseTunnelLinks(IP_LINK)).toEqual(['dvpn-wg-client', 'hy2-client', 'dvpn-awg-client']);
  });
  it('knows the link names live dvpnd uses (dvpn-hy2-client, dvpn-ovp-client), not only the old ones', () => {
    const live = [
      '36: dvpn-hy2-client: <POINTOPOINT,MULTICAST,NOARP,UP,LOWER_UP> mtu 1420 qdisc fq_codel state UNKNOWN mode DEFAULT group default qlen 500\\    link/none ',
      '37: dvpn-ovp-client: <POINTOPOINT,MULTICAST,NOARP,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UNKNOWN mode DEFAULT group default qlen 500\\    link/none ',
    ].join('\n');
    expect(parseTunnelLinks(live)).toEqual(['dvpn-hy2-client', 'dvpn-ovp-client']);
    const sh = require('node:fs').readFileSync('resources/scripts/remove-tunnels.sh', 'utf8') as string;
    expect(sh).toContain('LINKS=(dvpn-c0 dvpn-wg-client dvpn-awg-client dvpn-hy2-client dvpn-ovp-client hy2-client ovpn-client)');
    expect(sh).toContain('for l in "${LINKS[@]}"; do');
    // cb33: one link per instance for every protocol, and its kill switch table
    expect(parseTunnelLinks('41: dvpn-c0: <POINTOPOINT,NOARP,UP,LOWER_UP> mtu 1420 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000\\    link/none ')).toEqual(['dvpn-c0']);
    expect(sh).toContain("'sentinel-dvpn-c0:kill switch'");
  });
  it('restore network also removes dvpnd\'s IPv6 guard (a killed dvpnd would leave IPv6 off)', () => {
    const sh = require('node:fs').readFileSync('resources/scripts/remove-tunnels.sh', 'utf8') as string;
    expect(sh).toContain("'dvpnd_v6guard:IPv6 guard'");
  });
  it('returns nothing for empty or unrelated output', () => {
    expect(parseTunnelLinks('')).toEqual([]);
    expect(parseTunnelLinks(IP_LINK.split('\n').slice(0, 2).join('\n'))).toEqual([]);
  });
});

describe('connectErrorCopy: kill switch apply failure', () => {
  it('names the kill switch instead of "Something went wrong"', () => {
    const c = connectErrorCopy('rpc error: code = FailedPrecondition desc = failed precondition: applying firewall: applying kill switch: finding interface dvpn-wg-client: route ip+net: no such network interface');
    expect(c.code).toBe('kill-switch-failed');
    expect(c.message).toMatch(/kill switch/);
  });
});

describe('killSwitchBlocksProtocol', () => {
  it('never blocks on Linux: the nftables kill switch works with every protocol', async () => {
    const { killSwitchBlocksProtocol } = await import('../../src/core/session/state');
    for (const p of ['wireguard', 'amneziawg', 'openvpn', 'hysteria2', 'v2ray', 'xray']) {
      expect(killSwitchBlocksProtocol('linux', 'on', p)).toBeNull();
      expect(killSwitchBlocksProtocol('linux', 'persist', p)).toBeNull();
    }
  });
});

describe('orphanProcesses (gap #32)', () => {
  const BIN = '/opt/devnet-dvpn/resources/resources/bin';
  it('finds our hysteria2 / v2ray / xray and dvpnd-config openvpn only', () => {
    const procs = [
      { pid: 10, comm: 'hysteria2', exe: '/usr/local/lib/devnet-dvpn/hysteria2/hysteria2', cmdline: 'hysteria2 client -c /var/lib/dvpnd/client/x.yaml' },
      { pid: 11, comm: 'xray', exe: `${BIN}/xray/xray`, cmdline: 'xray run' },
      { pid: 12, comm: 'v2ray', exe: '/usr/bin/v2ray', cmdline: '/usr/bin/v2ray run' }, // the user's own
      { pid: 13, comm: 'openvpn', exe: '/usr/sbin/openvpn', cmdline: 'openvpn --config /var/lib/dvpnd/client/openvpn/client.conf ' },
      { pid: 14, comm: 'openvpn', exe: '/usr/sbin/openvpn', cmdline: 'openvpn --config /etc/openvpn/work.conf ' }, // the user's own
    ];
    expect(orphanProcesses(procs, BIN)).toEqual(['hysteria2:10', 'xray:11', 'openvpn:13']);
  });
  it('nothing running = none', () => expect(orphanProcesses([], BIN)).toEqual([]));
});

describe('node identity failure (owner laptop 2026-10-21, node 5CBc2eb3)', () => {
  it('names it and says nothing was paid', () => {
    const c = connectErrorCopy('StartSession: failed precondition: verifying node metadata: verifying metadata signature: invalid signature');
    expect(c.code).toBe('node-identity');
    expect(c.message).toMatch(/Nothing was paid/);
    expect(c.retry).toBe(false);
  });
});

describe('kill switch refusal lifts on dvpnd ddv5+ (gap #29 fixed in dvpnd)', () => {
  it('refuses on ddv4, allows on ddv5', async () => {
    const { killSwitchBlocksProtocol, daemonFixesKillSwitch } = await import('../../src/core/session/state');
    expect(daemonFixesKillSwitch('cf4c372-ddv4')).toBe(false);
    expect(daemonFixesKillSwitch('cf4c372-ddv5')).toBe(true);
    expect(daemonFixesKillSwitch('cf4c372-ddv12')).toBe(true);
    expect(daemonFixesKillSwitch(null)).toBe(false);
    expect(killSwitchBlocksProtocol('win32', 'on', 'wireguard', 'cf4c372-ddv4')).not.toBeNull();
    for (const p of ['wireguard', 'amneziawg', 'openvpn']) expect(killSwitchBlocksProtocol('win32', 'persist', p, 'cf4c372-ddv5')).toBeNull();
  });
});

// ─── A 429 on a new-deposit start never pays twice (VM dns6 2026-10-22: connect failed on a 429 burst) ───
import { newDepositAfter429 } from '../../src/core/session/state';
describe('newDepositAfter429', () => {
  const N = 'Node111111111111111111111111111111111111111';
  it('adopts a deposit to this node that appeared during the attempt', () => {
    expect(newDepositAfter429(N, new Set(['A']), [{ address: 'A', node: N, status: 'open' }, { address: 'B', node: N, status: 'open' }])).toEqual({ action: 'adopt', channel: 'B' });
  });
  it('retries when nothing new was opened (nothing paid)', () => {
    expect(newDepositAfter429(N, new Set(['A']), [{ address: 'A', node: N, status: 'open' }, { address: 'C', node: 'other', status: 'open' }])).toEqual({ action: 'retry' });
  });
  it('ignores closed rows and stops when the list is unreadable', () => {
    expect(newDepositAfter429(N, new Set([]), [{ address: 'D', node: N, status: 'closed' }])).toEqual({ action: 'retry' });
    expect(newDepositAfter429(N, null, [])).toEqual({ action: 'unknown' });
    expect(newDepositAfter429(N, new Set([]), null)).toEqual({ action: 'unknown' });
  });
});

describe('parseRivalRoutes (Cosmos lesson D6: another VPN is on), Linux ip route', () => {
  it('finds an OpenVPN-style half-route pair and a wg-quick default in its own table', () => {
    const r = 'default via 10.128.0.1 dev ens4 proto dhcp src 10.128.0.18 metric 100\n0.0.0.0/1 via 10.8.0.1 dev tun0\n128.0.0.0/1 via 10.8.0.1 dev tun0\ndefault dev wg0 table 51820 scope link\n';
    expect(parseRivalRoutes(r)).toEqual(['tun0', 'wg0']);
  });
  it('a default route on a VPN client link counts (NordLynx, Mullvad)', () => {
    expect(parseRivalRoutes('default dev nordlynx scope link\ndefault dev wg0-mullvad table 1836018789')).toEqual(['nordlynx', 'wg0-mullvad']);
  });
  it('never our own links, the physical card, a bridge or loopback', () => {
    const r = 'default via 192.168.1.1 dev wlp2s0\ndefault dev dvpn-wg-client table 51820 scope link\n0.0.0.0/1 dev dvpn-ovp-client\n128.0.0.0/1 dev dvpn-ovp-client\ndefault dev dvpn-hy2-client table 2147597479\ndefault via 10.0.0.1 dev br0\nbroadcast 127.255.255.255 dev lo table local';
    expect(parseRivalRoutes(r)).toEqual([]);
  });
  it('a VPN route that is not a default is not a rival (split routes of a work VPN)', () => {
    expect(parseRivalRoutes('10.20.0.0/16 dev tun0 scope link\n172.16.0.0/12 dev wg0')).toEqual([]);
  });
});

// Q0239: a SIGKILLed dvpnd left the Hysteria2 meter table `inet dvpnd_hy2`; restore network said
// "Network restored." and kept it. Runs the real script against fake nft / ip / pgrep (state = files).
describe.skipIf(process.platform === 'win32')('remove-tunnels.sh nft tables (Q0239)', () => {
  const fs = require('node:fs') as typeof import('node:fs');
  const os = require('node:os') as typeof import('node:os');
  const path = require('node:path') as typeof import('node:path');
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
  const restore = (tables: string[], opts: { failDelete?: boolean } = {}) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddv-rt-'));
    try {
      const st = path.join(dir, 'tables');
      const bin = path.join(dir, 'bin');
      fs.mkdirSync(st);
      fs.mkdirSync(bin);
      for (const t of tables) fs.writeFileSync(path.join(st, t), '');
      const fake = (name: string, body: string) => fs.writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
      fake('nft', `S='${st}'
case "$1 $2" in
  "list tables") for f in "$S"/*; do [ -e "$f" ] && echo "table inet \${f##*/}"; done; exit 0 ;;
  "list table") [ -e "$S/$4" ] ;;
  "delete table") ${opts.failDelete ? 'exit 1' : '[ -e "$S/$4" ] && rm "$S/$4"'} ;;
  *) exit 0 ;;
esac`);
      fake('ip', 'case "$*" in *"link show dvpn"*|*"link show hy2"*|*"link show ovpn"*) exit 1 ;; esac; exit 0');
      fake('pgrep', 'exit 1');
      fs.mkdirSync(path.join(dir, 'devnet-dvpn-T3st'));
      const result = path.join(dir, 'devnet-dvpn-T3st', 'result.json'); // _lib.sh only writes to …/devnet-dvpn-XXXXXX/result.json
      const r = spawnSync('bash', ['resources/scripts/remove-tunnels.sh', '--Result', result], { env: { PATH: `${bin}:/usr/bin:/bin` }, encoding: 'utf8' });
      return { left: fs.readdirSync(st).sort(), result: fs.existsSync(result) ? fs.readFileSync(result, 'utf8') : '', code: r.status };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it('removes the kill switch, the IPv6 guard and the Hysteria2 meter table', () => {
    const r = restore(['dvpnd', 'dvpnd_v6guard', 'dvpnd_hy2']);
    expect(r.left).toEqual([]);
    expect(r.code).toBe(0);
    expect(r.result).toMatch(/"ok"/);
    expect(r.result).toMatch(/Hysteria2 meter \(nft inet dvpnd_hy2\)/);
  });
  it('only the hy2 meter left (the Q0239 state): removed, not "none left"', () => {
    const r = restore(['dvpnd_hy2']);
    expect(r.left).toEqual([]);
    expect(r.result).not.toMatch(/none left/);
  });
  it('never touches a dvpnd NODE egress table or anyone else\'s table', () => {
    const r = restore(['dvpnd_hy2', 'dvpnd_wg0', 'filter']);
    expect(r.left).toEqual(['dvpnd_wg0', 'filter']);
  });
  it('a table that will not go away is an error, not "Network restored."', () => {
    const r = restore(['dvpnd_hy2'], { failDelete: true });
    expect(r.code).toBe(1);
    expect(r.result).toMatch(/still present: .*nft inet dvpnd_hy2/);
  });
});
