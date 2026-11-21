// ─── Q0540 (DVPN-WIN): a kept kill switch block is named at connect, never blamed on the server ───
// After a crash under the kill switch, the kept block stops the app's server check and the chain, so
// every other server read "Node is not reachable". The block is not lifted for the connect (that would
// leak what the user chose to block); the failure says what it is and offers Restore network.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { connectActionButton } from '../../src/shared/connect-action';

const src = readFileSync(join(__dirname, '..', '..', 'src', 'main', 'services', 'connection.ts'), 'utf8');

describe('connect under a kept kill switch block (Q0540)', () => {
  const at = src.indexOf('const blocker = await preflight(req, owner, d.device);');
  const body = src.slice(at, at + 2600); // the Q0560 switch branch sits between the Q0540 branch and the plain failure
  it('a failed server check with the kill switch on and no internet says the kill switch, with Restore network', () => {
    expect(at).toBeGreaterThan(0);
    expect(body).toMatch(/getDaemonSettings\(\)\.settings\.killSwitch !== 'off' && !\(await internetReachable\(getRpcUrls\(\)\)\)/);
    expect(body).toMatch(/return fail\(KILL_SWITCH_HELD_CONNECT\(\), 'kill-switch-held', 'Restore network', req\.node\);/);
    expect(src).toMatch(/KILL_SWITCH_HELD_CONNECT = \(\): string => tr\('The kill switch is still blocking the internet[^']*Restore network[^']*Nothing was paid\.'/);
  });
  it('Agent M xrp ks_persist: never while a session runs, and never for the daemon\'s "current session" refusal', () => {
    expect(body).toContain("if (!snapshot().session && !/current session/i.test(blocker.error)\n        && getDaemonSettings().settings.killSwitch !== 'off'");
  });
  it('negative control: otherwise the server check failure is shown as it was', () => {
    expect(body).toMatch(/return fail\(blocker\.error, blocker\.code \?\? 'preflight', blocker\.action \?\? null, req\.node\);/);
  });
  it('the action maps to the Restore network button', () => {
    expect(connectActionButton('Restore network')).toMatchObject({ target: 'restore', label: 'Restore network' });
  });
});
