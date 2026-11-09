// ─── More distros: rpm scriptlet arguments, package managers, arch probe, DNS without resolved ───
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ safeStorage: {} }));

import { hostDnsMode } from '../../src/main/daemon/settings';

const linux = process.platform === 'linux';

describe('package scriptlets read dpkg words AND rpm counts', () => {
  const postrm = fs.readFileSync('build/linux/after-remove.sh', 'utf8');
  const prerm = fs.readFileSync('build/linux/before-remove.sh', 'utf8');
  const caseLine = (s: string): string => s.split('\n').find((l) => l.startsWith('case "${1:-remove}"'))!;
  const decide = (line: string, arg: string): string =>
    execFileSync('bash', ['-c', `${line.replace(/exit 0/g, 'echo skip; exit 0')}\necho run`, '_', arg]).toString().trim().split('\n').pop()!;
  it.skipIf(!linux)('postrm keeps everything on an upgrade (dpkg upgrade, rpm 1+), cleans on remove (rpm 0)', () => {
    const l = caseLine(postrm);
    for (const a of ['upgrade', 'failed-upgrade', '1', '2']) expect(decide(l, a)).toBe('skip');
    for (const a of ['remove', 'purge', '0']) expect(decide(l, a)).toBe('run');
  });
  it.skipIf(!linux)('prerm restores the network only on a real remove (dpkg remove|purge, rpm 0)', () => {
    const l = caseLine(prerm);
    for (const a of ['remove', 'purge', '0']) expect(decide(l, a)).toBe('run');
    for (const a of ['upgrade', '1', '2']) expect(decide(l, a)).toBe('skip');
  });
  it('the rpm package uses the same three scriptlets as the deb', () => {
    const y = fs.readFileSync('electron-builder.yml', 'utf8');
    const rpm = y.slice(y.indexOf('\nrpm:'), y.indexOf('\nappImage:'));
    expect(rpm).toContain('afterInstall: build/linux/after-install.sh');
    expect(rpm).toContain('afterRemove: build/linux/after-remove.sh');
    expect(rpm).toContain('--before-remove=build/linux/before-remove.sh');
    expect(rpm).toContain('--rpm-tag=Recommends:openvpn');
    // EL9: a Recommends pulled in an inactive systemd-resolved; resolvconf mode covers that case
    expect(rpm).not.toContain('Recommends:systemd-resolved');
    // Rocky 9.8: a /usr/lib/.build-id link of ours conflicted with python3's, dnf refused the install
    expect(rpm).toContain('--rpm-rpmbuild-define=_build_id_links none');
    for (const d of ['wireguard-tools', 'nftables', 'polkit', 'libsecret', 'acl', 'iproute']) expect(rpm).toContain(`- ${d}\n`);
  });
});

