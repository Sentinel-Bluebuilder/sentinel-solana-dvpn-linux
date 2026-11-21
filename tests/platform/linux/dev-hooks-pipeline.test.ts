// ─── K-M4-5 (rc9-c2) on Linux: a release never carries the UI test hooks ───
// Port of the Windows app ef47e0fa1 (release-win.mjs / package:win): the payload check runs after the app build and before
// electron-builder packs it, in both Linux build paths.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (f: string): string => fs.readFileSync(f, 'utf8');

describe('K-M4-5 pipeline (Linux)', () => {
  it('release-linux.mjs checks out/main after electron-vite build and before electron-builder', () => {
    const rel = read('scripts/release-linux.mjs');
    const at = rel.indexOf("run('node', ['scripts/check-dev-hooks-payload.mjs']); // K-M4-5");
    expect(at).toBeGreaterThan(rel.indexOf("npx(['electron-vite', 'build']);"));
    expect(at).toBeLessThan(rel.indexOf("npx(['electron-builder', '--linux'"));
  });
  it('package:linux runs the same check between the build and electron-builder', () => {
    const pkg = JSON.parse(read('package.json')).scripts as Record<string, string>;
    expect(pkg['package:linux']).toMatch(/electron-vite build && node scripts\/check-dev-hooks-payload\.mjs && .*electron-builder --linux/);
  });
});
