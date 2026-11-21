// ─── i18n-wrap — put every sentence a person sees through tr(), mechanically (B3) ───
// Uses the extract script's classifier on a type-checked program, so a value only goes into a
// sentence as a {placeholder} when its type is a string or a number. What it does:
//   JSX text                      →  {tr('…')}
//   JSX text with values          →  {tr('Paid {amount} to {server}.', { amount, server })}
//   shown attributes (title …)    →  title={tr('…')}
//   strings / templates in code   →  tr('…') / tr('Switching to {place}…', { place })
//   module constant  const X='…'  →  const X = (): string => tr('…');  and every X → X() (all files)
//   the import of tr is added (or merged into an existing import of the i18n module).
// Never touched: log lines, names and codes, class names, data-* values, test ids, the terminal
// (src/cli), dev pictures, words kept in every language (docs/i18n/RULES-CODE.md). A file where
// nothing applies stays byte-identical.
//   node scripts/i18n-wrap.mjs --dry    [paths…]   print what would change (old → new per edit)
//   node scripts/i18n-wrap.mjs --write  [paths…]   change the files
//   node scripts/i18n-wrap.mjs --report [paths…]   what it could not do safely, file:line + why
//   add --json for machine output. Paths = files or folders; default = the app folders.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { ROOT, rel, folderOf, scanSource, isTrCall, looksLikeCode } from './i18n-extract.mjs';

export const APP_FOLDERS = ['src/renderer', 'src/core', 'src/shared', 'src/main', 'src/preload'];
const I18N_DIR = path.join(ROOT, 'src', 'shared', 'i18n');
const KEPT_WORDS = /\b(Devnet dVPN|Devnet|dVPN|Sentinel|Solana|tDVPN|SOL|WireGuard|AmneziaWG|OpenVPN|V2Ray|Xray|VLESS|VMess|Trojan|Shadowsocks|Hysteria2?|TUIC|SOCKS5?|DNS|IPv[46]|IP|RPC|URL|CLI|LAN|VPN|OK|ID|GB|MB|KB|UTC)\b/g;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', middot: '·', rarr: '→', larr: '←', times: '×', bull: '•', copy: '©' };
// Elements that carry words inside a sentence (a sentence around one of these is split by markup).
const TEXT_TAGS = /^(b|strong|em|i|u|a|span|small|mark|code|kbd|Term|Link|Ext)$/;

// ─── Programs (types tell a string value from an element) ───
const programs = {};
function program(kind) {
  if (programs[kind]) return programs[kind];
  const cfg = path.join(ROOT, kind === 'web' ? 'tsconfig.web.json' : 'tsconfig.node.json');
  const host = { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n')); } };
  const parsed = ts.getParsedCommandLineOfConfigFile(cfg, {}, host);
  const p = ts.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, noEmit: true } });
  programs[kind] = { program: p, checker: p.getTypeChecker() };
  return programs[kind];
}
const kindFor = (relPath) => (relPath.startsWith('src/renderer/') ? 'web' : 'node');

