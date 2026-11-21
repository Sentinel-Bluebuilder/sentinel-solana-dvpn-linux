// ─── Minimum display time for a message (UI-002, UI-017) ───
// React side of core/session/connect-stage settle*: a value stays on screen at least `minMs`;
// values arriving inside that window replace each other and the latest shows when it ends.
// `urgent` values (blocked internet, a failure, Reconnecting with traffic held) show at once.
import { useEffect, useRef, useState } from 'react';
import { DWELL_MS, settleDue, settlePush, settleStart, settleTick, type Settled } from '../../../core/session/connect-stage';

export function useSettled<T>(value: T, opts: { minMs?: number; urgent?: boolean; same?: (a: T, b: T) => boolean } = {}): T {
  const minMs = opts.minMs ?? DWELL_MS;
  const ref = useRef<Settled<T> | null>(null);
  if (ref.current === null) ref.current = settleStart(value, Date.now());
  // Pushed during render so an urgent value is on screen in the same frame it arrives.
  ref.current = settlePush(ref.current, value, Date.now(), { minMs, urgent: opts.urgent, same: opts.same });
  const [, bump] = useState(0);
  const due = settleDue(ref.current, Date.now(), minMs);
  useEffect(() => {
    if (due === null) return undefined;
    const t = setTimeout(() => {
      if (ref.current) ref.current = settleTick(ref.current, Date.now(), minMs);
      bump((n) => n + 1);
    }, due + 1);
    return () => clearTimeout(t);
  });
  return ref.current.shown;
}
