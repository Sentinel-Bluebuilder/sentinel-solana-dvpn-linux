// ─── Audit U-12: Android split lanes hide the exit addresses until tapped ───
// Every desktop screen hides an IP until it is clicked (owner 2026-11-12); the Android lanes printed both in full.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync('src/renderer/src/screens/android/SplitTunnelAndroid.tsx', 'utf8');

describe('Android split tunnelling lanes', () => {
  it('show the VPN exit and your own address through HiddenIp', () => {
    expect(src).toContain('<HiddenIp ip={lanes.vpnExit!} />');
    expect(src).toContain('<HiddenIp ip={lanes.directExit!} />');
    expect(src).not.toContain("lanes.vpnExit ?? 'being checked'");
    expect(src).not.toContain("lanes.directExit ?? 'not measured yet'");
  });
});
