// ─── Words the code reads stay English (B3): a file path and a connect action are never tr() ───
// The wrapper once translated the macOS 'Application Support' folder, the 'Devnet dVPN CLI.command' file name and
// 75 connect actions; each would have broken only in another language. The extractor now refuses them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanFile } from '../../scripts/i18n-extract.mjs';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function errorsOf(source: string): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-code-words-'));
  dirs.push(dir);
  const file = path.join(dir, 'sample.ts');
  fs.writeFileSync(file, source);
  return scanFile(file).errors.map((e: { why: string }) => e.why);
}

describe('the extractor refuses tr() where the code reads the words', () => {
  it('a folder or file name in path.join / path.resolve', () => {
    expect(errorsOf("const p = path.join(home, 'Library', tr('Application Support'));")).toEqual([expect.stringMatching(/file path/)]);
    expect(errorsOf("const p = path.resolve(dir, tr('Devnet dVPN CLI.command'));")).toEqual([expect.stringMatching(/file path/)]);
  });

  it('a connect action (routing key)', () => {
    expect(errorsOf("const r = { error: tr('Nothing was paid.'), action: tr('Pick another server') };")).toEqual([expect.stringMatching(/routing key/)]);
  });

  it('negative control: a sentence beside them is fine', () => {
    expect(errorsOf("const r = { error: tr('Nothing was paid.'), action: 'Pick another server', label: tr('Servers') }; const p = path.join(home, 'Library');")).toEqual([]);
  });

  it('the app itself has none (positive control: the real tree is scanned)', () => {
    expect(scanFile('src/main/services/connect-checks.ts').errors).toEqual([]);
    expect(scanFile('src/main/runtime.ts').errors).toEqual([]);
  });
});
