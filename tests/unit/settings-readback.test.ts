// ─── Daemon settings apply: read back the live files when the administrator step reports an error (fleet bug #3) ───
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main/daemon/manager', () => ({
  DEFAULT_DAEMON_HOME: '/var/lib/dvpnd', SERVICE_NAME: 'dvpnd-client', daemonInfo: () => null,
  deviceRecord: () => null, relinkDaemon: () => undefined, scriptPath: (s: string) => s,
}));
vi.mock('../../src/main/system/elevate', () => ({ runElevated: async () => ({ status: 'error', detail: 'timed out' }) }));
vi.mock('../../src/main/logger', () => ({ log: { info: () => undefined, warn: () => undefined } }));
vi.mock('../../src/main/host', () => ({ getHost: () => ({ dataDir: '/tmp' }) }));

describe('appliedAnyway', () => {
  const staged = { root: 'a = 1\n', client: 'b = 2\n' };

  it('is true only when both live files equal the staged ones', async () => {
    const { appliedAnyway } = await import('../../src/main/daemon/settings');
    expect(appliedAnyway({ root: 'a = 1\n', client: 'b = 2\n' }, staged)).toBe(true);
  });

  it('is false when the live files were rolled back or only half written', async () => {
    const { appliedAnyway } = await import('../../src/main/daemon/settings');
    expect(appliedAnyway({ root: 'a = 0\n', client: 'b = 2\n' }, staged)).toBe(false);
    expect(appliedAnyway({ root: 'a = 1\n', client: 'b = 0\n' }, staged)).toBe(false);
  });

  it('is false when the live files cannot be read', async () => {
    const { appliedAnyway } = await import('../../src/main/daemon/settings');
    expect(appliedAnyway(null, staged)).toBe(false);
  });
});
