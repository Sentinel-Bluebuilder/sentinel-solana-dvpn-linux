// ─── Rows UI-095, 096, 097, 099: the Settings screen says things in plain words, in place ───
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync('src/renderer/src/screens/Settings.tsx', 'utf8');

describe('Settings screen', () => {
  it('UI-095: the payments switch has a short label, says "servers", and never prints the raw error', () => {
    expect(src).toContain("label={tr('Set up payments on first connect')}");
    expect(src).not.toContain('pay nodes');
    expect(src).not.toContain('snap.deviceAuto.error');
    expect(src).toContain('data-device-auto-failed');
  });

  it('UI-096: the expert rows sit under Advanced, in plain words; no "RPC" in a label or title', () => {
    expect(src).toContain('data-settings-advanced');
    const labels = [...src.matchAll(/<(?:Row label|Section title)=\{tr\('((?:[^'\\]|\\.)+)'\)/g)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThan(15); // positive control: the labels were found
    expect(labels.filter((l) => /RPC|Deposit block|Service defaults|dvpnd/.test(l))).toEqual([]);
    expect(labels).toContain('Solana connection for the VPN service');
    expect(src).toContain('data-rpc-same');
  });

  it('UI-096: "Use the same as this app" is never offered for an address that carries an access key', () => {
    expect(src).toContain("maskRpcKey(firstRpc) === firstRpc ? firstRpc : ''");
  });

  it('UI-097: a wrong spending limit is said under the field, not in a toast', () => {
    expect(src).toContain('data-field-error="allowance"');
    expect(src).not.toMatch(/toast\('warn', 'Device spending limit/);
  });

  it('UI-099: the SOL switch is worded as network fees', () => {
    expect(src).toContain("label={tr('Keep enough SOL for network fees')}");
    expect(src).not.toContain("Top up this device's SOL automatically");
  });
});
