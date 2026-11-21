// ─── One permission covers several connects (owner 2026-11-12) ───
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deviceLimitFor } from '../../src/core/session/device-limit';

const T = 1_000_000n; // 1 tDVPN in base units

describe('deviceLimitFor', () => {
  it("owner's case: a 66 tDVPN deposit raises the limit to 660, not 66", () => {
    expect(deviceLimitFor(50n * T, 66n * T)).toBe(660n * T);
  });
  it('a higher Settings limit wins', () => {
    expect(deviceLimitFor(1000n * T, 66n * T)).toBe(1000n * T);
  });
  it('the dialog and connect use the same rule', () => {
    expect(readFileSync('src/main/services/wallet.ts', 'utf8')).toContain("deviceLimitFor(BigInt(toBaseUnits(getSettings().allowanceTdvpn)), BigInt(minAllowanceBase || '0'))");
    expect(readFileSync('src/renderer/src/components/ConnectSheet.tsx', 'utf8')).toContain("deviceLimitFor(BigInt(toBaseUnits(settingTdvpn || '0')), BigInt(escrowBase || '0'))");
  });
});
