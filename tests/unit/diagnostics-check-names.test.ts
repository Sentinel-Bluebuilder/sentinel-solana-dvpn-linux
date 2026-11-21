// ─── Diagnostics: every check the VPN service reports reads in the app's words ───
// The 687e1af pictures on the Windows VM (UI-187 gallery pass) showed the service's `delegate` check as a bare
// "Delegate". The names the service is known to send are mapped; the fallback only covers names a newer
// service adds. Source-text checks, the convention for screens.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync('src/renderer/src/screens/Diagnostics.tsx', 'utf8');
const table = /const CHECK_NAMES = \(\): Record<string, string> => \(\{([\s\S]*?)\n\}\);/.exec(src)?.[1] ?? '';

describe('Diagnostics check names', () => {
  it('the table is there (positive control)', () => {
    expect(table).toContain("kill_switch: tr('Kill switch state')");
  });

  it('the token approval reads as the spending limit, not "Delegate"', () => {
    expect(table).toContain("delegate: tr('Spending limit')");
  });

  it('every name the service is known to send has a name of its own', () => {
    for (const n of ['kill_switch', 'build', 'rpc', 'mint', 'clock', 'key', 'grant', 'mandate', 'delegate', 'privileges', 'dns_backend', 'kill_switch_backend', 'dns_servers', 'other_vpn']) {
      expect(table, n).toMatch(new RegExp(`\\b${n}: tr\\('`));
    }
  });
});