// ─── Helpers ───
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const q = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').split(LS).join('\\u2028').split(PS).join('\\u2029')}'`;
const trCall = (key, vars) => `tr(${q(key)}${vars ? `, ${vars}` : ''})`;
const lineOf = (sf, pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
const isFnScope = (n) => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n)
  || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n) || ts.isConstructorDeclaration(n)
  || (ts.isPropertyDeclaration(n) && !(ts.getCombinedModifierFlags(n) & ts.ModifierFlags.Static));
function inFunction(node) { for (let p = node.parent; p; p = p.parent) if (isFnScope(p)) return true; return false; }
function within(node, pred) { for (let p = node.parent; p; p = p.parent) if (pred(p)) return p; return null; }
function hasJsx(n) {
  let found = false;
  const v = (x) => { if (found) return; if (ts.isJsxElement(x) || ts.isJsxSelfClosingElement(x) || ts.isJsxFragment(x)) { found = true; return; } ts.forEachChild(x, v); };
  v(n);
  return found;
}
/** Only kept words (names, units) and no other word: never wrapped. */
const keptOnly = (text) => !/\p{L}{2,}/u.test(text.replace(KEPT_WORDS, ' '));
const looksLikeCommand = (text) => /(^|\s)--[a-z][\w-]*/.test(text) && /devnet-dvpn|daemon|\bnpm\b|\bnode\b/.test(text);

/** JSX text as React renders it (lines trimmed and joined by one space; entities decoded). null = an unknown entity. */
function jsxValue(raw) {
  const lines = raw.split(/\r\n|\n|\r/);
  const kept = [];
  lines.forEach((line, i) => {
    let l = line.replace(/\t/g, ' ');
    if (i !== 0) l = l.replace(/^ +/, '');
    if (i !== lines.length - 1) l = l.replace(/ +$/, '');
    if (l) kept.push(l);
  });
  let bad = false;
  const out = kept.join(' ').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    if (e in ENTITIES) return ENTITIES[e];
    bad = true;
    return m;
  });
  return bad ? null : out;
}

function typeOk(t) {
  if (t.isUnion()) return t.types.every(typeOk);
  return !!(t.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BigIntLike));
}

// Placeholder names tell the translator what goes there: the variable or property, the argument
// of a formatter (tdvpn(s.spent) → spent), the first side of a || / ?? / ternary.
const FORMATTER = /^(BigInt|format\w*|fmt\w*|short\w*|tdvpn\w*|sol\w*|String|Number|countryName|protocolLabel|plural\w*|round|abs|toFixed|toLocaleString|toString|trim)$/;
function nameFor(e) {
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  if (ts.isCallExpression(e)) {
    const callee = ts.isPropertyAccessExpression(e.expression) ? e.expression.name.text : ts.isIdentifier(e.expression) ? e.expression.text : '';
    if (FORMATTER.test(callee) && e.arguments[0]) { const n = nameFor(e.arguments[0]); if (n !== 'value') return n; }
    if (FORMATTER.test(callee) && ts.isPropertyAccessExpression(e.expression)) return nameFor(e.expression.expression);
    return nameFor(e.expression);
  }
  if (ts.isBinaryExpression(e)) { const n = nameFor(e.left); return n !== 'value' ? n : nameFor(e.right); }
  if (ts.isConditionalExpression(e)) { const n = nameFor(e.whenTrue); return n !== 'value' ? n : nameFor(e.whenFalse); }
  if (ts.isElementAccessExpression(e) || ts.isNonNullExpression(e) || ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) return nameFor(e.expression);
  return 'value';
}

// ─── Per-file state ───
function open(abs) {
  const r = rel(abs);
  const { program: prog, checker } = program(kindFor(r));
  const sf = prog.getSourceFile(abs);
  if (!sf) return null;
  return { abs, r, sf, text: sf.text, checker, scan: scanSource(sf, sf.text), edits: [], hand: [], constants: [], pending: [], converted: new Set(), wrapped: 0 };
}

function addEdit(st, start, end, out, what) {
  st.edits.push({ start, end, text: out, line: lineOf(st.sf, start), what, old: st.text.slice(start, end) });
}
const handAt = (st, node, why, t) => st.hand.push({ line: lineOf(st.sf, node.getStart(st.sf)), why, text: t });

/** A node's source with the edits already planned inside it folded in (and removed from the list). */
function render(st, node) {
  const s = node.getStart(st.sf);
  const e = node.end;
  const inner = st.edits.filter((x) => x.start >= s && x.end <= e).sort((a, b) => b.start - a.start);
  let out = st.text.slice(s, e);
  for (const x of inner) { out = out.slice(0, x.start - s) + x.text + out.slice(x.end - s); st.edits.splice(st.edits.indexOf(x), 1); }
  return out;
}

/** Placeholder names for values: the variable or property name, made unique. */
function namer(st) {
  const names = new Map();
  const used = new Set();
  const vars = [];
  return {
    vars,
    name(e) {
      const src = e.getText(st.sf);
      let n = names.get(src);
      if (n) return n;
      let base = nameFor(e).replace(/[^\w]/g, '') || 'value';
      if (!/^[A-Za-z_]/.test(base)) base = 'value';
      n = base;
      for (let i = 2; used.has(n); i++) n = `${base}${i}`;
      used.add(n);
      names.set(src, n);
      const src2 = render(st, e); // folds in edits inside the value (a constant read becomes X())
      vars.push(src2 === n ? n : `${n}: ${src2}`);
      return n;
    },
    text() { return vars.length ? `{ ${vars.join(', ')} }` : null; },
  };
}

/** An English plural ending passed as a value (n === 1 ? '' : 's', plural(n)): needs trPlural, by hand. */
function pluralish(e) {
  let x = e;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  // any piece of English chosen in code: n === 1 ? '' : 's', n === 1 ? ' needs' : 's need',
  // x ? `, ${n} deposits` : '', ok && ' (ready)', plural(n, 'server'): the translator must see whole sentences
  const words = (y) => { while (ts.isParenthesizedExpression(y)) y = y.expression; return ts.isStringLiteral(y) || ts.isNoSubstitutionTemplateLiteral(y) || ts.isTemplateExpression(y) || (ts.isConditionalExpression(y) && (words(y.whenTrue) || words(y.whenFalse))); };
  if (ts.isConditionalExpression(x) && (words(x.whenTrue) || words(x.whenFalse))) return true;
  if (ts.isBinaryExpression(x) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(x.operatorToken.kind) && words(x.right)) return true;
  if (ts.isTemplateExpression(x)) return true;
  // words anywhere inside the value (osPick({ win32: 'Windows asks' }, 'your system asks')): a piece made elsewhere
  let prose = false;
  const look = (n) => {
    if (prose) return;
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && /\p{L}/u.test(n.text) && (/\s/.test(n.text.trim()) || /^\p{Lu}\p{Ll}/u.test(n.text)) && !looksLikeCode(n.text)) { prose = true; return; }
    ts.forEachChild(n, look);
  };
  look(x);
  if (prose) return true;
  if (ts.isCallExpression(x)) {
    const callee = ts.isPropertyAccessExpression(x.expression) ? x.expression.name.text : ts.isIdentifier(x.expression) ? x.expression.text : '';
    if (/^plural/i.test(callee)) return true;
  }
  return false;
}

/** tr() call for a template literal, or null when a value is not a plain string/number. */
function fromTemplate(st, node) {
  for (const sp of node.templateSpans) if (hasJsx(sp.expression) || pluralish(sp.expression) || !typeOk(st.checker.getTypeAtLocation(sp.expression))) return null;
  const nm = namer(st);
  let key = node.head.text;
  for (const sp of node.templateSpans) key += `{${nm.name(sp.expression)}}` + sp.literal.text;
  return trCall(key, nm.text());
}

// ─── One string or template in code → tr() (shared by both phases) ───
/** Plans the edit for one candidate; false (with a hand note) when it is not safe. */
function planString(st, c) {
  const node = c.node;
  if (keptOnly(c.text) || within(node, isTrCall)) return false;
  if (c.kind === 'error') { handAt(st, node, 'thrown error: wrap where it is shown (logs stay English)', c.text); return false; }
  if (looksLikeCommand(c.text)) { handAt(st, node, 'holds a command: split the sentence from the command', c.text); return false; }
  if (c.kind === 'string' && /^\p{Ll}/u.test(c.text)) { handAt(st, node, 'starts lower case and is not in a shown place: may be a code', c.text); return false; }
  // a piece of a sentence joined in code: the translator must see the whole sentence
  const raw = ts.isTemplateExpression(node) ? node.head.text + '…' + node.templateSpans[node.templateSpans.length - 1].literal.text : node.text;
  const joined = ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.PlusToken;
  if (joined || /^[,.:;)]/.test(raw.trim()) || (c.kind !== 'jsx-attr' && raw !== raw.trim())) { handAt(st, node, 'a piece of a sentence joined in code: make it one sentence with placeholders', c.text); return false; }
  if (ts.isTemplateExpression(node)) {
    if (node.templateSpans.some((sp) => pluralish(sp.expression))) { handAt(st, node, 'a piece of English chosen in code (plural ending or clause) passed as a value: use trPlural or whole sentences', c.text); return false; }
    const call = fromTemplate(st, node);
    if (!call) { handAt(st, node, 'a value in the sentence is not a plain string or number', c.text); return false; }
    addEdit(st, node.getStart(st.sf), node.end, call, 'template');
  } else {
    const inAttr = ts.isJsxAttribute(node.parent);
    const call = trCall(node.text);
    addEdit(st, node.getStart(st.sf), node.end, inAttr ? `{${call}}` : call, inAttr ? 'attribute' : 'string');
  }
  st.wrapped++;
  return true;
}
// plain strings first, then templates (a template may hold a string)
const byTemplateLast = (a, b) => Number(ts.isTemplateExpression(a.node)) - Number(ts.isTemplateExpression(b.node));

// ─── Phase 1: module constants and tables → functions read at use (edits in every file that reads them) ───
// `const X = '…'` becomes `const X = (): string => tr('…')`; `const T = { … }` becomes
// `const T = (): Type => ({ … })` with its sentences wrapped. Every X → X(), `typeof X` → ReturnType<typeof X>.
function phaseConstants(st, pre) {
  const { sf } = st;
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt) || !(stmt.declarationList.flags & ts.NodeFlags.Const) || stmt.declarationList.declarations.length !== 1) continue;
    const decl = stmt.declarationList.declarations[0];
    const init = decl.initializer;
    if (!init || !ts.isIdentifier(decl.name) || ts.isArrowFunction(init) || ts.isFunctionExpression(init)) continue;
    const s = init.getStart(sf);
    const inside = st.scan.candidates.filter((c) => c.kind !== 'jsx' && c.node.getStart(sf) >= s && c.node.end <= init.end && !keptOnly(c.text));
    if (!inside.some((c) => !inFunction(c.node) && c.kind !== 'error')) continue; // nothing read at module load
    const name = decl.name.text;
    const first = inside.find((c) => !inFunction(c.node)) ?? inside[0];
    const refs = findRefs(st.abs, decl);
    const skipAll = (why) => { handAt(st, first.node, why, first.text); for (const c of inside) st.converted.add(c.node); };
    if (refs.some((x) => x.rel.startsWith('src/cli/'))) { skipAll(`constant ${name} is read by the terminal (src/cli is not edited)`); continue; }
    if (hasJsx(init)) { skipAll(`constant ${name} holds elements: make it a component or a function by hand`); continue; }
    const before = st.wrapped;
    for (const c of [...inside].sort(byTemplateLast)) { planString(st, c); st.converted.add(c.node); }
    if (st.wrapped === before) continue;
    const simple = ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init) || ts.isTemplateExpression(init);
    st.pending.push({ decl, init, name, simple }); // body rendered once every file's call-site edits are in (finishConstants)
    for (const x of refs) {
      const text = x.typeQuery ? null : x.shorthand ? `${name}: ${name}()` : `${name}()`;
      const e = x.typeQuery
        ? { start: x.typeQuery.getStart(x.typeQuery.getSourceFile()), end: x.typeQuery.end, text: `ReturnType<${x.typeQuery.getText(x.typeQuery.getSourceFile())}>`, line: x.line, what: `type of ${name}`, old: x.typeQuery.getText(x.typeQuery.getSourceFile()) }
        : { start: x.start, end: x.end, text, line: x.line, what: `call ${name}`, old: name };
      (pre[x.abs] ??= []).push(e);
    }
    st.constants.push({ name, kind: simple ? 'constant' : 'table', line: lineOf(sf, decl.getStart(sf)), text: first.text, refs: refs.map((x) => `${x.rel}:${x.line}${x.typeQuery ? ' (type)' : x.moduleLoad ? ' (read at module load: still frozen there)' : ''}`) });
  }
}

/** Turn each converted declaration into a function, folding in every planned edit inside it. */
function finishConstants(st) {
  const { sf } = st;
  for (const p of st.pending.sort((a, b) => b.init.getStart(sf) - a.init.getStart(sf))) {
    const body = render(st, p.init);
    const type = p.decl.type ? p.decl.type.getText(sf) : p.simple ? 'string' : null;
    addEdit(st, p.decl.getStart(sf), p.decl.end, `${p.name} = ()${type ? `: ${type}` : ''} => ${p.simple ? body : `(${body})`}`, p.simple ? 'constant' : 'table');
  }
}

// ─── Phase 2: strings and templates inside functions, then JSX sentences ───
function phaseStrings(st) {
  const cands = st.scan.candidates.filter((c) => c.kind !== 'jsx' && !st.converted.has(c.node)).sort(byTemplateLast);
  for (const c of cands) {
    if (!inFunction(c.node) && c.kind !== 'error' && !keptOnly(c.text)) { handAt(st, c.node, 'read at module load (not a top-level const): make it a function read at use', c.text); continue; }
    planString(st, c);
  }
}

function phaseJsx(st) {
  if (!st.r.endsWith('.tsx')) return;
  const { sf, checker } = st;
  const prose = new Set(st.scan.candidates.filter((c) => c.kind === 'jsx').map((c) => c.node));
  const tagOf = (n) => (ts.isJsxElement(n) ? n.openingElement.tagName.getText(sf) : ts.isJsxSelfClosingElement(n) ? n.tagName.getText(sf) : '');
  const attrsOf = (n) => (ts.isJsxElement(n) ? n.openingElement.attributes.getText(sf) : '');
  const blank = (k) => ts.isJsxText(k) && !k.text.trim();
  const kindOf = (k) => {
    if (ts.isJsxText(k)) return 'text';
    if (ts.isJsxExpression(k)) {
      if (!k.expression) return 'boundary'; // {/* comment */}
      const e = k.expression;
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return 'inline';
      if (hasJsx(e)) return 'boundary';
      return typeOk(checker.getTypeAtLocation(e)) && !pluralish(e) ? 'value' : 'boundary';
    }
    return 'boundary';
  };
  // a neighbour that carries words: a text element, or a value that is not plainly a string
  const textish = (k) => !!k && ((ts.isJsxElement(k) && TEXT_TAGS.test(tagOf(k))) || (ts.isJsxExpression(k) && !!k.expression && !hasJsx(k.expression)));

  const wrapChildren = (el) => {
    if (/^(code|kbd|pre|samp)$/.test(tagOf(el)) || /font-mono|data-i18n-skip/.test(attrsOf(el))) return;
    const kids = el.children;
    const segs = [];
    let cur = [];
    kids.forEach((k, i) => {
      const kd = kindOf(k);
      if (kd === 'boundary') { if (cur.length) segs.push(cur); cur = []; } else cur.push({ k, kd, i });
    });
    if (cur.length) segs.push(cur);
    for (const items of segs) {
      const texts = items.filter((x) => x.kd === 'text' && prose.has(x.k));
      if (!texts.length) continue;
      const firstI = items[0].i;
      const lastI = items[items.length - 1].i;
      let prev = null; for (let i = firstI - 1; i >= 0; i--) if (!blank(kids[i])) { prev = kids[i]; break; }
      let next = null; for (let i = lastI + 1; i < kids.length; i++) if (!blank(kids[i])) { next = kids[i]; break; }
      const nm = namer(st);
      let raw = '';
      let unknown = false;
      for (const x of items) {
        if (x.kd === 'text') { const v = jsxValue(x.k.text); if (v === null) unknown = true; raw += /\n/.test(x.k.text) ? ` ${v ?? ''} ` : v ?? ''; }
        else if (x.kd === 'inline') { raw += x.k.expression.text; render(st, x.k); }
        else raw += `{${nm.name(x.k.expression)}}`;
      }
      const key = raw.replace(/[ \t\r\n]+/g, ' ').trim();
      const node0 = texts[0].k;
      if (unknown) { handAt(st, node0, 'an HTML entity the script does not know', key); continue; }
      if (keptOnly(key.replace(/\{\w+\}/g, ' '))) continue;
      if (looksLikeCommand(key)) { handAt(st, node0, 'holds a command: split the sentence from the command', key); continue; }
      // a run that starts with , . : ; or ends with ( or a space-dot sits next to words made elsewhere
      const cut = /^[,.:;)]/.test(key) || /[(]$/.test(key) || /\s[.,:;]|\(\s/.test(key);
      if ((textish(next) && !/[.!?…:)]$/.test(key)) || (textish(prev) && /^\p{Ll}/u.test(key)) || ((prev || next) && cut)) { handAt(st, node0, 'sentence split by markup or a value that is not plain text: rewrite it as one sentence', key); continue; }
      const first = items[0].k;
      const last = items[items.length - 1].k;
      // replace from the first non-space to the last non-space of the run; spaces around it stay
      const start = ts.isJsxText(first) ? first.pos + (first.text.length - first.text.trimStart().length) : first.getStart(sf);
      const end = ts.isJsxText(last) ? last.end - (last.text.length - last.text.trimEnd().length) : last.end;
      // values already rendered by nm.name(); now take the planned edits inside the run out (they live in the vars)
      for (const x of [...st.edits]) if (x.start >= start && x.end <= end) st.edits.splice(st.edits.indexOf(x), 1);
      addEdit(st, start, end, `{${trCall(key, nm.text())}}`, nm.vars.length ? 'jsx-sentence' : 'jsx-text');
      st.wrapped++;
    }
  };
  const visit = (n) => { if (ts.isJsxElement(n) || ts.isJsxFragment(n)) wrapChildren(n); ts.forEachChild(n, visit); };
  visit(sf);
}

// ─── References to a module constant, across both projects ───
const refIndex = {};
function indexFor(kind) {
  if (refIndex[kind]) return refIndex[kind];
  const { program: p } = program(kind);
  const byName = new Map();
  for (const sf of p.getSourceFiles()) {
    if (sf.isDeclarationFile || sf.fileName.includes('node_modules') || !path.resolve(sf.fileName).startsWith(ROOT)) continue;
    const v = (n) => { if (ts.isIdentifier(n)) { const a = byName.get(n.text) ?? []; a.push(n); byName.set(n.text, a); } ts.forEachChild(n, v); };
    v(sf);
  }
  return (refIndex[kind] = byName);
}
/** Follow imports, and `const { X } = await import('…')` destructuring, back to the declaration. */
function resolveSym(checker, sym, depth = 0) {
  if (!sym || depth > 5) return sym;
  if (sym.flags & ts.SymbolFlags.Alias) return resolveSym(checker, checker.getAliasedSymbol(sym), depth + 1);
  const d = sym.declarations?.[0];
  if (d && ts.isBindingElement(d) && ts.isObjectBindingPattern(d.parent) && ts.isVariableDeclaration(d.parent.parent) && d.parent.parent.initializer) {
    const prop = (d.propertyName ?? d.name).getText();
    const t = checker.getTypeAtLocation(d.parent.parent.initializer);
    const target = checker.getAwaitedType?.(t) ?? t;
    const ps = target.getProperty(prop);
    if (ps) return resolveSym(checker, ps, depth + 1);
  }
  return sym;
}

function findRefs(abs, decl) {
  const name = decl.name.text;
  const declFile = path.resolve(abs);
  const declPos = decl.name.getStart();
  const kinds = ['node', 'web']; // tests (node project) import screen modules too
  const seen = new Set();
  const out = [];
  for (const kind of kinds) {
    const { checker } = program(kind);
    for (const id of indexFor(kind).get(name) ?? []) {
      const sf = id.getSourceFile();
      const f = path.resolve(sf.fileName);
      if (f === declFile && id.getStart(sf) === declPos) continue;
      const sym = resolveSym(checker, checker.getSymbolAtLocation(id));
      if (!sym?.declarations?.some((d) => path.resolve(d.getSourceFile().fileName) === declFile && d.name && d.name.getStart() === declPos)) continue;
      const p = id.parent;
      if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isImportClause(p)) continue;
      if (ts.isBindingElement(p) && (p.propertyName === id || (!p.propertyName && p.name === id))) continue; // the destructuring itself
      const k = `${f}:${id.getStart(sf)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const tq = ts.isTypeQueryNode(p) ? p : within(id, ts.isTypeQueryNode);
      out.push({ abs: f, rel: rel(f), start: id.getStart(sf), end: id.end, line: lineOf(sf, id.getStart(sf)), shorthand: ts.isShorthandPropertyAssignment(p), typeQuery: tq ?? null, moduleLoad: !inFunction(id) });
    }
  }
  return out;
}

