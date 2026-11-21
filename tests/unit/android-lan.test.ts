import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ANDROID_LAN_RANGES } from '../../src/shared/android/android-lan';

// Shared by all four apps; the Kotlin half exists only in the Android repo, so the cross-check runs there.
const ROUTE_SPLIT_KT = 'android/app/src/main/java/network/sentinel/devnetdvpn/vpn/RouteSplit.kt';

describe('Allow local network ranges (page = VPN engine)', () => {
  it.skipIf(!fs.existsSync(ROUTE_SPLIT_KT))('the page lists exactly what RouteSplit.kt leaves out', () => {
    const kt = fs.readFileSync(ROUTE_SPLIT_KT, 'utf8');
    const m = /val LAN = listOf\(([^)]*)\)/.exec(kt);
    expect(m, 'RouteSplit.LAN not found').not.toBeNull();
    const kotlin = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect(kotlin).toEqual([...ANDROID_LAN_RANGES]);
  });

  it('every range is a valid CIDR', () => {
    for (const r of ANDROID_LAN_RANGES) expect(r, r).toMatch(/^[0-9a-f.:]+\/\d{1,3}$/i);
  });
});
