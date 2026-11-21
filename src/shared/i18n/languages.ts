// ─── The 50 languages of the app (plan Queue B) ───
// code  = the language tag the files and the setting use (locales/<code>.json)
// label = what the selector shows: the two-letter code where one exists, else the three-letter one
// own   = the language's own name, as its speakers write it
// flag  = a country code for the bundled flag set, or null for a plain tile (no country of its own)
// rtl   = written right to left
// enabled = selectable. A language is switched on only when its file is complete and checked;
//           a right-to-left one also needs the start/end layout (LOGICAL_LAYOUT, gate test).
// Order = the order the selector lists them. Provisional: most-used first is settled with the reach figures.
// Files: locales/<code>/{screens,core,main}.json, the same three chunks as English (scripts/i18n-extract.mjs).

export interface Language {
  code: string;
  label: string;
  english: string;
  own: string;
  flag: string | null;
  rtl: boolean;
  enabled: boolean;
}

/** True once every screen uses start/end spacing (B4). A right-to-left language stays off until then. */
export const LOGICAL_LAYOUT = false;

const L = (code: string, label: string, english: string, own: string, flag: string | null, rtl = false, enabled = false): Language =>
  ({ code, label, english, own, flag, rtl, enabled });

export const LANGUAGES: readonly Language[] = [
  // World (15)
  L('en', 'EN', 'English', 'English', 'us', false, true),
  L('zh-Hans', 'ZH', 'Chinese (Simplified)', '简体中文', 'cn', false, true),
  L('zh-Hant', 'ZH', 'Chinese (Traditional)', '繁體中文', 'tw', false, true),
  L('es', 'ES', 'Spanish', 'Español', 'es', false, true),
  L('fr', 'FR', 'French', 'Français', 'fr', false, true),
  L('pt', 'PT', 'Portuguese', 'Português', 'br', false, true),
  L('ru', 'RU', 'Russian', 'Русский', 'ru', false, true),
  L('de', 'DE', 'German', 'Deutsch', 'de', false, true),
  L('ja', 'JA', 'Japanese', '日本語', 'jp'),
  L('ko', 'KO', 'Korean', '한국어', 'kr', false, true),
  L('it', 'IT', 'Italian', 'Italiano', 'it'),
  L('tr', 'TR', 'Turkish', 'Türkçe', 'tr'),
  L('pl', 'PL', 'Polish', 'Polski', 'pl'),
  L('nl', 'NL', 'Dutch', 'Nederlands', 'nl'),
  L('ro', 'RO', 'Romanian', 'Română', 'ro'),
  // South Asia (13)
  L('hi', 'HI', 'Hindi', 'हिन्दी', 'in', false, true),
  L('bn', 'BN', 'Bengali', 'বাংলা', 'bd'), // translated; switched off by the owner 2026-11-16, to return later
  L('ur', 'UR', 'Urdu', 'اردو', 'pk', true),
  L('mr', 'MR', 'Marathi', 'मराठी', 'in'),
  L('te', 'TE', 'Telugu', 'తెలుగు', 'in'), // translated; switched off by the owner 2026-11-16, to return later
  L('ta', 'TA', 'Tamil', 'தமிழ்', 'in', false, true),
  L('gu', 'GU', 'Gujarati', 'ગુજરાતી', 'in'),
  L('pa', 'PA', 'Punjabi', 'ਪੰਜਾਬੀ', 'in'),
  L('kn', 'KN', 'Kannada', 'ಕನ್ನಡ', 'in'),
  L('ml', 'ML', 'Malayalam', 'മലയാളം', 'in'),
  L('or', 'OR', 'Odia', 'ଓଡ଼ିଆ', 'in'),
  L('ne', 'NE', 'Nepali', 'नेपाली', 'np'),
  L('si', 'SI', 'Sinhala', 'සිංහල', 'lk'),
  // South-east Asia (7)
  L('id', 'ID', 'Indonesian', 'Bahasa Indonesia', 'id', false, true),
  L('ms', 'MS', 'Malay', 'Bahasa Melayu', 'my', false, true),
  L('vi', 'VI', 'Vietnamese', 'Tiếng Việt', 'vn'),
  L('fil', 'FIL', 'Filipino', 'Filipino', 'ph', false, true),
  L('th', 'TH', 'Thai', 'ไทย', 'th', false, true),
  L('my', 'MY', 'Burmese', 'မြန်မာ', 'mm'),
  L('km', 'KM', 'Khmer', 'ខ្មែរ', 'kh'),
  // Middle East and Central Asia (8)
  L('ar', 'AR', 'Arabic', 'العربية', 'sa', true),
  L('fa', 'FA', 'Persian', 'فارسی', 'ir', true),
  L('ps', 'PS', 'Pashto', 'پښتو', 'af', true),
  L('kmr', 'KU', 'Kurdish (Kurmanji)', 'Kurdî', null, false, true),
  L('ckb', 'CKB', 'Kurdish (Sorani)', 'کوردی', null, true),
  L('uz', 'UZ', 'Uzbek', 'Oʻzbekcha', 'uz'),
  L('az', 'AZ', 'Azerbaijani', 'Azərbaycanca', 'az'),
  L('uk', 'UK', 'Ukrainian', 'Українська', 'ua'),
  // Africa (7)
  L('ha', 'HA', 'Hausa', 'Hausa', 'ng'),
  L('yo', 'YO', 'Yoruba', 'Yorùbá', 'ng'),
  L('ig', 'IG', 'Igbo', 'Igbo', 'ng'),
  L('pcm', 'PCM', 'Nigerian Pidgin', 'Naijá', null),
  L('sw', 'SW', 'Swahili', 'Kiswahili', 'tz'),
  L('am', 'AM', 'Amharic', 'አማርኛ', 'et'),
  L('om', 'OM', 'Oromo', 'Afaan Oromoo', 'et'),
];

