// ─── AUDIT-FINAL the Linux app (review, D1-D7): the helper's arguments are the root boundary ───
// The polkit action for dvpn-helper is auth_admin_keep: after one admin prompt any process in the session may run a
// step with its own arguments for about 5 min (D8 kept for rc.9 by the lead). So every path a step reads, writes or
// deletes as root must be checked against what the app itself passes. Static checks in the style of the macOS app
// tests/platform/darwin/setup-staging-links.test.ts + apply-config-snapshot.test.ts, plus `bash -n` on each script.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (f: string): string => fs.readFileSync(`resources/scripts/${f}`, 'utf8');
const code = (f: string): string[] => read(f).split('\n');
const at = (f: string, re: RegExp): number => code(f).findIndex((l) => re.test(l) && !/^\s*#/.test(l));

describe('D1 setup-daemon.sh: --Staging and --Config are the app\'s own paths before root deletes them', () => {
  it('staging: canonical path = given path, basename daemon-staging|daemon-switch, under the user\'s home', () => {
    const f = 'setup-daemon.sh';
    const real = at(f, /staging_real="\$\(cd -P -- "\$STAGING"/);
    expect(real).toBeGreaterThan(-1);
    expect(at(f, /\[ "\$staging_real" = "\$STAGING" \] \|\| die/)).toBeGreaterThan(real);
    expect(at(f, /daemon-staging\|daemon-switch\) ;;/)).toBeGreaterThan(real);
    expect(at(f, /getent passwd "\$USER_NAME"/)).toBeGreaterThan(-1);
    expect(at(f, /check_user_path "\$staging_real"/)).toBeGreaterThan(real);
    expect(real).toBeLessThan(at(f, /rm -rf -- "\$STAGING"/)); // negative control: it is still deleted at the end
  });
  it('config: only <data>/migrate/config.toml, canonical, under the user\'s home', () => {
    const f = 'setup-daemon.sh';
    expect(at(f, /config_dir_real="\$\(cd -P -- "\$\(dirname -- "\$CONFIG"\)"/)).toBeGreaterThan(-1);
    expect(at(f, /= config\.toml \] && \[ "\$\(basename -- "\$config_dir_real"\)" = migrate \]/)).toBeGreaterThan(-1);
    expect(at(f, /check_user_path "\$config_dir_real"/)).toBeGreaterThan(-1);
  });
});

describe('D2 setup-daemon.sh: root reads only a root-owned snapshot of the staged files', () => {
  const f = 'setup-daemon.sh';
  it('snapshot first (root mktemp under the state root), refuse any link, then read only the snapshot', () => {
    const mk = at(f, /snap="\$\(mktemp -d "\$STATE_ROOT\/\.staged\./);
    const cp = at(f, /copy_as_user "\$USER_NAME" "\$STAGING" "\$snap\/home"/); // L32-2: read as the user
    const links = at(f, /find "\$snap\/home" -type l/);
    expect(mk).toBeGreaterThan(-1);
    expect(cp).toBeGreaterThan(mk);
    expect(links).toBeGreaterThan(cp);
    expect(at(f, /KEY_SRC="\$snap\/home\/keys\/operator\.json"/)).toBeGreaterThan(links);
    expect(at(f, /CFG_SRC="\$snap\/home\/config\.toml"/)).toBeGreaterThan(links);
  });
  it('--Config is read as the user (L32-2) and refused when the copy is a link or not a plain file', () => {
    expect(at(f, /as_user "\$USER_NAME" head -c 65537 -- "\$CONFIG" > "\$snap\/config\.toml"/)).toBeGreaterThan(-1);
    expect(at(f, /\[ -L "\$snap\/config\.toml" \] \|\| \[ ! -f "\$snap\/config\.toml" \]/)).toBeGreaterThan(-1);
    expect(at(f, /CFG_SRC="\$snap\/config\.toml"/)).toBeGreaterThan(-1);
  });
  it('nothing root reads comes straight from the user\'s folders', () => {
    expect(at(f, /KEY_SRC="\$STAGING\//)).toBe(-1);
    expect(at(f, /CFG_SRC="\$STAGING\//)).toBe(-1);
    expect(at(f, /CFG_SRC="\$CONFIG"/)).toBe(-1);
    expect(at(f, /opkey "\$STAGING"/)).toBe(-1);
  });
  it('the snapshot is removed on every exit', () => {
    expect(at(f, /trap 'rm -rf -- "\$snap"' EXIT/)).toBeGreaterThan(-1);
  });
});

describe('D3 apply-daemon-config.sh: snapshot before the service stops, write only from it', () => {
  const f = 'apply-daemon-config.sh';
  it('read as the user (L32-2) into a root mktemp folder, refuse a link, before systemctl stop', () => {
    const snap = at(f, /as_user "\$USER_NAME" head -c 65537 -- "\$SRC" > "\$snap\/config\.toml"/);
    expect(snap).toBeGreaterThan(at(f, /snap="\$\(mktemp -d "\$HOME_DIR\/\.staged\./));
    expect(at(f, /\[ -L "\$snap\/config\.toml" \] \|\| \[ ! -f "\$snap\/config\.toml" \]/)).toBeGreaterThan(snap);
    expect(snap).toBeLessThan(at(f, /systemctl stop "\$SERVICE"/));
  });
  it('writes the snapshot, never the staged path; the rollback still restores .bak', () => {
    expect(at(f, /atomic_write "\$snap\/config\.toml" "\$DST"/)).toBeGreaterThan(-1);
    expect(at(f, /atomic_write "\$SRC"/)).toBe(-1);
    expect(at(f, /atomic_write "\$DST\.bak" "\$DST"/)).toBeGreaterThan(-1); // negative control
  });
});

describe('D4 _lib.sh write_result: a new file renamed over the result path', () => {
  it('mktemp beside it, then mv -f; no direct `> "$r"`', () => {
    const f = '_lib.sh';
    const mk = at(f, /t="\$\(mktemp "\$\(dirname "\$r"\)\/\.result\./);
    expect(mk).toBeGreaterThan(-1);
    expect(at(f, /mv -f -- "\$t" "\$r"/)).toBeGreaterThan(mk);
    expect(at(f, /> "\$r"$/)).toBe(-1);
    expect(at(f, /chmod 644 "\$r"/)).toBe(-1);
  });
});

describe('D5 service-ctl.sh + apply-daemon-config.sh: only our own unit', () => {
  it.each(['service-ctl.sh', 'apply-daemon-config.sh'])('%s pins sentinel-dvpnd@c0', (f) => {
    expect(at(f, /\[ "\$SERVICE" = sentinel-dvpnd@c0 \] \|\| die/)).toBeGreaterThan(-1);
    expect(at(f, /\[\[ "\$SERVICE" =~ \^\[a-z\]/)).toBe(-1);
  });
});

describe('D6 root writes to the service config are atomic', () => {
  it.each([
    ['migrate-daemon-config.sh', /atomic_write "\$tmp" "\$f"/],
    ['upgrade-dns-list.sh', /atomic_write "\$tmp" "\$f"/],
    ['uninstall-cleanup.sh', /atomic_write "\$c\.ks" "\$c"/],
  ])('%s uses atomic_write, not cat >', (f, re) => {
    expect(at(f, re)).toBeGreaterThan(-1);
    expect(at(f, /cat "\$(tmp|c\.ks)" > "\$(f|c)"/)).toBe(-1);
    expect(read(f)).toMatch(/source .*_lib\.sh/);
  });
});

describe('D7 install-deps.sh: the root install never takes --OutDir', () => {
  it('OUT is pinned to /var/lib/devnet-dvpn unless --CheckOnly 1, before the log is opened', () => {
    const f = 'install-deps.sh';
    const pin = at(f, /\[ "\$CHECK" = 1 \] \|\| OUT=\/var\/lib\/devnet-dvpn/);
    expect(pin).toBeGreaterThan(at(f, /OUT="\$\{ARG\[OutDir\]/));
    expect(pin).toBeLessThan(at(f, /LOG="\$OUT\/install-deps\.log"/));
  });
});

describe('every root step still parses (bash -n)', () => {
  it.each(['_lib.sh', 'setup-daemon.sh', 'apply-daemon-config.sh', 'service-ctl.sh', 'install-deps.sh', 'migrate-daemon-config.sh', 'upgrade-dns-list.sh', 'uninstall-cleanup.sh'])('%s', (f) => {
    expect(() => execFileSync('bash', ['-n', `resources/scripts/${f}`], { stdio: 'pipe' })).not.toThrow();
  });
});
