// UI-195 (owner's session 2026-11-15): Quick connect paid a 50 tDVPN deposit because its random pick drew from
// every server, most at 50 tDVPN/GB, while some charged 0.002. It now draws from the cheapest band only.
import { describe, expect, it } from 'vitest';
import type { NodeView } from '../../src/shared/types';
import { cheapestBand, pickRandomQuickNode, QUICK_PRICE_BAND } from '../../src/shared/quick-pick';

const n = (address: string, perGb: string, o: Partial<NodeView> = {}): NodeView => ({ address, countryCode: 'DE', favourite: false, listingFresh: true, pricePerGb: perGb, pricePerHour: '1000', probe: { ok: true, latencyMs: 50 }, ...o } as unknown as NodeView);
const GB = { basis: 'per_gb' as const, units: 1 };

describe('Quick connect draws from the cheapest band (UI-195)', () => {
  const cheap = [n('C1', '2000000'), n('C2', '3000000')];
  const dear = [n('D1', '50000000000'), n('D2', '54000000000'), n('D3', '50000000000')];

  it('every random draw lands on a cheap server', () => {
    for (let i = 0; i < 20; i++) {
      const got = pickRandomQuickNode([...dear, ...cheap], null, null, () => i / 20, GB);
      expect(['C1', 'C2']).toContain(got?.address);
    }
  });

  it('the band is the cheapest price times QUICK_PRICE_BAND, inclusive', () => {
    expect(QUICK_PRICE_BAND).toBe(2n);
    expect(cheapestBand([n('A', '100'), n('B', '200'), n('C', '201')], GB).map((x) => x.address)).toEqual(['A', 'B']);
  });

  it('uses the basis asked for', () => {
    const per = [n('H1', '1', { pricePerHour: '900' }), n('H2', '999', { pricePerHour: '100' })];
    expect(cheapestBand(per, { basis: 'per_hour', units: 1 }).map((x) => x.address)).toEqual(['H2']);
  });

  it('negative controls: favourites are not filtered; all-dear still offers one; unpriced or malformed prices never crash', () => {
    const fav = n('F', '50000000000', { favourite: true });
    expect(pickRandomQuickNode([fav, ...cheap], null, null, () => 0, GB)?.address).toBe('F');
    expect(['D1', 'D3']).toContain(pickRandomQuickNode(dear, null, null, () => 0, GB)?.address);
    expect(cheapestBand([n('X', ''), n('Y', 'abc')], GB).map((x) => x.address)).toEqual(['X', 'Y']);
  });

  it('the preferred country is still honoured before price', () => {
    const fr = n('FR1', '50000000000', { countryCode: 'FR' });
    expect(pickRandomQuickNode([fr, ...cheap], 'FR', null, () => 0, GB)?.address).toBe('FR1');
  });
});
