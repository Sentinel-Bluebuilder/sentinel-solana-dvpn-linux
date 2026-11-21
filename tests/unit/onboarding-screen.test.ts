// UI-107 / UI-108: Onboarding says "server" and "payments", and a failed step says so under its button.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(resolve(__dirname, '../../src/renderer/src/screens/Onboarding.tsx'), 'utf8');
/** What a person reads: JSX text and string literals, without comments, hooks or import lines. */
const shown = src.split('\n').filter((l) => !/^\s*(\/\/|\{\/\*|import )/.test(l)).join('\n');

describe('Onboarding wording (UI-107)', () => {
  it('never says node, device key, base58 or solana-keygen', () => {
    for (const word of [/\bnodes?\b/i, /device key/i, /device&apos;s key/i, /base58/i, /solana-keygen/i, /JSON array/i]) expect(shown).not.toMatch(word);
  });
  it('names the step by what it does', () => {
    expect(src).toContain("byPlatform(tr('Set up payments on this computer'), tr('Set up payments on this phone'))");
    expect(src).toContain("'Set up payments'");
    expect(src).toContain('Payment address of the VPN service');
  });
});

describe('Onboarding failures are shown in place (UI-108)', () => {
  it('every wallet and payment call is quiet and reports through setFailed', () => {
    const calls = src.match(/call(<[^>]*>)?\(window\.api\.IPC\.(WALLET_CREATE|WALLET_IMPORT|WALLET_IMPORT_FILE|DAEMON_INIT)\b[^\n]*/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(6);
    for (const c of calls) expect(c).toContain('quiet: true');
    expect((src.match(/setFailed\(failText\(/g) ?? []).length).toBeGreaterThanOrEqual(7);
  });
  it('the message is an alert under the step, not a toast', () => {
    expect(src).toMatch(/role="alert" data-step-error/);
    expect((src.match(/<StepError text=\{failed\} \/>/g) ?? []).length).toBe(4);
    expect(src).not.toContain('.toast(');
  });
});