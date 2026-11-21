// DVPN-WIN q0540-buttons r31: on a whole-computer V2Ray session the header said "Every app on this computer uses
// the VPN." and the "Which apps use the VPN" card below said "Only apps you point at the VPN proxy use it." V2Ray/Xray
// TUN sessions still carry a proxy endpoint; the card is for proxy sessions only.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { coverageCopy } from '../../src/core/session/coverage';

describe('the proxy card on Home', () => {
  const home = readFileSync('src/renderer/src/screens/Home.tsx', 'utf8');
  it('is hidden when the whole device or a split covers the session', () => {
    expect(home).toContain("{session.proxyEndpoint && !onAndroid() && !(snap.coverage === 'device' || snap.coverage?.startsWith('split')) && (");
  });
  it('the header for those states never says only proxy apps are covered (so the card would contradict it)', () => {
    expect(coverageCopy('device').title).toBe('Protected');
    expect(`${coverageCopy('device').detail}`).not.toMatch(/point at the VPN proxy/);
  });
  it('negative control: a proxy session keeps the card (its words are the only place that explains the proxy)', () => {
    expect(home).toContain("'Only apps you point at the VPN proxy use it. Your browser and other apps use your normal connection.'");
    expect(coverageCopy('proxy-only').ok).toBe(false);
  });
});
