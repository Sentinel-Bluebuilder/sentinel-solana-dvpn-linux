// ─── RC9-WIRE (the agent kit rc.9): a key file that could not be locked is deleted before any key is written: nothing signed ───
import { describe, it, expect } from 'vitest';
import { moneyOf, moneyNote } from '../../src/cli/money-note';

describe('keyfile-lock-failed (WIN-W1)', () => {
  it('money none; on wallet: "Nothing was sent or signed."', () => {
    expect(moneyOf('keyfile-lock-failed')).toBe('none');
    expect(moneyNote('keyfile-lock-failed', 'wallet')).toBe('Nothing was sent or signed.');
  });
});
