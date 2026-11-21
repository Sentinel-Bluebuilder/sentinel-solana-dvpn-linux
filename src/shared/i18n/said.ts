// ─── Saved text (B5, plan item "Saved text"): a sentence kept as its English key and values ───
// A sentence stored in state, sent over IPC or kept in history is written once and read later, perhaps after the
// language has changed. Kept as a Said, it is composed in the language in use when it is shown, so switching the
// language also switches the last error, a close message, a toast still on screen or a history row.
//   const s = said('Paying deposit {amount}…', { amount });   // stored, sent, saved: plain JSON
//   showSaid(s)                                               // the sentence, in the language now in use
// The extractor reads said() / saidPlural() exactly like tr() / trPlural(): same arguments, same rules.
// A plain string is accepted wherever a Said is, and shown as it is (older state, logs, the CLI).
import { fill, tr, trPlural, type PluralForms, type Vars } from './tr';

export interface Said {
  /** The English sentence (the key); for a plural, its `other` form. */
  t: string;
  /** Values for its {placeholders}. Numbers, amounts, addresses: never a translated piece. */
  v?: Vars;
  /** Context tag (tr's third argument). */
  c?: string;
  /** Plural: the English forms and the count they are chosen by. */
  p?: PluralForms;
  n?: number;
}

export function said(text: string, vars?: Vars, context?: string): Said {
  return { t: text, ...(vars ? { v: plain(vars) } : {}), ...(context ? { c: context } : {}) };
}

export function saidPlural(forms: PluralForms, count: number, vars?: Vars, context?: string): Said {
  return { t: forms.other, p: forms, n: count, ...(vars ? { v: plain(vars) } : {}), ...(context ? { c: context } : {}) };
}

export const isSaid = (x: unknown): x is Said => !!x && typeof x === 'object' && typeof (x as Said).t === 'string';

/** The sentence in the language in use now. A plain string is shown as it is; null/undefined give ''. */
export function showSaid(s: Said | string | null | undefined): string {
  if (s === null || s === undefined) return '';
  if (typeof s === 'string') return s;
  return s.p ? trPlural(s.p, s.n ?? 0, s.v, s.c) : tr(s.t, s.v, s.c);
}

/** The English sentence with its values: logs, the CLI, comparisons. */
export function saidEnglish(s: Said | string | null | undefined): string {
  if (s === null || s === undefined) return '';
  if (typeof s === 'string') return s;
  if (!s.p) return fill(s.t, s.v);
  const cat = new Intl.PluralRules('en').select(s.n ?? 0);
  return fill(s.p[cat] ?? s.p.other, { n: s.n, ...s.v });
}

/** bigint does not survive JSON (IPC, files): kept as its decimal string. */
function plain(vars: Vars): Vars {
  const out: Vars = {};
  for (const [k, val] of Object.entries(vars)) out[k] = typeof val === 'bigint' ? val.toString() : val;
  return out;
}
