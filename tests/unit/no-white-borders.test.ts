// ─── No white boxes in dark mode, anywhere in the app (owner 2026-11-15) ───
// Two causes, both closed here:
// 1. A border that names no colour took Tailwind's default light grey (#e5e7eb). The default is now
//    the theme's hairline (tailwind.config.cjs borderColor.DEFAULT), for every border in the app.
// 2. Colours that are plain CSS variables (line, line-strong, and the -soft tones) take no opacity:
//    `border-line/70` produces NO rule, so the border fell back to that default. That drew the white
//    boxes around Built on Sentinel, the test-token buttons and the idle status card.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../src/renderer/src');
const CFG = readFileSync(join(__dirname, '../../tailwind.config.cjs'), 'utf8');
/** Colour names that are plain variables in tailwind.config.cjs, so `/NN` on them does nothing. */
const PLAIN = ['line-strong', 'line', 'accent-soft', 'ok-soft', 'warn-soft', 'bad-soft'];
const BAD = new RegExp(`\\b(?:border(?:-[trblxy])?|bg|text|ring|divide|outline|from|to|via|fill|stroke)-(?:${PLAIN.join('|')})/\\d+`, 'g');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css)$/.test(n) ? [p] : [];
  });
}

describe('borders are never white in dark mode', () => {
  it('a border with no colour of its own is the theme hairline, not Tailwind light grey', () => {
    expect(CFG).toMatch(/borderColor:\s*\{\s*DEFAULT:\s*'var\(--border\)'\s*\}/);
  });

  it('no class asks for a plain-variable colour with an opacity, in any screen or style', () => {
    const hits = files(ROOT).flatMap((f) => (readFileSync(f, 'utf8').match(BAD) ?? []).map((m) => `${f.slice(ROOT.length)}: ${m}`));
    expect(hits).toEqual([]);
  });

  it('the check finds each kind when it is there (control)', () => {
    expect('rounded border border-line/70 px-2'.match(BAD)).toEqual(['border-line/70']);
    expect('border-t-line-strong/40 bg-ok-soft/50'.match(BAD)).toEqual(['border-t-line-strong/40', 'bg-ok-soft/50']);
    expect('border border-line bg-bg-raised/50 border-warn/40'.match(BAD)).toBeNull();
  });

  it('the names in PLAIN really are plain variables (if one gains alpha support, drop it from the list)', () => {
    expect(CFG).toMatch(/line:\s*\{\s*DEFAULT:\s*'var\(--border\)',\s*strong:\s*'var\(--border-strong\)'/);
    for (const tone of ['accent', 'green', 'yellow', 'red']) expect(CFG).toContain(`soft: 'var(--${tone}-soft)'`);
  });
});
