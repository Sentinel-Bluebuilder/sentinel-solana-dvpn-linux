// ─── KSM7 UI arm (DVPN-WIN k7u2): after a restart while connected, the screen says the kill switch blocks ───
// Seen: the window came up on "Welcome back · Continue" with no word of the block; behind it the view was titled
// "Connection failed" though nothing was attempted.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync('src/renderer/src/App.tsx', 'utf8');
const conn = readFileSync('src/main/services/connection.ts', 'utf8');

describe('a kept block at start', () => {
  it('skips the welcome card so the blocked view (with Restore network) is what shows', () => {
    expect(app).toContain("const blockedNow = snap.conn.phase === 'error' && snap.conn.restoreNetwork === true;");
    expect(app).toContain('const showWelcome = snap.hasWallet && !welcomed && !sawSetup.current && !blockedNow;');
  });
  it('every kept-block view is titled "Internet blocked by the kill switch", never "Connection failed"', () => {
    expect(conn).toContain("export const BLOCKED_TITLE = (): string => tr('Internet blocked by the kill switch');");
    const lines = conn.split('\n').filter((l) => l.includes('blockedAfterEnd(') && l.includes('restoreNetwork: true }'));
    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const l of lines) expect(l).toContain('title: BLOCKED_TITLE(), restoreNetwork: true }');
  });
  it('negative control: the "VPN service stopped" view keeps its own title', () => {
    expect(conn).toMatch(/title: tr\('VPN service stopped'\), restoreNetwork: true/);
  });
});
