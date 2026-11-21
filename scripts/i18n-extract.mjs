// ─── i18n-extract — the English catalogue from the source, and the sentence census ───
// Reads every tr('…') / trPlural({…}) call in src/ with the TypeScript parser and writes the
// English catalogue in three chunks by where the sentence comes from:
//   src/shared/i18n/locales/en/{screens,core,main}.json
// Every language has the same three files (locales/<code>/<chunk>.json), so several sessions can
// translate one language's chunks, or different languages, without touching the same file. Keys are
// sorted, so the output is the same every run and two sessions wrapping different files never need
// a hand merge: re-run the script.
//   node scripts/i18n-extract.mjs            write the English chunks
//   node scripts/i18n-extract.mjs --check    exit 1 if they are out of date (gate test)
//   node scripts/i18n-extract.mjs --sync     move every language's entries into the chunk English has
//                                            them in, drop entries English no longer has (listed)
//   node scripts/i18n-extract.mjs --all      every sentence a person sees (wrapped or not) with file:line,
//                                            plus a word-frequency list (JSON; the terminology check)
//   node scripts/i18n-extract.mjs --census   sentences still unwrapped, per folder (JSON)
//   node scripts/i18n-extract.mjs --short    one- and two-word keys with no context tag (review list)
//   node scripts/i18n-extract.mjs --unwrapped <file…>   sentences in those files not passed through tr()
// Rules for wrapping: docs/i18n/RULES-CODE.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LOCALES = path.join(ROOT, 'src', 'shared', 'i18n', 'locales');
/** Chunk order = priority: a sentence used in two places lives in the first chunk that uses it. */
export const CHUNKS = ['screens', 'core', 'main'];
export const chunkPath = (code, chunk) => path.join(LOCALES, code, `${chunk}.json`);
/** The chunk a source file's sentences go to. */
export function chunkOf(relPath) {
  if (relPath.startsWith('src/renderer/')) return 'screens';
  if (relPath.startsWith('src/core/') || relPath.startsWith('src/shared/')) return 'core';
  return 'main';
}
const CONTEXT_SEP = '\u0004';
const PLURAL_SEP = '\u0005plural';
const PLURAL_CATS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

// ─── Files ───
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|cjs|js)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

export const rel = (file) => path.relative(ROOT, file).replace(/\\/g, '/');

/** The folder a file is counted under (plan B1 check 1). */
export function folderOf(relPath) {
  if (/^src\/main\/dev\/|^src\/renderer\/src\/components\/(Gallery|gallery-fixtures)/.test(relPath)) return 'dev';
  if (relPath.startsWith('src/renderer/')) return 'screens';
  if (relPath.startsWith('src/core/')) return 'core';
  if (relPath.startsWith('src/shared/i18n/')) return 'i18n';
  if (relPath.startsWith('src/shared/')) return 'shared';
  if (relPath.startsWith('src/main/') || relPath.startsWith('src/preload/')) return 'main';
  if (relPath.startsWith('src/cli/')) return 'cli';
  if (relPath.startsWith('scripts/')) return 'scripts';
  return 'other';
}

export function sourceFiles() {
  return [...walk(path.join(ROOT, 'src')).filter((f) => /\.(ts|tsx)$/.test(f)), ...walk(path.join(ROOT, 'scripts'))];
}

