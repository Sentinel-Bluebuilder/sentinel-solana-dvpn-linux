// ─── One rule for a service check's level, shared by every platform and screen (Q0547) ───
// The doctor runs as the user, so the checks that need the service's rights (its key, its privileges, its kill
// switch store) failed falsely (DVPN-WIN r31: ✗ "Access is denied" on a working service). Fork 6.10 reports them
// as severity "skip" ("Checked by the VPN service when it starts"). A skip is neither a tick nor a cross: nobody
// checked it here, so the screen must not claim either.

export type CheckLevel = 'ok' | 'warn' | 'fail' | 'skip';

/** A cb33 doctor row's severity (ok = severity != "error") to the level shown. An unknown severity is a warning,
 *  never a silent green (Mac manager.ts mapped anything else to ok). */
export function levelFromSeverity(severity: string, ok: boolean): CheckLevel {
  const sev = severity.toLowerCase();
  if (sev === 'error' || !ok) return 'fail';
  if (sev === 'skip') return 'skip';
  if (sev === 'warning') return 'warn';
  if (sev === 'ok' || sev === 'info' || sev === '') return 'ok';
  return 'warn';
}

/** The mark, colour and CLI label for a level. */
export function checkMark(level: CheckLevel): { symbol: string; className: string; label: string } {
  switch (level) {
    case 'ok': return { symbol: '✓', className: 'text-ok', label: 'ok  ' };
    case 'warn': return { symbol: '!', className: 'text-warn', label: 'warn' };
    case 'skip': return { symbol: '–', className: 'text-fg-muted', label: 'skip' };
    default: return { symbol: '✗', className: 'text-bad', label: 'FAIL' };
  }
}

/** A set of rows is fine when nothing failed or warned; skipped rows are not problems. */
export function checksFine(rows: Array<{ level: CheckLevel }>): boolean {
  return rows.every((r) => r.level === 'ok' || r.level === 'skip');
}
