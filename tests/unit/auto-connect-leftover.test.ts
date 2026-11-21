// ─── Connect on launch waits for the leftover-block check (C17, builder-kb) ───
// The guard used to read lastCloseMessage, which is null at every start, while the startup
// leftover check ran in parallel: connect on launch could start under a Restore network warning.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = { session: null as unknown, daemon: { reachable: true }, lastCloseMessage: null, conn: { restoreNetwork: false } };
const connect = vi.fn(async () => ({ ok: true }));
const checkLeftoverBlock = vi.fn(async () => false);

vi.mock('../../src/main/app-state', () => ({ snapshot: () => state }));
vi.mock('../../src/main/system/settings', () => ({ getSettings: () => ({ autoConnect: true, defaultBasis: 'per_hour', defaultHours: 1, defaultGb: 1, preferredCountry: '' }) }));
vi.mock('../../src/main/daemon/manager', () => ({ daemonReady: async () => true }));
vi.mock('../../src/main/services/connection', () => ({ adoptRunningSession: async () => undefined, checkLeftoverBlock, connect }));
vi.mock('../../src/main/services/nodes', () => ({ nodeViews: () => [{ address: 'N1', probe: true, pricePerHour: '1', pricePerGb: '1' }], refreshNodes: async () => [] }));
vi.mock('../../src/main/services/wallet', () => ({ refreshWallet: async () => ({ ready: true }) }));
vi.mock('../../src/shared/quick-pick', () => ({ pickQuickNode: (l: Array<{ address: string }>) => l[0] }));
vi.mock('../../src/main/logger', () => ({ log: { info: () => undefined, warn: () => undefined } }));

async function run(): Promise<void> {
  vi.resetModules();
  const { maybeAutoConnect } = await import('../../src/main/services/auto-connect');
  await maybeAutoConnect();
}

describe('connect on launch', () => {
  beforeEach(() => { connect.mockClear(); checkLeftoverBlock.mockReset(); state.conn.restoreNetwork = false; });

  it('does not connect when the leftover check finds a block', async () => {
    checkLeftoverBlock.mockImplementation(async () => { state.conn.restoreNetwork = true; return true; });
    await run();
    expect(checkLeftoverBlock).toHaveBeenCalledOnce();
    expect(connect).not.toHaveBeenCalled();
  });

  it('does not connect when the parallel check already raised Restore network', async () => {
    state.conn.restoreNetwork = true;
    await run();
    expect(connect).not.toHaveBeenCalled();
  });

  it('connects when the network is clean (positive control)', async () => {
    checkLeftoverBlock.mockResolvedValue(false);
    await run();
    expect(checkLeftoverBlock).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledOnce();
  });

  // CODE-AUDIT L-37: nobody sees a price at launch, so the deposit is held to the listed one.
  it('sends the deposit of the listed price, so a price raised since is refused', async () => {
    checkLeftoverBlock.mockResolvedValue(false);
    await run();
    const req = (connect.mock.calls[0] as unknown as [{ shownEscrow?: string; units: number; basis: string }])[0];
    expect(req.basis).toBe('per_hour');
    expect(req.shownEscrow).toBe('1'); // 1 base unit per hour x 1 hour, from the list the mock returns
  });
});
