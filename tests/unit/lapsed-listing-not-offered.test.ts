// UI-179 (owner's laptop 2026-11-15, three times): a server that answers but whose on-chain listing has lapsed is
// refused by Connect before paying ("has not checked in recently"), so nothing may offer it: not connect on launch
// / `agent up` (pickQuickNode), not a plan's server list (roster).
import { describe, expect, it, vi } from 'vitest';
import type { NodeView } from '../../src/shared/types';

vi.mock('../../src/main/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../src/main/app-state', () => ({ patch: vi.fn() }));
vi.mock('../../src/main/wallet/vault', () => ({ ownerAddress: () => 'Owner', ownerSigner: () => ({}) }));
vi.mock('../../src/core/app/signer', () => ({ signAndSend: vi.fn() }));
vi.mock('../../src/core/chain/builders', () => ({ openSubscription: vi.fn(), closeSubscription: vi.fn() }));
vi.mock('../../src/core/chain/program', () => ({ pda: {} }));
vi.mock('../../src/main/services/nodes', () => ({ findNode: () => null }));
vi.mock('../../src/core/plans/plans', () => ({ listPlans: async () => [], markProviderAnswering: async (p: unknown[]) => p, planRoster: async () => [], providerApi: async () => ({}), subscriptionsOf: async () => [] }));

const { pickQuickNode } = await import('../../src/shared/quick-pick');
const { withListing } = await import('../../src/main/services/plans');

const node = (address: string, o: Partial<NodeView> = {}): NodeView => ({ address, countryCode: 'DE', favourite: false, listingFresh: true, probe: { ok: true, latencyMs: 50 }, ...o } as unknown as NodeView);

describe('a lapsed listing is never offered (UI-179)', () => {
  it('pickQuickNode skips a server that answers but whose listing lapsed, even when it is the fastest', () => {
    const fast = node('Lapsed', { listingFresh: false, probe: { ok: true, latencyMs: 5 } as NodeView['probe'] });
    const slow = node('Fresh', { probe: { ok: true, latencyMs: 90 } as NodeView['probe'] });
    expect(pickQuickNode([fast, slow], null)?.address).toBe('Fresh');
    expect(pickQuickNode([node('L', { listingFresh: false, favourite: true }), slow], null)?.address).toBe('Fresh');
    expect(pickQuickNode([fast], null)).toBeNull();
  });

  it('negative control: a record without the field (older fixtures) is still offered', () => {
    const old = { ...node('Old') } as Record<string, unknown>;
    delete old.listingFresh;
    expect(pickQuickNode([old as unknown as NodeView], null)?.address).toBe('Old');
  });

  it('a plan\'s server list says which servers are not listed any more; unknown ones stay unmarked', () => {
    const known: Record<string, { listingFresh: boolean }> = { A: { listingFresh: true }, B: { listingFresh: false } };
    const out = withListing([{ node: 'A', live: true, probedAt: 1 }, { node: 'B', live: true, probedAt: 1 }, { node: 'C', live: true, probedAt: 1 }], (a) => known[a] ?? null);
    expect(out.map((e) => e.listed)).toEqual([true, false, undefined]);
    expect(out[1].live).toBe(true); // the provider's own word is kept as it is
  });
});