// ─── Import of tr ───
function importEdit(abs, sf) {
  const spec0 = path.relative(path.dirname(abs), I18N_DIR).replace(/\\/g, '/');
  const spec = spec0.startsWith('.') ? spec0 : `./${spec0}`;
  let last = null;
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st)) continue;
    last = st;
    if (path.resolve(path.dirname(abs), st.moduleSpecifier.text) !== I18N_DIR) continue;
    const nb = st.importClause?.namedBindings;
    if (nb && ts.isNamedImports(nb) && !st.importClause.isTypeOnly) {
      if (nb.elements.some((e) => e.name.text === 'tr')) return null;
      const lastEl = nb.elements[nb.elements.length - 1];
      return { start: lastEl.end, end: lastEl.end, text: ', tr', line: lineOf(sf, lastEl.end), what: 'import', old: '' };
    }
  }
  const at = last ? last.end : (sf.statements[0] ? sf.statements[0].getStart(sf) : 0);
  return { start: at, end: at, text: last ? `\nimport { tr } from '${spec}';` : `import { tr } from '${spec}';\n`, line: lineOf(sf, at), what: 'import', old: '' };
}

function declaresTr(sf) {
  let found = false;
  const v = (n) => {
    if (found) return;
    if ((ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isFunctionDeclaration(n) || ts.isBindingElement(n)) && n.name && ts.isIdentifier(n.name) && n.name.text === 'tr') found = true;
    ts.forEachChild(n, v);
  };
  v(sf);
  return found;
}

