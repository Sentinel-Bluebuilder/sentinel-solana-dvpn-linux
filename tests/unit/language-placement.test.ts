// ─── The language menu (plan "The language menu"; Queue B5) ───
// One component (LanguageSelect, two looks) on Connect, the first welcome screen and Settings. The list is
// "System language", English, then the enabled rows of languages.ts in row order; nothing else is shown.
// Search folds case and accents. Each place saves the pick as the `language` setting ('' = system).
// Connect hides the control during a session without unmounting it, so the row keeps its height.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANGUAGES, isSelectable, selectableLanguages } from '../../src/shared/i18n/languages';
import { fold, menuLanguages, searchMenu } from '../../src/shared/language-menu';

const SCREENS = join(__dirname, '../../src/renderer/src/screens');
const src = (f: string): string => readFileSync(join(SCREENS, f), 'utf8');
const COMPONENT = readFileSync(join(__dirname, '../../src/renderer/src/components/LanguageSelector.tsx'), 'utf8');

describe('language menu: the list', () => {
  it('equals English, then the enabled rows of languages.ts in row order', () => {
    const want = LANGUAGES.filter((l) => isSelectable(l));
    const en = want.find((l) => l.code === 'en')!;
    expect(menuLanguages().map((l) => l.code)).toEqual([en, ...want.filter((l) => l !== en)].map((l) => l.code));
  });

  it('a disabled language, or a right-to-left one before the start/end layout, is absent', () => {
    const codes = new Set(menuLanguages().map((l) => l.code));
    for (const l of LANGUAGES) if (!l.enabled || l.rtl) expect(codes.has(l.code)).toBe(l.code === 'en');
    // the guard holds even if a right-to-left row were switched on by mistake
    const fakeOn = LANGUAGES.filter((l) => l.rtl).map((l) => ({ ...l, enabled: true }));
    expect(fakeOn.some((l) => isSelectable(l, false))).toBe(false);
    expect(selectableLanguages(false).some((l) => l.rtl)).toBe(false);
  });

  it('the two Kurdish have no country flag: the plain tile with the code', () => {
    expect(LANGUAGES.filter((l) => l.code === 'kmr' || l.code === 'ckb').every((l) => l.flag === null)).toBe(true);
    expect(COMPONENT).toContain('data-language-tile');
  });
});

describe('language menu: search', () => {
  const all = LANGUAGES;
  it('by own name, English name and code, ignoring case and accents', () => {
    expect(fold('Tiếng Việt')).toBe('tieng viet');
    expect(searchMenu('espanol', all)[0].code).toBe('es');
    expect(searchMenu('SPANISH', all)[0].code).toBe('es');
    expect(searchMenu('fil', all)[0].code).toBe('fil');
    expect(searchMenu('tieng', all)[0].code).toBe('vi');
    expect(searchMenu('日本', all)[0].code).toBe('ja');
    expect(searchMenu('zzzz', all)).toEqual([]);
  });
  it('keeps row order among equal matches (never alphabetical)', () => {
    const hits = searchMenu('kurd', all).map((l) => l.code);
    expect(hits).toEqual(['kmr', 'ckb']);
  });
});

describe('language menu: placement', () => {
  // Owner 2026-11-16: the menu sits bottom left in the sidebar (App.tsx), not on Connect.
  for (const [file, hook, look] of [['../App.tsx', 'data-sidebar-language', 'row'], ['Onboarding.tsx', 'data-onboarding-language', 'row'], ['Settings.tsx', 'data-settings-language', 'row']] as const) {
    it(`${file}: the one menu (${look}), only with a choice, saved as the language setting`, () => {
      const s = src(file);
      expect(s).toMatch(/from '\.\.?\/components\/LanguageSelector'/);
      expect(s).toContain(hook);
      expect(s).toContain(`<LanguageSelect look="${look}"`);
      expect(s).toMatch(/(langs|menuLanguages\(\))\.length > 1/);
      expect(s).toMatch(/onChange=\{\(code\) => void (saveLanguage\(code\)|set\(\{ language: code \}\))\}/);
      expect(s).toMatch(/value=\{(settings\?\.language \?\? ''|settings\.language \?\? ''|savedLang)\}/);
    });
  }

  it('Connect carries no language menu; the sidebar one sits between the session card and the test tokens', () => {
    expect(src('Home.tsx')).not.toContain('LanguageSelect');
    const app = src('../App.tsx');
    expect(app.indexOf('<SessionCard')).toBeLessThan(app.indexOf('data-sidebar-language'));
    expect(app.indexOf('data-sidebar-language')).toBeLessThan(app.indexOf('<TestTokens'));
    expect(app).toContain('data-main-nav="side"');
    expect(app).toContain('data-main-nav="bottom"');
  });

  it('the list is drawn in the page body at a fixed position, so no card can clip it', () => {
    expect(COMPONENT).toContain('createPortal(');
    expect(COMPONENT).toContain('document.body');
    expect(COMPONENT).toContain("position: 'fixed'");
    expect(COMPONENT).not.toMatch(/absolute z-50/);
  });

  it('hooks and keys', () => {
    for (const h of ['data-language-select', 'data-language-option', 'data-language-search', 'data-lang-selector', 'data-lang-option', 'data-lang-search', 'role="listbox"', 'role="option"']) expect(COMPONENT).toContain(h);
    for (const k of ["'ArrowDown'", "'ArrowUp'", "'Enter'", "'Escape'"]) expect(COMPONENT).toContain(k);
    expect(COMPONENT).toContain("tr('System language')");
    expect(COMPONENT).toContain("tr('No language found')");
  });
});
