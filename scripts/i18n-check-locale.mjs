// ─── i18n-check-locale — every gate a committed locale must pass, in seconds ───
// For each language: keys against the English (missing / extra per chunk), placeholders and trJsx
// parts name for name, empty values, direction-override characters, the term sheet (scripts/i18n-terms.mjs)
// and the banned names over the locale files.
//   node scripts/i18n-check-locale.mjs <code>... | --all  [--against <dir>] [--json]
// --against <dir>: compare with the English chunks in <dir> (<dir>/{screens,core,main}.json), e.g. the
// proof keys translators work from while the app is being wrapped; default: the repo's English.
// Exit 1 when a language has a fault that is not "missing" (missing is expected until the wrap ends).
// Term mismatches are printed as notes for the reader and fail only with --strict-terms: the term sheet is a word
// match, and a command name (connect, refund) or a sentence that rightly words it another way trips it.
import fs from 'node:fs';
import path from 'node:path';
import { CHUNKS, chunkPath, languageDirs, safetyTags } from './i18n-extract.mjs';
import { checkLanguage } from './i18n-terms.mjs';
import { loadMatchers } from './i18n-banned.mjs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const strictTerms = args.includes('--strict-terms');
const ai = args.indexOf('--against');
const against = ai >= 0 ? args[ai + 1] : null;
// a flag, or the value after --against / --safety-out (only when that flag is given)
const valueAt = new Set(['--against', '--safety-out'].map((f) => args.indexOf(f)).filter((i) => i >= 0).map((i) => i + 1));
const skipArg = (a, i) => a.startsWith('--') || valueAt.has(i);
const codes = args.includes('--all') ? languageDirs().filter((c) => c !== 'en') : args.filter((a, i) => !skipArg(a, i));
if (!codes.length) { console.error('usage: node scripts/i18n-check-locale.mjs <code>...|--all [--against <dir>] [--json]'); process.exit(2); }

const readJson = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {});
const english = Object.fromEntries(CHUNKS.map((c) => [c, readJson(against ? path.join(against, `${c}.json`) : chunkPath('en', c))]));
const englishAll = Object.assign({}, ...Object.values(english));
// The safety-tagged sentences (money, refund, recovery phrase, kill switch, blocked internet): every
// reader reads the same set. --safety-out <file> writes it: chunk, position in that chunk, tags, English.
const safety = [];
for (const c of CHUNKS) Object.keys(english[c]).forEach((k, i) => {
  const v = english[c][k];
  const text = [k.split('\u0004').pop().replace('\u0005plural', ''), ...(typeof v === 'object' && v ? Object.values(v) : [])].join(' ');
  const tags = safetyTags(text, '', k.includes('\u0004') ? k.split('\u0004')[0] : '');
  if (tags.length) safety.push({ chunk: c, n: i + 1, tags, key: k });
});
const so = args.indexOf('--safety-out');
if (so >= 0) fs.writeFileSync(args[so + 1], `# ${safety.length} safety-tagged sentences (scripts/i18n-check-locale.mjs over ${against ?? 'the repo English'}): chunk<TAB>position in chunk<TAB>tags<TAB>English key\n` + safety.map((s) => `${s.chunk}\t${s.n}\t${s.tags.join(',')}\t${s.key.replace(/\u0004/g, ' | ctx: ').replace('\u0005plural', ' [plural]')}`).join('\n') + '\n');
const holders = (s) => [...[...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]), ...[...s.matchAll(/<(\w+)\/?>/g)].map((m) => `<${m[1]}>`)].sort().join(',');
const textsOf = (v) => (typeof v === 'string' ? [v] : Object.values(v ?? {}).filter((s) => typeof s === 'string'));
const englishText = (key, v) => (typeof v === 'object' && v ? v.other ?? '' : typeof v === 'string' && v ? v : key.split('\u0004').pop().replace('\u0005plural', ''));
const BIDI_OVERRIDE = /[‪-‮⁦-⁩]/; // embeddings / overrides / isolates: the layout decides direction, not the text
const banned = loadMatchers() ?? [];

// The plural forms a whole count can land on in a language (same mapping as intlLocale in src/shared/i18n/tr.ts)
const pluralNeeds = (code) => {
  const rules = new Intl.PluralRules(code === 'kmr' ? 'ku' : code === 'pcm' ? 'en-NG' : code);
  return { has: new Set(rules.resolvedOptions().pluralCategories), needed: [...new Set([...Array(1001).keys()].map((n) => rules.select(n)))] };
};

