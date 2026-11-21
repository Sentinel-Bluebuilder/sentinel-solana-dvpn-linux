// ─── Steady speed download (row 148) ───
// The measuring half of the steady method (arithmetic: core/nodetest/steady.ts). Ported from
// sentinel-node-tester-solana lib/speed-method.js `measureSteadyBaseline`: several parallel
// streams for a fixed time, the running total sampled ten times a second, the figure taken
// from whole 1 s windows after the ramp. The same code measures the speed without VPN and
// the speed through a server, so the two are comparable.
//
// Source today: a public speed host over normal certificate-checked TLS, so a server on the
// path cannot answer the test itself. A public host allows 25 MB a request and refuses a
// caller after a few hundred MB, so each stream makes one request: slow and medium lines
// reach a steady state inside it, a fast line finishes early and reads as a floor ("at
// least"). Lifting that needs the tester's own origin (pinned key, no per-caller limit of
// 25 MB); its address and pin are not in this app yet (open item, memory/status-UI-SCREENS.md).
import { speedFigure, STEADY_SECONDS, STEADY_STREAMS, type ByteSample, type SpeedFigure } from '../nodetest/steady';
import { streamGet } from './quality';

/** The error a pinned source's fetch fails with when the key did not match (pinned-origin.ts imports it from here). */
export const PIN_MISMATCH = 'pin mismatch';
/** Most one request may ask for (Cloudflare refuses more than 25 MB). */
export const REQUEST_BYTES = 25_000_000;
/** Under this much in total the source is treated as not working. */
export const MIN_BYTES = 100_000;

export interface SpeedSource {
  name: string;
  url: (bytes: number) => string;
  /** Most one request may ask for; unset = REQUEST_BYTES (a public host). */
  maxRequestBytes?: number;
  /** Our own origin, identified by its key (core/quality/pinned-origin.ts): a wrong key means tampering. */
  pinned?: boolean;
  /** How this source is fetched; unset = the normal certificate-checked request. */
  fetch?: StreamFetch;
}

export const SPEED_SOURCES: readonly SpeedSource[] = [
  { name: 'speed.cloudflare.com', url: (bytes) => `https://speed.cloudflare.com/__down?bytes=${bytes}` },
  { name: 'proof.ovh.net', url: () => 'https://proof.ovh.net/files/100Mb.dat' },
];

export type StreamFetch = (url: string, idleTimeoutMs: number, onBytes: (total: number) => void, socks: string | undefined, maxMs: number) => Promise<{ status: number; bytes: number }>;

export interface SteadyOptions {
  /** A proxy session's local endpoint; unset = the computer's own route (or the whole-computer tunnel). */
  socks?: string;
  /** Byte cap per stream (core/nodetest/steady.ts perStreamCap). */
  capBytesPerStream: number;
  streams?: number;
  seconds?: number;
  sources?: readonly SpeedSource[];
  fetch?: StreamFetch;
  /** Measuring a session (not the speed without VPN): on Android never fall back to the phone's own route. */
  throughSession?: boolean;
}

export type SteadyOutcome =
  | { ok: true; figure: SpeedFigure; source: string }
  /**
   * `reached` = at least one request got an HTTP answer: the path works, the source or the link gave no data.
   * `tampered` = something on the path answered in place of our own origin (wrong key).
   */
  | { ok: false; reached: boolean; tampered: boolean; error: string };

async function runSource(src: SpeedSource, o: Required<Pick<SteadyOptions, 'capBytesPerStream' | 'streams' | 'seconds'>> & { socks?: string; fetch: StreamFetch }): Promise<{ figure: SpeedFigure | null; total: number; reached: boolean; errors: string[] }> {
  const t0 = performance.now();
  const deadline = t0 + o.seconds * 1000;
  const samples: ByteSample[] = [{ t: 0, bytes: 0 }];
  const errors: string[] = [];
  let total = 0;
  let reached = false;
  // The measuring window ends when the first stream stops (byte cap used up, or it failed): after
  // that fewer streams are pulling, and those windows would read low (seen live on a 1 Gbit line).
  let cut: { ms: number; bytes: number } | null = null;
  const timer = setInterval(() => { if (!cut) samples.push({ t: (performance.now() - t0) / 1000, bytes: total }); }, 100);
  const stream = async (): Promise<void> => {
    try {
      await pull();
    } finally {
      if (!cut) cut = { ms: performance.now() - t0, bytes: total };
    }
  };
  // One request per stream. Asking again for more was tried live (2026-11-15, ctl-1): both public
  // hosts answered HTTP 429 after a few hundred MB, so a public source gets REQUEST_BYTES a stream
  // and no more; on a fast line that ends early and the figure is the whole transfer, a floor.
  const pull = async (): Promise<void> => {
    const want = Math.max(1, Math.min(src.maxRequestBytes ?? REQUEST_BYTES, o.capBytesPerStream));
    const left = deadline - performance.now();
    let seen = 0;
    try {
      const r = await (src.fetch ?? o.fetch)(src.url(want), Math.min(8000, left + 2000), (n) => {
        const add = Math.min(n, want) - seen; // a host that ignores the size is cut at the cap
        if (add > 0) { total += add; seen += add; }
      }, o.socks, left);
      reached = true;
      if (r.status !== 200 && r.status !== 206) errors.push(`HTTP ${r.status}`);
    } catch (err) {
      errors.push((err as Error).message || 'no answer');
    }
  };
  try {
    await Promise.all(Array.from({ length: o.streams }, stream));
  } finally {
    clearInterval(timer);
  }
  const end = (cut as { ms: number; bytes: number } | null) ?? { ms: performance.now() - t0, bytes: total };
  const ms = Math.round(end.ms);
  samples.push({ t: end.ms / 1000, bytes: end.bytes });
  return { figure: end.bytes >= MIN_BYTES ? speedFigure(samples, end.bytes, ms, o.streams) : null, total, reached, errors };
}

/** Never throws. Tries each source in turn; the first that delivers data gives the figure. */
export async function steadyDownload(opts: SteadyOptions): Promise<SteadyOutcome> {
  const o = {
    capBytesPerStream: opts.capBytesPerStream, streams: opts.streams ?? STEADY_STREAMS, seconds: opts.seconds ?? STEADY_SECONDS,
    socks: opts.socks,
    fetch: opts.fetch ?? ((url, idle, onBytes, socks, maxMs) => streamGet(url, idle, onBytes, socks, maxMs, opts.throughSession === true)),
  };
  const why: string[] = [];
  let reached = false;
  for (const src of opts.sources ?? SPEED_SOURCES) {
    const r = await runSource(src, o);
    reached = reached || r.reached;
    // A wrong key on our own origin: never measure against whoever answered, and never fall back
    // through the same path as if nothing had happened.
    if (src.pinned && r.errors.includes(PIN_MISMATCH)) {
      const detail = `${src.name}: ${PIN_MISMATCH}`; // for the log; the person sees the SPEED_TAMPERED sentence
      return { ok: false, reached: true, tampered: true, error: detail };
    }
    if (r.figure) return { ok: true, figure: r.figure, source: src.name };
    why.push(`${src.name}: ${r.errors[0] ?? `only ${r.total} bytes arrived`}`);
  }
  return { ok: false, reached, tampered: false, error: why.join('; ') };
}
