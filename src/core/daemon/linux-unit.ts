// ─── The Linux unit pair: sentinel-dvpnd@c0.service + its .socket (the agent kit T-C rows 16, 17; RC8 W47) ───
// An installed but STOPPED service was told `daemon install --yes` (a reinstall, root, a minute) where one
// `systemctl start` of the socket brings it back; and `daemon doctor` passed the root-only rows with "it is running,
// so they passed" while nothing ran. Here the two units are read from `systemctl show` (no root) and judged.
// Pure: the caller runs systemctl.

export interface UnitState { id: string; load: string | null; active: string | null }
export interface UnitPair { installed: boolean | null; serviceActive: boolean; socketActive: boolean }

/** `systemctl show <svc> <sock> -p Id -p LoadState -p ActiveState` (blocks separated by a blank line) -> one row per unit. */
export function parseUnitsShow(stdout: string): UnitState[] {
  return String(stdout ?? '').split(/\r?\n\s*\r?\n/).map((b) => {
    const v = (k: string): string | null => {
      const m = new RegExp(`^${k}=(.*)$`, 'm').exec(b);
      return m ? m[1].trim() : null;
    };
    return { id: v('Id') ?? '', load: v('LoadState'), active: v('ActiveState') };
  }).filter((u) => u.id);
}

const isActive = (u: UnitState | undefined): boolean => !!u && (u.active === 'active' || u.active === 'reloading' || u.active === 'activating');

/** The pair's state. installed: null = systemd said nothing (cannot tell). */
export function unitPair(rows: UnitState[], service: string): UnitPair {
  const svc = rows.find((u) => u.id === `${service}.service` || u.id === service);
  const sock = rows.find((u) => u.id === `${service}.socket`);
  if (!svc || svc.load === null) return { installed: null, serviceActive: false, socketActive: false };
  return { installed: svc.load === 'loaded', serviceActive: isActive(svc), socketActive: isActive(sock) };
}

/** Installed, and neither the service nor its socket runs: one command starts it (the socket wakes the service). */
export function stoppedStartNext(p: UnitPair, service: string): string | null {
  if (p.installed !== true || p.serviceActive || p.socketActive) return null;
  return `sudo systemctl start ${service}.socket`;
}

export interface DoctorRowLite { name: string; ok: boolean; level: 'ok' | 'warn' | 'fail' | 'skip'; detail: string }
const PASSED_BY_SERVICE = /it is running, so they passed/i;

/** Doctor, Linux: a `service` row from the units AND whether the socket answered; rows dvpnd passed "because it is
 *  running" read as not checked while it does not run. Pure. */
export function linuxDoctorRows<R extends DoctorRowLite>(rows: R[], p: UnitPair, answered: boolean, service: string): DoctorRowLite[] {
  const up = answered && (p.serviceActive || p.socketActive || p.installed === null);
  const start = stoppedStartNext(p, service);
  let svcRow: DoctorRowLite;
  if (up) svcRow = { name: 'service', ok: true, level: 'ok', detail: p.installed === null ? 'The service answered.' : `${service} is active and its socket answered.` };
  else if (p.installed === false) svcRow = { name: 'service', ok: false, level: 'fail', detail: 'The VPN service is not installed. Install it: devnet-dvpn daemon install --yes' };
  else if (start) svcRow = { name: 'service', ok: false, level: 'fail', detail: `The VPN service is installed but stopped. Start it: ${start}` };
  else svcRow = { name: 'service', ok: false, level: 'fail', detail: `${service} is ${p.serviceActive ? 'active' : 'listening'} but its socket did not answer. Restart it: sudo systemctl restart ${service}` };
  const out = rows.map((r): DoctorRowLite => (!up && PASSED_BY_SERVICE.test(r.detail)
    ? { ...r, level: 'skip', detail: 'Not checked: the service is not running (it checks its own settings when it starts).' }
    : r));
  return [svcRow, ...out];
}
