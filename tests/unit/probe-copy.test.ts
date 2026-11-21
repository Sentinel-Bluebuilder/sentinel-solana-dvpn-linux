// ─── The server check's errors are read by people (a refused connect shows them, ". Nothing was paid.") ───
// docs/DESIGN.md → Copy: "server", never "node"; the census still reads them (core/nodes/census.ts silentReason).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = readFileSync(join(__dirname, '../../src/core/nodes/discovery.ts'), 'utf8');

/** The fixed texts probeNode puts in `error`. */
function probeErrors(): string[] {
  return [...SRC.matchAll(/(?:out\.error|authError) = (?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

describe('server check error texts', () => {
  it('finds every fixed text (positive control)', () => {
    expect(probeErrors().length).toBeGreaterThanOrEqual(11);
  });

  it('none says "node", "metadata", "on-chain" or "TLS"', () => {
    expect(probeErrors().filter((t) => /\bnodes?\b|metadata|on-chain|\bTLS\b/i.test(t))).toEqual([]);
  });

  it('the census still finds its three words', () => {
    const all = probeErrors().join('\n').toLowerCase();
    for (const w of ['not a valid url', 'not reachable', 'answered http']) expect(all).toContain(w);
  });
});
