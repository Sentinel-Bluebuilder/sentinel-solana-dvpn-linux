// ─── Read off the 687e1af pictures (UI-187 gallery pass), fixed on the owner's word via UI-LEAD ───
// Kill switch with Off said what a drop does three times (status line, Off card, "What happens" panel): the
// status line now leaves it to the panel. Split tunnelling's Normal connection lane showed only a hidden IP
// ("····") under "Sites see": it now says it in words.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Kill switch, Off', () => {
  it('the status line does not repeat what the panel says', () => {
    const src = readFileSync('src/renderer/src/screens/KillSwitch.tsx', 'utf8');
    expect(src).toContain("{(state !== 'off' || live) && <p className=\"text-sm text-fg-dim\" data-ks-detail>{state === 'off' ? null : copy.detail}");
    // one whole sentence per mode (a translated name is never put inside another sentence)
    expect(src).toContain('<Section title={MODES().find((m) => m.id === mode)?.what}>');
    expect(src).toContain("what: tr('What happens with “Off”')");
    expect(src).toContain("what: tr('What happens with “On”')");
  });
});

describe('Split tunnelling, Normal connection lane', () => {
  it('says "Your own IP address" in words, not a hidden address', () => {
    const src = readFileSync('src/renderer/src/screens/SplitTunnel.tsx', 'utf8');
    expect(src).toContain('<span className="font-sans text-fg-dim" data-lane-direct-sees>{tr(\'Your own IP address\')}</span>');
    expect(src).not.toContain("<HiddenIp ip={snap.homeIp} /> : 'Your own IP'");
  });
});
