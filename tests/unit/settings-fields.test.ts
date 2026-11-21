// ─── Audit U-9, U-10: Settings text boxes ───
// U-9: any settings change (a theme switch, a toggle) refilled every text box from storage and wiped an RPC list or
// a speed server being typed. U-10: the prepaid MB/min boxes took any number of digits; past ~1e21 the value went
// into the VPN service's settings as "1e+22".
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync('src/renderer/src/screens/Settings.tsx', 'utf8');

/** The screen's own helper, run as written (types stripped). */
function wholeUnitsFromSource(): (typed: string, max: number) => number {
  const start = src.indexOf('function wholeUnits(');
  expect(start).toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf('\n}\n', start) + 2).replace(/: (string|number)/g, '');
  return new Function(`${body}; return wholeUnits;`)() as (typed: string, max: number) => number;
}

describe('Settings: a change elsewhere keeps what is being typed (U-9)', () => {
  it('each text box is refilled only when its own stored value changed', () => {
    expect(src).toContain("if (!was || was.rpcUrls.join('\\n') !== settings.rpcUrls.join('\\n')) setRpcText(");
    expect(src).toContain('if (!was || was.speedOrigin !== settings.speedOrigin) setSpeedOrigin(settings.speedOrigin);');
    expect(src).toContain('if (!was || was.speedPin !== settings.speedPin) setSpeedPin(settings.speedPin);');
    expect(src).not.toContain('if (settings) { setRpcText(');
  });
});

describe('Settings: prepaid amounts stay whole numbers in range (U-10)', () => {
  it('clamps to 1..max and never yields an exponent', () => {
    const f = wholeUnitsFromSource();
    expect(f('50', 100_000)).toBe(50);
    expect(f('', 100_000)).toBe(1);
    expect(f('0', 100_000)).toBe(1);
    expect(f('12a3', 100_000)).toBe(123);
    expect(f('99999999999999999999999', 100_000)).toBe(100_000);
    expect(String(f('99999999999999999999999', 100_000) * 1e6)).not.toContain('e');
  });

  it('both boxes use it', () => {
    expect(src).toContain('prepayBytes: String(wholeUnits(e.target.value, PREPAY_MB_MAX) * 1e6)');
    expect(src).toContain('prepaySeconds: String(wholeUnits(e.target.value, PREPAY_MIN_MAX) * 60)');
  });
});
