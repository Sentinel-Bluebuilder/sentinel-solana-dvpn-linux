// ─── Q0295 #3: Open in PowerShell starts a shell from the installed app ───
// ddv2-wx1 (fresh Azure-2, lab-0bb7b3b): the click started no process at all. The shell's cwd was the CLI
// folder inside app.asar (a file, not a folder), so the spawn failed after openPowerShell had returned ok.
import { EventEmitter } from 'node:events';
import os from 'node:os';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const st = vi.hoisted(() => ({ calls: [] as { file: string; args: string[]; opts: Record<string, unknown> }[], child: null as unknown, errors: [] as string[] }));

vi.mock('node:child_process', () => ({
  spawn: (file: string, args: string[], opts: Record<string, unknown>) => {
    st.calls.push({ file, args, opts });
    const child = Object.assign(new EventEmitter(), { unref: () => undefined });
    st.child = child;
    return child;
  },
}));
vi.mock('../../src/main/host', () => ({ getHost: () => ({ dataDir: 'C:\\ddv\\data', resourcesDir: 'C:\\app\\resources' }) }));
vi.mock('../../src/main/logger', () => ({
  log: { error: (msg: string) => { st.errors.push(msg); }, warn: () => undefined, info: () => undefined, debug: () => undefined },
  redact: (s: string) => s,
  redactUrls: (s: string) => s,
}));

const { openPowerShell } = await import('../../src/main/services/cli-exec');

describe('Open in PowerShell from the installed app (Q0295)', () => {
  const realPlatform = process.platform;
  beforeAll(() => { Object.defineProperty(process, 'platform', { value: 'win32' }); });
  afterAll(() => { Object.defineProperty(process, 'platform', { value: realPlatform }); });

  it('starts the shell in a real folder, never inside app.asar', () => {
    const r = openPowerShell('C:\\app\\Devnet dVPN.exe', 'C:\\app\\resources\\app.asar\\out\\cli\\devnet-dvpn.cjs', 'C:\\app\\resources');
    expect(r.ok).toBe(true);
    const cwd = String(st.calls[0].opts.cwd);
    expect(cwd).toBe(os.homedir());
    expect(cwd).not.toMatch(/\.asar/i);
  });

  it('a spawn that fails later is logged, not lost', () => {
    (st.child as EventEmitter).emit('error', new Error('spawn cmd.exe ENOENT'));
    expect(st.errors).toContain('Open in PowerShell: the shell did not start');
  });
});
