// ─── Notification rules (UI-030 to UI-035) ───
// Pure. One notification per event: a repeat replaces the one already showing and counts up,
// an error stays until it is dismissed (WCAG 2.2.1: no time limit on something the user must
// read), nothing is shown that the current screen already shows, three are visible at most.

export type NoteKind = 'info' | 'success' | 'warn' | 'error';

export interface NoteAction {
  label: string;
  /** A screen id of the app ('wallet', 'nodes', …). */
  screen: string;
}

export interface NoteInput {
  kind: NoteKind;
  message: string;
  title?: string;
  action?: NoteAction;
  /** Same key = same event: the newer one replaces the older in place. Default: kind + message. */
  key?: string;
  /** Stays until dismissed, whatever its kind. */
  sticky?: boolean;
}

export interface Note extends NoteInput {
  id: number;
  key: string;
  /** How many times this event arrived while showing. */
  count: number;
  /** ms epoch of the last arrival; the display time restarts from it. */
  at: number;
}

export const MAX_VISIBLE = 3;
/** Kept in the list beyond the visible ones, so "+2 more" can open them as the front ones leave. */
export const MAX_KEPT = 8;

const LIFE_MS: Record<NoteKind, number | null> = { info: 4500, success: 4500, warn: 8000, error: null };

/** How long a note shows, or null when it stays until dismissed. */
export function lifeMs(n: Pick<Note, 'kind' | 'sticky'>): number | null {
  return n.sticky ? null : LIFE_MS[n.kind];
}

export const noteKey = (n: NoteInput): string => n.key ?? `${n.kind}:${n.title ?? ''}:${n.message}`;

// What a screen already shows itself: a notification saying the same thing is noise (UI-033, UI-111).
const SHOWN_BY_SCREEN: Array<{ screen: string; test: RegExp }> = [
  { screen: 'home', test: /^(Connected|Disconnected|Protected)\b\.?$/i },
];

export function shownByScreen(n: NoteInput, screen: string | null): boolean {
  if (!screen || n.kind === 'error' || n.kind === 'warn') return false;
  return SHOWN_BY_SCREEN.some((r) => r.screen === screen && r.test.test(n.message.trim()));
}

/** Add a note. Returns the same array when nothing changes (the note is suppressed). */
export function pushNote(list: readonly Note[], input: NoteInput, id: number, now: number, screen: string | null = null): readonly Note[] {
  if (!input.message.trim() || shownByScreen(input, screen)) return list;
  const key = noteKey(input);
  const at = list.findIndex((n) => n.key === key);
  if (at >= 0) {
    // In place: the stack does not jump, the count says it happened again.
    const next = [...list];
    next[at] = { ...list[at], ...input, key, count: list[at].count + 1, at: now };
    return next;
  }
  const next = [...list, { ...input, id, key, count: 1, at: now }];
  if (next.length <= MAX_KEPT) return next;
  // Over the cap: the oldest note that would have timed out anyway goes first; errors go last.
  const drop = next.findIndex((n) => lifeMs(n) !== null);
  next.splice(drop >= 0 ? drop : 0, 1);
  return next;
}

export function dismissNote(list: readonly Note[], id: number): readonly Note[] {
  return list.some((n) => n.id === id) ? list.filter((n) => n.id !== id) : list;
}

/** Notes whose time is up at `now`. `paused` (pointer over the stack, or the window hidden) stops the clock. */
export function expireNotes(list: readonly Note[], now: number, paused = false): readonly Note[] {
  if (paused) return list;
  const next = list.filter((n) => { const life = lifeMs(n); return life === null || now - n.at < life; });
  return next.length === list.length ? list : next;
}

/** The newest three on screen, and how many more wait behind them. */
export function visibleNotes(list: readonly Note[]): { shown: readonly Note[]; more: number } {
  // Errors first in the cut (they must not be hidden behind passing notes), order on screen stays by arrival.
  if (list.length <= MAX_VISIBLE) return { shown: list, more: 0 };
  const errors = list.filter((n) => lifeMs(n) === null).slice(-MAX_VISIBLE);
  const room = MAX_VISIBLE - errors.length;
  const rest = room > 0 ? list.filter((n) => lifeMs(n) !== null).slice(-room) : [];
  const keep = new Set([...errors, ...rest].map((n) => n.id));
  const shown = list.filter((n) => keep.has(n.id));
  return { shown, more: list.length - shown.length };
}
