// ─── Linux platform layer: pure parts of autostart, terminal, keyring, groups, scripts ───
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ safeStorage: {} }));

import { autostartEntry, autostartPath } from '../../src/main/system/autostart';
import { cliShellRc, shq, TERMINALS } from '../../src/main/services/cli-exec';
import { keyringAttrs, keyringError } from '../../src/cli/keystore';
import { backendIsStrong } from '../../src/main/wallet/electron-keystore';
import { daemonLinkCopy } from '../../src/core/daemon/link-copy';

describe('XDG autostart entry', () => {
  it('starts hidden and quotes a path with spaces', () => {
    const e = autostartEntry('/opt/Devnet dVPN/devnet-dvpn-desktop');
    expect(e).toContain('[Desktop Entry]');
    expect(e).toContain('Exec="/opt/Devnet dVPN/devnet-dvpn-desktop" --hidden');
    expect(autostartEntry('/usr/bin/x')).toContain('Exec=/usr/bin/x --hidden');
  });
  it('escapes characters the Desktop Entry spec reserves', () => {
    // file text: Exec="/home/a\\"b/\\$x/app" --hidden
    expect(autostartEntry('/home/a"b/$x/app')).toContain('Exec="/home/a\\\\"b/\\\\$x/app" --hidden');
  });
  it('lives under XDG_CONFIG_HOME/autostart', () => {
    expect(autostartPath({ XDG_CONFIG_HOME: '/c' }).replace(/\\/g, '/')).toBe('/c/autostart/devnet-dvpn.desktop');
  });
});

describe('terminal for the CLI', () => {
  it('binds devnet-dvpn to this app with every path single-quoted', () => {
    const rc = cliShellRc("/opt/Devnet dVPN/devnet-dvpn-desktop", "/opt/it's/cli.cjs", '/r', '/d');
    expect(rc).toContain("export DVPN_DATA_DIR='/d'");
    expect(rc).toContain("ELECTRON_RUN_AS_NODE=1 NODE_NO_WARNINGS=1 '/opt/Devnet dVPN/devnet-dvpn-desktop' '/opt/it'\\''s/cli.cjs' \"$@\"");
    expect(shq("a'b")).toBe("'a'\\''b'");
  });
  it('knows the common terminals', () => {
    expect(TERMINALS.map(([t]) => t)).toEqual(expect.arrayContaining(['gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm']));
  });
  it('the rc file is valid bash', () => {
    if (process.platform === 'win32') return; // the Linux run is the one that counts
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ddv-rc-')), 'rc');
    fs.writeFileSync(f, cliShellRc('/x y/app', '/c.cjs', '/r', '/d'));
    execFileSync('bash', ['-n', f]);
  });
});

describe('CLI keyring wallet', () => {
  it('names the wallet by this data folder', () => {
    expect(keyringAttrs('/home/u/.config/Devnet dVPN')).toEqual(['application', 'devnet-dvpn', 'kind', 'cli-wallet', 'data-dir', path.resolve('/home/u/.config/Devnet dVPN')]);
  });
  it('turns keyring failures into an action', () => {
    expect(keyringError('ENOENT').message).toMatch(/libsecret-tools.*--keyfile/);
    expect(keyringError('secret-tool: Cannot autolaunch D-Bus without X11 $DISPLAY').message).toMatch(/No unlocked keyring.*--keyfile/);
    expect(keyringError('The name org.freedesktop.secrets was not provided by any .service files').message).toMatch(/No unlocked keyring/);
    expect(keyringError('weird').message).toMatch(/could not store or read the wallet: weird/);
  });
});

describe('desktop app wallet encryption', () => {
  it('accepts only real keyrings, never basic_text', () => {
    expect(backendIsStrong('gnome_libsecret')).toBe(true);
    expect(backendIsStrong('kwallet6')).toBe(true);
    expect(backendIsStrong('basic_text')).toBe(false);
    expect(backendIsStrong('unknown')).toBe(false);
  });
});

