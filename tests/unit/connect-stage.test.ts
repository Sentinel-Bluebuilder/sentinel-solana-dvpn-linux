// Rows UI-001, UI-002, UI-005, UI-017: one stage mapping and the minimum display time.
import { describe, expect, it } from 'vitest';
import { DWELL_MS, connectStage, settleDue, settlePush, settleStart, settleTick, stageOf, type Stage } from '../../src/core/session/connect-stage';
import type { ConnPhase } from '../../src/core/session/state';

const ORDER: Stage[] = ['ready', 'deposit', 'connecting', 'checking', 'protected'];

describe('connectStage', () => {
  it('a clean connect only moves forward, one step per stage', () => {
    const run: Array<[ConnPhase, boolean | null]> = [['preflight', null], ['paying', null], ['connecting', null], ['checking', null], ['connected', null], ['connected', true]];
    const steps = run.map(([phase, covered]) => connectStage({ phase, covered }).step);
    expect(steps).toEqual([1, 2, 3, 4, 4, 5]);
    const stages = run.map(([phase, covered]) => stageOf({ phase, covered }));
    for (let i = 1; i < stages.length; i += 1) expect(ORDER.indexOf(stages[i])).toBeGreaterThanOrEqual(ORDER.indexOf(stages[i - 1]));
  });

  it('no warning tone anywhere on a clean connect (UI-005)', () => {
    for (const phase of ['preflight', 'paying', 'connecting', 'checking', 'connected'] as ConnPhase[]) {
      expect(connectStage({ phase, covered: null }).tone).toBe('working');
    }
    expect(connectStage({ phase: 'connected', covered: true }).tone).toBe('ok');
  });

  it('the ring turns from the first stage through Checking (UI-001)', () => {
    for (const phase of ['preflight', 'paying', 'connecting', 'checking'] as ConnPhase[]) expect(connectStage({ phase, covered: null }).busy).toBe(true);
    expect(connectStage({ phase: 'connected', covered: null }).busy).toBe(true);
    expect(connectStage({ phase: 'connected', covered: true }).busy).toBe(false);
    expect(connectStage({ phase: 'idle', covered: null }).busy).toBe(false);
  });

  it('connected but measured as not covered is a warning, shown at once', () => {
    const v = connectStage({ phase: 'connected', covered: false });
    expect(v).toMatchObject({ stage: 'unprotected', tone: 'warn', urgent: true, label: 'Not protected' });
  });

  it('connected with no way to measure is "Not confirmed": a settled warning, not a spinner', () => {
    expect(connectStage({ phase: 'connected', covered: 'unknown' })).toMatchObject({ stage: 'unconfirmed', tone: 'warn', busy: false, label: 'Not confirmed' });
  });

  it('problems, reconnecting and a blocked internet are urgent; progress is not', () => {
    expect(connectStage({ phase: 'error', covered: null }).urgent).toBe(true);
    expect(connectStage({ phase: 'reconnecting', covered: null }).urgent).toBe(true);
    expect(connectStage({ phase: 'idle', covered: null, blocked: true }).urgent).toBe(true);
    expect(connectStage({ phase: 'paying', covered: null }).urgent).toBe(false);
    expect(connectStage({ phase: 'idle', covered: null }).urgent).toBe(false);
  });
});

describe('minimum display time', () => {
  it('a message stays at least the dwell time; the latest of several wins', () => {
    let s = settleStart('a', 1000);
    s = settlePush(s, 'b', 1100);
    expect(s.shown).toBe('a');
    s = settlePush(s, 'c', 1200);
    expect(s).toMatchObject({ shown: 'a', pending: 'c' });
    expect(settleDue(s, 1200)).toBe(DWELL_MS - 200);
    s = settleTick(s, 1000 + DWELL_MS - 1);
    expect(s.shown).toBe('a');
    s = settleTick(s, 1000 + DWELL_MS);
    expect(s).toMatchObject({ shown: 'c', pending: null, since: 1000 + DWELL_MS });
  });

  it('after the dwell time a new message shows at once', () => {
    const s = settlePush(settleStart('a', 0), 'b', DWELL_MS);
    expect(s).toMatchObject({ shown: 'b', pending: null });
  });

  it('an urgent message is never delayed', () => {
    const s = settlePush(settleStart('a', 0), 'blocked', 5, { urgent: true });
    expect(s).toMatchObject({ shown: 'blocked', since: 5, pending: null });
  });

  it('going back to what is shown drops what waited (no flash of a state that already passed)', () => {
    let s = settlePush(settleStart('Protected', 0), 'Reconnecting', 100);
    expect(s.pending).toBe('Reconnecting');
    s = settlePush(s, 'Protected', 300);
    expect(s).toMatchObject({ shown: 'Protected', pending: null });
    expect(settleTick(s, 5000).shown).toBe('Protected');
    expect(settleDue(s, 5000)).toBeNull();
  });

  it('compares by what the user would see', () => {
    const same = (a: { t: string }, b: { t: string }): boolean => a.t === b.t;
    const first = { t: 'x' };
    const s = settlePush(settleStart(first, 0), { t: 'x' }, 10, { same });
    expect(s.shown).toBe(first);
  });
});
