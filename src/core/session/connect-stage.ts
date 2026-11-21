// ─── The stage of a connection, for every surface (UI-001 to UI-018) ───
// One mapping from (phase, coverage) to a stage, a tone and a step. The Connect screen, the
// status card and notifications all read it, so they cannot disagree. Pure: no clock, no DOM.
//
// A clean connect moves forward only: Getting ready → Deposit → Connecting → Checking → Protected.
// "Connected, not measured yet" is Checking in the working tone; it is never a warning.
import type { ConnPhase } from './state';
import { tr } from '../../shared/i18n';

export type Stage =
  | 'idle'
  | 'ready' // zero-cost checks, VPN service start
  | 'deposit'
  | 'connecting'
  | 'checking' // tunnel up, not yet proven
  | 'protected'
  | 'unprotected' // connected, but the measured exit says traffic is not covered
  | 'unconfirmed' // connected, and the app has no way to measure it
  | 'reconnecting'
  | 'ending'
  | 'problem';

/** neutral = nothing happening · working = in progress · ok = protected · warn = needs attention · bad = failed or blocked. */
export type Tone = 'neutral' | 'working' | 'ok' | 'warn' | 'bad';

export interface StageView {
  stage: Stage;
  /** The small label above the title. */
  label: string;
  tone: Tone;
  /** The ring turns: from the first stage through Checking, and while ending. */
  busy: boolean;
  /** 1–5 on the forward path, null elsewhere. */
  step: number | null;
  /** Shown at once: the minimum display time never delays these. */
  urgent: boolean;
}

export const STEPS = 5;

const VIEW = (): Record<Stage, Omit<StageView, 'stage'>> => ({
  idle: { label: tr('Your connection'), tone: 'neutral', busy: false, step: null, urgent: false },
  ready: { label: tr('Getting ready'), tone: 'working', busy: true, step: 1, urgent: false },
  deposit: { label: tr('Deposit'), tone: 'working', busy: true, step: 2, urgent: false },
  connecting: { label: tr('Connecting'), tone: 'working', busy: true, step: 3, urgent: false },
  checking: { label: tr('Checking'), tone: 'working', busy: true, step: 4, urgent: false },
  protected: { label: tr('Protected'), tone: 'ok', busy: false, step: 5, urgent: false },
  unprotected: { label: tr('Not protected'), tone: 'warn', busy: false, step: null, urgent: true },
  unconfirmed: { label: tr('Not confirmed'), tone: 'warn', busy: false, step: null, urgent: false },
  reconnecting: { label: tr('Reconnecting'), tone: 'warn', busy: true, step: null, urgent: true },
  ending: { label: tr('Disconnecting'), tone: 'working', busy: true, step: null, urgent: false },
  problem: { label: tr('Problem'), tone: 'bad', busy: false, step: null, urgent: true },
});

export interface StageInput {
  phase: ConnPhase;
  /**
   * While connected: true = covered as the title says, false = measured and not covered,
   * null = not measured yet, 'unknown' = cannot be measured (IP checks off, or this app is left out of a split).
   */
  covered: boolean | null | 'unknown';
  /** The internet may be blocked (Restore network is offered): always shown at once. */
  blocked?: boolean;
}

export function stageOf(i: StageInput): Stage {
  switch (i.phase) {
    case 'idle': return 'idle';
    case 'preflight': return 'ready';
    case 'paying': return 'deposit';
    case 'connecting': return 'connecting';
    case 'checking': return 'checking';
    case 'connected': return i.covered === null ? 'checking' : i.covered === 'unknown' ? 'unconfirmed' : i.covered ? 'protected' : 'unprotected';
    case 'reconnecting': return 'reconnecting';
    case 'disconnecting': return 'ending';
    case 'error': return 'problem';
    default: return 'idle';
  }
}

export function connectStage(i: StageInput): StageView {
  const stage = stageOf(i);
  const v = VIEW()[stage];
  return { stage, ...v, urgent: v.urgent || !!i.blocked };
}

// ─── Minimum display time (UI-002, UI-017) ───
// A message stays at least `minMs`. Messages arriving inside that window replace each other;
// only the latest is shown when the window ends. An urgent one is shown at once.

export interface Settled<T> {
  shown: T;
  /** ms epoch `shown` appeared. */
  since: number;
  /** Waiting to be shown at `since + minMs`; null when nothing waits. */
  pending: T | null;
}

export const DWELL_MS = 700;

export function settleStart<T>(value: T, now: number): Settled<T> {
  return { shown: value, since: now, pending: null };
}

/** A new value arrived at `now`. `same` compares what the user would see. */
export function settlePush<T>(s: Settled<T>, value: T, now: number, opts: { minMs?: number; urgent?: boolean; same?: (a: T, b: T) => boolean } = {}): Settled<T> {
  const same = opts.same ?? Object.is;
  if (same(s.shown, value)) return s.pending === null ? s : { ...s, pending: null };
  if (opts.urgent || now - s.since >= (opts.minMs ?? DWELL_MS)) return { shown: value, since: now, pending: null };
  return { ...s, pending: value };
}

/** The window may have ended at `now`: show what waited. */
export function settleTick<T>(s: Settled<T>, now: number, minMs = DWELL_MS): Settled<T> {
  if (s.pending === null || now - s.since < minMs) return s;
  return { shown: s.pending, since: now, pending: null };
}

/** ms until the waiting value is due; null when nothing waits. */
export function settleDue<T>(s: Settled<T>, now: number, minMs = DWELL_MS): number | null {
  return s.pending === null ? null : Math.max(0, s.since + minMs - now);
}
