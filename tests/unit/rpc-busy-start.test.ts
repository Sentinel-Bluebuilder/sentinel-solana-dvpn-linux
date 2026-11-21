// ─── Connect right after a permission/limit transaction (owner's laptop 2026-11-12) ───
// The limit raise signed at 21:19:27, the deposit followed 4 s later, the public devnet RPC said busy.
// dvpnd's words were "unavailable: the network is unreachable or busy", which the 429-only retry did
// not know: the deposit had opened (adopted) and Connect still failed.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RPC_BUSY_DELAYS_MS } from '../../src/core/session/state';

const src = readFileSync('src/main/services/connection.ts', 'utf8');
const re = new RegExp(/export const RPC_BUSY_RE = \/(.+)\/i;/.exec(src)![1], 'i');

describe('RPC busy at session start', () => {
  it('dvpnd\'s own busy wording counts as busy, as does 429', () => {
    expect(re.test('StartSession: unavailable: the network is unreachable or busy right now; try again in a moment')).toBe(true);
    expect(re.test('429 Too Many Requests')).toBe(true);
    expect(re.test('node offline')).toBe(false); // negative control
  });
  it('both retry branches use it (no 429-only check left)', () => {
    expect(src).not.toContain('/429|Too Many Requests/i.test(msg)');
    expect((src.match(/RPC_BUSY_RE\.test\(msg\)/g) ?? []).length).toBe(2);
  });
  it('waits the project\'s 7 s between a just-signed permission and the deposit', () => {
    expect(src).toMatch(/export const TX_GAP_MS = 7000;/);
    const sign = src.indexOf('const blocked = await ensureDevicePermission(floor'); // rc.4 E-55: + { confirmSwitch }
    // CODE-AUDIT E6: on the public endpoint only (txGapMs), as row 73 asked.
    const wait = src.indexOf('if (gap > 0) await new Promise((r) => setTimeout(r, gap));');
    expect(src).toContain("return overLimitState().inUse === 'public' ? TX_GAP_MS : 0;");
    const start = src.indexOf('d = await whileWatched(() => waitForDaemon(SERVICE_WAIT_MS, daemonInfo));');
    expect(sign).toBeGreaterThan(0);
    expect(wait).toBeGreaterThan(sign);
    expect(wait).toBeLessThan(start);
  });
  it('backs off for about 40 s before giving up', () => {
    expect(RPC_BUSY_DELAYS_MS.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(40_000);
  });
});
