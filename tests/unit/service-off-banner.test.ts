// ─── Q0576 (owner laptop, 0.3.0-rc.2 upgrade): a stopped VPN service says so and offers the fix ───
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lostSetupCopy } from '../../src/core/session/setup-gate';

describe('service-off banner', () => {
  it('says the service is off and names the button, never only "keeps retrying"', () => {
    const c = lostSetupCopy('service');
    expect(c?.text).toBe('The VPN service is off, so you cannot connect. Press Start the VPN service to turn it back on.');
    expect(c?.text).not.toContain('keeps retrying');
  });
  it('the banner button carries that label on desktop', () => {
    expect(readFileSync('src/renderer/src/App.tsx', 'utf8')).toContain("<InstallServiceButton label={tr('Start the VPN service')} />"); // same words as the text on every OS (AND-34)
  });
  it('negative control: other steps keep their own copy', () => {
    expect(lostSetupCopy('device')?.text).toContain('could not be read');
  });
});