describe('socket group', () => {
  it('device init never asks dvpnd to chown to the socket group (EPERM for a non-member)', () => {
    const src = fs.readFileSync('src/main/daemon/manager.ts', 'utf8');
    const init = src.slice(src.indexOf('export function initDevice'), src.indexOf('function loginName'));
    expect(init).toContain('initArgs(staging, owner)'); // --instance c0: cb33 has no --role
    expect(init).not.toContain("'--socket-group'");
  });
  it('a refused socket says what to do', () => {
    expect(daemonLinkCopy('connect EACCES /var/lib/dvpnd/client/daemon.sock')).toMatch(/not allowed/);
    expect(daemonLinkCopy('connect ENOENT /var/lib/dvpnd/client/daemon.sock')).toMatch(/not running/);
  });
});

describe('shell scripts', () => {
  const files = [
    ...fs.readdirSync('resources/scripts').map((f) => path.join('resources/scripts', f)),
    ...fs.readdirSync('build/linux').map((f) => path.join('build/linux', f)),
    'build/cli/devnet-dvpn',
    ...fs.readdirSync('scripts/e2e/linux').filter((f) => f.endsWith('.sh')).map((f) => path.join('scripts/e2e/linux', f)),
  ];
  it.each(files)('%s has LF line ends and a bash shebang', (f) => {
    const s = fs.readFileSync(f, 'utf8');
    expect(s.includes('\r')).toBe(false);
    if (!f.endsWith('_lib.sh')) expect(s.startsWith('#!/bin/bash') || s.startsWith('#!/bin/sh') || s.startsWith('#!/usr/bin/env bash')).toBe(true);
  });
  it.each(files)('%s parses (bash -n)', (f) => {
    if (process.platform === 'win32') return;
    execFileSync('bash', ['-n', f]);
  });
  it('every helper step has its script, and nothing else is reachable', async () => {
    const { HELPER_STEPS } = await import('../../src/main/system/elevate');
    for (const s of HELPER_STEPS) expect(fs.existsSync(`resources/scripts/${s}.sh`)).toBe(true);
    const helper = fs.readFileSync('resources/scripts/dvpn-helper', 'utf8');
    const listed = /case "\$step" in\n\s+([a-z|-]+)\)/.exec(helper)?.[1].split('|');
    expect(listed?.sort()).toEqual([...HELPER_STEPS].sort());
  });
});

describe('doctor run as the desktop user', () => {
  it('a running service owns the key and DB: those denials are not failures', async () => {
    const { doctorForUser } = await import('../../src/main/daemon/manager');
    const rows = [
      { name: 'key', ok: false, level: 'fail' as const, detail: 'loading key: reading key file: open /var/lib/dvpnd/client/client/keys/device.json: permission denied' },
      { name: 'kill_switch', ok: true, level: 'warn' as const, detail: 'store unusable: sqlite3: unable to open database file' },
      { name: 'rpc', ok: false, level: 'fail' as const, detail: 'permission denied' },
    ];
    const up = doctorForUser(rows, true, false);
    expect(up[0].level).toBe('ok');
    expect(up[1].level).toBe('ok');
    expect(up[2].level).toBe('fail'); // other checks are never softened
    expect(doctorForUser(rows, false, false)[0].level).toBe('fail'); // service down: real failure
    expect(doctorForUser(rows, true, true)[0].level).toBe('fail'); // root reads everything
  });
  it('resolvconf mode (EL9): the user cannot write resolv.conf, the root service can', async () => {
    const { doctorForUser } = await import('../../src/main/daemon/manager');
    const dns = { name: 'dns_backend', ok: false, level: 'fail' as const, detail: 'client dns backend is not usable: dns_backend = "resolvconf": /etc/resolv.conf is not writable: open /etc/resolv.conf: permission denied; want resolvectl, resolvconf, or none (or set DVPND_NETWORK_DNS_BACKEND)' };
    expect(doctorForUser([dns], true, false)[0].level).toBe('ok');
    expect(doctorForUser([dns], false, false)[0].level).toBe('fail');
    const other = { ...dns, detail: 'client dns backend is not usable: dns_backend = "resolvectl": resolvectl not found' };
    expect(doctorForUser([other], true, false)[0].level).toBe('fail');
  });
});

