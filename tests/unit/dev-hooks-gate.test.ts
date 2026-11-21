// ─── K-M4-5 (rc9-c2, review audit): the UI test hooks are not in a release build ───
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { devHooksArmed, uiSmokeEnv } from '../../src/main/dev/hooks';

const read = (p: string): string => fs.readFileSync(path.resolve(p), 'utf8');
const code = (s: string): string => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

describe('dev hooks gate', () => {
  it('a release build (no flag) never arms, packaged or not; "1" only unpackaged; "packaged" both', () => {
    expect(devHooksArmed(true, '')).toBe(false);
    expect(devHooksArmed(false, '')).toBe(false);
    expect(devHooksArmed(true, '1')).toBe(false);
    expect(devHooksArmed(false, '1')).toBe(true);
    expect(devHooksArmed(true, 'packaged')).toBe(true);
    expect(devHooksArmed(true, 'yes')).toBe(false);
  });
  it('DVPN_UI_SMOKE is ignored by a release build', () => {
    const was = process.env.DVPN_UI_SMOKE;
    process.env.DVPN_UI_SMOKE = 'C:\\x';
    try {
      expect(uiSmokeEnv(true, '')).toBe('');
      expect(uiSmokeEnv(false, '')).toBe('');
      expect(uiSmokeEnv(false, '1')).toBe('C:\\x');
    } finally {
      if (was === undefined) delete process.env.DVPN_UI_SMOKE; else process.env.DVPN_UI_SMOKE = was;
    }
  });
  it('no file outside src/main/dev imports dev/ui-* statically; index.ts loads it behind the build literal', () => {
    const files: string[] = [];
    const walk = (d: string): void => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(e.name)) files.push(p); } };
    walk(path.resolve('src'));
    for (const f of files) {
      if (f.includes(`${path.sep}main${path.sep}dev${path.sep}`)) continue;
      expect(code(fs.readFileSync(f, 'utf8')), f).not.toMatch(/^\s*import\s[^;]*from\s+['"][^'"]*dev\/ui-[^'"]*['"]/m);
    }
    const idx = code(read('src/main/index.ts'));
    expect(idx).toMatch(/__DVPN_DEV_HOOKS__ && devHooksArmed\(app\.isPackaged\) && process\.env\.DVPN_UI_SMOKE\s*\n\s*\? import\('\.\/dev\/ui-smoke'\)/);
    expect(idx).not.toMatch(/process\.env\.DVPN_UI_SMOKE\)\s*(runUiSmoke|prepareUiSmoke)/);
    for (const f of ['src/main/ipc.ts', 'src/main/system/notify.ts']) expect(code(read(f)), f).not.toMatch(/process\.env\.DVPN_UI_SMOKE\s*[?)]/);
  });
  it('the build sets the flag only from DVPN_DEV_HOOKS, empty by default', () => {
    const cfg = read('electron.vite.config.ts');
    expect(cfg).toMatch(/define: \{ __DVPN_DEV_HOOKS__: JSON\.stringify\(DEV_HOOKS\) \}/);
    expect(cfg).toMatch(/\['1', 'packaged'\]\.includes\(process\.env\.DVPN_DEV_HOOKS \?\? ''\)/);
  });
  it('ui-scenario no longer swallows a failed screen read or screenshot', () => {
    const s = code(read('src/main/dev/ui-scenario.ts'));
    expect(s).not.toMatch(/\.catch\(\(\) => (\[\]|undefined)\)/);
  });
});
