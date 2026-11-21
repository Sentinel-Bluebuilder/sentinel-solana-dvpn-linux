// ─── Prepay caps ───
// dvpnd (cf4c 19f2f8b, Q0338) caps the prepaid block at max_prepay_bytes 256 MiB and
// max_prepay_seconds 15 min by default. The client signs one block ahead, so the cap bounds what a
// node can redeem for data it never delivered. A larger prepay_* is capped by dvpnd without a
// word; the app says so instead (Settings hint, one log line on apply).

import { tr } from './i18n';
export const PREPAY_CAP_BYTES = 256n * 1024n * 1024n;
export const PREPAY_CAP_SECONDS = 900n;

/** Which configured prepay values dvpnd will cap; empty when none. */
export function prepayOverCap(bytes?: string | null, seconds?: string | null): Array<'bytes' | 'seconds'> {
  const n = (v: string | null | undefined): bigint => { try { return v ? BigInt(v) : 0n; } catch (err) { console.warn('prepay value is not a whole number', v, err); return 0n; } };
  const out: Array<'bytes' | 'seconds'> = [];
  if (n(bytes) > PREPAY_CAP_BYTES) out.push('bytes');
  if (n(seconds) > PREPAY_CAP_SECONDS) out.push('seconds');
  return out;
}

/** The Settings hint for the prepay row. */
export function prepayHint(bytes?: string | null, seconds?: string | null): string {
  // Q0338 (DIR): this sizes the deposit a session needs; the service signs ahead only a small lead.
  const base = tr('The deposit a session needs: a new or reused deposit must cover at least this much. It is not paid ahead; the service pays the server as you use data, a few seconds ahead.');
  const cap = tr('Max 268 MB and 15 min; larger values are capped to protect you.');
  return prepayOverCap(bytes, seconds).length ? `${base} ${cap}` : `${base} Max 268 MB and 15 min.`;
}

/**
 * Pure part of prepayCost. A configured 0 (what `dvpnd init` writes) means "the node's minimum
 * block", NOT "nothing": reading it as 0 let a fully spent per-hour deposit pass the reuse check,
 * and the node closed every such session at once with "credit exhausted" (ddv-win-c mx182, all six
 * protocols). The node minimum is not known here, so 0 counts as a TENTH of the default block
 * (100 MB / 6 min). Not the whole block: a per-GB deposit is exactly one 1 GB block and the node
 * takes its first 100 MB block at connect, so "a full GB left" refused every per-GB reuse and each
 * reconnect paid a new deposit + rent (ui-win-2 adopt 2026-10-22: 0.0009 left of 0.001). The tenth
 * matches what the node itself takes when asked for 0: 100 MB / 6 min (no chain field for it).
 * Proven: ui-win-2 uiextra-adopt186, second connect reused the deposit. A spent deposit (0 left)
 * still fails. Never below 1.
 */
export function prepayFor(node: { pricePerGb: string; pricePerHour: string }, basis: 'per_gb' | 'per_hour', bytes?: string | null, seconds?: string | null): bigint {
  const pick = (v: string | null | undefined, dflt: bigint, cap: bigint): bigint => { const n = v == null || v === '' ? 0n : BigInt(v); return n > 0n ? (n < cap ? n : cap) : dflt; };
  // Q0338: dvpnd never prepays more than its cap, so neither does this estimate.
  const cost = basis === 'per_gb'
    ? (pick(bytes, 100_000_000n, PREPAY_CAP_BYTES) * BigInt(node.pricePerGb) + 999_999_999n) / 1_000_000_000n
    : (pick(seconds, 360n, PREPAY_CAP_SECONDS) * BigInt(node.pricePerHour) + 3599n) / 3600n;
  return cost > 0n ? cost : 1n;
}