describe('device address without the secret', () => {
  it('reads device.pub and rejects anything that is not an address', async () => {
    const { readDevicePub } = await import('../../src/main/daemon/manager');
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ddv-pub-'));
    expect(readDevicePub(d)).toBeNull();
    fs.writeFileSync(path.join(d, 'device.pub'), '8HfzUKNUnzt9zNpfnh1A3FZRDpZbKzaDCPaESAh4DPVh\n');
    expect(readDevicePub(d)).toBe('8HfzUKNUnzt9zNpfnh1A3FZRDpZbKzaDCPaESAh4DPVh');
    fs.writeFileSync(path.join(d, 'device.pub'), '{"secret":[1,2,3]}');
    expect(readDevicePub(d)).toBeNull();
    // cb33: <state root>/c0.device.pub, next to the instance folder (inside it every file is 0600)
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ddv-pub-r-'));
    fs.writeFileSync(path.join(root, 'c0.device.pub'), '8HfzUKNUnzt9zNpfnh1A3FZRDpZbKzaDCPaESAh4DPVh\n');
    expect(readDevicePub(path.join(root, 'c0'))).toBe('8HfzUKNUnzt9zNpfnh1A3FZRDpZbKzaDCPaESAh4DPVh');
  });
  it('setup writes only the public key, world-readable, and keeps keys root-only', () => {
    const s = fs.readFileSync('resources/scripts/setup-daemon.sh', 'utf8');
    expect(s).toContain('key list --instance c0 --home "$1"');
    expect(s).not.toContain('keys list');
    expect(s).toContain('chmod 644 "$(pub_path "$HOME_DIR")"');
    // cb33's own modes: everything in the folder root-only, folders 0700, files 0600
    expect(s).toContain('chown -R root:root "$HOME_DIR"');
    expect(s).toContain('find "$HOME_DIR" -mindepth 1 -type d -exec chmod 700 {} +');
    expect(s).toContain('find "$HOME_DIR" -type f -exec chmod 600 {} +');
    expect(s).toContain('install -m 600 -o root -g root "$KEY_SRC" "$HOME_DIR/keys/operator.json"');
    // upgrade: the old key is under the role folder (<home>/client/keys, seen on r2), tried first
    expect(s).toContain('KEY_SRC="$LEGACY/client/keys/device.json"');
    expect(s.indexOf('$LEGACY/client/keys/device.json')).toBeLessThan(s.indexOf('KEY_SRC="$LEGACY/keys/device.json"'));
    // the app reads a copy next to the folder, never the 0600 file inside it
    const lib = fs.readFileSync('resources/scripts/_lib.sh', 'utf8');
    expect(lib).toContain("mirror_path() { printf '%s/%s.config.toml'");
    expect(lib).toContain('install -m 640 -o root -g "$DAEMON_GROUP"');
  });
});

