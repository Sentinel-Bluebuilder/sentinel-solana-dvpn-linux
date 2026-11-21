// ─── grant-socket root step (Q0491; Linux side of the Windows app grantPipeAccess a2edc22) ───
// A second account on the machine got EACCES on the service socket and read "The VPN service is not running."
// The step grants ONLY the account that asked (pkexec PKEXEC_UID / sudo SUDO_UID), never a name passed in.
// Behaviour runs here only up to the first root action (no root, no /var/lib/sentinel-dvpn on the test box):
// the refusals and no-ops are exactly the paths that must hold before anything is written.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = 'resources/scripts/grant-socket.sh';
const src = fs.readFileSync(SCRIPT, 'utf8');
const unix = process.platform !== 'win32';

function run(env: Record<string, string>, args: string[] = []): { code: number; result: { status?: string; detail?: string } } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devnet-dvpn-'));
  const result = path.join(dir, 'result.json');
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'PKEXEC_UID' && k !== 'SUDO_UID')) as Record<string, string>;
  let code = 0;
  try {
    execFileSync('/bin/bash', [SCRIPT, ...args, '--Result', result], { env: { ...clean, ...env }, stdio: 'pipe' });
  } catch (err) {
    code = (err as { status?: number }).status ?? 1;
  }
  const out = fs.existsSync(result) ? JSON.parse(fs.readFileSync(result, 'utf8')) : {};
  fs.rmSync(dir, { recursive: true, force: true });
  return { code, result: out };
}

describe('grant-socket.sh', () => {
  it('takes the account from the caller uid only; a --User argument is never read', () => {
    expect(src).toContain('UID_ASKED="${PKEXEC_UID:-${SUDO_UID:-}}"');
    expect(src).not.toMatch(/ARG\[User\]/);
    expect(src).toContain('getent passwd "$UID_ASKED"');
  });
  it('writes the account name into the unit only after a strict name check, and only this socket path', () => {
    const check = src.indexOf('[[ "$NAME" =~ ^[a-z_][a-z0-9_.-]*\\$?$ ]]');
    expect(check).toBeGreaterThan(0);
    expect(src.indexOf('LINE="ExecStartPost=')).toBeGreaterThan(check);
    expect(src).toContain('SOCK="$HOME_DIR/daemon.sock"');
    expect(src).toContain('grep -qxF "$LINE" "$DROPF"'); // a second grant does not add the line twice
  });
  it.runIf(unix)('no caller (a root shell): nothing to grant, exit 0', () => {
    expect(run({})).toEqual({ code: 0, result: expect.objectContaining({ status: 'ok', detail: 'run as root: nothing to grant' }) });
  });
  it.runIf(unix)('caller root: nothing to grant', () => {
    expect(run({ PKEXEC_UID: '0' }).result.detail).toBe('root: nothing to grant');
  });
  // Negative controls: a malformed uid, or an account that asks while the service is not installed, writes nothing.
  it.runIf(unix)('a malformed uid is refused', () => {
    const r = run({ PKEXEC_UID: '1000;id' });
    expect(r.code).toBe(1);
    expect(r.result.detail).toBe('bad caller uid');
  });
  it.runIf(unix)('a --User for someone else changes nothing: the caller is still the one checked', () => {
    const r = run({ SUDO_UID: '0' }, ['--User', 'alice']);
    expect(r.result.detail).toBe('root: nothing to grant');
  });
  it.runIf(unix && !fs.existsSync('/var/lib/sentinel-dvpn/c0'))('service not installed: refused before any change', () => {
    const r = run({ PKEXEC_UID: String(os.userInfo().uid) });
    expect(r.code).toBe(1);
    expect(r.result.detail).toBe('the VPN service is not installed on this computer');
  });
});
