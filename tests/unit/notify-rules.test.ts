// Rows UI-030 to UI-035: one notification per event, errors stay, three visible.
import { describe, expect, it } from 'vitest';
import { MAX_KEPT, MAX_VISIBLE, dismissNote, expireNotes, lifeMs, pushNote, shownByScreen, visibleNotes, type Note } from '../../src/core/app/notify-rules';

const add = (list: readonly Note[], kind: Note['kind'], message: string, id: number, now = 0, extra = {}): readonly Note[] => pushNote(list, { kind, message, ...extra }, id, now);

describe('notification rules', () => {
  it('the same event replaces the one showing and counts up (UI-031)', () => {
    let l = add([], 'error', 'The Solana network did not answer.', 1, 0);
    l = add(l, 'info', 'Copied', 2, 10);
    l = add(l, 'error', 'The Solana network did not answer.', 3, 500);
    expect(l).toHaveLength(2);
    expect(l[0]).toMatchObject({ id: 1, count: 2, at: 500 });
  });

  it('a key ties different texts to one event', () => {
    let l = add([], 'info', 'Refund 1 of 3 sent', 1, 0, { key: 'refund' });
    l = add(l, 'success', 'Refunds sent', 2, 100, { key: 'refund' });
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ kind: 'success', message: 'Refunds sent', count: 2 });
  });

  it('an error never times out; the others do (UI-032)', () => {
    expect(lifeMs({ kind: 'error' })).toBeNull();
    expect(lifeMs({ kind: 'info', sticky: true })).toBeNull();
    let l = add([], 'error', 'Could not start the VPN service.', 1, 0);
    l = add(l, 'success', 'Added to your wallet', 2, 0);
    l = add(l, 'warn', 'Your deposit is running low.', 3, 0);
    expect(expireNotes(l, 4499)).toHaveLength(3);
    expect(expireNotes(l, 4500).map((n) => n.id)).toEqual([1, 3]);
    expect(expireNotes(l, 60_000).map((n) => n.id)).toEqual([1]);
  });

  it('the clock stops while the pointer is over the stack (UI-035)', () => {
    const l = add([], 'info', 'Copied', 1, 0);
    expect(expireNotes(l, 60_000, true)).toBe(l);
  });

  it('a repeat restarts the display time', () => {
    let l = add([], 'info', 'Copied', 1, 0);
    l = add(l, 'info', 'Copied', 2, 4000);
    expect(expireNotes(l, 5000)).toHaveLength(1);
    expect(expireNotes(l, 8500)).toHaveLength(0);
  });

  it('nothing the Connect screen already shows is also a notification (UI-033)', () => {
    expect(shownByScreen({ kind: 'success', message: 'Connected' }, 'home')).toBe(true);
    expect(pushNote([], { kind: 'success', message: 'Connected' }, 1, 0, 'home')).toHaveLength(0);
    expect(pushNote([], { kind: 'success', message: 'Connected' }, 1, 0, 'nodes')).toHaveLength(1);
    // positive control: a problem is never suppressed
    expect(pushNote([], { kind: 'error', message: 'Connected' }, 1, 0, 'home')).toHaveLength(1);
  });

  it('an empty message is not a notification', () => {
    expect(add([], 'error', '  ', 1)).toHaveLength(0);
  });

  it('three visible, the rest counted; errors are never the hidden ones (UI-035)', () => {
    let l: readonly Note[] = [];
    l = add(l, 'error', 'e1', 1);
    for (let i = 2; i <= 6; i += 1) l = add(l, 'info', `i${i}`, i);
    const v = visibleNotes(l);
    expect(v.shown).toHaveLength(MAX_VISIBLE);
    expect(v.shown.map((n) => n.id)).toEqual([1, 5, 6]);
    expect(v.more).toBe(3);
  });

  it('the list is capped; passing notes go before errors', () => {
    let l: readonly Note[] = [];
    l = add(l, 'error', 'e1', 1);
    for (let i = 2; i <= MAX_KEPT + 3; i += 1) l = add(l, 'info', `i${i}`, i);
    expect(l).toHaveLength(MAX_KEPT);
    expect(l[0].id).toBe(1);
  });

  it('dismiss removes one and returns the same list when the id is unknown', () => {
    const l = add([], 'info', 'Copied', 1);
    expect(dismissNote(l, 9)).toBe(l);
    expect(dismissNote(l, 1)).toHaveLength(0);
  });
});
