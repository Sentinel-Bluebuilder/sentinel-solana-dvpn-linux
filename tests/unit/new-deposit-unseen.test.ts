// ─── U-M4-1 (rc9-c2): connect() never pays a new deposit whose amount was not shown ───
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { newDepositUnseen, priceRaised } from '../../src/main/services/connection';

const src = fs.readFileSync(path.resolve('src/main/services/connection.ts'), 'utf8');

describe('U-M4-1: newDepositUnseen', () => {
  it('a new deposit above zero with no shown amount is refused', () => {
    expect(newDepositUnseen('39000000', undefined)).toBe(true);
    expect(newDepositUnseen('39000000', '')).toBe(true);
    expect(newDepositUnseen('39000000', 'abc')).toBe(true);
  });
  it('a shown amount (equal or not) passes this check; priceRaised still guards a higher one', () => {
    expect(newDepositUnseen('39000000', '39000000')).toBe(false);
    expect(newDepositUnseen('39000000', '10')).toBe(false);
    expect(priceRaised('39000000', '10')).toBe(true);
  });
  it('a free server (escrow 0) needs no shown amount', () => {
    expect(newDepositUnseen('0', undefined)).toBe(false);
  });
});

describe('U-M4-1: wired before every new deposit', () => {
  it('the user connect refuses before cred = newChannel', () => {
    const at = src.indexOf("if (!reuse && newDepositUnseen(cost.escrow, req.shownEscrow)) {");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(src.indexOf('cred = reuse ? { channel: reuse } : { newChannel: { mode, escrow: cost.escrow } };'));
    expect(src.slice(at, at + 900)).toMatch(/return fail\(DEPOSIT_UNUSABLE_COPY\(\), 'deposit-unusable', 'Connect again', req\.node\);/);
  });
  it('the server-test connect refuses before its startWithRetry', () => {
    const at = src.indexOf("if (!open && newDepositUnseen(cost.escrow, req.shownEscrow)) { testRun = null; return no(DEPOSIT_UNUSABLE_COPY(), 'deposit-unusable'); }");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(src.indexOf('s = await startWithRetry(req.node, open ? { channel: open }'));
  });
});
