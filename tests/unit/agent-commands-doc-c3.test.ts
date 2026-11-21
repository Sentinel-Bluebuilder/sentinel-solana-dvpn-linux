// ─── rc9-f2 DOC (review audit 3637da9): the shipped AGENT-COMMANDS page needs no corrections ───
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const DOC = fs.readFileSync('docs/AGENT-COMMANDS.md', 'utf8');
const lines = DOC.split('\n');
const row = (start: string): string => {
  const r = lines.filter((l) => l.startsWith(start));
  expect(r.length, start).toBe(1);
  return r[0];
};

function srcText(dir: string): string {
  let out = '';
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out += srcText(p);
    else if (/\.(ts|tsx)$/.test(e.name)) out += fs.readFileSync(p, 'utf8');
  }
  return out;
}

describe('AGENT-COMMANDS corrections', () => {
  it('no internal lane name in the shipped page', () => {
    expect(DOC.match(/AC-[A-Z]+/g) ?? []).toEqual([]);
  });
  it('the spending-limit line gives the rc.9 next: device setup --allowance <this deposit>, alsoNext --raise-limit', () => {
    const p = row('**Spending limit (S7, rc.6):**');
    expect(p).toContain('`action` is `<cli> device setup --allowance <this deposit> --yes`, then the same `agent up` line');
    expect(p).toContain('`alsoNext` is the same `agent up` line with `--raise-limit --yes`');
    expect(p).not.toContain('`action` is the same line with `--raise-limit --yes`');
  });
  it('exit 5: no bare pipe, and the sudo case is said to be refused', () => {
    const r = row('| 5 |');
    expect(r).not.toContain('on|persist');
    expect(r).toContain('`daemon set --kill-switch on` or `--kill-switch persist`');
    expect(r).toMatch(/under sudo, sudo -i or su started from an SSH login, which is refused/);
  });
  it('exit 6: plain words, not code spans, for none / the paying commands', () => {
    const r = row('| 6 |');
    for (const w of ['`none`', '`unclear`', '`agent`', '`connect`', '`switch`', '`test`']) expect(r, w).not.toContain(w);
  });
  it('rows for disconnect-failed and the three apply codes', () => {
    for (const c of ['disconnect-failed', 'apply-busy', 'apply-while-connecting', 'apply-failed']) {
      expect(row(`| \`${c}\` |`)).toContain('`<cli> agent status --json`');
    }
  });
  it('every code a failure row or the money table names is a code the source raises', () => {
    const src = srcText('src');
    const a = DOC.indexOf('## Failure codes');
    const b = DOC.indexOf('### Usage (exit 3)');
    expect(a).toBeGreaterThan(0);
    const codes = new Set<string>();
    for (const l of DOC.slice(a, b).split('\n')) {
      if (!l.startsWith('| `')) continue;
      const cells = l.split(' | ');
      const named = l.startsWith('| none |') || l.startsWith('| open |') || l.startsWith('| unclear |') || l.startsWith('| refund |') ? cells[2] : cells[0];
      for (const m of named.matchAll(/`([a-z][a-z0-9_]*(?:-[a-z0-9_]+)*)`/g)) codes.add(m[1]);
    }
    for (const l of lines.filter((x) => /^\| (none|open|unclear|refund) \|/.test(x))) {
      for (const m of l.split(' | ')[2].matchAll(/`([a-z][a-z0-9_]*(?:-[a-z0-9_]+)*)`/g)) codes.add(m[1]);
    }
    expect(codes.size).toBeGreaterThan(40);
    const missing = [...codes].filter((c) => !src.includes(`'${c}'`) && !src.includes(`"${c}"`) && !src.includes(`\`${c}\``));
    expect(missing).toEqual([]);
  });
});
