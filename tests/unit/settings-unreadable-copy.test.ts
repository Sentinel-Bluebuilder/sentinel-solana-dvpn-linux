// ─── Q0544 UI arm (DVPN-LINUX): an installed service whose settings copy is empty is named on screen as the CLI does ───
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EMPTY_SETTINGS_COPY, unreadableSettingsCopy } from '../../src/shared/settings-copy';

describe('the unreadable-settings banner', () => {
  it('an empty copy gets the CLI words (Install service rewrites it)', () => {
    expect(unreadableSettingsCopy(true)).toBe(EMPTY_SETTINGS_COPY);
    expect(EMPTY_SETTINGS_COPY).toMatch(/is empty/);
  });
  it('negative control: a missing service still says install it first', () => {
    expect(unreadableSettingsCopy(false)).not.toBe(EMPTY_SETTINGS_COPY);
    expect(unreadableSettingsCopy(undefined)).toBe(unreadableSettingsCopy(false));
  });
  it('Kill switch and Settings both use it; the CLI uses the same string', () => {
    for (const f of ['src/renderer/src/screens/KillSwitch.tsx', 'src/renderer/src/screens/Settings.tsx']) {
      expect(readFileSync(f, 'utf8')).toContain('{unreadableSettingsCopy(daemon.empty)}');
    }
    expect(readFileSync('src/main/daemon/settings.ts', 'utf8')).toContain("export { EMPTY_SETTINGS_COPY } from '../../shared/settings-copy';");
  });
});