describe('dvpnd doctor rows', () => {
  it('reads cf4c372 (name/ok/detail) and dfe36c7 (Name/OK/Detail) output, grant copy is plain', async () => {
    const { parseDoctorRows } = await import('../../src/main/daemon/manager');
    // captured on ddv-linux-1 from cf4c372-ddv1 with a device that had no grant yet
    const v2 = parseDoctorRows('[{"detail":"","name":"rpc","ok":true},{"detail":"missing on PATH: [xray]","name":"service_binaries_xray","ok":true},{"detail":"8Hfz… holds no grant from Hyi…; run dvpnctl grant open-grant --key <owner>","name":"grant","ok":false}]');
    expect(v2.map((r) => r.level)).toEqual(['ok', 'warn', 'fail']);
    expect(v2[2].detail).toMatch(/no spending permission yet/);
    expect(v2[2].detail).not.toMatch(/dvpnctl/);
    const v1 = parseDoctorRows('[{"Name":"key","OK":true,"Detail":""}]');
    expect(v1).toEqual([{ name: 'key', ok: true, level: 'ok', detail: '' }]);
    // cb33 (fork-cb33-1-ddv19): {detail,name,ok,severity}; ok = severity != "error", so a warning row is ok
    const cb33 = parseDoctorRows('[{"detail":"instance folder modes are as expected","name":"permissions","ok":true,"severity":"ok"},{"detail":"a non-persistent kill switch row is left over; the next run releases it","name":"kill_switch","ok":true,"severity":"warning"},{"detail":"x is exposed","name":"permissions","ok":false,"severity":"error"},{"detail":"instance folder is group-writable","name":"permissions","ok":true,"severity":"warning"}]');
    expect(cb33.map((r) => r.level)).toEqual(['ok', 'warn', 'fail', 'warn']);
  });
});

