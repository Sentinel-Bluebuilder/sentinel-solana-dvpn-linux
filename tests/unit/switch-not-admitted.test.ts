// ─── Q0557 (Agent M, Mac 6.13): a switch refused by the kept kill switch block is said plainly, with Restore network ───
import { describe, expect, it } from 'vitest';
import { connectErrorCopy } from '../../src/core/session/state';

describe('switch under the kill switch: new server not admitted', () => {
  it('names the kill switch and offers Restore network, never the catch-all', () => {
    const e = connectErrorCopy('rpc error: code = FailedPrecondition desc = starting session: node host is not admitted by the kill switch in place; StopSession releases it: 172.182.220.109');
    expect(e.code).toBe('kill-switch-held');
    expect(e.action).toBe('Restore network');
    expect(e.message).toMatch(/kill switch.*Restore network.*Nothing was paid/);
    expect(e.message).not.toMatch(/Something went wrong/);
  });
  it('Q0561: the old tunnel still closing is a plain retry, never the catch-all', () => {
    const e = connectErrorCopy("rpc error: code = Unavailable desc = the previous server's connection is still closing; nothing was paid; try again in a few seconds");
    expect(e.code).toBe('tunnel-closing');
    expect(e.message).toMatch(/still closing.*nothing was paid/);
  });
  it('DVPN-WIN q0563e: the service dropping mid-connect says so, never the catch-all', () => {
    const e = connectErrorCopy('StartSession: Connection dropped');
    expect(e.code).toBe('service-stopped-connecting');
    expect(e.message).toMatch(/VPN service stopped while connecting.*Restore network/);
  });
  it('negative control: an unknown error still gets the catch-all', () => {
    expect(connectErrorCopy('zzz unrelated failure').code).toBe('unknown');
  });
});
