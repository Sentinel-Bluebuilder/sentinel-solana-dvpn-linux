// ─── i18n-banned — no banned name in the language work ───
// The list lives outside the repository (one name per line, whole word; a line "cs:Name" is
// case-sensitive; "#" starts a comment), so nothing here names anything. Path: env I18N_BANNED_LIST,
// else no list: set I18N_BANNED_LIST.
// Fails on: the language work's own files (SCOPE) and the added lines of a diff (env I18N_DIFF = a
// `git diff -U0 <FINAL>` file, for the B3/B4/B5 commits). Every other file's hits are only listed.
//   node scripts/i18n-banned.mjs [--diff <file>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LIST_PATH = process.env.I18N_BANNED_LIST ?? '';
const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist', 'dist-vm', 'dist-vm-ui', 'build', 'evidence', 'coverage']);
const TEXT = /\.(ts|tsx|mjs|cjs|js|json|md|yml|yaml|html|css|txt|sh|ps1|nsh)$/;

/** The language work's own files: a hit here fails. */
export function inScope(rel) {
  return rel.startsWith('src/shared/i18n/') || rel.startsWith('docs/i18n/')
    || /^scripts\/i18n-[^/]+$/.test(rel) || /^tests\/(unit|platform\/[^/]+)\/i18n-[^/]+$/.test(rel);
}

export function loadMatchers(listPath = LIST_PATH) {
  if (!fs.existsSync(listPath)) return null;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return fs.readFileSync(listPath, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
    const cs = l.startsWith('cs:');
    const name = cs ? l.slice(3).trim() : l;
    return { name, re: new RegExp(`(?<![\\p{L}\\p{N}_])${esc(name)}(?![\\p{L}\\p{N}_])`, cs ? 'u' : 'iu') };
  });
}

function hitsIn(text, matchers) {
  return matchers.filter((m) => m.re.test(text)).map((m) => m.name);
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !(dir === ROOT && e.name === 'resources')) walk(p, out); }
    else if (TEXT.test(e.name)) out.push(p);
  }
  return out;
}

/** Added lines per file from a unified diff (`git diff -U0`). */
export function addedLines(diffText) {
  const out = [];
  let file = null;
  let line = 0;
  for (const l of diffText.split('\n')) {
    if (l.startsWith('+++ ')) { file = l.slice(4).replace(/^b\//, '').trim(); continue; }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (h) { line = Number(h[1]); continue; }
    if (file && file !== '/dev/null' && l.startsWith('+')) { out.push({ file, line, text: l.slice(1) }); line++; }
  }
  return out;
}

/** { fail: hits that fail the gate, listed: hits elsewhere (old files), skipped: no list } */
export function scan({ listPath = LIST_PATH, diffPath = process.env.I18N_DIFF } = {}) {
  const matchers = loadMatchers(listPath);
  if (!matchers) return { skipped: true, fail: [], listed: [] };
  if (!matchers.length) return { skipped: false, fail: [], listed: [] };
  const fail = [];
  const listed = [];
  for (const p of walk(ROOT)) {
    const rel = path.relative(ROOT, p).replace(/\\/g, '/');
    fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
      for (const name of hitsIn(l, matchers)) (inScope(rel) ? fail : listed).push(`${rel}:${i + 1} ${name}`);
    });
  }
  if (diffPath && fs.existsSync(diffPath)) {
    for (const a of addedLines(fs.readFileSync(diffPath, 'utf8'))) {
      if (inScope(a.file)) continue; // already failed above
      for (const name of hitsIn(a.text, matchers)) fail.push(`${a.file}:${a.line} ${name} (changed line)`);
    }
  }
  return { skipped: false, fail, listed };
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const i = process.argv.indexOf('--diff');
  const r = scan({ diffPath: i > 0 ? process.argv[i + 1] : process.env.I18N_DIFF });
  if (r.skipped) { console.error(`no banned-name list at ${LIST_PATH}`); process.exitCode = 2; }
  else {
    if (r.listed.length) console.log(`Older files (listed, not failed):\n  ${r.listed.join('\n  ')}`);
    if (r.fail.length) { console.error(`FAIL:\n  ${r.fail.join('\n  ')}`); process.exitCode = 1; }
    else console.log('banned names: none in the language work');
  }
}
