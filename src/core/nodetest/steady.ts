// ─── Steady speed method: the arithmetic (row 148) ───
// Ported from sentinel-node-tester-solana audit/speed-lab.js `steadyState` and
// lib/speed-method.js `perStreamCap` / `measureSteadyBaseline` (figures only; the
// downloading lives in main/services/node-test.ts). Method: several parallel,
// time-bounded streams; cumulative bytes sampled ~10 times a second; rates taken over
// whole 1 s windows; the ramp ends at the first window that reaches 80 % of the median
// of the windows after it; the figure is the median of the rest. On known caps this
// read 88–95 % of the true rate where one download over total time read 15–47 %.

export const STEADY_VERSION = 'steady-v1';
export const STEADY_STREAMS = 4;
export const STEADY_SECONDS = 10;
/** Total bytes one test may pull (all streams). */
export const STEADY_BUDGET_BYTES = 600_000_000;

/** Cumulative bytes received at `t` seconds since the first request. */
export interface ByteSample { t: number; bytes: number }

export interface SteadyState {
  /** Seconds from the first sample to the first steady window; null when no steady state. */
  rampSeconds: number | null;
  /** Number of steady windows the figure rests on. */
  windows: number;
  medianBps: number | null;
  p90Bps: number | null;
  /** Last third under 70 % of the first third (burst, then throttle). Information only, never a verdict. */
  falling: boolean;
}

export function median(a: readonly number[]): number | null {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function percentile(a: readonly number[], p: number): number | null {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

export function steadyState(samples: readonly ByteSample[], windowSec = 1): SteadyState {
  const pts = samples.filter((s) => Number.isFinite(s.t) && Number.isFinite(s.bytes));
  const rates: Array<{ t: number; bps: number }> = [];
  let a = 0;
  for (let i = 1; i < pts.length; i++) {
    const dt = pts[i].t - pts[a].t;
    if (dt + 1e-9 < windowSec) continue;
    rates.push({ t: pts[i].t, bps: ((pts[i].bytes - pts[a].bytes) * 8) / dt });
    a = i;
  }
  // The final window holds the transfer's tail (streams stopping at the deadline): drop it.
  const body = rates.slice(0, -1);
  let start = body.length;
  for (let i = 0; i < body.length; i++) {
    const after = median(body.slice(i + 1).map((x) => x.bps));
    if (after === null || body[i].bps >= 0.8 * after) { start = i; break; }
  }
  const steady = body.slice(start).map((x) => x.bps);
  const third = Math.floor(steady.length / 3);
  const mean = (xs: number[]): number => xs.reduce((p, q) => p + q, 0) / xs.length;
  const first = third ? mean(steady.slice(0, third)) : null;
  const last = third ? mean(steady.slice(-third)) : null;
  return {
    rampSeconds: start < body.length ? round2(start > 0 ? body[start - 1].t - pts[0].t : 0) : null,
    windows: steady.length,
    medianBps: median(steady),
    p90Bps: percentile(steady, 90),
    falling: first !== null && last !== null && first > 0 ? last < 0.7 * first : false,
  };
}

export interface SpeedFigure {
  method: typeof STEADY_VERSION;
  mbps: number;
  /** 'steady' = median of steady windows; 'transfer' = whole transfer, a floor (the byte budget ran out first). */
  basis: 'steady' | 'transfer';
  p90Mbps: number | null;
  rampSeconds: number | null;
  falling: boolean;
  bytes: number;
  ms: number;
  streams: number;
}

/**
 * The figure for one finished test, or null when nothing usable arrived.
 * `ms` = wall time from the first request to the last byte.
 */
export function speedFigure(samples: readonly ByteSample[], totalBytes: number, ms: number, streams: number): SpeedFigure | null {
  const ss = steadyState(samples);
  // Under two whole steady windows the median rests on one sample (seen live: 35 Mbit reported on a
  // line that moved 398 MB in 2.5 s). Then the whole transfer is the only fair figure, as a floor.
  if (ss.medianBps !== null && ss.medianBps > 0 && ss.windows >= 2) {
    return {
      method: STEADY_VERSION, mbps: round2(ss.medianBps / 1e6), basis: 'steady',
      p90Mbps: ss.p90Bps === null ? null : round2(ss.p90Bps / 1e6),
      rampSeconds: ss.rampSeconds, falling: ss.falling, bytes: totalBytes, ms, streams,
    };
  }
  if (!(totalBytes > 0 && ms > 0)) return null;
  return {
    method: STEADY_VERSION, mbps: round2((totalBytes * 8) / (ms / 1000) / 1e6), basis: 'transfer',
    p90Mbps: null, rampSeconds: null, falling: false, bytes: totalBytes, ms, streams,
  };
}

/**
 * Byte cap per stream. A per-GB deposit ends the session when its data is used up, and the
 * server's own counter runs a few % above payload, so the whole test stays under 60 % of
 * the data paid for, less 10 MB for the other checks. Per-hour deposits pass null.
 */
export function perStreamCap(prepaidBytes: number | null, streams = STEADY_STREAMS, budgetBytes = STEADY_BUDGET_BYTES): number {
  let total = budgetBytes;
  if (prepaidBytes !== null && prepaidBytes > 0) total = Math.min(total, Math.floor(prepaidBytes * 0.6) - 10_000_000);
  return Math.max(1_000_000, Math.floor(total / Math.max(1, streams)));
}
