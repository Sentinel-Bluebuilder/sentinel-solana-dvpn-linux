// ─── i18n: a converted file shows no sentence that skips tr() (plan Queue B, lesson 5) ───
// Add a file here in the same commit that wraps it (docs/i18n/RULES-CODE.md). One per line,
// alphabetical, so two sessions adding files at once do not collide.
import { describe, expect, it } from 'vitest';
import { unwrapped } from '../../scripts/i18n-extract.mjs';

const CONVERTED: string[] = [
  'src/renderer/src/components/LanguageSelector.tsx',
];

describe('i18n: converted files', () => {
  it('the list is sorted and has no repeats', () => {
    expect(CONVERTED).toEqual([...new Set(CONVERTED)].sort());
  });

  it.each(CONVERTED.length ? CONVERTED : ['(none yet)'])('%s: every sentence goes through tr()', (file) => {
    if (file === '(none yet)') return;
    const left = unwrapped([file]).map((r: { line: number; kind: string; text: string }) => `${r.line} [${r.kind}] ${r.text}`);
    expect(left, `node scripts/i18n-extract.mjs --unwrapped ${file}`).toEqual([]);
  });
});
