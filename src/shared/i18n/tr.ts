// ─── tr(): the one translation function (screens, main process, terminal) ───
// No React, no Electron, no file access: a catalogue is handed in by whoever loads it.
// The English sentence is the key. A missing entry, an unknown language or an empty
// translation falls back to the English sentence, so nothing ever shows a raw key.
//   tr('The VPN service is off.')
//   tr('Switching to {place}…', { place })
//   tr('Open', undefined, 'menu')            same words, other meaning: a context tag
//   trPlural({ one: '{n} server', other: '{n} servers' }, count)
import { DEFAULT_LANGUAGE, LONG_TEXT_CODE, findLanguage } from './languages';
import { longText } from './long-text';

export type Vars = Record<string, string | number | bigint | null | undefined>;
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
export type Entry = string | PluralForms;
export type Catalog = Record<string, Entry>;

/** Separates a context tag from the sentence in a key (same character as the classic message catalogues). */
export const CONTEXT_SEP = '\u0004';
/** Marks a plural key: the key is the English `other` form. */
export const PLURAL_SEP = '\u0005plural';

export const keyOf = (text: string, context?: string): string => (context ? `${context}${CONTEXT_SEP}${text}` : text);
export const pluralKeyOf = (other: string, context?: string): string => keyOf(other, context) + PLURAL_SEP;

let active = DEFAULT_LANGUAGE;
let catalog: Catalog = {};
let plural = new Intl.PluralRules('en');
const listeners = new Set<(code: string) => void>();

/** Switch the language. `cat` = that language's file (null or {} for English). */
export function setLanguage(code: string, cat: Catalog | null = null): void {
  active = code;
  catalog = cat ?? {};
  plural = new Intl.PluralRules(intlLocale(code));
  for (const fn of listeners) {
    try { fn(code); } catch (err) { console.error('[i18n] language listener failed:', err); }
  }
}

export const currentLanguage = (): string => active;

/** Called after every setLanguage (the main process re-sends its current state to the screens). */
export function onLanguageChange(fn: (code: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The tag Intl understands for one of our codes. */
export function intlLocale(code: string): string {
  if (code === LONG_TEXT_CODE) return 'en';
  if (code === 'kmr') return 'ku';
  if (code === 'pcm') return 'en-NG';
  return code;
}

/** First Strong Isolate … Pop Directional Isolate: the value inside keeps its own direction (B5). */
export const FSI = '⁨';
export const PDI = '⁩';

/**
 * Put the values into a sentence. `isolate`: wrap each value in FSI…PDI, so an address, an amount, a command
 * or a Latin name inside a right-to-left sentence keeps its own order and does not drag the words around it.
 * tr() isolates when the language is written right to left; the English `.message` of an error does not.
 */
export function fill(text: string, vars?: Vars, isolate = false): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = vars[name];
    if (v === undefined || v === null) return whole;
    return isolate ? `${FSI}${String(v)}${PDI}` : String(v);
  });
}

/** True while a right-to-left language is on: tr() then isolates its values. */
const rtlActive = (): boolean => findLanguage(active)?.rtl === true;

export function tr(text: string, vars?: Vars, context?: string): string {
  const hit = catalog[keyOf(text, context)];
  const base = typeof hit === 'string' && hit ? hit : text;
  const out = fill(base, vars, rtlActive());
  return active === LONG_TEXT_CODE ? longText(out) : out;
}

export function trPlural(forms: PluralForms, count: number, vars?: Vars, context?: string): string {
  const hit = catalog[pluralKeyOf(forms.other, context)];
  const cat = plural.select(count);
  const own = hit && typeof hit === 'object' ? hit : null;
  const englishCat = new Intl.PluralRules('en').select(count);
  const base = (own && (own[cat] || own.other)) || forms[englishCat] || forms.other;
  const out = fill(base, { n: formatNumber(count), ...vars }, rtlActive());
  return active === LONG_TEXT_CODE ? longText(out) : out;
}

// ─── Numbers and dates in the chosen language (the system's own formatter) ───
export function formatNumber(n: number | bigint, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(intlLocale(active), opts).format(n);
}

export function formatDate(d: Date | number, opts?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(intlLocale(active), opts).format(d);
}

export function formatList(items: string[], type: 'conjunction' | 'disjunction' = 'conjunction'): string {
  return new Intl.ListFormat(intlLocale(active), { style: 'long', type }).format(items);
}
