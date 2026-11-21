// ─── Right-to-left gate (B4): no physical left/right in the renderer ───
// Arabic, Persian, Urdu, Pashto and Sorani Kurdish can be switched on only when the layout mirrors. Every left/right
// spacing, position, border, corner or alignment must be start/end (scripts/i18n-logical.mjs does the plain ones).
// This test fails on any physical-direction class or CSS property outside the allow-list below, each with its reason.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = 'src/renderer';
const CLASS = /(?<![\w-])!?(?:[a-z0-9-]+(?:-?\[[^\]\s]*\])?:)*-?(?:m[lr]|p[lr]|left|right|border-[lr]|rounded-(?:[lr]|[tb][lr])|scroll-[mp][lr]|inset-[lr])-[\w[\]./%#-]+|(?<![\w-])(?:[a-z0-9-]+:)*(?:text-left|text-right|float-left|float-right|border-[lr]|rounded-[lr]|space-x-reverse|divide-x-reverse)(?![\w-])/g;
const CSS_PROP = /(?<![\w-])(?:(?:margin|padding|border|inset|scroll-margin|scroll-padding)-(?:left|right)(?:-[a-z]+)?|left|right|float)\s*:|(?<![\w-])text-align\s*:\s*(?:left|right)\b/g;

/** file (relative to src/renderer) → tokens allowed there, and why. A '*' entry allows the whole file. */
const ALLOW: Record<string, { tokens: string[]; why: string }> = {
  'src/components/LanguageSelector.tsx': { tokens: ['right-to-left'], why: 'English words in a comment or sentence, not a class' },
  'src/screens/SplitTunnel.tsx': { tokens: ['left-out'], why: 'English words in a comment or sentence, not a class' },
  'src/styles/index.css': { tokens: ['right-hand', 'border-right:'], why: 'a comment word; the disclosure chevron is two borders turned 45° and points down, the same in both directions' },
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(tsx?|css|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

function physicalIn(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8');
  const hits = [...text.matchAll(CLASS)].map((m) => m[0]);
  if (file.endsWith('.css')) hits.push(...[...text.matchAll(CSS_PROP)].map((m) => m[0].replace(/\s+/g, '')));
  return hits;
}

describe('right-to-left gate', () => {
  it('no physical left/right class or CSS property in the renderer outside the allow-list', () => {
    const files = walk(ROOT);
    expect(files.length).toBeGreaterThan(30); // positive control: the real renderer is scanned
    const faults: string[] = [];
    for (const file of files) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      const allow = ALLOW[rel];
      if (allow?.tokens.includes('*')) continue;
      for (const hit of physicalIn(file)) if (!allow?.tokens.includes(hit)) faults.push(`${rel}: ${hit}`);
    }
    expect(faults).toEqual([]);
  });

  it('the scan finds what it must (negative control on a sample)', () => {
    const sample = 'className="ml-2 md:text-right hover:border-l-2 ps-2 text-start" .x { margin-left: 0; left: 0; text-align: right; }';
    expect([...sample.matchAll(CLASS)].map((m) => m[0])).toEqual(['ml-2', 'md:text-right', 'hover:border-l-2']);
    expect([...sample.matchAll(CSS_PROP)].map((m) => m[0].replace(/\s+/g, ''))).toEqual(['margin-left:', 'left:', 'text-align:right']);
  });

  it('every allow-list entry is still needed (no stale exceptions)', () => {
    for (const [rel, { tokens }] of Object.entries(ALLOW)) {
      const file = path.join(ROOT, rel);
      expect(fs.existsSync(file), rel).toBe(true);
      if (tokens.includes('*')) continue;
      const hits = physicalIn(file);
      for (const t of tokens) expect(hits, `${rel} ${t}`).toContain(t);
    }
  });
});