describe('service start after device setup (no password)', () => {
  it('polkit rule: sentinel-dvpn group, our unit, start/restart only', () => {
    const r = fs.readFileSync('resources/polkit/50-devnet-dvpn.rules', 'utf8');
    expect(r).toContain("action.lookup('unit') === 'sentinel-dvpnd@c0.service'");
    expect(r).toContain("subject.isInGroup('sentinel-dvpn')");
    expect(r).toMatch(/verb'\) === 'start' \|\| action\.lookup\('verb'\) === 'restart'\)/);
    expect(r).not.toMatch(/'stop'|'enable'|'disable'/);
    for (const f of ['resources/scripts/setup-daemon.sh', 'build/linux/after-install.sh']) expect(fs.readFileSync(f, 'utf8')).toContain('50-devnet-dvpn.rules');
    expect(fs.readFileSync('resources/scripts/uninstall-cleanup.sh', 'utf8')).toContain('rm -f /etc/polkit-1/rules.d/50-devnet-dvpn.rules');
    expect(fs.readFileSync('build/linux/after-remove.sh', 'utf8')).toMatch(/^rm -f .* \/etc\/polkit-1\/rules\.d\/50-devnet-dvpn\.rules \/etc\/sudoers\.d\/devnet-dvpn$/m);
    expect(fs.readFileSync('resources/scripts/uninstall-cleanup.sh', 'utf8')).toContain('/etc/sudoers.d/devnet-dvpn');
    // polkit 0.105 (Ubuntu 22.04) has no JS rules: the same right as a visudo-checked sudoers drop-in, two commands only
    const sr = fs.readFileSync('resources/scripts/start-right.sh', 'utf8');
    expect(sr).toContain('visudo -cqf');
    expect(sr).toContain('%sentinel-dvpn ALL=(root) NOPASSWD: $b start sentinel-dvpnd@c0.service, $b restart sentinel-dvpnd@c0.service');
    expect(sr).not.toMatch(/NOPASSWD: ALL/);
  });
  it('keeps the host firewall open for the Hysteria2 tunnel, also when ufw comes after the app', () => {
    const fw = fs.readFileSync('resources/scripts/host-firewall.sh', 'utf8');
    // only the tun's own range, never the whole link (ufw stores exactly this line; read before write,
    // so the watcher cannot loop)
    expect(fw).toContain('ufw allow in on "$IFACE" from "$V4" to "$V4"');
    expect(fw).toContain('ufw allow in on "$IFACE" from "$V6" to "$V6"');
    expect(fw).toContain('grep -qsF -- "-A ufw-user-input -i $IFACE -d $V4 -s $V4 -j ACCEPT" "$UFW_RULES"');
    expect(fw).not.toMatch(/ufw allow in on "\$IFACE"( comment|\s*>)/);
    expect(fw).toContain('PathModified=$UFW_RULES');
    // a burst of ufw edits must not trip the start limit and kill the watcher (r2, 0.1.12)
    const unit = fw.slice(fw.indexOf('Description=Devnet dVPN: keep the host firewall open'), fw.indexOf('[Service]'));
    expect(unit).toMatch(/^StartLimitIntervalSec=0$/m);
    const setup = fs.readFileSync('resources/scripts/setup-daemon.sh', 'utf8');
    expect(setup).toContain('host-firewall.sh" "$LIB/host-firewall.sh"');
    // '+': outside cb33's ProtectSystem=strict sandbox (host-firewall.sh writes ufw / firewalld state)
    expect(setup).toContain('ExecStartPre=-+/bin/bash $LIB/host-firewall.sh allow');
    expect(setup).toContain('DROP="/etc/systemd/system/$SERVICE.service.d"');
    expect(setup).toContain('/bin/bash "$LIB/host-firewall.sh" units');
    // gap #87: data.db (+ -wal/-shm) root only. cb33 runs with umask 077, so no chmod hooks any more
    // (the live check on the rig stats them); the note says why they are gone.
    expect(setup).toContain('umask 077');
    expect(setup).not.toContain('chmod 600 "$HOME_DIR"/client/data.db');
    const upgrade = fs.readFileSync('build/linux/after-install.sh', 'utf8');
    expect(upgrade).toContain('/bin/bash "$LIB/host-firewall.sh" units');
    expect(upgrade).toContain('install -m 755 "$S/host-firewall.sh" "$LIB/host-firewall.sh"');
    const un = fs.readFileSync('resources/scripts/uninstall-cleanup.sh', 'utf8');
    expect(un.indexOf('host-firewall.sh" remove-units')).toBeGreaterThan(0);
    expect(un).toContain('host-firewall.sh" remove\n');
  });
  it('unit backs off to 5 min while the device has no grant (RPC budget)', () => {
    // cb33's unit restarts every 5 s forever; our drop-in adds the backoff
    const setup = fs.readFileSync('resources/scripts/setup-daemon.sh', 'utf8');
    expect(setup).toMatch(/RestartSteps=8\nRestartMaxDelaySec=300/);
    expect(setup).toContain('$BACKOFF\nUNIT');
  });
  it('reads systemctl start results', async () => {
    const { classifyServiceStart } = await import('../../src/main/daemon/manager');
    expect(classifyServiceStart(0, '')).toBe('started');
    expect(classifyServiceStart(1, 'Failed to start dvpnd-client.service: Interactive authentication required.')).toBe('no-right');
    expect(classifyServiceStart(5, 'Failed to start dvpnd-client.service: Unit dvpnd-client.service not found.')).toBe('no-service');
    expect(classifyServiceStart(1, 'Job for dvpnd-client.service failed because the control process exited')).toBe('failed');
  });
});

describe('dvpnd v2 config migration (cf4c372 ignores the old key names)', () => {
  const m = fs.readFileSync('resources/scripts/migrate-daemon-config.sh', 'utf8');
  it('renames the same keys as the Windows script, per file', () => {
    const table = /RENAMES='([^']+)'/.exec(m)?.[1].trim().split('\n').map((l) => l.trim());
    expect(table).toEqual([
      'config.toml pipe endpoint',
      'config.toml compute_unit_margin compute_unit_margin_percent',
      'config.toml loaded_data_limit loaded_data_limit_bytes',
      'config.toml max_priority_fee max_priority_fee_lamports',
      'config.toml priority_fee priority_fee_lamports',
      'client/config.toml escrow escrow_base_units',
      'client/config.toml dns dns_backend',
    ]);
  });
  it('runs at setup and on package upgrade, and only under /var/lib/sentinel-dvpn or /var/lib/dvpnd', () => {
    expect(fs.readFileSync('resources/scripts/setup-daemon.sh', 'utf8')).toContain('migrate-daemon-config.sh" --DaemonHome "$HOME_DIR"');
    const post = fs.readFileSync('build/linux/after-install.sh', 'utf8');
    expect(post.indexOf('migrate-daemon-config.sh')).toBeGreaterThan(0);
    expect(post.indexOf('migrate-daemon-config.sh')).toBeLessThan(post.indexOf('try-restart'));
    expect(m).toContain('/var/lib/dvpnd/*|/var/lib/sentinel-dvpn/*) ;;');
    expect(post).toContain('migrate-daemon-config.sh" --DaemonHome /var/lib/sentinel-dvpn/c0');
  });
  // Q0426: dvpnd's "on" lifts the block on any service stop; the app's one "On" is persist. An install or
  // update moves an old "on" before the service starts, except the one start after an uninstall (#84).
  it.skipIf(process.platform === 'win32')('moves kill_switch on to persist, client file only; off/persist/online/comments stay; uninstall marker keeps on once', () => {
    const d = fs.mkdtempSync('/var/tmp/ks-mig-');
    const home = path.join(d, 'dvpnd', 'client');
    const script = m.split('/var/lib/dvpnd/*|/var/lib/sentinel-dvpn/*) ;;').join(`${d}/dvpnd/*|${d}/sentinel-dvpn/*) ;;`);
    const sc = path.join(d, 'migrate.sh');
    fs.writeFileSync(sc, script);
    fs.writeFileSync(path.join(d, 'upgrade-dns-list.sh'), 'echo same\n');
    fs.mkdirSync(path.join(home, 'client'), { recursive: true });
    const run = (client: string, root = "[network]\nkill_switch = 'on'\n"): [string, string] => {
      fs.writeFileSync(path.join(home, 'client', 'config.toml'), client);
      fs.writeFileSync(path.join(home, 'config.toml'), root);
      execFileSync('bash', [sc, '--DaemonHome', home]);
      return [fs.readFileSync(path.join(home, 'client', 'config.toml'), 'utf8'), fs.readFileSync(path.join(home, 'config.toml'), 'utf8')];
    };
    const cases: Array<[string, string]> = [
      ["[network]\nkill_switch = 'on'\n", "[network]\nkill_switch = 'persist'\n"],
      ['kill_switch = "on"\n', 'kill_switch = "persist"\n'],
      ["kill_switch='on'\n", "kill_switch='persist'\n"],
      ["kill_switch = 'off'\n", "kill_switch = 'off'\n"],
      ["kill_switch = 'persist'\n", "kill_switch = 'persist'\n"],
      ["kill_switch = 'online'\n", "kill_switch = 'online'\n"],
      ["# kill_switch = 'on'\n", "# kill_switch = 'on'\n"],
    ];
    for (const [before, after] of cases) {
      const [client, root] = run(before);
      expect(client).toBe(after);
      expect(root).toBe("[network]\nkill_switch = 'on'\n"); // root config.toml is never touched
    }
    // uninstall stepped persist down and left the marker: this one start keeps on, the next moves it
    fs.writeFileSync(path.join(home, '.ks-stepped-down'), '');
    expect(run("kill_switch = 'on'\n")[0]).toBe("kill_switch = 'on'\n");
    expect(fs.existsSync(path.join(home, '.ks-stepped-down'))).toBe(false);
    expect(run("kill_switch = 'on'\n")[0]).toBe("kill_switch = 'persist'\n");
    // cb33 c0: ONE config.toml, and the "client" rules apply to it (mode kept: cb33 wants 0600)
    const c0 = path.join(d, 'sentinel-dvpn', 'c0');
    fs.mkdirSync(c0, { recursive: true });
    const one = (text: string): string => {
      fs.writeFileSync(path.join(c0, 'config.toml'), text);
      fs.chmodSync(path.join(c0, 'config.toml'), 0o600);
      execFileSync('bash', [sc, '--DaemonHome', c0]);
      expect(fs.statSync(path.join(c0, 'config.toml')).mode & 0o777).toBe(0o600);
      return fs.readFileSync(path.join(c0, 'config.toml'), 'utf8');
    };
    expect(one("[network]\nkill_switch = 'on'\nescrow = 5\n")).toBe("[network]\nkill_switch = 'persist'\nescrow_base_units = 5\n");
    expect(one("kill_switch = 'off'\n")).toBe("kill_switch = 'off'\n");
    fs.writeFileSync(path.join(c0, '.ks-stepped-down'), '');
    expect(one("kill_switch = 'on'\n")).toBe("kill_switch = 'on'\n");
    expect(one("kill_switch = 'on'\n")).toBe("kill_switch = 'persist'\n");
    fs.rmSync(d, { recursive: true, force: true });
  });
});

