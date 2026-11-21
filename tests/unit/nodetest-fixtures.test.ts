// The gallery states of the Node test page must show what their names say (screenshots rest on them).
import { describe, it, expect } from 'vitest';
import { nodeTestPreviews } from '../../src/core/nodetest/fixtures';
import { census } from '../../src/core/nodes/census';
import { tally } from '../../src/core/nodetest/stages';

const NOW = 1_800_000_000_000;
const all = nodeTestPreviews(NOW);
const by = (id: string) => all.find((p) => p.id === id)!;

describe('node test gallery fixtures', () => {
  it('six states with unique ids', () => {
    expect(all.map((p) => p.id)).toEqual(['empty', 'picked', 'low-limit', 'running', 'finished', 'unfinished']);
  });

  it('the server list shows usable, offline and full servers, all checked', () => {
    const c = census(by('empty').nodes, NOW);
    expect(c).toMatchObject({ onNetwork: 6, usable: 4, notAnswering: 1, notChecked: 0 });
    expect(c.entries.map((e) => e.state)).toContain('verified-busy');
  });

  it('the plan states: one batch at the full limit, servers left out at a low limit', () => {
    expect(by('picked').plan).toMatchObject({ jobs: 4, servers: 4, waitSeconds: 0 });
    expect(by('picked').plan!.overLimit).toHaveLength(0);
    expect(by('low-limit').plan!.overLimit).toHaveLength(1);
  });

  it('the finished run has one of each result, and the history gives "working N of the last M"', () => {
    const p = by('finished');
    expect(tally(p.hist.run!.results)).toMatchObject({ working: 1, slow: 1, failed: 1, notTested: 1 });
    expect(p.hist.runs).toHaveLength(2);
    expect(Object.keys(p.hist.history)).toHaveLength(4);
  });

  it('running and unfinished', () => {
    expect(by('running').progress).toMatchObject({ done: 1, total: 4, step: 'speed' });
    expect(by('running').hist.running).not.toBeNull();
    expect(by('unfinished').hist.runs[0]).toMatchObject({ resumable: true, done: 1, total: 4 });
  });
});
