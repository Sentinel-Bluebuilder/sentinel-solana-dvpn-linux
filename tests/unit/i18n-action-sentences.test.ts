// ─── Every connect / close action has its sentence (B3, Home's "session ended" banner) ───
// An action stays English (connectActionButton routes on it). Home shows it as advice after the message, so each
// one needs a whole translated sentence in ACTION_SENTENCES; one missing would show English in every language.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTION_SENTENCES, actionSentence } from '../../src/shared/connect-action';

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['cli', 'locales'].includes(e.name)) walk(p, out); } else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** The English actions the app sets: every capitalised quoted string in an `action:` value. */
function actionsInSource(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of walk('src')) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\baction: ([^,}\n]*)/g)) {
      for (const q of m[1].matchAll(/'([A-Z][^']*)'/g)) if (!found.has(q[1])) found.set(q[1], file);
    }
  }
  return found;
}

describe('ACTION_SENTENCES', () => {
  it('has a sentence for every action the app sets', () => {
    const found = actionsInSource();
    expect(found.size).toBeGreaterThan(15); // positive control: the scan reads the real tree
    const missing = [...found].filter(([a]) => !Object.hasOwn(ACTION_SENTENCES, a)).map(([a, f]) => `${a} (${f})`);
    expect(missing).toEqual([]);
  });

  it('each sentence is the action as a sentence (English unchanged on Home)', () => {
    for (const [a, sentence] of Object.entries(ACTION_SENTENCES)) expect(sentence()).toBe(`${a}.`);
  });

  it('no sentence for no action; an unknown one shows as before', () => {
    expect(actionSentence(null)).toBeNull();
    expect(actionSentence('unknown')).toBeNull();
    expect(actionSentence('Something new')).toBe('Something new.');
  });
});
