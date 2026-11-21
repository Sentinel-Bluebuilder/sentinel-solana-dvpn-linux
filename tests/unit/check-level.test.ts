// ─── Q0547: a check nobody ran here is shown as skipped, never ✓ or ✗ ───
// DVPN-WIN r31: Diagnostics as the user showed ✗ "Access is denied" for the service's key on a working service.
// Fork 6.10 reports those checks as severity "skip"; before this, Mac turned an unknown severity green and every
// screen turned it red.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkMark, checksFine, levelFromSeverity } from '../../src/shared/check-level';

describe('check levels (Q0547)', () => {
  it('maps the fork severities, skip included', () => {
    expect(levelFromSeverity('skip', true)).toBe('skip');
    expect(levelFromSeverity('ok', true)).toBe('ok');
    expect(levelFromSeverity('warning', true)).toBe('warn');
    expect(levelFromSeverity('error', false)).toBe('fail');
  });
  it('negative controls: a failed row is never skip, an unknown severity is never green', () => {
    expect(levelFromSeverity('skip', false)).toBe('fail');
    expect(levelFromSeverity('surprise', true)).toBe('warn');
  });
  it('skip is grey with no tick or cross, labelled skip in the CLI, and not a problem', () => {
    expect(checkMark('skip')).toEqual({ symbol: '–', className: 'text-fg-muted', label: 'skip' });
    expect(checkMark('ok').symbol).toBe('✓');
    expect(checksFine([{ level: 'ok' }, { level: 'skip' }])).toBe(true);
    expect(checksFine([{ level: 'ok' }, { level: 'warn' }])).toBe(false);
  });
  it('every screen and the CLI use the one rule', () => {
    for (const f of ['src/renderer/src/screens/Diagnostics.tsx', 'src/renderer/src/screens/KillSwitch.tsx', 'src/renderer/src/screens/android/KillSwitchAndroid.tsx']) {
      const s = readFileSync(f, 'utf8');
      expect(s, f).toContain('checkMark(r.level)');
      expect(s, f).not.toContain("r.level === 'ok' ? '✓'");
    }
    expect(readFileSync('src/cli/daemon-cmd.ts', 'utf8')).toContain('${checkMark(r.level).label}');
  });
});
