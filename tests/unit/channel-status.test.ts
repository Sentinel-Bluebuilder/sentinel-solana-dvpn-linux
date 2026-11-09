// ─── Deposits show the chain's status, not dvpnd's stale copy ───
// VM sweep 2026-10-21: `channels` listed a deposit as "open" that settlement had already started
// closing, so `channels fund` was offered and then refused.
import { describe, it, expect, vi } from 'vitest';
import type { DaemonChannel } from '../../src/core/daemon/client';

const chain = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, fail: false }));
vi.mock('../../src/core/chain/accounts', () => ({
  channelByPda: vi.fn(),
  channelsByOwner: async () => { if (chain.fail) throw new Error('rpc 429'); return chain.rows; },
}));
vi.mock('../../src/main/wallet/vault', () => ({ ownerAddress: () => 'Owner1111111111111111111111111111111111111', ownerSigner: vi.fn() }));
vi.mock('../../src/main/logger', () => ({ log: { warn: () => undefined, info: () => undefined } }));
vi.mock('../../src/main/daemon/manager', () => ({ daemon: vi.fn(), daemonInfo: () => ({ reachable: true }) }));
vi.mock('../../src/main/services/connection', () => ({ toLive: (s: unknown) => s }));
vi.mock('../../src/main/services/wallet', () => ({ refreshWallet: vi.fn() }));
vi.mock('../../src/main/services/history', () => ({ listHistory: () => [] }));
const { withChainStatus } = await import('../../src/main/services/activity');

const ch = (address: string, escrow = '1000'): DaemonChannel => ({ address, node: 'N', mode: 0, escrow, cumulative: '0', openedAt: '0', status: 'open' });

describe('withChainStatus', () => {
  it('open / closing / gone on chain', async () => {
    chain.fail = false;
    chain.rows = [{ address: 'A', status: 0, escrow: '1000' }, { address: 'B', status: 1, escrow: '1000' }];
    const out = await withChainStatus([ch('A'), ch('B'), ch('C')]);
    expect(out.map((c) => c.status)).toEqual(['open', 'closing', 'closed']);
  });
  it('a top-up on chain shows the larger escrow', async () => {
    chain.rows = [{ address: 'A', status: 0, escrow: '201000' }];
    expect((await withChainStatus([ch('A', '1000')]))[0].escrow).toBe('201000');
  });
  it('a deposit carried over from an older dvpnd (node "", mode 0) takes node + mode from chain', async () => {
    chain.fail = false;
    chain.rows = [{ address: 'A', status: 1, escrow: '1000', node: 'Node1', mode: 1 }];
    const out = await withChainStatus([{ ...ch('A'), node: '' }]);
    expect(out[0]).toMatchObject({ node: 'Node1', mode: 1, status: 'closing' });
    expect((await withChainStatus([ch('A')]))[0].node).toBe('N'); // the service's own value wins when present
  });
  // Q0425 (plat-fedora): an OPEN channel this wallet opened from an earlier device home was missing,
  // because the list came from the service's local history only.
  it('lists an open on-chain channel of this wallet that the service does not know, also when it knows none', async () => {
    chain.fail = false;
    chain.rows = [{ address: 'A', status: 0, escrow: '1000' }, { address: 'F34', status: 0, escrow: '5000', node: 'Node3', mode: 1, redeemed: '7', openedAt: '1730000000' }];
    const out = await withChainStatus([ch('A'), ch('C')]);
    expect(out.map((c) => [c.address, c.status])).toEqual([['A', 'open'], ['C', 'closed'], ['F34', 'open']]);
    expect(out[2]).toEqual({ address: 'F34', node: 'Node3', mode: 1, escrow: '5000', cumulative: '7', openedAt: '1730000000', status: 'open' });
    expect((await withChainStatus([])).map((c) => c.address)).toEqual(['A', 'F34']);
  });
  it('chain unreadable: keeps the service view, never throws', async () => {
    chain.fail = true;
    expect((await withChainStatus([ch('A')]))[0].status).toBe('open');
  });
});
