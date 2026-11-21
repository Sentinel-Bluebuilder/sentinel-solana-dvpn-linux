// ─── On/off flags never swallow the next word (connect-71, rebuilt `test` command 7eb52b9) ───
import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../src/cli/args';

describe('boolean flags', () => {
  it('test plan --never-tested <server> keeps the server as a positional', () => {
    expect(parseArgs(['test', 'plan', '--never-tested', 'NodeA'])).toEqual({ _: ['test', 'plan', 'NodeA'], flags: { 'never-tested': true } });
  });
  it('--failed-last and --resume are on/off too', () => {
    expect(parseArgs(['test', 'run', '--failed-last', 'NodeA', '--resume', 'x'])).toEqual({ _: ['test', 'run', 'NodeA', 'x'], flags: { 'failed-last': true, resume: true } });
  });
  it('negative control: a value flag still takes the next word', () => {
    expect(parseArgs(['test', 'plan', '--country', 'DE']).flags).toEqual({ country: 'DE' });
  });
});
