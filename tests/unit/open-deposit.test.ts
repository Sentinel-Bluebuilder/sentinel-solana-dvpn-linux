// ─── An open deposit is used before a new one (owner 2026-11-12) ───
// 21:19 a failed Connect paid 388 tDVPN per hour to 6M2KTW; 21:23 Connect per GB paid a second
// 66 tDVPN deposit to the same server and the first sat unused.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openDepositFor, closingDepositFor } from '../../src/core/session/open-deposit';
import type { PendingSettlement } from '../../src/shared/types';

const NODE = { address: '6M2KTW', pricePerGb: '66000000', pricePerHour: '97500000' };
const dep = (o: Partial<PendingSettlement>): PendingSettlement => ({ channel: 'c', node: NODE.address, mode: 1, escrow: '388000000', redeemed: '0', status: 'open', readyAt: null, refundable: '388000000', ...o });

describe('openDepositFor', () => {
  it("today's case: the open per-hour deposit is offered, in per-hour pricing", () => {
    expect(openDepositFor([dep({ channel: '54Fu' })], NODE)).toEqual({ channel: '54Fu', basis: 'per_hour', left: '388000000' });
  });
  it('picks the one with the most left', () => {
    const r = openDepositFor([dep({ channel: 'a', mode: 0, refundable: '70000000' }), dep({ channel: 'b', refundable: '200000000' })], NODE);
    expect(r?.channel).toBe('b');
  });
  it('negative controls: other server, closing, or less than one unit left', () => {
    expect(openDepositFor([dep({ node: 'other' })], NODE)).toBeNull();
    expect(openDepositFor([dep({ status: 'closing' })], NODE)).toBeNull();
    expect(openDepositFor([dep({ channel: 'live', status: 'in-use' })], NODE, 'live')).toBeNull();
    expect(openDepositFor([dep({ refundable: '1000' })], NODE)).toBeNull();
  });
});

describe('right after a disconnect', () => {
  it('a deposit still listed as in use, from a session that ended, is offered (owner 2026-11-12, HQXdwJ)', () => {
    expect(openDepositFor([dep({ channel: 'HQXd', mode: 0, status: 'in-use', escrow: '60000000', refundable: '52921331' })], NODE, null)?.channel).toBe('HQXd');
  });
  it('the list refreshes when a session ends, not only when one starts', () => {
    const s = readFileSync('src/main/scheduler.ts', 'utf8');
    expect(s).toContain('newSessionStarted(settleForSession, sid) || sessionEnded(settleForSession, sid)');
    expect(readFileSync('src/renderer/src/components/ConnectSheet.tsx', 'utf8')).toContain('openDepositFor(snap.settlements, node, snap.session?.channel ?? null)');
  });
});

describe('same rule as connect()', () => {
  it('owner 2026-11-12: 39 tDVPN left of a 54 tDVPN per-GB deposit is reused (less than a full GB, more than the first block)', () => {
    const n = { address: '7qEe4H', pricePerGb: '54000000', pricePerHour: '0' };
    expect(openDepositFor([dep({ node: '7qEe4H', channel: 'CMU4', mode: 0, escrow: '54000000', refundable: '38994449' })], n)).toEqual({ channel: 'CMU4', basis: 'per_gb', left: '38994449' });
  });
  it('a deposit already closing is reported, never offered for reuse', () => {
    const d = dep({ channel: 'CsPZ', mode: 0, status: 'closing', refundable: '62146351', readyAt: 1794440268 });
    expect(openDepositFor([d], NODE)).toBeNull();
    expect(closingDepositFor([d], NODE)).toEqual({ channel: 'CsPZ', left: '62146351', readyAt: 1794440268 });
    expect(closingDepositFor([{ ...d, refundable: '0' }], NODE)).toBeNull();
    expect(closingDepositFor([{ ...d, node: 'other' }], NODE)).toBeNull();
  });
  it('the dialog and connect() share prepayFor', () => {
    expect(readFileSync('src/core/session/open-deposit.ts', 'utf8')).toContain("import { prepayFor } from '../../shared/prepay-cap';");
    expect(readFileSync('src/main/services/connect-checks.ts', 'utf8')).toContain("import { prepayFor } from '../../shared/prepay-cap';");
    expect(readFileSync('src/renderer/src/components/ConnectSheet.tsx', 'utf8')).toContain('data-closing-deposit={closingDep.channel}');
  });
});

describe('wiring', () => {
  const sheet = readFileSync('src/renderer/src/components/ConnectSheet.tsx', 'utf8');
  const conn = readFileSync('src/main/services/connection.ts', 'utf8');
  it('the dialog starts on the open deposit, hides the amount, locks the other pricing, pays nothing', () => {
    expect(sheet).toContain('useState<Basis>(openDep ? openDep.basis :');
    expect(sheet).toContain('const reusing = !!openDep && openDep.basis === basis;');
    expect(sheet).toContain('{!reusing && <section>');
    expect(sheet).toContain('disabled={!offered || lockedOut}');
    // UI-044: a deposit that already exists adds nothing to the button; a new one names its amount.
    expect(sheet).toContain('const noDeposit = subscription || reusing;');
    expect(sheet).toContain("(noDeposit ? tr('Connect') : tr('Connect and deposit {amount}', { amount: preview.escrowText }))");
    expect(sheet).not.toMatch(/uses open deposit|Locked now|· lock /);
    expect(sheet).toContain('subscription || reusing ? null');
  });
  it('connect falls back to an open deposit in the other pricing before paying a new one', () => {
    const other = conn.indexOf("const otherBasis = req.basis === 'per_hour' ? 'per_gb' : 'per_hour';");
    const pay = conn.indexOf('cred = reuse ? { channel: reuse } : { newChannel: { mode, escrow: cost.escrow } };');
    expect(other).toBeGreaterThan(0);
    expect(other).toBeLessThan(pay);
  });
});