describe('package layout that Chromium can start', () => {
  it('installs to a folder without spaces (zygote cannot exec a spaced path)', () => {
    const y = fs.readFileSync('electron-builder.yml', 'utf8');
    expect(/^productName: (\S+)$/m.exec(y)?.[1]).toBe('devnet-dvpn');
    expect(y).toMatch(/extraMetadata:\n {2}productName: Devnet dVPN/);
    for (const f of ['build/linux/after-install.sh', 'build/linux/before-remove.sh']) {
      expect(fs.readFileSync(f, 'utf8')).not.toContain('/opt/Devnet dVPN');
    }
  });
  it('ships an AppArmor userns profile for Ubuntu 24.04+, and removes it', () => {
    const inst = fs.readFileSync('build/linux/after-install.sh', 'utf8');
    expect(inst).toContain('profile devnet-dvpn /opt/devnet-dvpn/devnet-dvpn-desktop flags=(unconfined)');
    expect(inst).toContain('userns,');
    expect(fs.readFileSync('build/linux/after-remove.sh', 'utf8')).toContain('rm -f /etc/apparmor.d/devnet-dvpn');
  });
});

describe('.deb dependencies (clean-machine runs)', () => {
  const yml = fs.readFileSync('electron-builder.yml', 'utf8');
  it('lists the libraries Electron links that a stock server image lacks', () => {
    // clean Ubuntu 22.04: libgbm.so.1 not found; clean Debian 12: libasound.so.2 not found
    expect(yml).toMatch(/- libgbm1\n/);
    expect(yml).toMatch(/- libasound2t64 \| libasound2\n/);
  });
  it('lists the VPN tools the service needs', () => {
    for (const d of ['wireguard-tools', 'openvpn', 'nftables', 'iproute2', 'acl', 'pkexec | policykit-1', 'libsecret-tools']) expect(yml).toContain(`- ${d}\n`);
  });
});

