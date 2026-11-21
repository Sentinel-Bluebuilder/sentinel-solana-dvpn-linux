// ─── Where a tooltip goes ───
// Owner 2026-11-15: tooltips were cut off by the cards around them. The popup is drawn on top of
// the whole window (components/ui.tsx Help), and this pure rule keeps it inside the window.

/** Width of every tooltip, in px. */
export const TIP_W = 256;
/** Gap kept from the window edge. */
const TIP_EDGE = 8;
/** Gap kept from the (?) button. */
const TIP_GAP = 8;

/**
 * A tap first focuses the (?) (which opens the tooltip) and then clicks it. The click must not close
 * what that same tap just opened (audit L-9: on a phone a tap showed nothing). A click this soon after
 * the tooltip opened belongs to the gesture that opened it.
 */
export const TIP_SAME_GESTURE_MS = 400;
export function clickCloses(openedAtMs: number, nowMs: number): boolean {
  return nowMs - openedAtMs >= TIP_SAME_GESTURE_MS;
}

export interface TipPlace { left: number; top: number; maxHeight: number }

/**
 * Above the button when it fits, else below; centred on the button but never past either window
 * edge; if neither side has room, the side with more, and the tooltip scrolls inside itself.
 */
export function placeTip(btn: { left: number; top: number; bottom: number; width: number }, tipH: number, view: { width: number; height: number }): TipPlace {
  const above = btn.top - TIP_GAP - TIP_EDGE;
  const below = view.height - btn.bottom - TIP_GAP - TIP_EDGE;
  const up = tipH <= above || (tipH > below && above >= below);
  const room = Math.max(40, up ? above : below);
  const h = Math.min(tipH, room);
  const top = up ? btn.top - TIP_GAP - h : btn.bottom + TIP_GAP;
  const centre = btn.left + btn.width / 2 - TIP_W / 2;
  const left = Math.min(Math.max(TIP_EDGE, centre), Math.max(TIP_EDGE, view.width - TIP_W - TIP_EDGE));
  return { left: Math.round(left), top: Math.round(top), maxHeight: Math.round(room) };
}
