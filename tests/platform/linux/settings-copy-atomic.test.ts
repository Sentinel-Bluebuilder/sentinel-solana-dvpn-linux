// ─── The settings copy is never cut, and a cut one is never read as "no settings" ───
// hunt1 2026-11-12: a spot preemption at 18:04:05 hit refresh_mirror's `cat config.toml > c0.config.toml`;
// the copy stayed 0 bytes. Every later `daemon settings` showed only allowLan, and `daemon set` failed with
// unrelated words ("Basis must be per_gb or per_hour.", "Kill switch must be off, on or persist.").
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const st = vi.hoisted(() => ({ text: '' as string | null }));
vi.mock('node:fs', async (orig) => {
  const real = await orig<typeof import('node:fs')>();
  const readFileSync = (p: unknown, ...rest: unknown[]): unknown => {
    if (String(p).endsWith('c0.config.toml')) {
      if (st.text === null) { const e = new Error('ENOENT') as NodeJS.ErrnoException; e.code = 'ENOENT'; throw e; }
      return st.text;
    }
    return (real.readFileSync as (...a: unknown[]) => unknown)(p, ...rest);
  };
  return { ...real, default: { ...real, readFileSync }, readFileSync };
});
vi.mock('../../../src/main/daemon/manager', () => ({ DEFAULT_DAEMON_HOME: '/var/lib/sentinel-dvpn/c0', SERVICE_NAME: 'sentinel-dvpnd@c0', configMirrorPath: (h: string) => `${h}.config.toml`, daemonInfo: vi.fn(() => ({})), deviceRecord: () => null, relinkDaemon: vi.fn(), scriptPath: (n: string) => n }));
const elevate = vi.hoisted(() => ({ runElevated: vi.fn() }));
vi.mock('../../../src/main/system/elevate', () => elevate);
vi.mock('../../../src/main/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../../../src/main/host', () => ({ getHost: () => ({ dataDir: '/tmp' }) }));

const { getDaemonSettings, applyDaemonSettings, EMPTY_SETTINGS_COPY } = await import('../../../src/main/daemon/settings');
const real = await vi.importActual<typeof import('node:fs')>('node:fs');
const SCRIPTS = join(__dirname, '../../../resources/scripts');

describe('an empty settings copy', () => {
  beforeEach(() => { st.text = ''; elevate.runElevated.mockReset(); });
  it('is not readable, flagged empty (not missing)', () => {
    expect(getDaemonSettings()).toMatchObject({ readable: false, missing: false, empty: true, settings: {} });
    st.text = ' \n';
    expect(getDaemonSettings()).toMatchObject({ readable: false, empty: true });
  });
  it('Apply refuses with the reason and never runs the root step', async () => {
    const r = await applyDaemonSettings({ killSwitch: 'persist' } as never);
    expect(r).toEqual({ ok: false, error: EMPTY_SETTINGS_COPY });
    expect(elevate.runElevated).not.toHaveBeenCalled();
  });
  it('control: a real copy reads and is not flagged', () => {
    st.text = "[network]\nkill_switch = 'off'\nallow_lan = false\n";
    const r = getDaemonSettings();
    expect(r.readable).toBe(true);
    expect(r.empty).toBeUndefined();
    expect(r.settings.killSwitch).toBe('off');
  });
});

describe('root steps never truncate a settings file in place', () => {
  const src = (n: string): string => real.readFileSync(join(SCRIPTS, n), 'utf8');
  it('apply-daemon-config.sh, setup-daemon.sh and refresh_mirror write through atomic_write', () => {
    for (const [n, re] of [
      ['apply-daemon-config.sh', /cat "\$SRC" > "\$DST"|cat "\$DST\.bak" > "\$DST"/],
      ['setup-daemon.sh', /cat "\$CFG_SRC" > "\$HOME_DIR\/config\.toml"/],
      ['_lib.sh', /cat "\$1\/config\.toml" > "\$m"/],
    ] as const) expect(src(n), n).not.toMatch(re);
    expect(src('apply-daemon-config.sh')).toMatch(/atomic_write "\$snap\/config\.toml" "\$DST"/); // D3: the root snapshot
    expect(src('setup-daemon.sh')).toMatch(/atomic_write "\$CFG_SRC" "\$HOME_DIR\/config\.toml"/);
    expect(src('_lib.sh')).toMatch(/atomic_write "\$1\/config\.toml" "\$m"/);
  });
  it.skipIf(process.platform === 'win32')('atomic_write: new bytes, old mode kept, no temp file left', () => {
    const out = execFileSync('bash', ['-c', `set -e; d=$(mktemp -d); trap 'rm -rf "$d"' EXIT
      printf 'old\\n' > "$d/dst"; chmod 600 "$d/dst"; printf 'new settings\\n' > "$d/src"; chmod 644 "$d/src"
      source "${SCRIPTS}/_lib.sh"; atomic_write "$d/src" "$d/dst"
      printf '%s|%s|%s' "$(cat "$d/dst")" "$(stat -c %a "$d/dst")" "$(ls -A "$d" | tr '\\n' ' ')"`], { encoding: 'utf8' });
    expect(out).toBe('new settings|600|dst src ');
  });
});
