// ─── W91b (the agent kit rc.9): firstSetupLimit, the one rule for a first setup with no allowance given ───
import { describe, it, expect } from 'vitest';
import { firstSetupLimit } from '../../src/core/session/device-limit';

describe('firstSetupLimit', () => {
  it('the wallet holds less than the limit: the wallet amount', () => expect(firstSetupLimit(150n, 100n, 2n)).toBe(100n));
  it('never below this deposit', () => expect(firstSetupLimit(150n, 1n, 2n)).toBe(2n));
  it('negative controls: enough held, nothing held, or unknown: the limit as asked', () => {
    expect(firstSetupLimit(150n, 200n, 2n)).toBe(150n);
    expect(firstSetupLimit(150n, 0n, 2n)).toBe(150n);
    expect(firstSetupLimit(150n, null, 2n)).toBe(150n);
  });
});
