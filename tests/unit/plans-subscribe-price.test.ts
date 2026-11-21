// ─── CODE-AUDIT E11: a plan price raised after it was shown is never signed ───
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({ price: '2000', signed: 0 }));
vi.mock('../../src/core/plans/plans', () => ({
  listPlans: async () => [{ address: 'PlanA', provider: 'Prov', price: st.price, durationSeconds: 3600, dataCapGb: 0, maxConnections: 1, listed: true, providerUri: '', providerListed: true }],
  markProviderAnswering: async (p: unknown) => p,
  planRoster: vi.fn(), providerApi: vi.fn(), subscriptionsOf: async () => [],
}));
vi.mock('../../src/core/chain/builders', () => ({ openSubscription: async () => ({}), closeSubscription: vi.fn() }));
vi.mock('../../src/core/chain/program', () => ({ pda: { subscription: () => ({ toBase58: () => 'SubA' }) } }));
vi.mock('../../src/core/app/signer', () => ({ signAndSend: async () => { st.signed += 1; return { signature: 'Sig' }; } }));
vi.mock('../../src/main/wallet/vault', () => ({ ownerAddress: () => 'Owner', ownerSigner: () => ({}) }));
vi.mock('../../src/main/app-state', () => ({ patch: vi.fn() }));
vi.mock('../../src/main/services/nodes', () => ({ findNode: () => null }));
vi.mock('../../src/main/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { subscribe, refreshPlans, PLAN_PRICE_CHANGED_COPY } = await import('../../src/main/services/plans');

beforeEach(async () => { st.signed = 0; st.price = '2000'; await refreshPlans(); });

describe('subscribe (E11)', () => {
  it('the listed price went above the shown one: nothing signed, price-changed', async () => {
    const r = await subscribe({ plan: 'PlanA', confirmed: true, shownPrice: '1000' });
    expect(r).toEqual({ ok: false, error: PLAN_PRICE_CHANGED_COPY(), code: 'price-changed' });
    expect(st.signed).toBe(0);
  });
  it('negative control: the shown price (or none, an old caller) is signed', async () => {
    expect((await subscribe({ plan: 'PlanA', confirmed: true, shownPrice: '2000' })).ok).toBe(true);
    expect((await subscribe({ plan: 'PlanA', confirmed: true })).ok).toBe(true);
    expect(st.signed).toBe(2);
  });
});