/** The long-text test language (every sentence 40% longer). Never in the list a person sees. */
export const LONG_TEXT_CODE = 'en-XL';

export const DEFAULT_LANGUAGE = 'en';

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code.toLowerCase(), l]));

export function findLanguage(code: string | null | undefined): Language | null {
  if (!code) return null;
  return BY_CODE.get(code.toLowerCase()) ?? null;
}

/** A person may pick it: switched on, and a right-to-left one only once the layout is start/end. */
export function isSelectable(l: Language, logicalLayout = LOGICAL_LAYOUT): boolean {
  return l.enabled && (!l.rtl || logicalLayout);
}

export function selectableLanguages(logicalLayout = LOGICAL_LAYOUT): Language[] {
  return LANGUAGES.filter((l) => isSelectable(l, logicalLayout));
}

/** Text direction for the document: 'rtl' only when the layout can carry it. */
export function direction(code: string, logicalLayout = LOGICAL_LAYOUT): 'ltr' | 'rtl' {
  const l = findLanguage(code);
  return l?.rtl && logicalLayout ? 'rtl' : 'ltr';
}

/** What the page is marked with for a language: <html lang> (fonts, screen readers) and <html dir>. */
export function documentMarks(code: string, logicalLayout = LOGICAL_LAYOUT): { lang: string; dir: 'ltr' | 'rtl' } {
  return { lang: code === LONG_TEXT_CODE ? 'en' : code, dir: direction(code, logicalLayout) };
}

/**
 * The language to run in.
 * 1. A saved choice that names a known language wins, even if that language is switched off
 *    (a switched-off language still loads; it is only hidden from the list). The one exception:
 *    a right-to-left language before the start/end layout falls back, its layout would be broken.
 * 2. No saved choice: the first system language we have switched on (exact tag, then base language).
 * 3. English.
 */
export function resolveLanguage(saved: string | null | undefined, system: readonly string[] = [], logicalLayout = LOGICAL_LAYOUT): string {
  if (saved === LONG_TEXT_CODE) return LONG_TEXT_CODE;
  const s = findLanguage(saved);
  if (s && (!s.rtl || logicalLayout)) return s.code;
  if (s) return DEFAULT_LANGUAGE;
  for (const tag of system) {
    const hit = matchSystem(tag);
    if (hit && isSelectable(hit, logicalLayout)) return hit.code;
  }
  return DEFAULT_LANGUAGE;
}

/** Map a system tag (zh-CN, zh-TW, pt-BR, ku, fil-PH …) to one of ours. */
export function matchSystem(tag: string): Language | null {
  const t = tag.replace(/_/g, '-').toLowerCase();
  const exact = findLanguage(t);
  if (exact) return exact;
  const [base, ...rest] = t.split('-');
  if (base === 'zh') {
    const traditional = rest.some((p) => p === 'hant' || p === 'tw' || p === 'hk' || p === 'mo');
    return findLanguage(traditional ? 'zh-Hant' : 'zh-Hans');
  }
  if (base === 'ku') return findLanguage(rest.includes('arab') || rest.includes('iq') ? 'ckb' : 'kmr');
  if (base === 'tl') return findLanguage('fil');
  return findLanguage(base);
}

/** Search the list by code, label, own name or English name (the selector's filter). */
export function searchLanguages(query: string, list: readonly Language[]): Language[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...list];
  const score = (l: Language): number => {
    if (l.label.toLowerCase() === q || l.code.toLowerCase() === q) return 0;
    if (l.own.toLowerCase().startsWith(q) || l.english.toLowerCase().startsWith(q)) return 1;
    if (l.own.toLowerCase().includes(q) || l.english.toLowerCase().includes(q) || l.code.toLowerCase().startsWith(q)) return 2;
    return -1;
  };
  return list.map((l, i) => ({ l, i, s: score(l) })).filter((x) => x.s >= 0).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.l);
}
