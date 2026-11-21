// ─── E-ST (the agent kit rc.9, review rc.8 edge check): a fresh data dir adopts the installed service's device key ───
import { describe, it, expect } from 'vitest';
import { adoptInstalledDevice, type AdoptDeps } from '../../src/main/daemon/manager';

const SVC = 'C0Service1111111111111111111111111111111111';
const deps = (o: Partial<AdoptDeps> & { recorded?: unknown[] } = {}): AdoptDeps & { recorded: unknown[] } => {
  const recorded: unknown[] = [];
  return {
    record: () => null, home: 'C:\\ProgramData\\sentinel-dvpn\\c0', has: () => true,
    detect: async () => ({ ok: true, device: SVC }), register: (d, ow, h) => { recorded.push([d, ow, h]); },
    ...o, recorded,
  };
};

describe('E-ST: initDevice with the service installed', () => {
  it('review shape: no device.json, the service home has a config: its key is adopted and recorded, no new key', async () => {
    const d = deps();
    expect(await adoptInstalledDevice('Owner1', d)).toBe(SVC);
    expect(d.recorded).toEqual([[SVC, 'Owner1', 'C:\\ProgramData\\sentinel-dvpn\\c0']]);
  });
  it('negative controls: a record exists (a wallet switch keeps its own path), or no service home: nothing adopted', async () => {
    const rec = deps({ record: () => ({ device: 'Other', owner: 'O2', home: 'h', at: 1 }) as never });
    expect(await adoptInstalledDevice('Owner1', rec)).toBeNull();
    expect(rec.recorded).toEqual([]);
    expect(await adoptInstalledDevice('Owner1', deps({ has: () => false }))).toBeNull();
  });
  it('the service key cannot be read (admin-only folder): fail-open, a new key is made as before', async () => {
    const d = deps({ detect: async () => ({ ok: false, error: 'Access is denied.' }) });
    expect(await adoptInstalledDevice('Owner1', d)).toBeNull();
    expect(d.recorded).toEqual([]);
  });
});
