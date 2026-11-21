// ─── A wallet switch stages its device in <data>/daemon-switch; the Linux root step must take it ───
// The macOS port refused it: its setup script accepted only a folder named daemon-staging, so
// `device switch` failed at "…/daemon-switch". Linux checks the staged home by its contents
// (config.toml + keys/operator.json). Since D1 (AUDIT-FINAL the Linux app) the root step checks the folder name too: it must
// accept BOTH daemon-staging and daemon-switch in the same check. This pins that.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('wallet switch staging folder (Linux root step)', () => {
  const setup = read('resources/scripts/setup-daemon.sh');
  const helper = read('resources/scripts/dvpn-helper');
  const lib = read('resources/scripts/_lib.sh');
  const manager = read('src/main/daemon/manager.ts');

  it('the root step accepts both staging names in one check (D1), and nothing else names only one', () => {
    expect(setup).toMatch(/case "\$\(basename -- "\$staging_real"\)" in daemon-staging\|daemon-switch\) ;;/);
    for (const s of [helper, lib]) {
      expect(s).not.toMatch(/daemon-staging/);
      expect(s).not.toMatch(/daemon-switch/);
    }
  });

  it('setup-daemon.sh takes the staged home by its contents', () => {
    expect(setup).toMatch(/\[ -n "\$STAGING" \] && \[ -f "\$STAGING\/config\.toml" \]/);
    expect(setup).toMatch(/KEY_SRC="\$snap\/home\/keys\/operator\.json"/); // D2: read from the root snapshot of $STAGING
  });

  it('installService passes the switch folder itself as Staging', () => {
    expect(manager).toMatch(/export function switchHome\(\): string \{\s*return path\.join\(getHost\(\)\.dataDir, 'daemon-switch'\);/);
    expect(manager).toMatch(/const sw = staging === switchHome\(\) \? pendingSwitch\(\) : null;/);
    expect(manager).toMatch(/Dvpnd: dvpnd, Staging: staging,/);
  });

  it('positive control: a guard that accepts only daemon-staging would be caught', () => {
    const guarded = setup.replace('daemon-staging|daemon-switch) ;;', 'daemon-staging) ;;');
    expect(guarded).not.toMatch(/case "\$\(basename -- "\$staging_real"\)" in daemon-staging\|daemon-switch\) ;;/);
  });
});
