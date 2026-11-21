// ─── S8 (rc9-c2, review): the release payload check fails on nothing to check ───
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.resolve('scripts/check-dev-hooks-payload.mjs');
const run = (dir: string): { code: number | null; out: string } => {
  const r = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'devhooks-'));

describe('S8: check-dev-hooks-payload', () => {
  it('a missing folder: exit 2', () => {
    expect(run(path.join(tmp(), 'nope')).code).toBe(2);
  });
  it('an empty folder, or one with no script file: exit 2, nothing checked', () => {
    const d = tmp();
    expect(run(d)).toMatchObject({ code: 2 });
    fs.writeFileSync(path.join(d, 'notes.txt'), 'x');
    const r = run(d);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/nothing was checked/);
  });
  it('a planted marker: exit 1, with the count scanned', () => {
    const d = tmp();
    fs.mkdirSync(path.join(d, 'chunks'));
    fs.writeFileSync(path.join(d, 'index.cjs'), 'module.exports = 1;\n');
    fs.writeFileSync(path.join(d, 'chunks', 'a.cjs'), 'function runScenario() {}\n');
    const r = run(d);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/2 files scanned/);
  });
  it('a clean bundle: exit 0, with the count scanned', () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'index.cjs'), 'const DEV_HOOKS_BUILD = "";\nmodule.exports = 1;\n');
    const r = run(d);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/1 files scanned/);
  });
});
