// ─── rc.3.1 F1 (screen half): deposits from an earlier device of this wallet are labelled; Refund all says what it skipped ───
// The engine lists every deposit of the loaded wallet in snap.settlements. `device` = opened by a device that is not this
// computer's; `unverified` on an open row = that device can still spend, so `settle run` without channels skips it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const activity = readFileSync(join(__dirname, '../../src/renderer/src/screens/Activity.tsx'), 'utf8');
const wallet = readFileSync(join(__dirname, '../../src/renderer/src/screens/Wallet.tsx'), 'utf8');
const rowAt = activity.indexOf('function RefundRow(');
const row = activity.slice(rowAt, activity.indexOf('\n}\n', rowAt));

describe('Activity refund rows: a deposit from another device', () => {
  it('a row with device set shows the muted label, its short address, the tooltip and the hook', () => {
    expect(row).toContain("{s.device && <div className=\"text-meta text-fg-muted\" data-other-device-row={s.device}");
    expect(row).toContain("title={tr('This deposit was made by a device this wallet used before. It is refunded to this wallet.')}");
    expect(row).toContain("tr('From another device ({device})', { device: short(s.device) })");
  });

  it('an open unverified row says Refund all skips it, and keeps its own refund button', () => {
    expect(row).toContain("{s.unverified && s.status === 'open' && <div");
    expect(row).toContain("tr('That device can still spend, so Refund all skips it. Refund it by itself.')");
    // the row's own button is not hidden for these rows
    expect(row).toContain('{line.action && onRefund && <>');
    expect(row).not.toMatch(/line\.action && onRefund && !s\.unverified/);
  });

  it('Refund all does not count rows it will skip, and its toast says how many were skipped and why', () => {
    expect(activity).toContain("const skippedByAll = snap.settlements.filter((s) => s.unverified && s.status === 'open');");
    expect(activity).toContain('&& !skippedByAll.includes(s));');
    expect(activity).toContain('const skipped = confirm.channels ? 0 : skippedByAll.length;');
    expect(activity).toContain("'{count} deposit was skipped: the device that made it can still spend. Refund it by itself.'");
    expect(activity).toContain("'{count} deposits were skipped: the devices that made them can still spend. Refund each by itself.'");
  });
});

describe('Wallet: the dead device-active branch is gone', () => {
  it('no branch, state or note for a code the engine no longer sends', () => {
    expect(wallet).not.toContain("'device-active'");
    expect(wallet).not.toContain('otherActive');
    expect(wallet).not.toContain('data-other-active');
  });

  it('a failed read still says so', () => {
    expect(wallet).toContain("tr('Could not read its deposits. Try again.')");
  });
});