// ─── What counts as a sentence a person sees ───
// JSX attributes whose value is shown; everything else on an element (className, data-*, id …) is code.
const VISIBLE_ATTR = /^(title|placeholder|alt|label|hint|tip|text|message|caption|heading|subtitle|description|detail|body|confirm\w*|cancel\w*|empty\w*|aria-(label|description|valuetext|roledescription))$/i;
// Object keys whose string value is shown (copy tables, toasts, status cards).
const VISIBLE_KEY = /^(title|label|hint|tip|text|message|detail|details|body|caption|heading|subtitle|description|summary|reason|action|actionLabel|cta|button|placeholder|empty|note|help|why|fix|what|line|headline|sub|short|long)$/;
const LOG_OBJ = /^(console|log|logger|LOG|dlog|elog)$/;
const LOG_FN = /^(log|logLine|logInfo|logWarn|logError|debug|trace)$/;
const TAILWIND_TOKEN = /^!?-?[a-z0-9]+(?:[:\-/.][a-z0-9\[\]().%#,_'-]*)*$/;

export function hasLetter(s) { return /\p{L}/u.test(s); }
export function looksLikeClassList(s) { const toks = s.trim().split(/\s+/); return toks.length > 0 && toks.every((t) => TAILWIND_TOKEN.test(t)); }
export function looksLikeCode(s) {
  const t = s.trim();
  return /^(https?:|wss?:|file:|\/|\.\.?\/|[A-Za-z]:\\|#[0-9a-f]{3,8}$|--?[a-z]|[a-z]+\.[a-z]+\(|<|\{\s*"|\[)/i.test(t)
    || /^[a-z][a-z0-9]*([._:-][a-z0-9]+)+$/.test(t) // keys, channels, codes: nav.home, wallet:get, open-deposit
    || /^[A-Z0-9_]+$/.test(t) // CONSTANTS, codes
    || /^[\w-]+=[^\s]*$/.test(t)
    || /\$\{|\b(SELECT|INSERT|UPDATE)\b.*\b(FROM|INTO|SET)\b/.test(t)
    // shell and PowerShell lines, filters, SVG path data: machine text, never a sentence
    || /\b(Write-Host|Write-Output|Get-[A-Z]\w+|Set-[A-Z]\w+|New-[A-Z]\w+|Remove-[A-Z]\w+|Start-Process|Stop-Process|Test-Path|ForEach-Object|Where-Object|Select-Object)\b|-ErrorAction\b|\$env:|\$\w+\s*=|\$\(|\$_\.|\bIMAGENAME\s+eq\b|\btasklist\b|\btaskkill\b|\bnetsh\b|\bsc\.exe\b|\breg (add|query|delete)\b|\/FI\s|\s\|\s*\w/.test(t)
    || (/^[MmZzLlHhVvCcSsQqTtAa\d\s,.\-]+$/.test(t) && /\d/.test(t) && /^[Mm]/.test(t));
}
/** Prose: two or more words with letters, or one capitalised word in a place that is shown. */
export function isProse(s, shownPlace) {
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t || !hasLetter(t) || looksLikeCode(t) || looksLikeClassList(t)) return false;
  const words = t.split(' ').filter((w) => /\p{L}{2,}/u.test(w));
  if (words.length >= 2) return /^[\p{Lu}\p{N}'"“‘(«…•·—–-]|^\p{Ll}+ \p{L}/u.test(t) || shownPlace;
  return shownPlace && words.length === 1 && /^\p{Lu}/u.test(words[0]);
}

export function templateText(node) {
  if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let s = node.head.text;
    node.templateSpans.forEach((sp, i) => { s += `{${i + 1}}` + sp.literal.text; });
    return s;
  }
  return null;
}

export function calleeName(call) {
  const e = call.expression;
  if (ts.isIdentifier(e)) return { obj: null, fn: e.text };
  if (ts.isPropertyAccessExpression(e)) return { obj: ts.isIdentifier(e.expression) ? e.expression.text : null, fn: e.name.text };
  return { obj: null, fn: null };
}

export function inside(node, pred) {
  for (let p = node.parent; p; p = p.parent) if (pred(p)) return p;
  return null;
}

// Errors a person reads (src/shared/i18n/shown-error.ts): `new X('sentence', vars)` is read like tr('sentence', vars).
// Each class here extends ShownError (tests/unit/i18n-shown-error.test.ts checks it).
export const SHOWN_ERROR_CLASSES = ['ShownError', 'AmountError', 'ConfigError', 'ProviderError'];
const isShownErrorNew = (n) => ts.isNewExpression(n) && !!n.arguments && ts.isIdentifier(n.expression) && SHOWN_ERROR_CLASSES.includes(n.expression.text);
// said() / saidPlural() (src/shared/i18n/said.ts) keep a sentence to show later: read exactly like tr() / trPlural().
const SAID_AS = { said: 'tr', saidPlural: 'trPlural' };
export const isTrCall = (n) => isShownErrorNew(n) || (ts.isCallExpression(n) && ['tr', 'trPlural', 'trJsx', 'said', 'saidPlural'].includes(calleeName(n).fn ?? '') && calleeName(n).obj === null);
export const isLogCall = (n) => ts.isCallExpression(n) && (() => { const { obj, fn } = calleeName(n); return (obj && LOG_OBJ.test(obj)) || (!obj && fn && LOG_FN.test(fn)); })();

function parse(file) {
  const text = fs.readFileSync(file, 'utf8');
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  return { text, sf: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind) };
}

/**
 * One file: its tr() calls (keys), calls that cannot be read (errors), the sentences not passed
 * through tr() (candidates) and its left/right layout classes (physical).
 */
export function scanFile(file) {
  const { text, sf } = parse(file);
  return scanSource(sf, text);
}

/** Same as scanFile on an already parsed file (the wrap script passes a type-checked program's file). Each candidate carries its node (not enumerable). */
export function scanSource(sf, text = sf.text) {
  const file = sf.fileName;
  const lines = text.split('\n');
  const where = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const keys = [];
  const errors = [];
  const candidates = [];
  const physical = [];
  const compared = []; // sentences compared with === (a translated value would no longer match)

  const visit = (node) => {
    // tr('…', vars?, 'context'?)  /  trPlural({ one, other }, n, vars?, 'context'?)
    if (isTrCall(node)) {
      const shownError = isShownErrorNew(node);
      const called = shownError ? 'tr' : calleeName(node).fn;
      const fn = SAID_AS[called] ?? called;
      const [first] = node.arguments;
      const ctxArg = shownError ? undefined : node.arguments[fn === 'tr' ? 2 : 3]; // a ShownError's third argument is { cause }
      let context;
      if (ctxArg) {
        const c = templateText(ctxArg);
        if (c === null || ts.isTemplateExpression(ctxArg)) errors.push({ line: where(node), why: 'context tag must be a plain string' });
        else context = c;
      }
      if (fn !== 'trPlural') { // tr('…') and trJsx('… <part>…</part> …', parts): the sentence is the key
        if (!first || !(ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) errors.push({ line: where(node), why: 'tr() needs a plain string as its first argument (use {name} placeholders, not ${…})' });
        else keys.push({ key: context ? `${context}${CONTEXT_SEP}${first.text}` : first.text, value: first.text, context, line: where(node) });
      } else if (!first || !ts.isObjectLiteralExpression(first)) {
        errors.push({ line: where(node), why: 'trPlural() needs an object of plain strings ({ one, other })' });
      } else {
        const forms = {};
        for (const p of first.properties) {
          const name = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null;
          const val = ts.isPropertyAssignment(p) ? p.initializer : null;
          if (!name || !PLURAL_CATS.has(name) || !val || !(ts.isStringLiteral(val) || ts.isNoSubstitutionTemplateLiteral(val))) {
            errors.push({ line: where(node), why: 'trPlural() forms must be zero/one/two/few/many/other with plain strings' });
            continue;
          }
          forms[name] = val.text;
        }
        if (!forms.other) errors.push({ line: where(node), why: 'trPlural() needs an `other` form' });
        else keys.push({ key: (context ? `${context}${CONTEXT_SEP}${forms.other}` : forms.other) + PLURAL_SEP, value: forms, context, line: where(node) });
      }
      // A translated piece placed inside another sentence cannot be translated right (word order,
      // gender, case): each combination must be its own whole sentence; vars carry names/numbers/amounts.
      const varsArg = node.arguments[fn === 'tr' ? 1 : 2];
      let nested = false;
      const look = (n) => { if (nested) return; if (isTrCall(n)) { nested = true; return; } ts.forEachChild(n, look); };
      if (varsArg) look(varsArg);
      if (nested) errors.push({ line: where(node), why: 'a translated piece inside another sentence: write each combination as one whole sentence' });
      // Words the code itself reads must stay English: a file or folder name (path.join / path.resolve) and a
      // connect error's action (a routing key read by connectActionButton / closeAction).
      const up = node.parent;
      if (up && ts.isCallExpression(up) && up.arguments.includes(node) && /^(join|resolve)$/.test(calleeName(up).fn ?? '') && ['path', null].includes(calleeName(up).obj)) {
        errors.push({ line: where(node), why: 'tr() in a file path: a folder or file name is not translated' });
      }
      if (up && ts.isPropertyAssignment(up) && up.initializer === node && ts.isIdentifier(up.name) && up.name.text === 'action') {
        errors.push({ line: where(node), why: 'tr() as an action: the action is a routing key read in English (connectActionButton); translate its button label instead' });
      }
      return; // nothing inside a tr() call is a candidate
    }

    const lit = (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) ? templateText(node) : null;
    if (lit !== null) {
      const p = node.parent;
      const ln = where(node);
      // left/right layout classes (B4) and inline left/right styles
      if (/\bclassName\b|\bcn\(|\bclsx\(|\bcx\(/.test(lines[ln - 1] ?? '') || looksLikeClassList(lit)) {
        for (const tok of lit.split(/\s+/)) if (isPhysicalClass(tok)) physical.push({ line: ln, token: tok });
      }
      const skip = ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p)
        || ts.isLiteralTypeNode(p) || (ts.isPropertyAssignment(p) && p.name === node) || ts.isElementAccessExpression(p)
        || ts.isCaseClause(p) || (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(p.operatorToken.kind))
        || ts.isTaggedTemplateExpression(p) || inside(node, isLogCall) || inside(node, (n) => ts.isRegularExpressionLiteral(n))
        || (lines[ln - 1] ?? '').includes('copy:internal') || (lines[ln - 1] ?? '').includes('i18n:skip');
      if (!skip) {
        let shown = false;
        let kind = 'string';
        const attr = inside(node, ts.isJsxAttribute);
        if (attr) {
          const name = attr.name.getText(sf);
          if (!VISIBLE_ATTR.test(name)) return ts.forEachChild(node, visit);
          shown = true; kind = 'jsx-attr';
        } else if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && VISIBLE_KEY.test(p.name.text)) {
          shown = true; kind = 'copy';
        } else if (inside(node, (n) => ts.isNewExpression(n) && /Error$/.test(n.expression.getText(sf)))) {
          kind = 'error';
        } else if (inside(node, (n) => ts.isJsxExpression(n))) {
          shown = true; kind = 'jsx-expr';
        }
        if (isProse(lit, shown)) candidates.push(withNode({ line: ln, kind, text: lit.replace(/\s+/g, ' ').trim() }, node));
      } else if (ts.isBinaryExpression(p) && isProse(lit, false) && !inside(node, isLogCall)) {
        compared.push(withNode({ line: ln, kind: 'compared', text: lit }, node));
      }
    }
    if (ts.isJsxText(node)) {
      const t = node.text.replace(/\s+/g, ' ').trim();
      if (t && hasLetter(t) && !looksLikeCode(t)) candidates.push(withNode({ line: where(node), kind: 'jsx', text: t }, node));
    }
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && inside(node, (n) => ts.isJsxAttribute(n) && n.name.getText(sf) === 'style')) {
      if (/^(marginLeft|marginRight|paddingLeft|paddingRight|left|right|borderLeft\w*|borderRight\w*)$/.test(node.name.text)) physical.push({ line: where(node), token: `style.${node.name.text}` });
      if (node.name.text === 'textAlign' && /left|right/.test(node.initializer.getText(sf))) physical.push({ line: where(node), token: 'style.textAlign' });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { file: rel(file), keys, errors, candidates, physical, compared };
}

const withNode = (row, node) => Object.defineProperty(row, 'node', { value: node, enumerable: false });

// ─── Left/right layout classes (B4 turns these into start/end) ───
export function isPhysicalClass(token) {
  const base = token.replace(/^.*:/, '').replace(/^!/, '').replace(/^-/, '');
  return /^(m[lr]|p[lr]|scroll-m[lr]|scroll-p[lr])-/.test(base)
    || /^(left|right)-/.test(base)
    || /^border-[lr](-|$)/.test(base)
    || /^rounded-([lr]|[tb][lr])(-|$)/.test(base)
    || /^text-(left|right)$/.test(base)
    || /^(float|clear)-(left|right)$/.test(base)
    || /^origin-(top-|bottom-)?(left|right)$/.test(base)
    || /^(space|divide)-x-reverse$/.test(base);
}

// ─── The catalogue ───
const byKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function extract(files = sourceFiles()) {
  const cat = new Map();
  const errors = [];
  for (const f of files) {
    const r0 = rel(f);
    if (folderOf(r0) === 'i18n' || r0.startsWith('scripts/')) continue; // the function's own doc comments; tooling
    const r = scanFile(f);
    const chunk = chunkOf(r.file);
    for (const e of r.errors) errors.push(`${r.file}:${e.line}: ${e.why}`);
    for (const k of r.keys) {
      const prev = cat.get(k.key);
      if (prev && JSON.stringify(prev.value) !== JSON.stringify(k.value)) errors.push(`${r.file}:${k.line}: same key, different plural forms as ${prev.at}`);
      if (!prev) cat.set(k.key, { value: k.value, at: `${r.file}:${k.line}`, chunk });
      else if (CHUNKS.indexOf(chunk) < CHUNKS.indexOf(prev.chunk)) prev.chunk = chunk;
    }
  }
  const chunks = Object.fromEntries(CHUNKS.map((c) => [c, {}]));
  const catalog = {};
  for (const k of [...cat.keys()].sort(byKey)) {
    const e = cat.get(k);
    chunks[e.chunk][k] = e.value;
    catalog[k] = e.value;
  }
  return { catalog, chunks, errors };
}

export const serialise = (catalog) => JSON.stringify(catalog, null, 2) + '\n';

/** One language's entries, all chunks merged ({} when it has no files). */
export function readLanguage(code) {
  const out = {};
  for (const c of CHUNKS) {
    const p = chunkPath(code, c);
    if (fs.existsSync(p)) Object.assign(out, JSON.parse(fs.readFileSync(p, 'utf8')));
  }
  return out;
}

/** The languages that have a folder (English included). */
export function languageDirs() {
  if (!fs.existsSync(LOCALES)) return [];
  return fs.readdirSync(LOCALES, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(byKey);
}

/** Lay `code`'s entries out like English: same chunk per key, sorted; entries English lacks are dropped and returned. */
export function syncLanguage(code, chunks = extract().chunks) {
  const have = readLanguage(code);
  const dropped = Object.keys(have).filter((k) => !CHUNKS.some((c) => k in chunks[c])).sort(byKey);
  for (const c of CHUNKS) {
    const out = {};
    for (const k of Object.keys(chunks[c])) if (k in have) out[k] = have[k];
    fs.mkdirSync(path.dirname(chunkPath(code, c)), { recursive: true });
    fs.writeFileSync(chunkPath(code, c), serialise(out));
  }
  return dropped;
}

// ─── Safety sentences: every sentence is translated back once; these get a second translate-back ───
// Tagged from the English words, or by `// i18n:safety=<tag>` on the line, or a context tag that
// starts with one of these names ('money', 'refund' …).
export const SAFETY = {
  money: /\b(pay|pays|paid|paying|payment|deposit|deposits|price|prices|cost|costs|fee|fees|spend|spent|spending|balance|send|sent|withdraw\w*|top[- ]?up|tDVPN|SOL|lamports?|charge\w*|allowance|subscribe\w*|subscription)\b/i,
  refund: /\b(refund\w*|claim\w*|settle\w*|close (the|a|your) deposit)\b/i,
  'recovery-phrase': /\b(recovery phrase|secret (phrase|key)|private key|seed|mnemonic|key ?file|backup|back up|words? of your)\b/i,
  'kill-switch': /\bkill[- ]switch\b/i,
  'blocked-internet': /\b(block(s|ed|ing)?|restore network|leak\w*|unprotected|exposed|internet (is |stays )?(off|down|cut))\b/i,
};
export function safetyTags(text, line = '', context = '') {
  const tags = new Set(Object.entries(SAFETY).filter(([, re]) => re.test(text)).map(([k]) => k));
  for (const m of line.matchAll(/i18n:safety=([\w-]+)/g)) tags.add(m[1]);
  for (const k of Object.keys(SAFETY)) if (context && context.startsWith(k)) tags.add(k);
  return [...tags].sort();
}

// ─── Every sentence a person sees, wrapped or not (terminology check, B7b) ───
export function allSentences(files = sourceFiles()) {
  const map = new Map();
  const add = (text, at, folder, wrapped, tags = []) => {
    const e = map.get(text) ?? { text, at: [], folders: new Set(), wrapped: false, safety: new Set(safetyTags(text)) };
    e.at.push(at); e.folders.add(folder); e.wrapped ||= wrapped;
    for (const t of tags) e.safety.add(t);
    map.set(text, e);
  };
  for (const f of files) {
    const folder = folderOf(rel(f));
    if (!['screens', 'core', 'shared', 'main'].includes(folder)) continue;
    const r = scanFile(f);
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    for (const k of r.keys) for (const t of typeof k.value === 'string' ? [k.value] : Object.values(k.value)) add(t, `${r.file}:${k.line}`, folder, true, safetyTags(t, lines[k.line - 1], k.context));
    for (const c of r.candidates) add(c.text, `${r.file}:${c.line}`, folder, false, safetyTags(c.text, lines[c.line - 1]));
  }
  const sentences = [...map.values()].sort((a, b) => byKey(a.text, b.text)).map((e) => ({ ...e, folders: [...e.folders].sort(), safety: [...e.safety].sort() }));
  const freq = new Map();
  for (const s of sentences) for (const w of s.text.toLowerCase().replace(/\{\w+\}/g, ' ').match(/\p{L}[\p{L}'’-]*/gu) ?? []) freq.set(w, (freq.get(w) ?? 0) + 1);
  const words = [...freq.entries()].sort((a, b) => b[1] - a[1] || byKey(a[0], b[0]));
  return { sentences, words };
}

// ─── Census (B1 check 1) ───
export function census(files = sourceFiles()) {
  const by = {};
  const short = [];
  for (const f of files) {
    const r = scanFile(f);
    const folder = folderOf(r.file);
    const b = (by[folder] ??= { files: 0, filesWithText: 0, sentences: 0, unique: new Set(), wrapped: 0, physical: 0, byKind: {} });
    b.files += 1;
    if (r.candidates.length) b.filesWithText += 1;
    b.sentences += r.candidates.length;
    for (const c of r.candidates) { b.unique.add(c.text); b.byKind[c.kind] = (b.byKind[c.kind] ?? 0) + 1; }
    b.wrapped += r.keys.length;
    b.physical += r.physical.length;
    for (const k of r.keys) if (!k.context && typeof k.value === 'string' && k.value.trim().split(/\s+/).length <= 2) short.push(`${r.file}:${k.line}: ${k.value}`);
  }
  const rows = Object.fromEntries(Object.entries(by).sort().map(([k, v]) => [k, { ...v, unique: v.unique.size }]));
  return { rows, short };
}

/** Sentences in `files` a person sees that do not go through tr() (the per-file gate after B3). */
export function unwrapped(files) {
  return files.flatMap((f) => scanFile(path.resolve(ROOT, f)).candidates.map((c) => ({ file: rel(path.resolve(ROOT, f)), ...c })));
}

// ─── Run as a script ───
const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes('--census')) {
    process.stdout.write(JSON.stringify(census(), null, 2) + '\n');
  } else if (args.includes('--all')) {
    process.stdout.write(JSON.stringify(allSentences(), null, 2) + '\n');
  } else if (args.includes('--sync')) {
    const { chunks, errors } = extract();
    if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
    else for (const code of languageDirs().filter((c) => c !== 'en')) {
      const dropped = syncLanguage(code, chunks);
      console.log(`${code}: laid out like English${dropped.length ? `; dropped ${dropped.length} entries English no longer has:\n  ${dropped.join('\n  ')}` : ''}`);
    }
  } else if (args.includes('--short')) {
    for (const line of census().short) console.log(line);
  } else if (args.includes('--unwrapped')) {
    const rows = unwrapped(args.filter((a) => !a.startsWith('--')));
    for (const r of rows) console.log(`${r.file}:${r.line} [${r.kind}] ${r.text}`);
    process.exitCode = rows.length ? 1 : 0;
  } else {
    const { chunks, errors } = extract();
    if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
    const stale = CHUNKS.filter((c) => (fs.existsSync(chunkPath('en', c)) ? fs.readFileSync(chunkPath('en', c), 'utf8') : '') !== serialise(chunks[c]));
    if (args.includes('--check')) {
      if (stale.length) { console.error(`English chunks out of date (${stale.join(', ')}): run node scripts/i18n-extract.mjs`); process.exitCode = 1; }
    } else if (!errors.length) {
      for (const c of CHUNKS) {
        fs.mkdirSync(path.dirname(chunkPath('en', c)), { recursive: true });
        fs.writeFileSync(chunkPath('en', c), serialise(chunks[c]));
      }
      console.log(`en: ${CHUNKS.map((c) => `${c} ${Object.keys(chunks[c]).length}`).join(', ')} entries`);
    }
  }
}
