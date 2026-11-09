// ─── AppImage AppRun sandbox hint (Ubuntu 24.04+ AppArmor userns restriction; DIR: hint only, sandbox stays on) ───
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HINT_BEGIN, patchAppRun } from '../../scripts/appimage-apprun.mjs';

const SNIPPET = fs.readFileSync(path.join(__dirname, '../../build/linux/apprun-sandbox-hint_lib.sh'), 'utf8');
const APPRUN = '#!/bin/bash\nset -e\nargs=("$@")\nBIN="$APPDIR/devnet-dvpn-desktop"\n\nif [ -z "$APPIMAGE_EXIT_AFTER_INSTALL" ] ; then\n  trap atexit EXIT\nfi\n';

describe('patchAppRun', () => {
  it('puts the hint right after the BIN= line, once', () => {
    const out = patchAppRun(APPRUN, SNIPPET);
    const lines = out.split('\n');
    const bin = lines.findIndex((l: string) => l.startsWith('BIN="$APPDIR/'));
    expect(lines.slice(bin + 1).join('\n').trimStart().startsWith(HINT_BEGIN)).toBe(true);
    expect(out.split(HINT_BEGIN).length).toBe(2);
    expect(out).toContain('trap atexit EXIT'); // the rest of AppRun is untouched
    expect(out).not.toMatch(/exec "\$BIN" .*--no-sandbox/); // never turns the sandbox off
  });
  it('refuses a second patch and an AppRun without the anchor', () => {
    expect(() => patchAppRun(patchAppRun(APPRUN, SNIPPET), SNIPPET)).toThrow(/already/);
    expect(() => patchAppRun('#!/bin/bash\nexec foo\n', SNIPPET)).toThrow(/BIN=/);
  });
});

// Runs the real snippet in bash with a fake sysctl file and a fake `unshare` on PATH.
describe.skipIf(process.platform === 'win32')('sandbox hint in bash', () => {
  const run = (sysctl: string | null, opts: { unshareOk?: boolean; args?: string[]; env?: Record<string, string> } = {}): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddv-hint-'));
    try {
      const sys = path.join(dir, 'restrict');
      if (sysctl !== null) fs.writeFileSync(sys, `${sysctl}\n`);
      const bin = path.join(dir, 'bin');
      fs.mkdirSync(bin);
      fs.writeFileSync(path.join(bin, 'unshare'), `#!/bin/sh\nexit ${opts.unshareOk ? 0 : 1}\n`, { mode: 0o755 });
      // AppRun's own shape: set -e, args=("$@"), then the snippet; stderr folded into stdout to read the hint.
      const script = `exec 2>&1\nset -e\nargs=("$@")\n${SNIPPET}\necho REACHED-EXEC\n`;
      const env = { PATH: `${bin}:/usr/bin:/bin`, DVPN_USERNS_SYSCTL: sys, APPIMAGE: '/home/u/Devnet-dVPN.AppImage', ...opts.env };
      return execFileSync('bash', ['-c', script, 'AppRun', ...(opts.args ?? [])], { env, encoding: 'utf8' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it('restricted (1) and no user namespace: prints the exact command, then still starts the app', () => {
    const out = run('1');
    expect(out).toMatch(/blocks the browser sandbox/);
    expect(out).toContain('"/home/u/Devnet-dVPN.AppImage" --no-sandbox');
    expect(out).toMatch(/install the \.deb/);
    expect(out.trimEnd().endsWith('REACHED-EXEC')).toBe(true); // hint only: AppRun goes on to exec
  });
  it('negative: not restricted (0) or no such sysctl: no hint', () => {
    expect(run('0')).toBe('REACHED-EXEC\n');
    expect(run(null)).toBe('REACHED-EXEC\n');
  });
  it('no hint when the user already passed --no-sandbox, when a profile lets userns work, or when silenced', () => {
    expect(run('1', { args: ['--no-sandbox'] })).toBe('REACHED-EXEC\n');
    expect(run('1', { unshareOk: true })).toBe('REACHED-EXEC\n');
    expect(run('1', { env: { DVPN_NO_SANDBOX_HINT: '1' } })).toBe('REACHED-EXEC\n');
  });
});
