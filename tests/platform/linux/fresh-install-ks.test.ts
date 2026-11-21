// ─── Q0507: a fresh install starts with the kill switch off ───
// RELEASE BLOCKER (DIR 2026-11-12, found on Windows, same path on Linux): `dvpnd init` writes kill_switch = 'on' and
// setup's migrate-daemon-config.sh turns 'on' into 'persist' (Q0426), so every fresh install came up "Always":
// install, connect, reboot = no internet. Decision: fresh install = off; an upgrade or wallet switch keeps the user's
// value. Call site: initDevice → carryLiveSettings → freshInstallDefaults on the staged config.toml, then the real
// migrate script that setup-daemon.sh runs as root.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/main/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { readToml } from '../../../src/core/daemon/config';
import { configMirrorPath, freshInstallDefaults } from '../../../src/main/daemon/manager';

const INIT = fs.readFileSync(path.join(__dirname, '../../fixtures/cb33-c0-config.toml'), 'utf8'); // dvpnd init: 'on'
const MIGRATE = path.resolve(__dirname, '../../../resources/scripts/migrate-daemon-config.sh');

function rig(installed: string | null): { staging: string; live: string; legacy: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ddv-q0507-'));
  const staging = path.join(root, 'staging');
  fs.mkdirSync(staging);
  fs.writeFileSync(path.join(staging, 'config.toml'), INIT);
  const live = path.join(root, 'c0');
  if (installed !== null) fs.writeFileSync(configMirrorPath(live), INIT.replace("kill_switch = 'on'", `kill_switch = '${installed}'`));
  return { staging, live, legacy: path.join(root, 'legacy-none') };
}
const ks = (dir: string): unknown => readToml(fs.readFileSync(path.join(dir, 'config.toml'), 'utf8'), 'network', 'kill_switch');

describe('Q0507 fresh install kill switch', () => {
  it('control: dvpnd init writes on', () => {
    expect(readToml(INIT, 'network', 'kill_switch')).toBe('on');
  });

  it('nothing installed: the staged config is off', () => {
    const r = rig(null);
    expect(freshInstallDefaults(r.staging, r.live, r.legacy)).toBe(true);
    expect(ks(r.staging)).toBe('off');
  });

  it('an installed home (upgrade, wallet switch): the staged config is left to carryLiveSettings', () => {
    const r = rig('persist');
    expect(freshInstallDefaults(r.staging, r.live, r.legacy)).toBe(false);
    expect(ks(r.staging)).toBe('on'); // untouched here; carryLiveSettings copies the user's value
  });

  it('initDevice runs it after carrying settings', () => {
    const src = fs.readFileSync('src/main/daemon/manager.ts', 'utf8');
    const init = src.slice(src.search(/export (async )?function initDevice/));
    expect(init.indexOf('freshInstallDefaults(staging);')).toBeGreaterThan(init.indexOf('carryLiveSettings(staging);'));
  });

  it("setup's migrate step rewrites only an 'on' kill switch, so a fresh 'off' stays off", () => {
    const s = fs.readFileSync(MIGRATE, 'utf8');
    const rewrites = s.split('\n').filter((l) => /kill_switch/.test(l) && /sed -i/.test(l));
    expect(rewrites).toHaveLength(1);
    expect(rewrites[0]).toMatch(/\)on\(/); // the pattern needs the value on
    expect(rewrites[0]).toMatch(/persist/);
    const fresh = rig(null);
    freshInstallDefaults(fresh.staging, fresh.live, fresh.legacy);
    expect(fs.readFileSync(path.join(fresh.staging, 'config.toml'), 'utf8')).not.toMatch(/^\s*kill_switch\s*=\s*['"]on['"]/m);
  });
});