describe('uninstall restores a KDE system proxy too', () => {
  it('has a kde branch that only undoes the value while it is still ours', () => {
    const s = fs.readFileSync('resources/scripts/uninstall-cleanup.sh', 'utf8');
    expect(s).toContain("st.get('backend') == 'kde'");
    expect(s).toContain("kr('socksProxy') == f'socks://{host} {port}'");
  });
});

describe('uninstall steps "Always" down to "on" (#31 #84: a reinstall re-armed the block from the kept config)', () => {
  const s = fs.readFileSync('resources/scripts/uninstall-cleanup.sh', 'utf8');
  const start = s.indexOf('for c in /var/lib/sentinel-dvpn/c0/config.toml /var/lib/dvpnd/*/client/config.toml');
  const block = s.slice(start, s.indexOf('\ndone\n', start) + 6);
  it('does it before the service stops', () => {
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThan(s.indexOf('service uninstall --instance c0'));
    expect(start).toBeLessThan(s.indexOf('systemctl stop dvpnd-client'));
  });
  it.skipIf(process.platform === 'win32')('rewrites persist only, either quote style; off and on stay', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-step-'));
    const cases: Record<string, [string, string]> = {
      a: ["[network]\nkill_switch = 'persist'\n", "[network]\nkill_switch = 'on'\n"],
      b: ['kill_switch = "persist"\n', "kill_switch = 'on'\n"],
      c: ["kill_switch = 'off'\n", "kill_switch = 'off'\n"],
      e: ["kill_switch = 'on'\n", "kill_switch = 'on'\n"],
    };
    for (const [k, [before]] of Object.entries(cases)) {
      fs.mkdirSync(path.join(d, k, 'client'), { recursive: true });
      fs.writeFileSync(path.join(d, k, 'client', 'config.toml'), before);
    }
    // cb33 c0 home: the one config.toml, mode kept, marker 0600 inside the folder
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-step-c0-'));
    fs.mkdirSync(path.join(r, 'c0'));
    fs.writeFileSync(path.join(r, 'c0', 'config.toml'), "[network]\nkill_switch = 'persist'\n");
    fs.chmodSync(path.join(r, 'c0', 'config.toml'), 0o600);
    execFileSync('bash', ['-c', 'log() { :; }\n' + block.split('/var/lib/dvpnd').join(d).split('/var/lib/sentinel-dvpn').join(r)]);
    expect(fs.readFileSync(path.join(r, 'c0', 'config.toml'), 'utf8')).toBe("[network]\nkill_switch = 'on'\n");
    expect(fs.statSync(path.join(r, 'c0', 'config.toml')).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.join(r, 'c0', '.ks-stepped-down')).mode & 0o777).toBe(0o600);
    expect(fs.existsSync(path.join(r, 'c0', 'config.toml.ks'))).toBe(false);
    fs.rmSync(r, { recursive: true, force: true });
    for (const [k, [, after]] of Object.entries(cases)) expect(fs.readFileSync(path.join(d, k, 'client', 'config.toml'), 'utf8')).toBe(after);
    // Q0426: the stepped-down home gets the marker that keeps the reinstall's migration from moving it back
    expect(fs.existsSync(path.join(d, 'a', '.ks-stepped-down'))).toBe(true);
    expect(fs.existsSync(path.join(d, 'c', '.ks-stepped-down'))).toBe(false);
    fs.rmSync(d, { recursive: true, force: true });
  });
});

