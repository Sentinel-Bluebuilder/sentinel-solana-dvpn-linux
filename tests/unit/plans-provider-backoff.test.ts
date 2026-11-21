// UI-172: a plan provider that does not answer is asked again less and less often (10 min, 20 min, 40 min … 6 h),
// and one whose listed address is this computer itself goes straight to 6 h. One log line per try.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const st = vi.hoisted(() => ({ asked: [] as string[], answers: new Map<string, string | null>() }));
const info = vi.fn();
vi.mock('../../src/main/logger', () => ({ log: { info, warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../src/main/app-state', () => ({ patch: vi.fn() }));
vi.mock('../../src/main/wallet/vault', () => ({ ownerAddress: () => 'Owner', ownerSigner: () => ({}) }));
vi.mock('../../src/core/app/signer', () => ({ signAndSend: vi.fn() }));
vi.mock('../../src/core/chain/builders', () => ({ openSubscription: vi.fn(), closeSubscription: vi.fn() }));
vi.mock('../../src/core/chain/program', () => ({ pda: {} }));
vi.mock('../../src/main/services/nodes', () => ({ findNode: () => null }));
vi.mock('../../src/core/plans/plans', () => ({
  listPlans: async () => [...st.answers.keys()].map((provider) => ({ address: `plan-${provider}`, provider })),
  // the real rule, without its own 60 s cache getting in the way: ask the probe for every provider, every time
  markProviderAnswering: async (plans: Array<{ provider: string }>, probe: (p: string) => Promise<boolean>) =>
    Promise.all(plans.map(async (p) => ({ ...p, providerAnswering: await probe(p.provider) }))),
  providerApi: async (provider: string) => {
    st.asked.push(provider);
    const err = st.answers.get(provider);
    if (err) throw new Error(err);
    return { origin: 'https://x', tlsSha256: 'y' };
  },
  planRoster: vi.fn(), subscriptionsOf: async () => [],
}));

const P = await import('../../src/main/services/plans');
const MIN = 60_000;
const askedOf = (p: string): number => st.asked.filter((x) => x === p).length;

describe('a plan provider that does not answer (UI-172)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-15T12:00:00Z'));
    st.asked = []; st.answers = new Map(); info.mockClear(); P.resetProviderBackoff();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('the waits double from 10 minutes up to 6 hours; this computer\'s own address waits 6 hours at once', () => {
    expect(P.providerRetryAfter(1, false)).toBe(10 * MIN);
    expect(P.providerRetryAfter(2, false)).toBe(20 * MIN);
    expect(P.providerRetryAfter(3, false)).toBe(40 * MIN);
    expect(P.providerRetryAfter(20, false)).toBe(P.PROVIDER_RETRY_MAX_MS);
    expect(P.providerRetryAfter(1, true)).toBe(P.PROVIDER_RETRY_MAX_MS);
  });

  it('a dead provider: asked at 0, 10, 30 and 70 minutes when the list refreshes every 10 minutes, and logged only then', async () => {
    st.answers.set('Dead', 'connect ETIMEDOUT 203.0.113.9:9443');
    for (let m = 0; m <= 70; m += 10) {
      vi.setSystemTime(new Date(Date.parse('2026-11-15T12:00:00Z') + m * MIN));
      await P.refreshPlans();
    }
    expect(askedOf('Dead')).toBe(4); // was 8
    expect(info.mock.calls.filter((c) => c[0] === 'plan provider not answering').length).toBe(4);
  });

  it('a provider listed at 127.0.0.1 is asked once, then not again for 6 hours', async () => {
    st.answers.set('Loop', 'connect ECONNREFUSED 127.0.0.1:9443');
    for (let m = 0; m <= 350; m += 10) {
      vi.setSystemTime(new Date(Date.parse('2026-11-15T12:00:00Z') + m * MIN));
      await P.refreshPlans();
    }
    expect(askedOf('Loop')).toBe(1);
    vi.setSystemTime(new Date(Date.parse('2026-11-15T12:00:00Z') + 361 * MIN));
    await P.refreshPlans();
    expect(askedOf('Loop')).toBe(2);
  });

  it('negative control: a provider that answers is asked every time, and one that comes back starts from 10 minutes again', async () => {
    st.answers.set('Good', null);
    st.answers.set('Flaky', 'connect ETIMEDOUT 203.0.113.9:9443');
    await P.refreshPlans();
    vi.setSystemTime(new Date(Date.parse('2026-11-15T12:00:00Z') + 10 * MIN));
    st.answers.set('Flaky', null);
    const plans = await P.refreshPlans();
    expect(askedOf('Good')).toBe(2);
    expect(plans.find((p) => p.provider === 'Flaky')?.providerAnswering).toBe(true);
    st.answers.set('Flaky', 'connect ETIMEDOUT 203.0.113.9:9443');
    vi.setSystemTime(new Date(Date.parse('2026-11-15T12:00:00Z') + 20 * MIN));
    await P.refreshPlans();
    vi.setSystemTime(new Date(Date.parse('2026-11-15T12:00:00Z') + 30 * MIN));
    await P.refreshPlans();
    expect(askedOf('Flaky')).toBe(4); // 0, 10 (ok), 20 (fail, first again), 30 (10 min later)
  });
});
