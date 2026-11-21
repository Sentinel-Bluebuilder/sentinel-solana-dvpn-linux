// ─── rc.3.1 F1 (Windows device-switch run): settle list names the device that opened a deposit ───
// After a switch there and back, the replaced device's deposits were missing from settle list. The engine now lists
// every device's (readSettlements); a row another device opened carries `device`, and an open one it can still spend
// is `unverified` (settle run skips it unless named with --channel). The CLI line says both.
import { describe, it, expect } from 'vitest';
import { settleRow } from '../../src/cli/commands';

const row = { channel: 'Chan1', node: 'NodeA', mode: 0, escrow: '2000000', redeemed: '0', status: 'open' as const, readyAt: null, refundable: '2000000' };

describe('F1: settle list rows of another device', () => {
  it('a row of this computer is unchanged', () => {
    expect(settleRow(row)).toBe('Chan1  open    refundable 2');
  });
  it('a row another device opened names it (short)', () => {
    expect(settleRow({ ...row, status: 'closing', device: 'DEVoldaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaQ7kp' })).toBe('Chan1  closing refundable 2  (device DEVo…Q7kp)');
  });
  it('an open deposit that device can still spend says how to refund it', () => {
    expect(settleRow({ ...row, device: 'DEVoldaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaQ7kp', unverified: true }))
      .toBe('Chan1  open    refundable 2  (device DEVo…Q7kp)  open on another device: settle run --channel Chan1 --yes refunds it');
  });
  it('negative control: unverified without a device still names the refund', () => {
    expect(settleRow({ ...row, unverified: true })).toMatch(/settle run --channel Chan1 --yes refunds it$/);
  });
});
