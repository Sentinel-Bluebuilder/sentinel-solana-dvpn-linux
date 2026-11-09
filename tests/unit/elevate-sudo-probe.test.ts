import { describe, expect, it } from 'vitest';
import { sudoProbeVerdict, SUDO_PROBE_MS } from '../../src/main/system/elevate';

// ─── sudo -n probe: only a refusal means pkexec (Azure u2404, kill switch on, 2026-10-28) ───
describe('sudoProbeVerdict', () => {
  it('sudo -n true exited 0 → sudo', () => {
    expect(sudoProbeVerdict(null)).toBe('sudo');
  });

  it('sudo refused (exit 1, "a password is required") → pkexec', () => {
    const err = Object.assign(new Error('Command failed: sudo -n true\nsudo: a password is required'), { code: 1, killed: false, signal: null });
    expect(sudoProbeVerdict(err)).toBe('pkexec');
  });

  it('probe still running at the limit (slow own-hostname lookup) did not refuse → sudo', () => {
    const err = Object.assign(new Error('Command failed: sudo -n true'), { killed: true, signal: 'SIGTERM' });
    expect(sudoProbeVerdict(err)).toBe('sudo');
  });

  it('the limit is above the ~10-20 s stall seen during a kill-switch session', () => {
    expect(SUDO_PROBE_MS).toBeGreaterThanOrEqual(20_000);
  });
});
