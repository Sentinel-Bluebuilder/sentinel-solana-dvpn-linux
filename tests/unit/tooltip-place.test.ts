// ─── Tooltips are never cut off (owner 2026-11-15: the (?) next to refunds was clipped by the UI) ───
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clickCloses, placeTip, TIP_SAME_GESTURE_MS, TIP_W } from '../../src/core/app/tip-place';

const VIEW = { width: 1180, height: 780 };
const btn = (left: number, top: number) => ({ left, top, bottom: top + 16, width: 16 });

describe('tooltip placement', () => {
  it('goes above the (?) when it fits, centred on it', () => {
    const p = placeTip(btn(500, 400), 80, VIEW);
    expect(p.top).toBe(400 - 8 - 80);
    expect(p.left).toBe(Math.round(508 - TIP_W / 2));
  });

  it('goes below when there is no room above (top of a card near the window top)', () => {
    const p = placeTip(btn(500, 30), 80, VIEW);
    expect(p.top).toBe(30 + 16 + 8);
  });

  it('never leaves the window on the left or the right', () => {
    expect(placeTip(btn(2, 400), 80, VIEW).left).toBe(8);
    const right = placeTip(btn(1170, 400), 80, VIEW);
    expect(right.left + TIP_W).toBeLessThanOrEqual(VIEW.width - 8);
  });

  it('a tooltip taller than both sides takes the bigger side and scrolls inside itself', () => {
    const p = placeTip(btn(500, 500), 2000, VIEW);
    expect(p.maxHeight).toBe(500 - 8 - 8);
    expect(p.top).toBeGreaterThanOrEqual(8);
  });

  it('a tap that opened the tooltip does not close it with its own click (L-9); a later click does', () => {
    expect(clickCloses(1000, 1050)).toBe(false);
    expect(clickCloses(1000, 1000 + TIP_SAME_GESTURE_MS)).toBe(true);
    const src = readFileSync(join(__dirname, '../../src/renderer/src/components/ui.tsx'), 'utf8');
    const help = src.slice(src.indexOf('export function Help'), src.indexOf('export function StatCell'));
    expect(help).toContain('clickCloses(openedAt.current');
    expect(help).not.toContain('setOpen((v) => !v)'); // the old plain toggle
  });

  it('sheets restore the page scroll they found when the first one opened (L-10)', () => {
    const src = readFileSync(join(__dirname, '../../src/renderer/src/components/ui.tsx'), 'utf8');
    expect(src).toContain('if (openSheets === 0) pageOverflow =');
    expect(src).not.toContain('prevOverflow');
  });

  it('is drawn on top of the whole window, so no card or scroll area can clip it', () => {
    const src = readFileSync(join(__dirname, '../../src/renderer/src/components/ui.tsx'), 'utf8');
    const help = src.slice(src.indexOf('export function Help'), src.indexOf('export function StatCell'));
    expect(help).toContain('createPortal(');
    expect(help).toContain('document.body');
    expect(help).toMatch(/className="[^"]*\bfixed\b/);
    // Negative control: the old in-place version (absolute inside the card) is gone.
    expect(help).not.toContain('absolute bottom-full');
  });
});