const results = codes.map((code) => {
  const r = { code, keys: 0, missing: 0, extra: 0, perChunk: {}, empty: [], placeholders: [], plurals: [], bidi: [], terms: [], banned: [], termsChecked: 0, sheet: true };
  const pn = pluralNeeds(code);
  r.pluralForms = pn.needed;
  const own = {};
  for (const c of CHUNKS) {
    const got = readJson(chunkPath(code, c));
    Object.assign(own, got);
    const want = english[c];
    const missing = Object.keys(want).filter((k) => !(k in got));
    const extra = Object.keys(got).filter((k) => !(k in want) && !(k in englishAll));
    const moved = Object.keys(got).filter((k) => !(k in want) && k in englishAll);
    r.keys += Object.keys(got).length; r.missing += missing.length; r.extra += extra.length + moved.length;
    r.perChunk[c] = { keys: Object.keys(got).length, missing, extra, moved };
    for (const [k, v] of Object.entries(got)) {
      const ts = textsOf(v);
      if (!ts.some((s) => s.trim())) { r.empty.push(k); continue; }
      const want0 = holders(englishText(k, englishAll[k] ?? want[k]));
      if (typeof v === 'object' && v) {
        // A plural: `other` carries every placeholder. Another form may leave out the count ({n} / {count}):
        // "one app" / "خادم واحد" / "except the one you chose" name it in words. Nothing else may be missing or added.
        const all = want0 ? want0.split(',') : [];
        const optional = new Set(['n', 'count']); // holders() gives names without braces
        for (const [form, s] of Object.entries(v)) {
          if (typeof s !== 'string' || !s.trim()) continue;
          const got = holders(s);
          const have = got ? got.split(',') : [];
          const ok = form === 'other'
            ? got === want0
            : have.every((h) => all.includes(h)) && all.every((h) => have.includes(h) || optional.has(h));
          if (!ok) r.placeholders.push({ key: k, want: want0, got: `${form}: ${got}`, text: s });
        }
      } else {
        for (const s of ts) if (s.trim() && holders(s) !== want0) r.placeholders.push({ key: k, want: want0, got: holders(s), text: s });
      }
      if (typeof v === 'object' && v) {
        const lacks = pn.needed.filter((f) => !(typeof v[f] === 'string' && v[f].trim()));
        const foreign = Object.keys(v).filter((f) => !pn.has.has(f));
        if (lacks.length || foreign.length) r.plurals.push({ key: k, lacks, foreign });
      }
      for (const s of ts) if (BIDI_OVERRIDE.test(s)) r.bidi.push(k);
      for (const s of ts) for (const m of banned) if (m.re.test(s)) r.banned.push({ key: k, name: m.name });
    }
  }
  const t = checkLanguage(code, undefined, englishAll, own);
  r.sheet = !t.missingSheet; r.terms = t.misses; r.termsChecked = t.checked; r.unconfirmed = t.unconfirmed;
  r.fail = r.extra + r.placeholders.length + r.plurals.length + r.bidi.length + (strictTerms ? r.terms.length : 0) + r.banned.length + (r.sheet ? 0 : 1);
  return r;
});

if (json) process.stdout.write(JSON.stringify(results, null, 2) + '\n');
else console.log(`English: ${Object.keys(englishAll).length} keys, ${safety.length} safety-tagged (${against ? `against ${against}` : 'repo English'})`);
if (!json) for (const r of results) {
  console.log(`${r.code}: ${r.keys} keys, ${r.missing} missing, ${r.extra} extra, ${r.empty.length} empty, ${r.placeholders.length} placeholder faults, ${r.plurals.length} plural-form faults (needs ${r.pluralForms.join('/')}), ${r.bidi.length} direction overrides, ${r.terms.length}/${r.termsChecked} term mismatches${r.sheet ? '' : ' (NO TERM SHEET)'}, ${r.banned.length} banned names`);
  for (const [c, x] of Object.entries(r.perChunk)) {
    if (x.extra.length) console.log(`  ${c} extra: ${x.extra.map((k) => JSON.stringify(k)).join(' | ')}`);
    if (x.moved.length) console.log(`  ${c} in another chunk in English: ${x.moved.map((k) => JSON.stringify(k)).join(' | ')}`);
  }
  for (const p of r.placeholders) console.log(`  placeholders ${JSON.stringify(p.key)}: want [${p.want}] got [${p.got}]`);
  for (const p of r.plurals) console.log(`  plural ${JSON.stringify(p.key)}:${p.lacks.length ? ` missing ${p.lacks.join(', ')}` : ''}${p.foreign.length ? ` not a form in ${r.code}: ${p.foreign.join(', ')}` : ''}`);
  for (const k of r.bidi) console.log(`  direction override in ${JSON.stringify(k)}`);
  for (const m of r.terms) console.log(`  ${strictTerms ? 'term' : 'term note'} [${m.term}] ${JSON.stringify(m.key)}\n      → ${m.translation}`);
  for (const b of r.banned) console.log(`  banned name "${b.name}" in ${JSON.stringify(b.key)}`);
}
if (results.some((r) => r.fail)) process.exitCode = 1;
