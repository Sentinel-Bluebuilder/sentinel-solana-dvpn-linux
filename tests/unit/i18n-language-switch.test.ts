// ─── B5 step 1: loading a language, the page marks, main's switch ───
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const st = vi.hoisted(() => ({ language: 'es', listeners: [] as Array<(s: { language: string }) => void>, patches: [] as Array<Record<string, unknown>> }));
vi.mock('../../src/main/system/settings', () => ({
  getSettings: () => ({ language: st.language }),
  onSettingsChanged: (fn: (s: { language: string }) => void) => { st.listeners.push(fn); return () => {}; },
}));
vi.mock('../../src/main/app-state', () => ({ patch: (p: Record<string, unknown>) => { st.patches.push(p); } }));
vi.mock('../../src/main/logger', () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }));

const { loadCatalog, applyLanguage } = await import('../../src/shared/i18n/catalogs');
const { tr, currentLanguage, setLanguage, LONG_TEXT_CODE, documentMarks } = await import('../../src/shared/i18n');
const { startLanguage } = await import('../../src/main/language');

/** One real sentence and its Spanish, read from the files (so the test follows the translators' edits). */
function spanishPair(): [string, string] {
  const es = JSON.parse(fs.readFileSync('src/shared/i18n/locales/es/main.json', 'utf8')) as Record<string, unknown>;
  const [key, value] = Object.entries(es).find(([k, v]) => typeof v === 'string' && v && v !== k && !k.includes('{')) as [string, string];
  return [key, value];
}

afterEach(() => setLanguage('en'));

describe('loadCatalog / applyLanguage', () => {
  it('English, the long-text language and an unknown code need no file', async () => {
    expect(await loadCatalog('en')).toBeNull();
    expect(await loadCatalog(LONG_TEXT_CODE)).toBeNull();
    expect(await loadCatalog('xx')).toBeNull();
  });

  it('a language loads all three of its files and tr() speaks it; back to English after', async () => {
    const cat = await loadCatalog('es');
    expect(Object.keys(cat ?? {}).length).toBeGreaterThan(1000); // screens + core + main merged
    const [key, value] = spanishPair();
    expect(await applyLanguage('es')).toBe('es');
    expect(tr(key)).toBe(value);
    await applyLanguage('en');
    expect(tr(key)).toBe(key);
  });

  it('two choices in quick succession: the last one wins', async () => {
    const first = applyLanguage('es');
    const second = applyLanguage('en');
    await Promise.all([first, second]);
    expect(currentLanguage()).toBe('en');
  });
});

describe('documentMarks', () => {
  it('lang is the code; dir is rtl for a right-to-left language only once the layout flag is on', () => {
    expect(documentMarks('ar', false)).toEqual({ lang: 'ar', dir: 'ltr' });
    expect(documentMarks('ar', true)).toEqual({ lang: 'ar', dir: 'rtl' });
    expect(documentMarks('fa', true)).toEqual({ lang: 'fa', dir: 'rtl' });
    expect(documentMarks('es', true)).toEqual({ lang: 'es', dir: 'ltr' });
    expect(documentMarks(LONG_TEXT_CODE)).toEqual({ lang: 'en', dir: 'ltr' });
  });
});

describe('main/language.ts', () => {
  it('starts in the saved language, tells the screens, and follows a change in Settings', async () => {
    let redraws = 0;
    st.language = 'es';
    await startLanguage(['fr-FR'], () => { redraws++; });
    expect(st.patches.at(-1)).toEqual({ language: 'es' }); // a saved choice wins
    expect(currentLanguage()).toBe('es');
    expect(redraws).toBe(1);
    st.language = ''; // back to the system language: French is switched on (rc.4), so French
    st.listeners[0]({ language: '' });
    await vi.waitFor(() => expect(st.patches.at(-1)).toEqual({ language: 'fr' }));
    expect(redraws).toBe(2);
  });
});

describe('the CLI stays English', () => {
  it('nothing the CLI bundles imports the language files', () => {
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    const users = ['src/cli', 'src/core', 'src/shared'].flatMap(walk).filter((f) => /\.tsx?$/.test(f) && /i18n\/catalogs['"]/.test(fs.readFileSync(f, 'utf8')));
    expect(users).toEqual([]);
    expect(fs.readFileSync('src/shared/i18n/index.ts', 'utf8')).not.toMatch(/catalogs/);
  });
});
