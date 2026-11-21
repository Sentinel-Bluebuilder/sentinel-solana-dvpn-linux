// ─── ShownError: an error a person reads (plan B3, thrown errors) ───
// `.message` is the English sentence with its values filled in: logs, the terminal (src/cli) and every
// existing `.message` reader keep working unchanged. `.shown()` is the same sentence in the language
// the app is set to, read at the moment it is shown, so the edges that show errors (ipc.ts, errorText,
// the screens' catch blocks) call shownMessage(err) instead of err.message.
// The extractor reads `new ShownError('…', vars)` and the subclasses listed in SHOWN_ERROR_CLASSES
// (scripts/i18n-extract.mjs) like tr('…', vars): the first argument must be a plain string.

import { fill, tr, type Vars } from './tr';

export class ShownError extends Error {
  readonly text: string;
  readonly vars?: Vars;

  constructor(text: string, vars?: Vars, options?: { cause?: unknown }) {
    super(fill(text, vars), options);
    this.name = new.target.name;
    this.text = text;
    this.vars = vars;
  }

  /** The sentence in the active language. */
  shown(): string {
    return tr(this.text, this.vars);
  }
}

/** What a person should read for a thrown value: the translated sentence of a ShownError, else its message. */
export function shownMessage(err: unknown, fallback = ''): string {
  if (err instanceof ShownError) return err.shown();
  if (typeof err === 'string') return err || fallback;
  const msg = (err as { message?: unknown } | null)?.message;
  return typeof msg === 'string' && msg ? msg : fallback;
}