describe('install-deps on apt, dnf and pacman', () => {
  const s = fs.readFileSync('resources/scripts/install-deps.sh', 'utf8');
  it('detects the package manager and keeps the apt path', () => {
    expect(s).toContain('for p in apt-get:apt dnf:dnf pacman:pacman; do command -v "${p%%:*}" >/dev/null && { PM=${p#*:}; break; }; done');
    expect(s).toContain('apt) apt_q update -y; apt_q install -y "${pkgs[@]}"');
  });
  it('EL9 turns on EPEL only when it needs it (openvpn, dkms)', () => {
    expect(s).toMatch(/is_el\(\) \{[^\n]*rocky\|almalinux/);
    expect(s).toContain("dnf_q install -y epel-release");
    expect(s).toContain("[[ \" ${pkgs[*]} \" == *' openvpn '* ]] && epel_on");
  });
  it('Fedora/EL AmneziaWG is the pinned source build, never the stale Copr', () => {
    // Rocky 9.8: Copr's EPEL 9 amneziawg-tools 1.0.20240201 failed every connect ("Line unrecognized: S3=1")
    expect(s).not.toContain('copr enable');
    // an old awg already on the system (it prints "wireguard-tools v1.0.2021…") counts as missing
    expect(s).toContain("elif ! awg --version 2>/dev/null | grep -q '^amneziawg-tools'; then");
    expect(s).toContain('"kernel-devel-$kv"');
    // dkms's kernel-devel-matched must be the RUNNING kernel's, or dnf installs the newest kernel too (Rocky 10-24)
    expect(s).toContain('matched=("kernel-devel-matched-$kv")');
    // only when the repo still has it (older point releases may not): otherwise the plain headers, AWG still builds
    expect(s).toContain('dnf -q list --showduplicates "kernel-devel-matched-$kv" >/dev/null 2>&1 && matched=("kernel-devel-matched-$kv")');
    expect(s).toContain('local kv kbefore matched=()');
    expect(s).toMatch(/"kernel-devel-\$kv" "\$\{matched\[@\]\}"/);
    expect(s).toContain('--setopt=install_weak_deps=False');
    expect(s).toContain('WARNING: the driver build installed another kernel');
    // EL9 kernel 5.14.0-687 has timer_container_of (6.16 API); the module build failed until guarded
    expect(s).toContain("sed -i 's|^#define timer_container_of from_timer$|#ifndef timer_container_of\\n&\\n#endif|'");
    expect(s).toMatch(/if awg_from_source; then installed\+=\(amneziawg\)/);
  });
  it('64-bit x86 and ARM pass, 32-bit is refused with a reason', () => {
    expect(s).toContain('x86_64|aarch64) echo "$(uname -r)|present|"');
    expect(s).toContain('|incompatible|64-bit only');
  });
  it('a plain /etc/resolv.conf counts as a DNS path (EL9, no systemd-resolved)', () => {
    expect(s).toContain('elif [ -f /etc/resolv.conf ]; then echo "resolv.conf|present|');
  });
  it.skipIf(!linux)('parses', () => { execFileSync('bash', ['-n', 'resources/scripts/install-deps.sh']); });
});

describe('uninstall on rpm systems (found live on Fedora 44 + Rocky 9.8)', () => {
  it('postrm removes the empty folders the rpm leaves under /opt (only empty ones)', () => {
    const postrm = fs.readFileSync('build/linux/after-remove.sh', 'utf8');
    expect(postrm).toContain('find /opt/devnet-dvpn -depth -type d -empty -delete');
    expect(postrm).not.toMatch(/rm -rf \/opt/);
  });
  it('no script asks "is the unit there" with systemctl cat >/dev/null (systemd 259 exits 141)', () => {
    for (const f of ['resources/scripts/uninstall-cleanup.sh', 'resources/scripts/apply-daemon-config.sh', 'scripts/e2e/linux/clean-install-test.sh', 'scripts/e2e/linux/installer-test.sh']) {
      expect(fs.readFileSync(f, 'utf8')).not.toMatch(/systemctl cat [^\n]*>\/dev\/null/);
    }
    expect(fs.readFileSync('resources/scripts/uninstall-cleanup.sh', 'utf8')).toContain('systemctl show -p LoadState --value dvpnd-client');
  });
});

describe('SELinux + old systemd (found live on Rocky 9.8)', () => {
  const setup = fs.readFileSync('resources/scripts/setup-daemon.sh', 'utf8');
  // Fedora 44 + Rocky 9.8 enforcing (TLX2 11-07): systemd (init_t) may not create a var_lib_t
  // sock_file, so cb33's <home>/daemon.sock never appeared. The rule gives it var_run_t, before
  // `service install` starts the socket; the rpm depends on semanage; it goes with the last instance.
  it('labels the instance sockets var_run_t before the service starts, and removes the rule with the last instance', () => {
    const rule = 'semanage fcontext -a -t var_run_t "$STATE_ROOT/[^/]+/daemon\\\\.sock"';
    expect(setup).toContain(rule);
    expect(setup.indexOf(rule)).toBeLessThan(setup.indexOf('"$DVPND" service install --instance c0'));
    expect(fs.readFileSync('electron-builder.yml', 'utf8')).toMatch(/rpm:[\s\S]*?depends:[\s\S]*?- policycoreutils-python-utils[\s\S]*?afterInstall/);
    const un = fs.readFileSync('resources/scripts/uninstall-cleanup.sh', 'utf8');
    expect(un).toContain('if [ -z "$others" ] && command -v semanage');
    expect(un).toContain('semanage fcontext -d "$STATE_ROOT/[^/]+/daemon\\\\.sock"');
  });
  it('relabels the service home after the files from the user staging folder go in', () => {
    expect(setup).toContain('restorecon -R "$STATE_ROOT"');
    expect(setup.indexOf('restorecon -R "$STATE_ROOT"')).toBeGreaterThan(setup.indexOf('cat "$CFG_SRC" > "$HOME_DIR/config.toml"'));
  });
  it('labels the service binaries bin_t (lib_t under systemd failed the RPC preflight)', () => {
    expect(setup).toContain('semanage fcontext -a -t bin_t "$LIB(/.*)?"');
    expect(setup).toContain('chcon -R -t bin_t "$LIB"');
    expect(fs.readFileSync('build/linux/after-install.sh', 'utf8')).toContain('chcon -R -t bin_t "$LIB"');
    expect(fs.readFileSync('resources/scripts/uninstall-cleanup.sh', 'utf8')).toContain("semanage fcontext -d '/usr/local/lib/devnet-dvpn(/.*)?'");
  });
  // r2 0.1.11: cb33 Hysteria2's NAT flow is TCP inside the tun's own /30 on dvpn-c0 (https 0/3 under
  // deny-incoming, 3/3 with only that /30). dvpn-c0 carries EVERY protocol, so the link is never trusted.
  it('firewalld: only the Hysteria2 tun range is allowed (source AND destination), never the whole link; removed on uninstall', () => {
    // the rules live in host-firewall.sh (also run before each service start and by the ufw watcher)
    const fw = fs.readFileSync('resources/scripts/host-firewall.sh', 'utf8');
    expect(fw).toContain('IFACE=dvpn-c0');
    expect(fw).toContain('V4=100.100.100.100/30');
    expect(fw).toContain('V6=2001::ffff:ffff:ffff:fff0/126');
    expect(fw).toContain('rich4="rule family=\\"ipv4\\" source address=\\"$V4\\" destination address=\\"$V4\\" accept"');
    expect(fw).toContain('firewall-cmd -q --permanent --zone="$z" --add-rich-rule="$r"');
    expect(fw).toContain('firewall-cmd -q --zone="$z" --add-rich-rule="$r"');
    expect(fw).toContain('firewall-cmd -q --permanent --zone="$z" --remove-rich-rule="$r"');
    // the link is never put in the trusted zone; the pre-cb33 binding is only ever REMOVED
    expect(fw).not.toContain('--add-interface');
    expect(fw).toContain('firewall-cmd -q --permanent --zone=trusted --remove-interface="$LEGACY_IFACE"');
    expect(setup).toContain('/bin/bash "$LIB/host-firewall.sh" units');
    const un = fs.readFileSync('resources/scripts/uninstall-cleanup.sh', 'utf8');
    expect(un).toContain('host-firewall.sh" remove\n');
  });
  it('systemd < 254 gets a 20 s restart instead of cb33\'s 5 s forever', () => {
    expect(setup).toContain("[ \"${SD_VER:-0}\" -lt 254 ] && BACKOFF='RestartSec=20'");
  });
  it('the user ACL goes on the socket each time systemd creates it (cb33 socket activation)', () => {
    // systemd owns the socket now (it outlives service restarts), so a killed daemon cannot leave a
    // socket without the ACL; the .socket drop-in re-applies it whenever the socket unit starts
    expect(setup).toContain('SDROP="/etc/systemd/system/$SERVICE.socket.d"');
    expect(setup).toContain("[Socket]\\nExecStartPost=-%s -m u:%s:rw %s/daemon.sock\\n");
    expect(setup).toContain('systemctl restart "$SERVICE.socket"');
  });
});

describe('DNS mode where systemd-resolved does not run', () => {
  it('"use the VPN DNS" becomes resolvconf without resolved, otherwise unchanged', () => {
    expect(hostDnsMode('resolvectl', false)).toBe('resolvconf');
    expect(hostDnsMode('resolvectl', true)).toBe('resolvectl');
    expect(hostDnsMode('none', false)).toBe('none');
    expect(hostDnsMode('resolvconf', true)).toBe('resolvconf');
    expect(hostDnsMode(undefined, false)).toBeUndefined();
  });
  it.skipIf(!linux)('setup writes resolvconf into the client config when resolved is not active', () => {
    const src = fs.readFileSync('resources/scripts/setup-daemon.sh', 'utf8');
    const start = src.indexOf('CFG="$HOME_DIR/config.toml"');
    const block = src.slice(start, src.indexOf("# cb33's modes", start));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddv-dns-'));
    fs.mkdirSync(path.join(dir, 'home'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.writeFileSync(path.join(dir, 'bin', 'systemctl'), '#!/bin/sh\nexit "${FAKE_RESOLVED:-3}"\n', { mode: 0o755 });
    const toml = path.join(dir, 'home', 'config.toml'); // cb33: the one config.toml
    const run = (content: string, resolved: string): string => {
      fs.writeFileSync(toml, content);
      execFileSync('bash', ['-c', `HOME_DIR='${dir}/home'\n${block}`], { env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, FAKE_RESOLVED: resolved } });
      return fs.readFileSync(toml, 'utf8');
    };
    try {
      expect(run("[network]\ndns_backend = 'resolvectl'\n", '3')).toContain("dns_backend = 'resolvconf'");
      expect(run('[network]\ndns_backend = "resolvectl"\n', '3')).toContain("dns_backend = 'resolvconf'");
      expect(run("[network]\nallow_lan = false\n", '3')).toMatch(/\[network\]\ndns_backend = 'resolvconf'/);
      expect(run("[network]\ndns_backend = 'none'\n", '3')).toContain("dns_backend = 'none'");
      expect(run("[network]\ndns_backend = 'resolvectl'\n", '0')).toContain("dns_backend = 'resolvectl'");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
