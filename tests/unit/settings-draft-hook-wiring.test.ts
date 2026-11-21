// ─── Q0271: the settings hook keeps early edits (wiring guard) ───
// settings-draft-early-edit.test.ts covers the merge itself; there is no React test runner here, so
// this guards the hook's use of it: the first read must merge (keepEdits) and every edit must be
// recorded as touched. Reverting only the hook (FMC, Mac port) passed the merge test.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(__dirname, '../../src/renderer/src/lib/use-daemon-settings.ts'), 'utf8');

describe('useDaemonSettings wiring (Q0271)', () => {
  it('the first read keeps edits made before it answered', () => {
    // Q0508: one shared store; every screen open re-reads with keepEdits and merges the touched keys.
    expect(src).toMatch(/useEffect\(\(\) => \{[\s\S]{0,200}loadDaemonSettings\(\{ keepEdits: true \}\)/);
    expect(src).toMatch(/mergeLoaded\(d\.settings, st\.draft, st\.touched\)/);
  });

  it('every edit through setDraft is recorded as touched', () => {
    expect(src).toMatch(/changedKeys\(st\.draft, next\)\) touched\.add\(k\)/);
  });
});
