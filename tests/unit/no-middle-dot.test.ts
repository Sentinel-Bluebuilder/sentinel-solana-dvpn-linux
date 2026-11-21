// UI-187 (owner 2026-11-15): no middle dot (" · ") joining fragments anywhere in the app. Text is written
// as proper wording: a sentence, "label: value", a list with commas or "and", or brackets. Comments may
// use it; strings and JSX text may not. Scope: the app's screens and the core and shared code they show.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// src/cli added once its owners had rebuilt their lines (connect-64 c96fe16, UI-SCREENS db550d2).
// src/main/services/cli-exec.ts (the CLI screen's help line) joins when UI-ENGINE has rebuilt its 'Built in' line.
const ROOTS = ['src/renderer/src', 'src/core', 'src/shared', 'src/cli'];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

/** Source with its comments removed: block comments, JSX comments and line comments (not "https://"). */
export function withoutComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** Lines that still join fragments with a middle dot. */
export function dottedLines(src: string): string[] {
  // Any middle dot at all, with or without spaces: a dot drawn as its own element
  // (`<span>·</span>`) slipped past a spaces-only check and reached two screens (UI-LEAD 2026-11-15).
  return withoutComments(src).split('\n').filter((l) => l.includes('·')).map((l) => l.trim());
}

/** The one file allowed to contain the character: the table that turns it into '-' for plain consoles. */
const ALLOWED = ['console-text.ts'];

describe('no middle dot in what the app shows', () => {
  it('finds one in a string and in JSX text, and ignores comments (positive control)', () => {
    expect(dottedLines("const a = `Checked ${n} · 12:04`;")).toHaveLength(1);
    expect(dottedLines('<span>Running · restart it</span>')).toHaveLength(1);
    expect(dottedLines('<span>Quick connect</span><span aria-hidden>·</span><Flag />')).toHaveLength(1);
    expect(dottedLines("// Exit codes: 0 ok · 1 error\n/** a · b */\n{/* c · d */}\nconst u = 'https://x.y'; // e · f")).toEqual([]);
  });

  it('there are files to check', () => {
    expect(ROOTS.flatMap(files).length).toBeGreaterThan(100);
  });

  it('none in src/renderer/src, src/core, src/shared or src/cli', () => {
    const hits = ROOTS.flatMap(files).filter((f) => !ALLOWED.some((a) => f.endsWith(a))).flatMap((f) => dottedLines(readFileSync(f, 'utf8')).map((l) => `${f}: ${l.slice(0, 120)}`));
    expect(hits).toEqual([]);
  });
});
