// ─── RESTORE-DEAD-NEXT (the agent kit rc.9): restore-network with a dead service names the one start line, then the restore ───
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { restoreDeadNext } from '../../src/cli/cli-fail';

describe('restoreDeadNext', () => {
  it('Windows: Start-Service of the c0 service (WFP filters stay with a persist kill switch), then restore again', () => {
    expect(restoreDeadNext('win32')).toBe("Start-Service 'sentinel-dvpnd$c0' in an administrator PowerShell, then devnet-dvpn daemon restore-network");
  });
  it('Linux: systemctl restart of the c0 unit, then restore again', () => {
    expect(restoreDeadNext('linux')).toBe('sudo systemctl restart sentinel-dvpnd@c0, then devnet-dvpn daemon restore-network');
  });
  it('other systems: daemon doctor', () => expect(restoreDeadNext('darwin')).toBe('devnet-dvpn daemon doctor --json'));
  it('daemon restore-network throws daemon-unavailable with that next before need()', () => {
    const src = fs.readFileSync(path.resolve('src/cli/daemon-cmd.ts'), 'utf8');
    const branch = src.slice(src.indexOf("sub === 'restore-network'"), src.indexOf("sub === 'uninstall'"));
    expect(branch).toMatch(/r\.code === 'daemon-unavailable'\) throw cliErr\('daemon-unavailable', restoreDeadNext\(\)/);
    expect(branch.indexOf('restoreDeadNext')).toBeLessThan(branch.indexOf('need(r)'));
  });
});
