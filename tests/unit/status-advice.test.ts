import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../../src/main/scheduler', () => ({ runJobNow: vi.fn() }));
import { blockedAdvice } from '../../src/cli/status-cmd';

// ks-persist 2026-10-22: status said "disconnect gives the internet back", disconnect then said the
// Always kill switch keeps it blocked. Both now point at the same way out.
describe('blocked-internet advice', () => {
  it('On (= persist, Q0426) points at restore-network, not disconnect, and no longer says Always', () => {
    expect(blockedAdvice('persist')).not.toMatch(/Always/);
    expect(blockedAdvice('persist')).toMatch(/daemon restore-network/);
    expect(blockedAdvice('persist')).not.toMatch(/"disconnect" gives/);
  });
  it("an old 'on' config keeps pointing at disconnect", () => {
    expect(blockedAdvice('on')).toMatch(/"disconnect" gives the internet back/);
  });
});

// builder-kb C15: "IP check and speed test: Off = never contacted" — status's internet probe must
// use the core TCP-only check, never fetch a third-party service.
describe('status internet probe', () => {
  it('does not fetch third-party services', () => {
    const src = readFileSync(join(__dirname, '../../src/cli/status-cmd.ts'), 'utf8');
    expect(src).not.toMatch(/ipify|connectivity-check|fetch\(/);
    expect(src).toMatch(/from '\.\.\/core\/quality\/reachability'/);
  });
});
