// dvpnd doctor JSON changed case between dfe36c7 and cf4c372; the CLI crashed on `padEnd` of undefined.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/main/system/elevate', () => ({ runElevated: vi.fn() }));
vi.mock('../../src/main/store', () => ({ readJson: vi.fn(), writeJson: vi.fn() }));

import { parseDoctorRows } from '../../src/main/daemon/manager';

describe('parseDoctorRows', () => {
  it('reads cf4c372 lowercase rows (verbatim shape, 2026-10-21)', () => {
    const rows = parseDoctorRows('[{"detail":"no persisted kill switch","name":"kill_switch","ok":true},{"detail":"","name":"rpc","ok":true},{"detail":"holds no grant","name":"grant","ok":false}]');
    expect(rows.map((r) => `${r.name}:${r.level}`)).toEqual(['kill_switch:ok', 'rpc:ok', 'grant:fail']);
  });
  it('a failed grant row reads as plain copy, not a dvpnctl command', () => {
    const [g] = parseDoctorRows('[{"detail":"6dJ3 holds no grant; run dvpnctl grant open-grant --key <owner>","name":"grant","ok":false}]');
    expect(g.detail).not.toMatch(/dvpnctl|--key/);
    expect(g.detail).toMatch(/no spending limit yet/);
  });
  it('still reads dfe36c7 capitalised rows', () => {
    expect(parseDoctorRows('[{"Name":"mandate","OK":false,"Detail":"x"}]')[0]).toEqual({ name: 'mandate', ok: false, level: 'fail', detail: 'x' });
  });
});

describe('doctor levels (owner laptop 2026-10-22: "!" on a healthy kill switch)', () => {
  it('kill switch with nothing held is OK, plain words', () => {
    const [r] = parseDoctorRows(JSON.stringify([{ name: 'kill_switch', ok: true, detail: 'no persisted kill switch' }]));
    expect(r.level).toBe('ok');
    expect(r.detail).toMatch(/Nothing held/);
  });
  it('kill switch unpinned is a warning; service_* advisories stay warnings; other OK rows are OK', () => {
    const rows = parseDoctorRows(JSON.stringify([
      { name: 'kill_switch', ok: true, detail: 'store unusable: x; checks run unpinned' },
      { name: 'service_adapter_openvpn', ok: true, detail: 'adapter missing' },
      { name: 'rpc', ok: true, detail: 'slot 123' },
    ]));
    expect(rows.map((r) => r.level)).toEqual(['warn', 'warn', 'ok']);
  });
});

// cb33 rows carry a severity (sentinel-go-sdk service.PreflightCheck; ok = severity != "error"); the texts
// are cb33 doctor.go checkLeftoverKillSwitch.
describe('doctor levels from cb33 severity', () => {
  it("the running session's kill-switch row is OK; a row left over is a warning; error is a failure", () => {
    const rows = parseDoctorRows(JSON.stringify([
      { name: 'kill_switch', ok: true, severity: 'ok', detail: "a non-persistent kill switch row belongs to the running daemon's session; checks run unpinned" },
      { name: 'kill_switch', ok: true, severity: 'warning', detail: 'a non-persistent kill switch row is left over; the next run releases it' },
      { name: 'grant', ok: false, severity: 'error', detail: 'no grant' },
      { name: 'service_adapter_openvpn', ok: true, severity: 'ok', detail: 'adapter present' },
    ]));
    expect(rows.map((r) => r.level)).toEqual(['ok', 'warn', 'fail', 'ok']);
    expect(rows[2].detail).toMatch(/no spending limit yet/);
  });
  it('nothing held still reads in plain words with a severity', () => {
    const [r] = parseDoctorRows(JSON.stringify([{ name: 'kill_switch', ok: true, severity: 'ok', detail: 'no persisted kill switch' }]));
    expect(r).toMatchObject({ level: 'ok', detail: expect.stringMatching(/Nothing held/) });
  });
});
