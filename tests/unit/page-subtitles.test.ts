// ─── Page subheadings: one direct sentence, similar length (owner 2026-11-12) ───
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = 'src/renderer/src/screens/';
// The subtitles are the same English, now inside tr(): read {tr('X')} as "X" and tr('X') as 'X'.
const untr = (s: string): string => s.replace(/\{tr\('((?:[^'\\]|\\.)*)'\)\}/g, '"$1"').replace(/tr\('((?:[^'\\]|\\.)*)'\)/g, "'$1'");
const read = (f: string): string => untr(readFileSync(DIR + f, 'utf8'));

describe('page subheadings', () => {
  const subs = readdirSync(DIR).filter((f) => f.endsWith('.tsx')).flatMap((f) => [...read(f).matchAll(/subtitle="([^"]+)"/g)].map((m) => ({ f, text: m[1] }))).concat(readdirSync(DIR).filter((f) => f.endsWith('.tsx')).flatMap((f) => [...read(f).matchAll(/subtitle=\{byPlatform\('([^']+)', '([^']+)'\)\}/g)].flatMap((m) => [{ f, text: m[1] }, { f, text: m[2] }]))).concat(readdirSync(DIR).filter((f) => f.endsWith('.tsx')).flatMap((f) => [...read(f).matchAll(/subtitle=\{[A-Z_]+ \? '([^']+)' : '([^']+)'\}/g)].flatMap((m) => [{ f, text: m[1] }, { f, text: m[2] }])));
  it('there are some (positive control)', () => {
    expect(subs.length).toBeGreaterThanOrEqual(10);
  });
  it('each is one sentence of 30 to 50 characters ending in a full stop', () => {
    for (const { f, text } of subs) {
      expect(text.length, `${f}: ${text}`).toBeGreaterThanOrEqual(30);
      expect(text.length, `${f}: ${text}`).toBeLessThanOrEqual(50);
      expect(text.endsWith('.'), f).toBe(true);
      expect(text.slice(0, -1).includes('. '), `${f}: one sentence`).toBe(false);
    }
  });
  it('the home list is called Recently connected', () => {
    expect(readFileSync(DIR + 'Home.tsx', 'utf8')).toContain("title: mine.length ? tr('Recently connected') : tr('Fastest right now')");
  });
});
