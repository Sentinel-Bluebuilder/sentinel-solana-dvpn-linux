// ─── Q0308: the AmneziaWG driver check wants a module for the RUNNING kernel ───
// After a kernel update EL9 links the old kernel's DKMS module into the new kernel's weak-updates:
// modinfo finds it, but it does not load. The check said "present", so repair drivers skipped the
// rebuild (Rocky 9.8: built for 687.56.1, running 687.60.1). Runs install-deps.sh in check mode
// with stand-in uname / modinfo / lsmod / awg on PATH.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../resources/scripts/install-deps.sh');
const RUNNING = '5.14.0-687.60.1.el9_8.x86_64';
const OLDER = '5.14.0-687.56.1.el9_8.x86_64';

function stub(dir: string, name: string, body: string): void {
  fs.writeFileSync(path.join(dir, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
}

function awgRow(opts: { vermagic: string; loaded?: boolean }): { status: string; detail: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awg-probe-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  stub(bin, 'uname', `case "$1" in -r) echo ${RUNNING} ;; -m) echo x86_64 ;; *) /usr/bin/uname "$@" ;; esac`);
  stub(bin, 'modinfo', opts.vermagic ? `[ "$1" = -F ] && echo '${opts.vermagic} SMP preempt mod_unload modversions'; exit 0` : 'exit 1');
  stub(bin, 'lsmod', opts.loaded ? "echo 'Module Size Used by'; echo 'amneziawg 118784 0'" : "echo 'Module Size Used by'");
  stub(bin, 'awg', "echo 'amneziawg-tools v1.0.20260812 - https://amnezia.org'");
  stub(bin, 'awg-quick', 'exit 0');
  try {
    execFileSync('bash', [SCRIPT, '--CheckOnly', '1', '--OutDir', dir], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdio: 'ignore' });
  } catch (err) {
    // exit 2 = something missing (wireguard/openvpn are not stubbed): the report is still written
    if ((err as { status?: number }).status !== 2) throw err;
  }
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'install-deps.json'), 'utf8')) as { deps: Array<{ name: string; status: string; detail: string }> };
  fs.rmSync(dir, { recursive: true, force: true });
  return report.deps.find((d) => d.name === 'amneziawg')!;
}

describe.skipIf(process.platform === 'win32')('AmneziaWG driver check (Q0308)', () => {
  it('a module built for an older kernel is missing, and the detail names both kernels', () => {
    const r = awgRow({ vermagic: OLDER });
    expect(r.status).toBe('missing');
    expect(r.detail).toContain(`not built for ${RUNNING}`);
    expect(r.detail).toContain(`built for ${OLDER}`);
  });

  it('a module built for the running kernel is present', () => {
    expect(awgRow({ vermagic: RUNNING }).status).toBe('present');
  });

  it('a loaded module is present even when modinfo cannot read it', () => {
    expect(awgRow({ vermagic: '', loaded: true }).status).toBe('present');
  });
});