describe('driver repair says why AmneziaWG is missing', () => {
  const s = fs.readFileSync('resources/scripts/install-deps.sh', 'utf8');
  it('keeps apt output and names a dead package source (Launchpad 503, 2026-10-21)', () => {
    expect(s).not.toMatch(/apt-get [^\n]*>\/dev\/null/);
    expect(s).toContain('install-deps.log');
    expect(s).toContain("apt-cache policy amneziawg-tools");
    expect(s).toContain('still missing after install: ${missing[*]}${why:+. $why}');
  });
});

describe('AmneziaWG without the PPA (Launchpad down, Debian)', () => {
  const s = fs.readFileSync('resources/scripts/install-deps.sh', 'utf8');
  it('builds the same pinned upstream commits from source, checked by sha256', () => {
    expect(s).toContain('AWG_TOOLS_SHA=ee0f0a9aa34ff0a0da4b3433b9512781cfe02843');
    expect(s).toContain('AWG_KMOD_SHA=4569c4c67f3a57414969260cafbbd04694fbaae0');
    expect(s).toMatch(/AWG_TOOLS_SUM=[0-9a-f]{64}/);
    expect(s).toMatch(/AWG_KMOD_SUM=[0-9a-f]{64}/);
    expect(s).toContain('sha256sum -c -');
    expect(s).toContain('elif awg_from_source; then');
  });
  it('adds the PPA on Ubuntu only', () => {
    expect(s).toMatch(/ID"\)" = ubuntu \] && ! grep -rqs 'amnezia\/ppa'/);
  });
});
