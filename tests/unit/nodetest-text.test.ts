// ─── UI-194 and UI-187: the Node test words on the page and the command line ───
// Verdicts in sentence case everywhere; the 10 Mbps bar said on the page; counts and stages as proper
// wording with commas, never fragments joined by a middle dot.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERDICT_TEXT, stagesText, tallyText, verdictText } from '../../src/core/nodetest/text';

describe('verdict words', () => {
  it('sentence case, the same on the page and the command line', () => {
    expect(Object.values(VERDICT_TEXT)).toEqual(['Working', 'Slow', 'Failed', 'Not tested', 'Stopped']);
    expect(readFileSync('src/cli/test-cmd.ts', 'utf8')).toContain('export const VERDICT_WORD: Record<TestVerdict, string> = VERDICT_TEXT;');
    const page = readFileSync('src/renderer/src/screens/NodeTest.tsx', 'utf8');
    // the page reads the same words through tr() (B3): in English, word for word what the terminal prints
    expect(page).toContain('const VERDICT_WORD = (): Record<TestVerdict, string> => verdictText();');
    expect(verdictText()).toEqual(VERDICT_TEXT);
    expect(page).not.toMatch(/uppercase \$\{VERDICT_CLASS/);
  });
});

describe('the bar is on the page', () => {
  it('under the plan line, and on the Working and Slow counts', () => {
    const page = readFileSync('src/renderer/src/screens/NodeTest.tsx', 'utf8');
    expect(page).toContain('A server counts as working at {SLOW_BELOW_MBPS} Mbps or more through it, and slow under that.');
    expect(page).toContain("<StatCell label={tr('Working')} value={counts.working} hint={tr('{SLOW_BELOW_MBPS} Mbps or more', { SLOW_BELOW_MBPS })} />");
    expect(page).toContain("<StatCell label={tr('Slow')} value={counts.slow} hint={tr('Under {SLOW_BELOW_MBPS} Mbps', { SLOW_BELOW_MBPS })} />");
  });
});

describe('command line wording', () => {
  it('counts with commas; not tested and stopped only when there are any', () => {
    expect(tallyText({ working: 1, slow: 33, failed: 2, notTested: 0, stoppedJobs: 0 })).toBe('Working 1, slow 33, failed 2');
    expect(tallyText({ working: 0, slow: 0, failed: 0, notTested: 3, stoppedJobs: 1 })).toBe('Working 0, slow 0, failed 0, not tested 3, stopped 1');
  });

  it('stages as passed and did not pass, with the exit address in brackets', () => {
    const stages = [
      { stage: 'found', ok: true, ms: 300 },
      { stage: 'exit-address', ok: true, ms: 300 },
      { stage: 'dns', ok: false, ms: 300 },
    ] as const;
    expect(stagesText({ stages: stages.map((s) => ({ ...s })), exitIp: '203.0.113.10' } as never)).toMatch(/^Passed: .+, .+ \(203\.0\.113\.10\)\. Did not pass: .+\.$/);
    expect(stagesText({ stages: [], exitIp: null } as never)).toBe('');
  });

  it('no middle dot left in the test command', () => {
    const src = readFileSync('src/cli/test-cmd.ts', 'utf8').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/\s·\s/);
  });
});
