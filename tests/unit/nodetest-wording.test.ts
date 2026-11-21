// ─── Rows 157, 158 (read off the gallery pictures): the Node test page never contradicts itself ───
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { historyLine, historyParts, type ServerSummary } from '../../src/core/nodetest/plan';
import { STAGES, STAGE_DOING, STAGE_LABEL } from '../../src/core/nodetest/stages';

const sum = (o: Partial<ServerSummary>): ServerSummary => ({ tested: true, lastVerdict: 'working', lastAt: 1, lastFive: ['working'], workingOfLastFive: 1, medianMbps: null, lastFailure: null, ...o });

describe('a server\'s past tests in one line', () => {
  it('never tested', () => expect(historyLine(sum({ tested: false }), 'x')).toBe('Never tested'));

  it('a slow server counts as connected: no "Slow, working 0 of 2"', () => {
    expect(historyLine(sum({ lastVerdict: 'slow', lastFive: ['slow', 'failed'], medianMbps: 21.3 }), 'Slow')).toBe('Slow last time, connected 1 of 2 times (typically 21.3 Mbps)');
  });

  it('a speed is shown only when the last test measured one', () => {
    expect(historyLine(sum({ lastVerdict: 'failed', lastFive: ['failed', 'working'], medianMbps: 240 }), 'Failed')).toBe('Failed last time, connected 1 of 2 times');
    expect(historyLine(sum({ lastVerdict: 'not-tested', lastFive: ['not-tested', 'working'], medianMbps: 12 }), 'Not tested')).toBe('Not tested last time, connected 1 of 1 times');
  });

  it('one test: no tally', () => {
    expect(historyLine(sum({ medianMbps: 86.4 }), 'Working')).toBe('Working last time (typically 86.4 Mbps)');
  });

  it('in parts for the two-line cell: the result, then tally and speed as one capitalised line', () => {
    expect(historyParts(sum({ lastVerdict: 'slow', lastFive: ['slow', 'failed'], medianMbps: 21.3 }), 'Slow')).toEqual({ head: 'Slow last time', tally: 'connected 1 of 2 times', speed: 'typically 21.3 Mbps', detail: 'Connected 1 of 2 times, typically 21.3 Mbps' });
    expect(historyParts(sum({ medianMbps: 86.4 }), 'Working').detail).toBe('Typically 86.4 Mbps');
    expect(historyParts(sum({ lastVerdict: 'not-tested', lastFive: ['not-tested', 'stopped'] }), 'Not tested').detail).toBeNull();
    const src = readFileSync('src/renderer/src/screens/NodeTest.tsx', 'utf8');
    expect(src).toContain('{hp.detail && <span className="block truncate text-fg-muted">{hp.detail}</span>}');
    expect(src).toContain('title={historyLine(sum, word)}');
  });

  it('only tests that never reached the server: no tally at all', () => {
    expect(historyLine(sum({ lastVerdict: 'not-tested', lastFive: ['not-tested', 'stopped'] }), 'Not tested')).toBe('Not tested last time');
  });
});

describe('the progress card', () => {
  it('every stage has a sentence of what is happening, different from its label', () => {
    for (const s of STAGES) {
      expect(STAGE_DOING()[s]).toMatch(/…$/);
      expect(STAGE_DOING()[s]).not.toBe(STAGE_LABEL[s]);
    }
  });

  it('the page uses them: place and connection type before the address, "selected of", no stage label as the step line', () => {
    const src = readFileSync('src/renderer/src/screens/NodeTest.tsx', 'utf8');
    expect(src).toContain('return STAGE_DOING()[p.step];');
    expect(src).not.toContain('return STAGE_LABEL[p.step];');
    expect(src).toContain('protocolLabel(p.protocol)'); // progressLine(progress, …): place and connection type before the address
    expect(src).toContain("tr('{length} selected of {length2}', { length: picked.length, length2: listed.length })");
    expect(src).toContain('historyLine(sum, word)');
  });
});
