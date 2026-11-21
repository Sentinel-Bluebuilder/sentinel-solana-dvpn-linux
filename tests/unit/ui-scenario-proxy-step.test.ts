// ─── DVPN-WIN KSM10: the ui-scenario 'proxy' step drives the live proxy switch, never "Whole computer" ───
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const scenario = readFileSync('src/main/dev/ui-scenario.ts', 'utf8');
const split = readFileSync('src/renderer/src/screens/SplitTunnel.tsx', 'utf8');

describe('ui-scenario proxy step', () => {
  it('targets the "Send apps through the VPN now" switch by its aria-label', () => {
    expect(scenario).toContain(`input[role="switch"][aria-label^="Send apps through the VPN now"]`);
    // one whole sentence per OS (the proxy's name is never put inside another sentence)
    expect(split).toContain("<Switch label={osPick({ win32: tr('Send apps through the VPN now (Windows proxy)'), darwin: tr('Send apps through the VPN now (macOS system proxy)'), linux: tr('Send apps through the VPN now (desktop proxy, GNOME/KDE)') }, tr('Send apps through the VPN now (system proxy)'))}");
  });
  it('negative control: no longer the first <label> mentioning the OS proxy (that is the Whole computer row)', () => {
    const at = scenario.indexOf("case 'proxy': {");
    expect(at).toBeGreaterThan(0);
    expect(scenario.slice(at, at + 900)).not.toContain('/Windows proxy/i.test(l.textContent)');
    // The reason: the Whole computer row's help text names the OS proxy and comes before the proxy switches.
    const whole = split.indexOf('data-whole-device checked');
    const live = split.indexOf('Send apps through the VPN now (');
    expect(whole).toBeGreaterThan(0);
    expect(split.slice(split.lastIndexOf('<label', whole), whole)).toContain('the Windows proxy');
    expect(whole).toBeLessThan(live);
  });
});