/** Apply edits; when two overlap the outer one wins and the inner one is returned as dropped. */
function apply(text, edits) {
  const asc = [...edits].sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const keep = [];
  const dropped = [];
  let reach = -1;
  for (const e of asc) {
    if (e.start < reach || (e.start === reach && e.end === e.start && keep.length && keep[keep.length - 1].end === e.start && keep[keep.length - 1].start === e.start)) { dropped.push(e); continue; }
    keep.push(e);
    reach = Math.max(reach, e.end);
  }
  let out = text;
  for (const e of keep.reverse()) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { out, dropped };
}

// ─── Files ───
function collect(paths) {
  const out = [];
  const walk = (p) => {
    if (!fs.existsSync(p)) return;
    if (fs.statSync(p).isDirectory()) { for (const e of fs.readdirSync(p).sort()) walk(path.join(p, e)); return; }
    if (!/\.(ts|tsx)$/.test(p) || /\.d\.ts$/.test(p)) return;
    if (['cli', 'dev', 'i18n', 'scripts', 'other'].includes(folderOf(rel(p)))) return;
    out.push(path.resolve(p));
  };
  for (const p of paths) walk(path.resolve(ROOT, p));
  return [...new Set(out)];
}

/** Plan (and with write, apply) the whole run. Results per file. */
export function run(paths = APP_FOLDERS, { write = false } = {}) {
  const states = new Map();
  const results = [];
  for (const abs of collect(paths)) {
    const st = open(abs);
    if (st) states.set(abs, st);
    else results.push({ file: rel(abs), folder: folderOf(rel(abs)), changed: false, wrapped: 0, edits: [], hand: [{ line: 0, why: 'not in the TypeScript project', text: '' }], constants: [], compared: [] });
  }
  const pre = {};
  for (const st of states.values()) phaseConstants(st, pre);
  for (const st of states.values()) {
    st.edits.push(...(pre[st.abs] ?? []));
    delete pre[st.abs];
    finishConstants(st);
    phaseStrings(st);
    phaseJsx(st);
  }
  const finish = (abs, st, edits) => {
    const r = rel(abs);
    const text = fs.readFileSync(abs, 'utf8');
    const hand = st?.hand ?? [];
    const all = [...edits];
    let changed = false;
    if (all.length) {
      const sf = st?.sf ?? ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, abs.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const usesTr = all.some((e) => e.text.includes('tr('));
      if (usesTr && declaresTr(sf)) { hand.push({ line: 0, why: 'the file has its own name tr: wrap it by hand', text: '' }); all.length = 0; }
      else if (usesTr) { const imp = importEdit(abs, sf); if (imp) all.push(imp); }
      const { out, dropped } = apply(text, all);
      for (const d of dropped) hand.push({ line: d.line, why: 'two changes overlap here: do it by hand', text: d.old });
      changed = out !== text;
      if (changed && write) fs.writeFileSync(abs, out);
    }
    results.push({ file: r, folder: folderOf(r), changed, wrapped: st?.wrapped ?? 0, edits: all.map(({ line, what, old, text: t }) => ({ line, what, old, new: t })), hand, constants: st?.constants ?? [], compared: (st?.scan.compared ?? []).map((c) => ({ line: c.line, text: c.text })) });
  };
  for (const [abs, st] of states) finish(abs, st, st.edits);
  for (const [abs, edits] of Object.entries(pre)) finish(abs, null, edits); // call sites in files outside the run (tests, other folders)
  return results.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

export function summary(results) {
  const by = {};
  for (const r of results) {
    const b = (by[r.folder] ??= { files: 0, changed: 0, wrapped: 0, hand: 0, compared: 0, constants: 0, why: {} });
    b.files++;
    if (r.changed) b.changed++;
    b.wrapped += r.wrapped;
    b.hand += r.hand.length;
    b.compared += r.compared.length;
    b.constants += r.constants.length;
    for (const h of r.hand) { const w = h.why.replace(/constant \w+/, 'constant X'); b.why[w] = (b.why[w] ?? 0) + 1; }
  }
  return by;
}

// ─── Run as a script ───
const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const args = process.argv.slice(2);
  const mode = args.includes('--write') ? 'write' : args.includes('--report') ? 'report' : 'dry';
  const paths = args.filter((a) => !a.startsWith('--'));
  const results = run(paths.length ? paths : APP_FOLDERS, { write: mode === 'write' });
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({ summary: summary(results), results: results.filter((r) => r.changed || r.hand.length || r.compared.length) }, null, 2) + '\n');
  } else {
    for (const r of results) {
      if (mode === 'report') {
        for (const h of r.hand) console.log(`${r.file}:${h.line}  ${h.why}${h.text ? `  «${h.text}»` : ''}`);
        for (const c of r.compared) console.log(`${r.file}:${c.line}  compared with ===: check the other side is translated the same way  «${c.text}»`);
      } else if (r.changed) {
        console.log(`── ${r.file}`);
        for (const e of r.edits) console.log(`  ${e.line} [${e.what}]\n    - ${e.old.replace(/\s+/g, ' ').trim()}\n    + ${e.new.replace(/\s+/g, ' ').trim()}`);
      }
    }
    for (const r of results) for (const c of r.constants) console.log(`constant ${r.file}:${c.line} ${c.name}: ${c.refs.length} call sites${c.refs.length ? `\n    ${c.refs.join('\n    ')}` : ''}`);
    console.log(JSON.stringify(summary(results), null, 2));
    if (mode === 'write') console.log('Now run: node scripts/i18n-extract.mjs');
  }
}
