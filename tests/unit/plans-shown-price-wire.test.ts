// ─── CODE-AUDIT E11, screen half: the price the Plans dialog showed reaches subscribe() ───
// The engine refuses a plan whose price rose above `shownPrice` (plans-subscribe-price.test.ts). Without
// these two lines the app never sent it, so the refusal could not happen from the Plans screen.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('Plans screen sends the shown price', () => {
  it('the confirm button sends the price it printed', () => {
    const src = fs.readFileSync('src/renderer/src/screens/Plans.tsx', 'utf8');
    expect(src).toContain("confirmLabel={tr('Pay {price} tDVPN', { price: tdvpn(confirm.price) })}");
    expect(src).toContain('call(window.api.IPC.SUBSCRIBE, { plan: confirm.address, shownPrice: String(confirm.price), confirmed: true })');
  });
  it('the handler passes it on as whole base units, and never drops it', () => {
    const src = fs.readFileSync('src/main/ipc.ts', 'utf8');
    expect(src).toContain("{ shownPrice: amount(p.shownPrice, 'invalid price') }");
    expect(src).not.toContain('subscribe({ plan: str(p.plan, 64), confirmed: true })');
  });
});
