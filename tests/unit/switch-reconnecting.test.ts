// ─── Q0560 (DVPN-WIN hunt ksw rc2 r91/r92 w-06): a switch while the session reconnects, under the kill switch ───
// The app checks the NEW server before it leaves the current one. Under the kill switch the only way out is the
// current tunnel; while the daemon redials it, that check fails ('Node did not answer: read ECONNRESET', 'Node is
// not reachable') and the app said 'Pick another server', blaming a healthy server. Now it says what is true.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { connectActionButton } from '../../src/shared/connect-action';

const src = readFileSync(join(__dirname, '..', '..', 'src', 'main', 'services', 'connection.ts'), 'utf8');

describe('switch while the current session reconnects under the kill switch (Q0560)', () => {
  const at = src.indexOf('const blocker = await preflight(req, owner, d.device);');
  const body = src.slice(at, at + 2600);

  it('a failed check of the new server on a switch, kill switch on, session reconnecting: says so, nothing paid', () => {
    expect(at).toBeGreaterThan(0);
    expect(body).toContain("if (req.switch && snapshot().session && !/current session/i.test(blocker.error)\n        && getDaemonSettings().settings.killSwitch !== 'off' && await currentSessionReconnecting()) {");
    expect(body).toContain("return fail(SWITCH_WHILE_RECONNECTING(), 'switch-reconnecting', 'Retry', req.node);");
    expect(src).toMatch(/SWITCH_WHILE_RECONNECTING = \(\): string => tr\('Your current connection is reconnecting[^']*Nothing was paid\.[^']*'/);
  });

  it('it asks the daemon\'s live list, not the screen (which waits out a short drop, Q0546)', () => {
    const fn = src.slice(src.indexOf('export async function currentSessionReconnecting'), src.indexOf('export async function currentSessionReconnecting') + 500);
    expect(fn).toContain('runningSession(await daemon().listSessions())');
    expect(fn).toContain("['reconnecting', 'checking'].includes(phaseFromDaemon(s.status, s.error))");
    expect(fn).toMatch(/catch \(err\) \{\s*log\.warn\('switch: could not list sessions'/);
  });

  it('negative control: a healthy session (or no switch) still shows the server check failure as it was', () => {
    const guard = body.indexOf('await currentSessionReconnecting()');
    const plain = body.indexOf("return fail(blocker.error, blocker.code ?? 'preflight', blocker.action ?? null, req.node);"); // rc.4 E-22: + code
    expect(guard).toBeGreaterThan(0);
    expect(plain).toBeGreaterThan(guard);
  });

  it('the action is a real button', () => {
    expect(connectActionButton('Retry')).toMatchObject({ target: 'same-node', label: 'Try again' });
  });
});
