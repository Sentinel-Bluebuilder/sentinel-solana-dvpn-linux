// Row 134: a failed DNS cache flush was logged with "Command failed" only (14 lines in the owner's app log,
// none explainable). The log line now carries the exit code, the signal, whether it timed out, and what
// ipconfig printed.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { flushFailure, flushNeedsAdmin } from '../../src/main/system/dns-check';

describe('a flush this Windows allows only to an administrator is not a fault (owner\'s laptop, build 9bf682c)', () => {
  it('"requires elevation" is recognised from what ipconfig printed', () => {
    const err = Object.assign(new Error('Command failed: ipconfig.exe /flushdns'), { code: 1 });
    expect(flushNeedsAdmin(flushFailure(err, 'Windows IP Configuration\r\n\r\nThe requested operation requires elevation.\r\n', ''))).toBe(true);
  });

  it('negative control: any other failure stays a warning', () => {
    const err = Object.assign(new Error('Command failed: ipconfig.exe /flushdns'), { code: 1 });
    expect(flushNeedsAdmin(flushFailure(err, 'Could not flush the DNS Resolver Cache: Function failed during execution.', ''))).toBe(false);
    expect(flushNeedsAdmin(flushFailure(Object.assign(new Error('spawn ipconfig.exe ENOENT'), { code: 'ENOENT' }), '', ''))).toBe(false);
  });
});

describe('a failed DNS cache flush says why', () => {
  it('exit code and what ipconfig printed', () => {
    const err = Object.assign(new Error('Command failed: ipconfig.exe /flushdns\nmore'), { code: 1 });
    const f = flushFailure(err, 'Windows IP Configuration\r\n\r\nCould not flush the DNS Resolver Cache: Function failed during execution.\r\n', '');
    expect(f).toMatchObject({ err: 'Command failed: ipconfig.exe /flushdns', code: 1, signal: null, timedOut: false, stderr: '' });
    expect(f.stdout).toBe('Windows IP Configuration Could not flush the DNS Resolver Cache: Function failed during execution.');
  });

  it('a flush that was stopped at the 10 s limit says so', () => {
    const err = Object.assign(new Error('Command failed: ipconfig.exe /flushdns'), { code: null, signal: 'SIGTERM', killed: true });
    expect(flushFailure(err, '', '')).toMatchObject({ code: null, signal: 'SIGTERM', timedOut: true });
  });

  it('a missing program keeps its code, and long output is cut', () => {
    const err = Object.assign(new Error('spawn ipconfig.exe ENOENT'), { code: 'ENOENT' });
    const f = flushFailure(err, undefined, 'x'.repeat(900));
    expect(f.code).toBe('ENOENT');
    expect(String(f.stderr).length).toBe(300);
    expect(f.stdout).toBe('');
  });
});
