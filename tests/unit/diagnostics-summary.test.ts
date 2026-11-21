// ─── Diagnostics: the line above the service check never says "Every check passed." over a failed row ───
// Seen on the E-55 pictures (gallery, no service): the 'binary' row was a red cross ("The VPN service program
// is not installed with this app.", manager.ts) and the line above it read "Every check passed.".
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const diag = readFileSync(join(__dirname, '../../src/renderer/src/screens/Diagnostics.tsx'), 'utf8');
const fnAt = diag.indexOf('export function doctorSummary(');
const fn = diag.slice(fnAt, diag.indexOf('\n}\n', fnAt));

describe('Diagnostics service-check summary', () => {
  it('the line is drawn from doctorSummary and keeps a data hook', () => {
    expect(fnAt).toBeGreaterThan(-1);
    expect(diag).toContain('data-check-summary>{doctorSummary(doctor)}</p>');
  });

  it('a failed row is named before a warning, and "Every check passed." comes only after both', () => {
    const fail = fn.indexOf("r.level === 'fail'");
    const warn = fn.indexOf("r.level === 'warn'");
    const all = fn.indexOf("tr('Every check passed.')");
    expect(fail).toBeGreaterThan(-1);
    expect(warn).toBeGreaterThan(fail);
    expect(all).toBeGreaterThan(warn);
    expect(fn).toContain("tr('A check found a problem: see the rows marked with a cross.')");
  });

  it('no other place in the screen says every check passed', () => {
    expect(diag.split("tr('Every check passed.')").length).toBe(2);
  });
});
