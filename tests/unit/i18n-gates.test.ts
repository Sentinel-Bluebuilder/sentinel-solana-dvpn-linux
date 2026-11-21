// ─── i18n gates (plan Queue B): what must hold before any language ships ───
// 1. The English chunks are what the source says (node scripts/i18n-extract.mjs), every tr() call readable.
// 2. Every language has the same three chunks as English with exactly the same entries in each.
// 3. Placeholders ({name}) match the English sentence, form by form.
// 4. A right-to-left language cannot be switched on before the layout uses start/end spacing.
// 5. A switched-off language still loads when a saved setting names it.
// 6. The list: 50 languages, flags from the bundled set, complete files for each one switched on.
// 7. No banned name in the language work (the list lives outside the repository).
// 8. The term check finds a translated sentence that lacks the chosen word.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHUNKS, LOCALES, ROOT, chunkPath, chunkOf, extract, folderOf, isPhysicalClass, languageDirs, readLanguage, rel, scanFile, serialise, sourceFiles, allSentences, safetyTags, type Catalog as FileCatalog } from '../../scripts/i18n-extract.mjs';
import { addedLines, inScope, scan, LIST_PATH } from '../../scripts/i18n-banned.mjs';
import { checkLanguage, englishOf } from '../../scripts/i18n-terms.mjs';
import { LANGUAGES, LOGICAL_LAYOUT, LONG_TEXT_CODE, direction, findLanguage, isSelectable, matchSystem, resolveLanguage, searchLanguages, selectableLanguages } from '../../src/shared/i18n/languages';
import { currentLanguage, intlLocale, pluralKeyOf, keyOf, setLanguage, tr, trPlural, type Catalog, type Entry } from '../../src/shared/i18n/tr';
import { LONG_TEXT_FACTOR, longText, skippedTr, visibleLength } from '../../src/shared/i18n/long-text';

const readChunk = (code: string, chunk: string): FileCatalog => JSON.parse(fs.readFileSync(chunkPath(code, chunk), 'utf8')) as FileCatalog;
const en = readLanguage('en') as Catalog;
const langs = languageDirs().filter((c: string) => c !== 'en');
// {placeholders} and trJsx parts (<link>…</link>, <cmd/>) must match the English, name for name
const holders = (s: string): string[] => [...[...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]), ...[...s.matchAll(/<(\w+)\/?>/g)].map((m) => `<${m[1]}>`)].sort();
const forms = (e: Entry): string[] => (typeof e === 'string' ? [e] : Object.values(e).filter((v): v is string => typeof v === 'string'));
const some = <T,>(xs: T[]): Array<T | '(none yet)'> => (xs.length ? xs : ['(none yet)']);

afterEach(() => setLanguage('en'));

