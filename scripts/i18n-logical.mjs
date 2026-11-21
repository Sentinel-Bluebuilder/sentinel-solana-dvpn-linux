// ─── B4: left/right Tailwind classes → start/end (right-to-left languages) ───
// Usage: node scripts/i18n-logical.mjs [--write] <file.tsx> [...]
// Changes class tokens only, and only in string pieces made wholly of Tailwind classes (so English text such as
// "left" is never touched, and nothing inside tr() is). In a left-to-right page every start/end class is the same as
// the left/right one it replaces; in Arabic, Persian, Urdu, Pashto, Kurdish (Sorani) and Hebrew-script pages it flips.
// Kept physical, and reported: a left/right next to a translate-x (centring by offset would land off-centre).
import fs from 'node:fs';
import ts from 'typescript';

const MAP = [
  [/^(-?)ml-/, '$1ms-'], [/^(-?)mr-/, '$1me-'], [/^pl-/, 'ps-'], [/^pr-/, 'pe-'],
  [/^(-?)left-/, '$1start-'], [/^(-?)right-/, '$1end-'],
  [/^text-left$/, 'text-start'], [/^text-right$/, 'text-end'],
  [/^border-l(-|$)/, 'border-s$1'], [/^border-r(-|$)/, 'border-e$1'],
  [/^rounded-tl(-|$)/, 'rounded-ss$1'], [/^rounded-tr(-|$)/, 'rounded-se$1'],
  [/^rounded-bl(-|$)/, 'rounded-es$1'], [/^rounded-br(-|$)/, 'rounded-ee$1'],
  [/^rounded-l(-|$)/, 'rounded-s$1'], [/^rounded-r(-|$)/, 'rounded-e$1'],
];
// A class token: variants (also arbitrary ones like min-[880px]:), then the utility, whose arbitrary values may hold
// anything but spaces and ']' (shadow-[inset_0_1px_0_rgb(255_255_255/.05)], grid-cols-[84px_minmax(0,140px)]).
const CLASS = /^!?([a-z0-9-]+(-?\[[^\]\s]*\])?:)*-?[a-z][a-z0-9]*(-([\w./%#]+|\[[^\]\s]*\]))*(\/[\w.]+)?$/;
const TR_CALLS = new Set(['tr', 'trPlural', 'trJsx']);

function convertToken(tok) {
  const m = /^(!?(?:[a-z0-9-]+(?:-?\[[^\]\s]*\])?:)*)(.*)$/.exec(tok);
  const [pre, base] = [m[1], m[2]];
  for (const [re, to] of MAP) if (re.test(base)) return pre + base.replace(re, to);
  return tok;
}

function insideTr(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && TR_CALLS.has(n.expression.text)) return true;
  }
  return false;
}

export function convert(source, fileName = 'x.tsx') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];
  const kept = [];
  const visit = (node) => {
    const piece = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
    if (piece && !insideTr(node)) {
      const text = node.text;
      const toks = text.split(/\s+/).filter(Boolean);
      if (toks.length && toks.every((t) => CLASS.test(t))) {
        const out = toks.map(convertToken);
        if (out.some((t, i) => t !== toks[i])) {
          if (toks.some((t) => /(^|:)-?translate-x-/.test(t))) kept.push({ line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, text });
          else {
            // Replace token by token in the raw text, so spacing and quotes stay as written.
            const start = node.getStart(sf);
            const raw = source.slice(start, node.getEnd());
            const fixed = raw.replace(/[^\s'"`{}$]+/g, (t) => (CLASS.test(t) ? convertToken(t) : t));
            if (fixed !== raw) edits.push({ start, end: node.getEnd(), raw, fixed, line: sf.getLineAndCharacterOfPosition(start).line + 1 });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  let out = source;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.fixed + out.slice(e.end);
  return { out, edits, kept };
}

if (process.argv[1] && process.argv[1].endsWith('i18n-logical.mjs')) {
  const write = process.argv.includes('--write');
  for (const file of process.argv.slice(2).filter((a) => !a.startsWith('--'))) {
    const src = fs.readFileSync(file, 'utf8');
    const { out, edits, kept } = convert(src, file);
    console.log(`${file}: ${edits.length} changed, ${kept.length} kept physical`);
    for (const e of edits) console.log(`  ${e.line}: ${e.raw.trim().slice(0, 110)}  →  ${e.fixed.trim().slice(0, 110)}`);
    for (const k of kept) console.log(`  KEPT ${k.line}: ${k.text.slice(0, 110)}`);
    if (write && out !== src) fs.writeFileSync(file, out);
  }
}
