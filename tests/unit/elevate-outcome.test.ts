import { describe, expect, it } from 'vitest';
import { noResultOutcome } from '../../src/main/system/elevate';

// ─── Admin step with no result file (#31 54b8ca4, Linux wording) ───
describe('noResultOutcome', () => {
  const base = { how: 'pkexec', exitCode: null, timedOut: false, timeoutMs: 120_000, stderr: '' };

  it('names the time limit when the step was cut off, never "declined"', () => {
    const r = noResultOutcome({ ...base, timedOut: true, exitCode: 126 });
    expect(r.status).toBe('error');
    expect(r.detail).toContain('within 120 s');
    expect(r.detail).not.toMatch(/declined/);
  });

  it('pkexec 126/127 is a declined prompt', () => {
    expect(noResultOutcome({ ...base, exitCode: 126 }).status).toBe('cancelled');
    expect(noResultOutcome({ ...base, exitCode: 127 }).status).toBe('cancelled');
  });

  it('sudo failures are errors with the last stderr line', () => {
    const r = noResultOutcome({ ...base, how: 'sudo', exitCode: 1, stderr: 'a\nsudo: a password is required\n' });
    expect(r).toEqual({ status: 'error', detail: 'The administrator step did not finish: sudo: a password is required' });
  });
});
