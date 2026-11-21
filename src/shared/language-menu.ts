// ─── The language menu's list and search (plan "The language menu") ───
// No React here, so the unit tests and any screen can use it. The list reads only the rows of
// shared/i18n/languages.ts: English, then every pickable language in row order (by speakers).
import { selectableLanguages, type Language } from './i18n';

/** The saved value for "System language". */
export const SYSTEM = '';

/** Lower case, accents removed: "Español" matches "espanol", "Tiếng Việt" matches "tieng viet". */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** English, then every pickable language in the order of the rows. Not enabled = not listed. */
export function menuLanguages(): Language[] {
  const list = selectableLanguages();
  const en = list.find((l) => l.code === 'en');
  return en ? [en, ...list.filter((l) => l !== en)] : list;
}

/** Filter by own name, English name, code or label; best matches first, row order otherwise. */
export function searchMenu(query: string, list: readonly Language[]): Language[] {
  const q = fold(query.trim());
  if (!q) return [...list];
  const score = (l: Language): number => {
    const own = fold(l.own); const eng = fold(l.english);
    if (fold(l.code) === q || fold(l.label) === q) return 0;
    if (own.startsWith(q) || eng.startsWith(q)) return 1;
    if (own.includes(q) || eng.includes(q) || fold(l.code).startsWith(q)) return 2;
    return -1;
  };
  return list.map((l, i) => ({ l, i, s: score(l) })).filter((x) => x.s >= 0).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.l);
}
