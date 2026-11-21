// ─── One vocabulary on screen (UI-044 to UI-057, docs/DESIGN.md → Copy) ───
// The words a person reads on the main screens never include the protocol's or the code's own terms.
// Scope: the screens and components of the main flow. The page name "Node test" is the one allowed "node".
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FILES = [
  'components/ConnectSheet.tsx', 'components/SessionCard.tsx', 'components/RestoreNetworkButton.tsx',
  'screens/Home.tsx', 'screens/Nodes.tsx', 'screens/Plans.tsx', 'screens/Activity.tsx', 'screens/Wallet.tsx', 'App.tsx',
].map((f) => join(__dirname, '../../src/renderer/src', f));

/** Say → never. Each pattern is matched against text a person reads, not against code. */
const NEVER: Array<[string, RegExp]> = [
  ['server', /\bnodes?\b/i],
  ['deposit', /\b(lock|locked|locks|escrow|channel|open deposit)\b/i],
  ['refund', /\b(settle|settled|settlement|rent)\b/i],
  ['spending limit', /\b(allowance|grant|token permission|spending permission|device permission)\b/i],
  ['VPN service', /\b(daemon|dvpnd)\b/i],
  ['plan access', /\btickets?\b/i],
  ['network fees', /\blamports\b/i],
  ['plural()', /\w\(s\)/],
];

/** Text a person reads on a line: quoted strings with a space or a capital, and JSX text. */
function shown(line: string): string[] {
  if (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line) || /^\s*import /.test(line) || /console\.(warn|error|log)\(/.test(line)) return [];
  const code = line.replace(/\{\/\*.*?\*\/\}/g, '').replace(/\/\/ .*$/, '');
  return [...code.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`|>([^<>{}\n]+)</g)]
    .map((m) => (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').replace(/\$\{[^}]*\}/g, ' '))
    .filter((x) => /[a-z]/.test(x) && (/\s/.test(x.trim()) || /^[A-Z][a-z]/.test(x.trim())))
    // class lists, selectors, paths and keys are code, not copy
    .filter((x) => !/^[a-z0-9:\-\[\]\/.%()#_ ]+$/.test(x.trim()) && !/^(data-|aria-|\.\.?\/)/.test(x.trim()));
}

function violations(text: string): string[] {
  const t = text.replace(/Node test/g, '');
  return NEVER.filter(([, re]) => re.test(t)).map(([say]) => say);
}

describe('copy glossary', () => {
  it('the checker catches each banned word (positive control)', () => {
    expect(violations('This device can pay nodes')).toEqual(['server']);
    expect(violations('Connect · lock 5 tDVPN')).toEqual(['deposit']);
    expect(violations('The daemon is retrying')).toEqual(['VPN service']);
    expect(violations('3 deposit(s)')).toEqual(['plural()']);
    expect(violations('Run a Node test')).toEqual([]);
    expect(shown("  <p className=\"text-sm\">The account rent is returned</p>")).toContain('The account rent is returned');
  });

  it('no main screen shows a banned word', () => {
    const bad: string[] = [];
    for (const f of FILES) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        for (const text of shown(line)) for (const say of violations(text.replace(/\{\w+\}/g, '·')) /* {placeholders} are names in code, never shown */) bad.push(`${f.split('renderer')[1]}:${i + 1} say "${say}": ${text.trim().slice(0, 90)}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
