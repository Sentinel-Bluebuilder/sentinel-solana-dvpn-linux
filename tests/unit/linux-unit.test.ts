// the agent kit T-C rows 16/17 (RC8 W47): an installed but stopped Linux service, and doctor while it is stopped.
import { describe, expect, it } from 'vitest';
import { parseUnitsShow, unitPair, stoppedStartNext, linuxDoctorRows } from '../../src/core/daemon/linux-unit';

const S = 'sentinel-dvpnd@c0';
const show = (svc: string, sock: string, load = 'loaded'): string =>
  `Id=${S}.service\nLoadState=${load}\nActiveState=${svc}\n\nId=${S}.socket\nLoadState=${load}\nActiveState=${sock}\n`;
const PASSED = { name: 'service_settings', ok: true, level: 'skip' as const, detail: 'run by the service itself (its settings are readable by root only); it is running, so they passed' };

describe('row 16: an installed but stopped service gets one start command, not a reinstall', () => {
  it('service + socket inactive -> sudo systemctl start <unit>.socket', () => {
    const p = unitPair(parseUnitsShow(show('inactive', 'inactive')), S);
    expect(p).toEqual({ installed: true, serviceActive: false, socketActive: false });
    expect(stoppedStartNext(p, S)).toBe(`sudo systemctl start ${S}.socket`);
  });
  it('socket listening (the service wakes on the first call) -> no start command', () => {
    expect(stoppedStartNext(unitPair(parseUnitsShow(show('inactive', 'active')), S), S)).toBeNull();
  });
  it('not installed -> no start command (daemon install stays the fix)', () => {
    const p = unitPair(parseUnitsShow(show('inactive', 'inactive', 'not-found')), S);
    expect(p.installed).toBe(false);
    expect(stoppedStartNext(p, S)).toBeNull();
  });
  it('systemd says nothing -> cannot tell, no start command', () => {
    expect(unitPair(parseUnitsShow(''), S)).toEqual({ installed: null, serviceActive: false, socketActive: false });
  });
});

describe('row 17: doctor checks the unit is active and the socket answers', () => {
  it('stopped: a fail row with the start command, and "it is running, so they passed" is not a pass', () => {
    const rows = linuxDoctorRows([PASSED], unitPair(parseUnitsShow(show('inactive', 'inactive')), S), false, S);
    expect(rows[0]).toMatchObject({ name: 'service', level: 'fail' });
    expect(rows[0].detail).toContain(`sudo systemctl start ${S}.socket`);
    expect(rows[1].detail).not.toMatch(/it is running/);
    expect(rows[1].detail).toMatch(/Not checked/);
  });
  it('running and answering: an ok service row, the service rows untouched', () => {
    const rows = linuxDoctorRows([PASSED], unitPair(parseUnitsShow(show('active', 'active')), S), true, S);
    expect(rows[0]).toMatchObject({ name: 'service', level: 'ok' });
    expect(rows[1]).toEqual(PASSED);
  });
  it('active but the socket does not answer: fail, restart named', () => {
    const rows = linuxDoctorRows([], unitPair(parseUnitsShow(show('active', 'active')), S), false, S);
    expect(rows[0].level).toBe('fail');
    expect(rows[0].detail).toContain('systemctl restart');
  });
  it('not installed: fail, daemon install named', () => {
    const rows = linuxDoctorRows([], unitPair(parseUnitsShow(show('inactive', 'inactive', 'not-found')), S), false, S);
    expect(rows[0].detail).toContain('daemon install --yes');
  });
});
