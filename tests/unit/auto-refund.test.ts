// ─── Idle deposits: per GB kept a day for a reconnect, per hour refunded in 10 min (owner 2026-11-12) ───
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dueForAutoRefund, KEEP_PER_GB_S, KEEP_PER_HOUR_S } from '../../src/core/settlement/auto-refund';
import { planChannel } from '../../src/core/settlement/settlement';

const STREAM = 1;
const NOW = 1_794_442_000;

describe('dueForAutoRefund', () => {
  it("owner's case: per-GB HQXdwJ, last session 23:37, is still kept at 00:33 (56 min later)", () => {
    const last = new Map([['HQX', NOW - 56 * 60]]);
    expect(dueForAutoRefund([{ channel: 'HQX', status: 'open', mode: 0, openedAt: NOW - 58 * 60 }], last, NOW, STREAM)).toEqual([]);
  });
  it('per GB is refunded after a day idle', () => {
    expect(dueForAutoRefund([{ channel: 'a', status: 'open', mode: 0 }], new Map([['a', NOW - KEEP_PER_GB_S]]), NOW, STREAM)).toEqual(['a']);
  });
  it('per hour is refunded 10 min after its session (its clock keeps running)', () => {
    expect(dueForAutoRefund([{ channel: 'h', status: 'open', mode: STREAM }], new Map([['h', NOW - KEEP_PER_HOUR_S]]), NOW, STREAM)).toEqual(['h']);
    expect(dueForAutoRefund([{ channel: 'h', status: 'open', mode: STREAM }], new Map([['h', NOW - 60]]), NOW, STREAM)).toEqual([]);
  });
  it('never touches a deposit in use, already refunding, or with nothing known', () => {
    const old = new Map([['x', NOW - 10 * KEEP_PER_GB_S]]);
    for (const status of ['in-use', 'closing', 'ready'] as const) expect(dueForAutoRefund([{ channel: 'x', status, mode: 0 }], old, NOW, STREAM)).toEqual([]);
    expect(dueForAutoRefund([{ channel: 'y', status: 'open', mode: 0 }], new Map(), NOW, STREAM)).toEqual([]);
  });
});

describe('CODE-AUDIT E1: a per-hour deposit as readSettlements lists it (ready, never open)', () => {
  const stream = { address: 'h', owner: 'O', node: 'N', opener: 'D', mode: STREAM, status: 0, escrow: '100', redeemed: '0', closeStartedAt: 0, rentPayer: 'R' };
  it('the planner lists an open per-hour deposit as a one-step close, which settlement shows as ready', () => {
    expect(planChannel(stream, { now: NOW, graceSeconds: 7200, inUse: new Set() }).kind).toBe('close');
  });
  it('a ready per-hour deposit idle 10 min is refunded by the idle check (survives an app restart)', () => {
    expect(dueForAutoRefund([{ channel: 'h', status: 'ready', mode: STREAM }], new Map([['h', NOW - KEEP_PER_HOUR_S]]), NOW, STREAM)).toEqual(['h']);
  });
  it('negative controls: per-hour still recent, per-hour in use, per-GB ready (dvpnd closes it), nothing known', () => {
    expect(dueForAutoRefund([{ channel: 'h', status: 'ready', mode: STREAM }], new Map([['h', NOW - 60]]), NOW, STREAM)).toEqual([]);
    expect(dueForAutoRefund([{ channel: 'h', status: 'in-use', mode: STREAM }], new Map([['h', NOW - KEEP_PER_GB_S]]), NOW, STREAM)).toEqual([]);
    expect(dueForAutoRefund([{ channel: 'g', status: 'ready', mode: 0 }], new Map([['g', NOW - 10 * KEEP_PER_GB_S]]), NOW, STREAM)).toEqual([]);
    expect(dueForAutoRefund([{ channel: 'h', status: 'ready', mode: STREAM }], new Map(), NOW, STREAM)).toEqual([]);
  });
  it('settlement.ts picks its candidates with the same rule', () => {
    expect(readFileSync('src/main/services/settlement.ts', 'utf8')).toContain('all.filter((x) => idleCandidate(x, MODE_STREAM))');
  });
});

describe('wiring', () => {
  const s = readFileSync('src/main/services/settlement.ts', 'utf8');
  it('the 10-min timer no longer refunds a per-GB deposit', () => {
    expect(s).toContain("if (!known || known.mode !== MODE_STREAM) { log.info('per-GB deposit kept for a reconnect', { channel }); return; }");
  });
  it('the idle check runs with every settlements poll and survives restarts (chain + dvpnd, not memory)', () => {
    expect(readFileSync('src/main/scheduler.ts', 'utf8')).toContain('run: async () => { await readSettlements(); await autoRefundIdle(); }');
    expect(s).toContain('for (const ses of await daemon().listSessions())');
  });
});
