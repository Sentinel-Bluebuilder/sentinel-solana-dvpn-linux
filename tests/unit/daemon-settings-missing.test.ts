// ─── getDaemonSettings: missing (ENOENT) vs not readable (EACCES) ───
// existsSync reports EACCES as "absent", so a user without access to /var/lib/sentinel-dvpn would be told to
// set up a service that is installed. The read's own error code decides.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({ code: 'ENOENT' }));
vi.mock('node:fs', async (orig) => {
  const real = await orig<typeof import('node:fs')>();
  const readFileSync = (p: unknown, ...rest: unknown[]): unknown => {
    if (String(p).endsWith('config.toml')) { const e = new Error(`${st.code}: ${String(p)}`) as NodeJS.ErrnoException; e.code = st.code; throw e; }
    return (real.readFileSync as (...a: unknown[]) => unknown)(p, ...rest);
  };
  return { ...real, default: { ...real, readFileSync }, readFileSync };
});
vi.mock('../../src/main/daemon/manager', () => ({ DEFAULT_DAEMON_HOME: '/var/lib/sentinel-dvpn/c0', SERVICE_NAME: 'sentinel-dvpnd@c0', configMirrorPath: (h: string) => `${h}.config.toml`, daemonInfo: vi.fn(), deviceRecord: () => null, relinkDaemon: vi.fn(), scriptPath: (n: string) => n }));
vi.mock('../../src/main/system/elevate', () => ({ runElevated: vi.fn() }));
vi.mock('../../src/main/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/main/host', () => ({ getHost: () => ({ dataDir: '/tmp' }) }));

const { getDaemonSettings } = await import('../../src/main/daemon/settings');

describe('getDaemonSettings missing flag', () => {
  beforeEach(() => { st.code = 'ENOENT'; });
  it('no config file: missing', () => {
    expect(getDaemonSettings()).toMatchObject({ readable: false, missing: true });
  });
  it('permission denied: not missing (installed, not readable as this user)', () => {
    st.code = 'EACCES';
    expect(getDaemonSettings()).toMatchObject({ readable: false, missing: false });
  });
});