// ─── A small .gitignore reader (the patterns this repository uses: globs, dir/, /anchored, !negation) ───
interface IgnoreRule { raw: string; neg: boolean; re: RegExp }
function parseIgnore(text: string): IgnoreRule[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((raw) => {
    const neg = raw.startsWith('!');
    let p = neg ? raw.slice(1) : raw;
    const dir = p.endsWith('/');
    if (dir) p = p.slice(0, -1);
    const anchored = p.startsWith('/') || p.includes('/');
    p = p.replace(/^\//, '');
    const glob = p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*');
    const head = anchored ? '^' : '(^|/)';
    return { raw, neg, re: new RegExp(`${head}${glob}${dir ? '/' : '(/|$)'}`) };
  });
}
function ignoredBy(rel: string, rules: IgnoreRule[]): string | null {
  let hit: string | null = null;
  for (const r of rules) if (r.re.test(rel)) hit = r.neg ? null : r.raw;
  return hit;
}

describe('i18n: the English catalogue', () => {
  it('the English chunks are up to date with the source (node scripts/i18n-extract.mjs)', () => {
    const { chunks, errors } = extract();
    expect(errors, 'tr() calls the script cannot read').toEqual([]);
    for (const c of CHUNKS) expect(fs.readFileSync(chunkPath('en', c), 'utf8'), `en/${c}.json`).toBe(serialise(chunks[c]));
  });

  it('only the three chunks exist, in every language folder', () => {
    for (const code of languageDirs()) {
      const files = fs.readdirSync(path.join(LOCALES, code)).sort();
      expect(files, code).toEqual(CHUNKS.map((c: string) => `${c}.json`).sort());
    }
    expect(fs.readdirSync(LOCALES).filter((f) => !fs.statSync(path.join(LOCALES, f)).isDirectory()), 'loose files in locales/').toEqual([]);
  });

  it('sentences go to the chunk of their folder', () => {
    expect(chunkOf('src/renderer/src/screens/Home.tsx')).toBe('screens');
    expect(chunkOf('src/core/session/state.ts')).toBe('core');
    expect(chunkOf('src/shared/format.ts')).toBe('core');
    expect(chunkOf('src/main/services/connection.ts')).toBe('main');
  });

  it('the extractor reads tr(), context tags and plurals, and refuses a built sentence', () => {
    const tmp = path.join(os.tmpdir(), `i18n-probe-${process.pid}.tsx`);
    fs.writeFileSync(tmp, [
      "const a = tr('The VPN service is off.');",
      "const b = tr('Switching to {place}…', { place });",
      "const c = tr('Open', undefined, 'menu');",
      "const d = trPlural({ one: '{n} server', other: '{n} servers' }, n);",
      'const e = tr(`Built ${x}`);',
      "const f = <p className=\"ml-2 text-right\">Not connected</p>;",
      "console.log('Logs stay English always');",
    ].join('\n'));
    try {
      const r = scanFile(tmp);
      expect(r.keys.map((k) => k.key)).toEqual(['The VPN service is off.', 'Switching to {place}…', keyOf('Open', 'menu'), pluralKeyOf('{n} servers')]);
      expect(r.errors).toHaveLength(1);
      expect(r.candidates.map((c) => c.text)).toEqual(['Not connected']);
      expect(r.physical.map((p) => p.token)).toEqual(['ml-2', 'text-right']);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('--all lists every sentence with where it is, and a word-frequency list', () => {
    const { sentences, words } = allSentences();
    expect(sentences.length).toBeGreaterThan(500);
    expect(sentences.every((s) => s.at.length > 0 && s.at.every((a) => /:\d+$/.test(a)))).toBe(true);
    expect(sentences.map((s) => s.text)).toEqual([...sentences.map((s) => s.text)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(words.length).toBeGreaterThan(100);
    expect(words[0][1]).toBeGreaterThanOrEqual(words[words.length - 1][1]);
  });

  it('safety sentences are tagged (money, refund, recovery phrase, kill switch, blocked internet)', () => {
    expect(safetyTags('Your deposit with this server can no longer be used, so nothing new was paid.')).toEqual(['money']);
    expect(safetyTags('Claim the refund now.')).toEqual(['refund']);
    expect(safetyTags('Write down your recovery phrase.')).toEqual(['recovery-phrase']);
    expect(safetyTags('The kill switch keeps the internet blocked.')).toEqual(['blocked-internet', 'kill-switch']);
    expect(safetyTags('Pick a server.')).toEqual([]);
    expect(safetyTags('Done', "x = tr('Done'); // i18n:safety=refund")).toEqual(['refund']);
    expect(safetyTags('Done', '', 'money-button')).toEqual(['money']);
  });

  it('left/right classes are told apart from start/end and symmetric ones', () => {
    for (const t of ['ml-2', '-mr-1', 'pl-3', 'md:pr-4', 'left-0', 'right-2', 'border-l', 'border-r-2', 'rounded-l-lg', 'rounded-tr', 'text-left', 'hover:text-right', 'float-left']) expect(isPhysicalClass(t), t).toBe(true);
    for (const t of ['ms-2', 'me-1', 'ps-3', 'pe-4', 'start-0', 'end-2', 'border-s', 'rounded-s-lg', 'text-start', 'mx-2', 'px-3', 'inset-x-0', 'border', 'rounded-lg', 'leading-tight', 'line-clamp-2']) expect(isPhysicalClass(t), t).toBe(false);
  });
});

describe('i18n: every language', () => {
  // Switched on (rc.4, owner: "include the translated languages as they are"): a missing entry shows its English
  // sentence (tr falls back), so a few are listed, not failed. More than 10% of a chunk missing means the language
  // is not translated enough to switch on (screens, core). Extras are never looked up (listed). Switched off: listed only.
  const MAX_MISSING_SHARE = 0.1;
  it.each(some(langs))('%s: each chunk holds the entries of the English chunk (a switched-on one misses at most 10%%)', (code) => {
    if (code === '(none yet)') return;
    const on = !!findLanguage(code)?.enabled;
    const diff: string[] = [];
    for (const c of CHUNKS) {
      const want = readChunk('en', c);
      const got = fs.existsSync(chunkPath(code, c)) ? readChunk(code, c) : {};
      const missing = Object.keys(want).filter((k) => !(k in got));
      const extra = Object.keys(got).filter((k) => !(k in want));
      // main: its keys grew with the engine wrap (b0197314) after the last re-key; listed until "main final" is sent.
      if (on && c !== 'main') expect(missing.length, `${code}/${c}: ${missing.length} of ${Object.keys(want).length} missing`).toBeLessThanOrEqual(Math.floor(Object.keys(want).length * MAX_MISSING_SHARE));
      if (missing.length || extra.length) diff.push(`${c}: ${missing.length} missing (shown in English), ${extra.length} not in English`);
    }
    if (diff.length) console.warn(`[i18n gate] ${code} (${on ? 'on' : 'switched off'}): ${diff.join('; ')}`);
  });

  it.each(some(langs))('%s: keys sorted like English (stable diffs)', (code) => {
    if (code === '(none yet)') return;
    for (const c of CHUNKS) {
      if (!fs.existsSync(chunkPath(code, c))) continue;
      expect(fs.readFileSync(chunkPath(code, c), 'utf8'), `${code}/${c}.json`).toBe(serialise(readChunk(code, c)));
      const keys = Object.keys(readChunk(code, c));
      expect(keys, `${code}/${c}.json order`).toEqual([...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    }
  });

  it.each(some(langs))('%s: placeholders, plural forms and empty entries', (code) => {
    if (code === '(none yet)') return;
    const rules = new Intl.PluralRules(intlLocale(code));
    const cats = new Set(rules.resolvedOptions().pluralCategories);
    // the forms a whole count can land on (counts here are whole numbers; 'many' in fr/es/pt/it is only for millions)
    const needed = [...new Set([...Array(1001).keys()].map((n) => rules.select(n)))];
    const bad: string[] = [];
    for (const [k, v] of Object.entries(readLanguage(code) as Catalog)) {
      const want = en[k];
      if (want === undefined) continue;
      const english = holders(typeof want === 'string' ? want : want.other);
      if ((typeof want === 'string') !== (typeof v === 'string')) { bad.push(`${k}: plural and plain mixed`); continue; }
      if (typeof v !== 'string') {
        if (!v.other) bad.push(`${k}: no 'other' form`);
        for (const c of Object.keys(v)) if (!cats.has(c as Intl.LDMLPluralRule)) bad.push(`${k}: form '${c}' does not exist in ${code}`);
        // a missing form falls back to 'other' and reads wrong (ru "2 серверов"): every form a count can reach is required
        for (const c of needed) if (!(v as Record<string, string | undefined>)[c]?.trim()) bad.push(`${k}: form '${c}' is missing (${code} needs ${needed.join(', ')})`);
      }
      for (const s of forms(v)) {
        if (!s.trim()) continue; // empty = English for now; counted by the completeness check below
        // the {n} count may be dropped in a singular form ("one server" in words), never invented
        const got = holders(s);
        const ok = typeof v === 'string' ? got.join() === english.join() : got.every((h) => english.includes(h)) && english.filter((h) => h !== 'n').every((h) => got.includes(h));
        if (!ok) bad.push(`${k}: placeholders ${got.join(',') || '-'} vs English ${english.join(',') || '-'}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('only known languages have a folder', () => {
    expect(langs.filter((c: string) => !findLanguage(c))).toEqual([]);
  });

  it('a language that is switched on is nearly complete: at most 10% of the entries missing or empty (shown in English)', () => {
    for (const l of LANGUAGES.filter((x) => x.enabled && x.code !== 'en')) {
      expect(langs, `${l.code} is switched on without files`).toContain(l.code);
      const own = readLanguage(l.code) as Catalog;
      const empty = Object.keys(en).filter((k) => !own[k] || forms(own[k]).some((s) => !s.trim()));
      expect(empty.length, `${l.code}: ${empty.length} of ${Object.keys(en).length} untranslated`).toBeLessThanOrEqual(Math.floor(Object.keys(en).length * 0.1));
    }
  });
});

describe('i18n: right to left', () => {
  const renderer = sourceFiles().filter((f) => folderOf(rel(f)) === 'screens');
  const physical = (): string[] => renderer.flatMap((f) => scanFile(f).physical.map((p) => `${rel(f)}:${p.line} ${p.token}`));

  it('no right-to-left language is switched on before the layout uses start/end spacing', () => {
    const rtlOn = LANGUAGES.filter((l) => l.rtl && l.enabled).map((l) => l.code);
    if (!LOGICAL_LAYOUT) expect(rtlOn, 'set LOGICAL_LAYOUT only after B4').toEqual([]);
    if (rtlOn.length || LOGICAL_LAYOUT) expect(physical(), 'left/right classes left in the screens').toEqual([]);
  });

  it('a right-to-left language is never selectable, and the page stays left to right, without the layout', () => {
    const fa = { ...findLanguage('fa')!, enabled: true };
    expect(isSelectable(fa, false)).toBe(false);
    expect(isSelectable(fa, true)).toBe(true);
    expect(direction('fa', false)).toBe('ltr');
    expect(direction('fa', true)).toBe('rtl');
    expect(resolveLanguage('fa', [], false)).toBe('en');
    expect(resolveLanguage('fa', [], true)).toBe('fa');
  });

  it('the five right-to-left languages are marked', () => {
    expect(LANGUAGES.filter((l) => l.rtl).map((l) => l.code).sort()).toEqual(['ar', 'ckb', 'fa', 'ps', 'ur']);
  });
});

describe('i18n: choosing the language', () => {
  it('a switched-off language still loads when the saved setting names it', () => {
    const it = findLanguage('it')!;
    expect(it.enabled).toBe(false);
    expect(resolveLanguage('it', ['de-DE'])).toBe('it');
    setLanguage('it', { 'Not connected': 'Non connesso' });
    expect(tr('Not connected')).toBe('Non connesso');
    expect(currentLanguage()).toBe('it');
  });

  it('no saved choice: the system language if it is switched on, else English', () => {
    expect(resolveLanguage(null, ['xx-YY'])).toBe('en');
    expect(resolveLanguage(undefined, ['de-DE'])).toBe(findLanguage('de')!.enabled ? 'de' : 'en');
    expect(resolveLanguage('nonsense', [])).toBe('en');
  });

  it('system tags map onto ours', () => {
    expect(matchSystem('zh-CN')?.code).toBe('zh-Hans');
    expect(matchSystem('zh-Hant-HK')?.code).toBe('zh-Hant');
    expect(matchSystem('zh_TW')?.code).toBe('zh-Hant');
    expect(matchSystem('pt-PT')?.code).toBe('pt');
    expect(matchSystem('ku')?.code).toBe('kmr');
    expect(matchSystem('ku-Arab-IQ')?.code).toBe('ckb');
    expect(matchSystem('tl-PH')?.code).toBe('fil');
    expect(matchSystem('fa-IR')?.code).toBe('fa');
  });

  it('the selector search finds a language by code, label, own name and English name', () => {
    const all = [...LANGUAGES];
    expect(searchLanguages('fa', all)[0].code).toBe('fa');
    expect(searchLanguages('فار', all)[0].code).toBe('fa');
    expect(searchLanguages('korean', all)[0].code).toBe('ko');
    expect(searchLanguages('ku', all)[0].code).toBe('kmr');
    expect(searchLanguages('', all)).toHaveLength(50);
    expect(searchLanguages('zzzz', all)).toEqual([]);
  });

  it('only switched-on languages are offered', () => {
    expect(selectableLanguages().every((l) => l.enabled && (!l.rtl || LOGICAL_LAYOUT))).toBe(true);
    expect(selectableLanguages().map((l) => l.code)).toContain('en');
  });
});

describe('i18n: tr()', () => {
  it('falls back to English for a missing, empty or unknown entry', () => {
    setLanguage('de', { 'Connect': 'Verbinden', 'Disconnect': '' });
    expect(tr('Connect')).toBe('Verbinden');
    expect(tr('Disconnect')).toBe('Disconnect');
    expect(tr('Never translated')).toBe('Never translated');
  });

  it('fills placeholders and leaves an unknown one visible', () => {
    setLanguage('de', { 'Switching to {place}…': 'Wechsel nach {place}…' });
    expect(tr('Switching to {place}…', { place: 'Berlin' })).toBe('Wechsel nach Berlin…');
    expect(tr('Paid {amount} to {who}', { amount: 3 })).toBe('Paid 3 to {who}');
  });

  it('keeps one-word entries with a context tag apart', () => {
    setLanguage('de', { [keyOf('Open', 'menu')]: 'Öffnen', [keyOf('Open', 'status')]: 'Offen' });
    expect(tr('Open', undefined, 'menu')).toBe('Öffnen');
    expect(tr('Open', undefined, 'status')).toBe('Offen');
    expect(tr('Open')).toBe('Open');
  });

  it('chooses the plural form by the language rules', () => {
    const f = { one: '{n} server', other: '{n} servers' };
    expect(trPlural(f, 1)).toBe('1 server');
    expect(trPlural(f, 3)).toBe('3 servers');
    setLanguage('ar', { [pluralKeyOf('{n} servers')]: { zero: 'لا خوادم', one: 'خادم واحد', two: 'خادمان', few: '{n} خوادم', many: '{n} خادمًا', other: '{n} خادم' } });
    expect(trPlural(f, 0)).toBe('لا خوادم');
    expect(trPlural(f, 2)).toBe('خادمان');
    expect(trPlural(f, 5)).toMatch(/^⁨[5٥]⁩ خوادم$/); // the digit as the language writes it, isolated (B5)
    expect(trPlural(f, 100)).toMatch(/ خادم$/);
  });
});

describe('i18n: the language list', () => {
  it('50 languages, unique codes, own names and labels', () => {
    expect(LANGUAGES).toHaveLength(50);
    expect(new Set(LANGUAGES.map((l) => l.code)).size).toBe(50);
    for (const l of LANGUAGES) {
      expect(l.own.trim(), l.code).not.toBe('');
      expect(l.label, l.code).toMatch(/^[A-Z]{2,3}$/);
    }
    expect(LANGUAGES.find((l) => l.code === LONG_TEXT_CODE)).toBeUndefined();
  });

  it('every flag is in the bundled flag set; no-country languages show a plain tile', () => {
    const dir = path.join(ROOT, 'node_modules', 'flag-icons', 'flags', '4x3');
    for (const l of LANGUAGES) if (l.flag) expect(fs.existsSync(path.join(dir, `${l.flag}.svg`)), `${l.code}: ${l.flag}`).toBe(true);
    expect(LANGUAGES.filter((l) => !l.flag).map((l) => l.code).sort()).toEqual(['ckb', 'kmr', 'pcm']);
  });
});

describe('i18n: the long-text test language', () => {
  it('every sentence comes out at least 40% longer, numbers and addresses kept', () => {
    for (const s of ['Not connected', 'Pay any server directly. No accounts, no company in the middle.', 'Paid 1.25 tDVPN to 9enW4xCJ', 'OK']) {
      const out = longText(s);
      expect(visibleLength(out), s).toBeGreaterThanOrEqual(Math.ceil(visibleLength(s) * LONG_TEXT_FACTOR));
    }
    expect(longText('Paid 1.25 tDVPN')).toContain('1.25');
  });

  it('a word on screen in en-XL with a plain vowel skipped tr(); names and numbers are not counted', () => {
    expect(skippedTr(longText('Pick a server or use quick connect.'))).toEqual([]);
    expect(skippedTr('Pick a server')).toEqual(['Pick', 'server']);
    expect(skippedTr(longText('Connect to Solana over WireGuard for 1.25 tDVPN'))).toEqual([]);
    expect(skippedTr('Solana WireGuard tDVPN 9enW4xCJ 1.25')).toEqual([]);
  });

  it('tr() in en-XL stretches every sentence after filling it', () => {
    setLanguage(LONG_TEXT_CODE);
    const out = tr('Switching to {place}…', { place: 'Berlin' });
    expect(visibleLength(out)).toBeGreaterThanOrEqual(Math.ceil('Switching to Berlin…'.length * LONG_TEXT_FACTOR));
    expect(resolveLanguage(LONG_TEXT_CODE)).toBe(LONG_TEXT_CODE);
  });
});

describe('i18n: the term check', () => {
  it('lists a translated sentence whose English has the term and whose translation lacks the chosen word', () => {
    const english = { 'Connect to a server.': 'Connect to a server.', 'Disconnect now.': 'Disconnect now.', [keyOf('Open', 'menu')]: 'Open' };
    const own = { 'Connect to a server.': 'Mit einem Server koppeln.', 'Disconnect now.': 'Jetzt trennen.', [keyOf('Open', 'menu')]: '' };
    const sheet = { language: 'de', terms: [
      { id: 'connect', en: ['connect'], word: 'verbinden', forms: ['Verbindung'], status: 'confirmed' as const },
      { id: 'disconnect', en: ['disconnect'], word: 'trennen', status: 'unconfirmed' as const },
    ] };
    const r = checkLanguage('de', sheet, english, own);
    expect(r.misses.map((m) => m.term)).toEqual(['connect']); // 'connect' is a whole word: not matched inside "Disconnect"
    expect(r.unconfirmed).toEqual(['disconnect']);
    expect(englishOf(keyOf('Open', 'menu'))).toBe('Open');
  });
});

describe('i18n: every language file reaches the repository', () => {
  // A .gitignore line meant for key files (a file named like a language code) once hid a language's
  // file from a wildcard `git add`. Every expected file of every language must be tracked.
  const expected = LANGUAGES.flatMap((l) => [
    `docs/i18n/terms/${l.code}.json`,
    ...CHUNKS.map((c: string) => `src/shared/i18n/locales/${l.code}/${c}.json`),
  ]);
  const existing = expected.filter((p) => fs.existsSync(path.join(ROOT, p)));
  const tracked = ((): Set<string> | null => {
    try {
      if (fs.existsSync(path.join(ROOT, '.git'))) return new Set(execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n'));
    } catch (err) {
      console.warn(`[i18n gate] git ls-files failed: ${(err as Error).message}`);
    }
    const list = process.env.I18N_TRACKED; // a `git ls-files` output, for a copy of the tree without .git
    return list && fs.existsSync(list) ? new Set(fs.readFileSync(list, 'utf8').split(/\r?\n/)) : null;
  })();

  it('the .gitignore reader matches like git does on the patterns we use', () => {
    const rules = parseIgnore('node_modules/\n*.key\nid.json\n/results/\n!docs/i18n/terms/id.json\n');
    expect(ignoredBy('docs/i18n/terms/id.json', rules)).toBeNull();
    expect(ignoredBy('src/shared/i18n/locales/id/core.json', rules)).toBeNull();
    expect(ignoredBy('keys/id.json', rules)).toBe('id.json');
    expect(ignoredBy('a/b.key', rules)).toBe('*.key');
    expect(ignoredBy('results/x.txt', rules)).toBe('/results/');
    expect(ignoredBy('src/results/x.txt', rules)).toBeNull();
  });

  it.skipIf(!tracked)('every expected language file that exists is tracked', () => {
    expect(existing.filter((p) => !tracked!.has(p)), 'not in git: add the path by name').toEqual([]);
  });

  it('no expected language file is hidden by .gitignore (unless git already tracks it)', () => {
    const rules = parseIgnore(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8'));
    const hidden = expected.map((p) => [p, ignoredBy(p, rules)] as const).filter(([p, r]) => r && !(tracked?.has(p)));
    if (!tracked) {
      if (hidden.length) console.warn(`\n[i18n gate] no git here: these language files would be hidden by .gitignore (check them with git on the laptop):\n  ${hidden.map(([p, r]) => `${p} (by "${r}")`).join('\n  ')}\n`);
      return;
    }
    expect(hidden.map(([p, r]) => `${p} (by "${r}")`)).toEqual([]);
  });
});

describe('i18n: no banned names in the language work', () => {
  const r = scan();
  if (r.skipped) console.warn(`\n[i18n gate] BANNED-NAME CHECK SKIPPED: no list at ${LIST_PATH} (set I18N_BANNED_LIST)\n`);
  else if (r.listed.length) console.warn(`\n[i18n gate] banned names in older files (listed, not failed):\n  ${r.listed.join('\n  ')}\n`);

  it.skipIf(r.skipped)('the language work and the changed lines carry none', () => {
    expect(r.fail).toEqual([]);
  });

  it('scope and diff reading', () => {
    expect(inScope('src/shared/i18n/locales/fa/core.json')).toBe(true);
    expect(inScope('scripts/i18n-extract.mjs')).toBe(true);
    expect(inScope('tests/unit/i18n-gates.test.ts')).toBe(true);
    expect(inScope('docs/i18n/TERMS.md')).toBe(true);
    expect(inScope('src/main/services/connection.ts')).toBe(false);
    const diff = ['+++ b/src/x.ts', '@@ -3,0 +4,2 @@', '+one', '+two', '+++ b/src/y.ts', '@@ -1 +1 @@', '-old', '+new'].join('\n');
    expect(addedLines(diff)).toEqual([{ file: 'src/x.ts', line: 4, text: 'one' }, { file: 'src/x.ts', line: 5, text: 'two' }, { file: 'src/y.ts', line: 1, text: 'new' }]);
  });
});
