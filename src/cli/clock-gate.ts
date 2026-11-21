// ─── The chain clock, read once for `agent up` and `agent status` (WIN-W7, the agent kit rc.9, review audit W-7) ───
// The clock was checked only inside the connect preflight (after the node probe) and by `daemon doctor`: on a
// fresh computer `agent up` answered not-funded (the device gate comes first) and `agent status` never named it,
// so an agent funded a device before it learned the clock was 10 min off (review rc.8 edge row 2).
// An unreadable chain time never blocks: the check is skipped and logged (as preflight does).
import { chainClockSkew, clockSkewBlocker } from '../core/chain/clock';
import { log } from '../main/logger';

export type SkewReader = () => Promise<number | null>;

export type ClockCheck = { kind: 'block'; skewS: number; error: string; code: 'clock-skew' } | { kind: 'ok' } | { kind: 'unknown' };

/** CLOCK-UNKNOWN (the agent kit rc9-c, review L3): the clock read with its outcome kept: within the limit, off, or unreadable. */
export async function clockCheck(read: SkewReader = chainClockSkew): Promise<ClockCheck> {
  let skewS: number | null;
  try {
    skewS = await read();
  } catch (err) {
    log.warn('chain time unreadable; clock check skipped', { err: (err as Error).message });
    return { kind: 'unknown' };
  }
  if (skewS === null) return { kind: 'unknown' };
  const b = clockSkewBlocker(skewS);
  return b ? { kind: 'block', skewS, error: b.error, code: b.code } : { kind: 'ok' };
}

/** The refusal for this computer's clock against the chain's, with the seconds; null inside the limit or unreadable. */
export async function clockBlock(read: SkewReader = chainClockSkew): Promise<{ skewS: number; error: string; code: 'clock-skew' } | null> {
  const c = await clockCheck(read);
  return c.kind === 'block' ? { skewS: c.skewS, error: c.error, code: c.code } : null;
}
