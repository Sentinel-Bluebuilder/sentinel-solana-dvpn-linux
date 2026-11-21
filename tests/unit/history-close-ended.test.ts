// Q0505 (Linux hunt): a session dvpnd ended itself while no app watched stayed "active" in history.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryEntry } from '../../src/shared/types';

const files = new Map<string, unknown>();
vi.mock('../../src/main/store', () => ({
  readJson: (f: string, d: unknown) => (files.has(f) ? JSON.parse(JSON.stringify(files.get(f))) : d),
  writeJson: (f: string, v: unknown) => { files.set(f, JSON.parse(JSON.stringify(v))); },
}));

const { closeEndedHistory, listHistory } = await import('../../src/main/services/history');

const open = (id: string): HistoryEntry => ({
  id, node: 'N', country: '', service: 'hysteria2', startedAt: 1_000, endedAt: null,
  rxBytes: '0', txBytes: '0', spent: '0', channel: 'C', closeReason: null,
});
const byId = (id: string): HistoryEntry => listHistory().find((h) => h.id === id)!;

describe('closeEndedHistory (Q0505)', () => {
  beforeEach(() => files.clear());

  it('closes an entry the service lists as ended, with its totals and reason', () => {
    files.set('history.json', [open('a')]);
    const n = closeEndedHistory([{ id: 'a', running: false, endedAt: 5_000, rxBytes: '1037000000', txBytes: '9', spent: '1000000', reason: 'escrow exhausted' }], null, 9_999);
    expect(n).toBe(1);
    expect(byId('a')).toMatchObject({ endedAt: 5_000, rxBytes: '1037000000', spent: '1000000', closeReason: 'escrow exhausted' });
  });

  it('closes an entry the service no longer lists at all, keeping what it had', () => {
    files.set('history.json', [{ ...open('b'), rxBytes: '42' }]);
    expect(closeEndedHistory([], null, 7_000)).toBe(1);
    expect(byId('b')).toMatchObject({ endedAt: 7_000, rxBytes: '42', closeReason: 'Ended by the VPN service' });
  });

  it('negative control: running, reconnected-as-new and the shown session stay open; ended ones are not rewritten', () => {
    files.set('history.json', [open('run'), open('old'), open('shown'), { ...open('done'), endedAt: 2_000, closeReason: 'closed by client' }]);
    const n = closeEndedHistory([
      { id: 'run', running: true },
      { id: 'old', running: false, replacedBy: 'new' },
      { id: 'done', running: false, endedAt: 3_000, reason: 'other' },
    ], 'shown', 9_000);
    expect(n).toBe(0);
    expect(byId('run').endedAt).toBeNull();
    expect(byId('old').endedAt).toBeNull();
    expect(byId('shown').endedAt).toBeNull();
    expect(byId('done')).toMatchObject({ endedAt: 2_000, closeReason: 'closed by client' });
  });
});
