// ─── rc9-f-linux (the Linux app Phase 2 B audit): L32-1 the package's own binaries only; L32-2 the user's files read as the user ───
// L32-1 runs the real setup-daemon.sh from a copied package tree whose PKG_ROOT points at a temp folder (the only
// change to the copy), so no test hook lives in the root scripts. L32-2 runs the real _lib.sh functions under bash.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPTS = path.resolve('resources/scripts');
const read = (f: string): string => fs.readFileSync(path.resolve(f), 'utf8');
let T = '';

function tree(base: string, pinTo: string): string {
  const s = path.join(base, 'scripts');
  fs.mkdirSync(s, { recursive: true });
  for (const f of fs.readdirSync(SCRIPTS)) fs.copyFileSync(path.join(SCRIPTS, f), path.join(s, f));
  const lib = path.join(s, '_lib.sh');
  const text = fs.readFileSync(lib, 'utf8');
  expect(text).toMatch(/^PKG_ROOT=\/opt\/devnet-dvpn$/m);
  fs.writeFileSync(lib, text.replace(/^PKG_ROOT=\/opt\/devnet-dvpn$/m, `PKG_ROOT=${pinTo}`));
  return s;
}
function stub(p: string): string {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return p;
}
function setup(scripts: string, args: string[]): { status: number | null; err: string } {
  const r = spawnSync('bash', [path.join(scripts, 'setup-daemon.sh'), '--DaemonHome', '/var/lib/sentinel-dvpn/c0', ...args],
    { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
  return { status: r.status, err: r.stderr };
}
function lib(script: string, env: Record<string, string> = {}): { status: number | null; out: string; err: string } {
  const r = spawnSync('bash', ['-c', `source "${path.join(SCRIPTS, '_lib.sh')}"; ${script}`],
    { encoding: 'utf8', env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', ...env } });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

beforeAll(() => { T = fs.mkdtempSync(path.join(os.tmpdir(), 'rc9f-linux-')); });
afterAll(() => { fs.rmSync(T, { recursive: true, force: true }); });

describe('L32-1 setup-daemon.sh run from the package installs only the package\'s own binaries', () => {
  it('a --Dvpnd outside the package is refused before anything is installed', () => {
    const pkg = path.join(T, 'opt', 'devnet-dvpn');
    const s = tree(path.join(pkg, 'resources', 'resources'), pkg);
    stub(path.join(pkg, 'resources', 'resources', 'bin', 'sentinel-dvpnd'));
    const fake = stub(path.join(T, 'x', 'sentinel-dvpnd'));
    const r = setup(s, ['--Dvpnd', fake]);
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/refused: the VPN service binary must be the installed package's own .*Nothing was changed/);
  });
  it('a --BinRoot outside the package is refused', () => {
    const pkg = path.join(T, 'opt', 'devnet-dvpn');
    const s = path.join(pkg, 'resources', 'resources', 'scripts');
    const own = path.join(pkg, 'resources', 'resources', 'bin', 'sentinel-dvpnd');
    const r = setup(s, ['--Dvpnd', own, '--BinRoot', path.join(T, 'x')]);
    expect(r.err).toMatch(/refused: the tunnel tools must be the installed package's own/);
  });
  it('the package\'s own binary passes the pin (stops at the next check: a bad service name)', () => {
    const pkg = path.join(T, 'opt', 'devnet-dvpn');
    const s = path.join(pkg, 'resources', 'resources', 'scripts');
    const bin = path.join(pkg, 'resources', 'resources', 'bin');
    const r = setup(s, ['--Dvpnd', path.join(bin, 'sentinel-dvpnd'), '--BinRoot', bin, '--Service', 'ssh']);
    expect(r.err).not.toMatch(/package's own/);
    expect(r.err).toMatch(/bad service name ssh/);
  });
  it('outside the package (the AppImage stage) the pin does not apply, as designed', () => {
    const s = tree(path.join(T, 'stage'), path.join(T, 'opt', 'devnet-dvpn'));
    const fake = path.join(T, 'x', 'sentinel-dvpnd');
    const r = setup(s, ['--Dvpnd', fake, '--Service', 'ssh']);
    expect(r.err).not.toMatch(/package's own/);
    expect(r.err).toMatch(/bad service name ssh/);
  });
});

describe('L32-2 _lib.sh: the user\'s staged files are read with the user\'s rights', () => {
  const me = os.userInfo().username;
  it('copy_as_user does not copy a staged config.toml hard-linked to a file the user cannot read', () => {
    if (process.getuid?.() === 0) return; // root reads a mode-000 file; this case needs an ordinary user
    const src = path.join(T, 'hl-src'); fs.mkdirSync(src);
    const secret = path.join(T, 'secret'); fs.writeFileSync(secret, 'ROOT-ONLY'); fs.chmodSync(secret, 0o000);
    fs.linkSync(secret, path.join(src, 'config.toml'));
    const r = lib(`declare -F copy_as_user >/dev/null || exit 9; copy_as_user ${me} "${src}" "${T}/hl-dst"`);
    expect(r.status).not.toBe(0);
    expect(r.status).not.toBe(9);
    const got = path.join(T, 'hl-dst', 'config.toml');
    expect(fs.existsSync(got) && fs.statSync(got).size > 0 ? fs.readFileSync(got, 'utf8') : '').not.toContain('ROOT-ONLY');
    fs.chmodSync(secret, 0o600);
  });
  it('has_hardlink finds a file with two names, and not a plain folder', () => {
    const d = path.join(T, 'two'); fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, 'a'), 'x'); fs.linkSync(path.join(d, 'a'), path.join(d, 'b'));
    expect(lib(`has_hardlink "${d}"`).status).toBe(0);
    const p = path.join(T, 'plain'); fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'a'), 'x');
    expect(lib(`has_hardlink "${p}"`).status).toBe(1);
  });
  it('a plain staged home copies, and the copy folder is 0700', () => {
    const src = path.join(T, 'ok-src'); fs.mkdirSync(path.join(src, 'keys'), { recursive: true });
    fs.writeFileSync(path.join(src, 'config.toml'), "owner = 'x'\n"); fs.writeFileSync(path.join(src, 'keys', 'operator.json'), '[1]');
    const r = lib(`copy_as_user ${me} "${src}" "${T}/ok-dst"`);
    expect(r.status).toBe(0);
    expect(fs.readFileSync(path.join(T, 'ok-dst', 'config.toml'), 'utf8')).toBe("owner = 'x'\n");
    expect(fs.readFileSync(path.join(T, 'ok-dst', 'keys', 'operator.json'), 'utf8')).toBe('[1]');
    expect(fs.statSync(path.join(T, 'ok-dst')).mode & 0o777).toBe(0o700);
  });
  it('check_caller_user: --User must be the account that asked (pkexec / sudo); root running the step may name any', () => {
    const uid = String(process.getuid?.() ?? 1000);
    expect(lib(`check_caller_user ${me}`, { PKEXEC_UID: uid }).status).toBe(0);
    if (uid !== '0') expect(lib('check_caller_user root', { PKEXEC_UID: uid }).status).toBe(1);
    if (uid !== '0') expect(lib('check_caller_user root', { SUDO_UID: uid, SUDO_COMMAND: '/bin/bash /opt/devnet-dvpn/resources/resources/scripts/dvpn-helper apply-daemon-config' }).status).toBe(1);
    expect(lib('check_caller_user root').status).toBe(0);
  });
  it('a SUDO_UID inherited by a root process (sudo devnet-dvpn …, which then runs the helper itself) is not the caller', () => {
    const uid = String(process.getuid?.() ?? 1000);
    expect(lib('check_caller_user root', { SUDO_UID: uid, SUDO_COMMAND: '/usr/bin/devnet-dvpn daemon set --kill-switch off --yes' }).status).toBe(0);
    expect(lib('caller_uid', { SUDO_UID: '1000', SUDO_COMMAND: '/usr/bin/devnet-dvpn daemon set --yes' }).out).toBe('');
    expect(lib('caller_uid', { SUDO_UID: '1000', SUDO_COMMAND: '/bin/bash /tmp/s/scripts/dvpn-helper setup-daemon' }).out).toBe('1000');
    expect(lib('caller_uid', { PKEXEC_UID: '1001', SUDO_UID: '1000' }).out).toBe('1001');
  });
});

describe('L32-2 order in the root steps (static)', () => {
  it('setup-daemon.sh: --User required with staged files, the caller check, copy_as_user, then link + hard-link refusals', () => {
    const s = read('resources/scripts/setup-daemon.sh');
    expect(s).not.toMatch(/cp -a -- "\$STAGING\/\."/);
    expect(s).not.toMatch(/cp -P -- "\$CONFIG"/);
    const at = (re: RegExp): number => { const m = re.exec(s); expect(m, String(re)).not.toBeNull(); return m!.index; };
    const req = at(/the login \(--User\) is required with staged files/);
    const caller = at(/check_caller_user "\$USER_NAME" \|\| die/);
    const copy = at(/copy_as_user "\$USER_NAME" "\$STAGING" "\$snap\/home"/);
    const sym = at(/the staging folder holds a link; refused/);
    const hard = at(/has_hardlink "\$snap\/home" && die/);
    expect(req).toBeLessThan(caller); expect(caller).toBeLessThan(copy); expect(copy).toBeLessThan(sym); expect(sym).toBeLessThan(hard);
    expect(s).toMatch(/stat -c %h -- "\$CONFIG"\)" = 1/);
    expect(s).toMatch(/as_user "\$USER_NAME" head -c 65537 -- "\$CONFIG" > "\$snap\/config\.toml"/);
  });
  it('apply-daemon-config.sh: --User + caller check + --Staged under the real home, one-name check, read as the user', () => {
    const s = read('resources/scripts/apply-daemon-config.sh');
    expect(s).not.toMatch(/cp -P -- "\$SRC"/);
    const at = (re: RegExp): number => { const m = re.exec(s); expect(m, String(re)).not.toBeNull(); return m!.index; };
    const user = at(/the login \(--User\) is required/);
    const home = at(/is not under \$USER_NAME's home/);
    const nl = at(/stat -c %h -- "\$SRC"\)" = 1/);
    const rd = at(/as_user "\$USER_NAME" head -c 65537 -- "\$SRC" > "\$snap\/config\.toml"/);
    const stop = at(/systemctl stop "\$SERVICE"/);
    expect(user).toBeLessThan(home); expect(home).toBeLessThan(nl); expect(nl).toBeLessThan(rd); expect(rd).toBeLessThan(stop);
  });
  it('the app passes the account that owns the staged file to apply (settings.ts), and the login to setup (manager.ts)', () => {
    const s = read('src/main/daemon/settings.ts');
    expect(s).toMatch(/Service: SERVICE_NAME, User: stagingUser\(\) \}/);
    // under `sudo devnet-dvpn` the staged file is root's: the process's own account, never SUDO_USER
    expect(s).toMatch(/function stagingUser\(\): string \{\n\s+try \{ return os\.userInfo\(\)\.username; \}/);
    expect(read('src/main/daemon/manager.ts')).toMatch(/\.\.\.\(user \? \{ User: user \} : \{\}\)/);
  });
});
