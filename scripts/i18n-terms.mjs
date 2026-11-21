// ─── i18n-terms — does every translated sentence use the chosen word for each term? ───
// Reads docs/i18n/terms/<code>.json (format: docs/i18n/RULES-CODE.md) and that language's files,
// and lists every sentence whose English contains a term while its translation contains none of the
// accepted forms. An untranslated (empty or missing) sentence is not listed here; the gate tests
// count those. Also lists the terms marked unconfirmed.
//   node scripts/i18n-terms.mjs <code> [--json]      exit 1 when a sentence misses its term
//   node scripts/i18n-terms.mjs --all [--json]       every language that has a term sheet
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readLanguage } from './i18n-extract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TERMS_DIR = path.join(ROOT, 'docs', 'i18n', 'terms');
const CONTEXT_SEP = '\u0004';
const PLURAL_SEP = '\u0005plural';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The English a person reads for a key: context tag and plural mark taken off. */
export const englishOf = (key) => key.replace(PLURAL_SEP, '').split(CONTEXT_SEP).pop();
const textsOf = (v) => (typeof v === 'string' ? [v] : Object.values(v ?? {})).filter((s) => typeof s === 'string' && s.trim());

export function readSheet(code) {
  const p = path.join(TERMS_DIR, `${code}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

/**
 * misses: { term, key, english, translation } for every translated sentence that names the term in
 * English and has none of its forms. `en` forms match as whole words, any case; translation forms
 * match as substrings (stems allowed), any case.
 */
export function checkLanguage(code, sheet = readSheet(code), english = readLanguage('en'), own = readLanguage(code)) {
  if (!sheet) return { code, missingSheet: true, misses: [], unconfirmed: [], checked: 0 };
  const misses = [];
  let checked = 0;
  for (const t of sheet.terms ?? []) {
    if (t.kind === 'phrase') continue; // phrases are checked by the translate-back, not word by word
    const en = (t.en ?? []).filter(Boolean);
    const forms = [t.word, ...(t.forms ?? [])].filter(Boolean).map((f) => f.toLocaleLowerCase(code));
    if (!en.length || !forms.length) continue;
    // kind "name" (page names: "Open Diagnostics", "in Wallet"): the English phrase as written, case and all
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(${en.map(esc).join('|')})(?![\\p{L}\\p{N}])`, t.kind === 'name' ? 'u' : 'iu');
    const except = new Set(t.except ?? []); // English sentences where the word means something else (a noun "copy", a command)
    for (const key of Object.keys(english)) {
      // placeholder names and trJsx part names are code ({version}, {endpoint}); command lines keep their words
      const eng = englishOf(key).replace(/\{\w+\}|<\/?\w+\/?>/g, ' ');
      if (/^\s*(devnet-dvpn\b|--|\()/.test(eng)) continue;
      if (!re.test(eng) || except.has(eng) || except.has(key)) continue;
      const tr = textsOf(own[key]);
      if (!tr.length) continue;
      checked++;
      const bad = tr.filter((s) => !forms.some((f) => s.toLocaleLowerCase(code).includes(f)));
      for (const s of bad) misses.push({ term: t.id, key, english: englishOf(key), translation: s });
    }
  }
  const unconfirmed = (sheet.terms ?? []).filter((t) => t.status !== 'confirmed').map((t) => t.id);
  return { code, missingSheet: false, misses, unconfirmed, checked };
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const codes = args.includes('--all')
    ? (fs.existsSync(TERMS_DIR) ? fs.readdirSync(TERMS_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort() : [])
    : args.filter((a) => !a.startsWith('--'));
  if (!codes.length) { console.error('usage: node scripts/i18n-terms.mjs <code>|--all [--json]'); process.exit(2); }
  const results = codes.map((c) => checkLanguage(c));
  if (json) process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  else for (const r of results) {
    if (r.missingSheet) { console.log(`${r.code}: no term sheet (docs/i18n/terms/${r.code}.json)`); continue; }
    console.log(`${r.code}: ${r.checked} sentence checks, ${r.misses.length} missing the chosen word, ${r.unconfirmed.length} terms unconfirmed${r.unconfirmed.length ? ` (${r.unconfirmed.join(', ')})` : ''}`);
    for (const m of r.misses) console.log(`  [${m.term}] ${m.english}\n      → ${m.translation}`);
  }
  if (results.some((r) => r.misses.length || r.missingSheet)) process.exitCode = 1;
}
