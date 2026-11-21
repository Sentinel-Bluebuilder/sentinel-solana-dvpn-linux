// ─── A word with its explanation ───
// `<Term k="deposit">Deposit</Term>` shows the word and a (?) that explains it in plain language
// (hover, keyboard focus, tap). The explanations live in one table: core/app/help-copy.ts.
import type { ReactNode } from 'react';
import { TERMS, type TermKey } from '../../../core/app/help-copy';
import { Help } from './ui';

export function Term({ k, children }: { k: TermKey; children: ReactNode }) {
  return <span className="inline-flex items-center gap-1.5" data-term={k}>{children}<Help text={TERMS()[k]} /></span>;
}

export { TERMS };
