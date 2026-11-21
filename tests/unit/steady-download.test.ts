import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { steadyDownload, PIN_MISMATCH, REQUEST_BYTES, type SpeedSource, type StreamFetch } from '../../src/core/quality/steady-download';
import { originSource, parseSpeedOrigin, pinOf } from '../../src/core/quality/pinned-origin';
import { speedFigure, type ByteSample } from '../../src/core/nodetest/steady';

// Row 148: several time-bounded streams, sampled, figure from steady windows. The fetch is a
// fake link that delivers `mbps` per stream until the time is up or the request is served.
const SRC: SpeedSource[] = [{ name: 'a.test', url: (b) => `https://a.test/d?bytes=${b}` }, { name: 'b.test', url: () => 'https://b.test/file' }];

// rc9-e (row 91): a fake clock, so a slow runner cannot change a figure (31.94 < 34 on the Mac CI). The test link and
// steadyDownload both run on it; settle() moves it in 20 ms steps until the download answers.
beforeEach(() => { vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance', 'Date'] }); });
afterEach(() => { vi.useRealTimers(); });
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  p.then(() => { done = true; }, () => { done = true; });
  for (let i = 0; i < 5000 && !done; i++) await vi.advanceTimersByTimeAsync(20);
  if (!done) throw new Error('steadyDownload did not finish in 100 s of fake time');
  return p;
}

function link(mbpsPerStream: number, log: string[] = []): StreamFetch {
  return (url, _idle, onBytes, _socks, maxMs) => new Promise((resolve) => {
    log.push(url);
    const want = Number(new URL(url).searchParams.get('bytes') ?? Infinity);
    const step = (mbpsPerStream * 1e6) / 8 / 50; // every 20 ms
    const t0 = performance.now();
    let sent = 0;
    const timer = setInterval(() => {
      sent = Math.min(want, sent + step);
      onBytes(sent);
      if (sent >= want || performance.now() - t0 >= maxMs) { clearInterval(timer); resolve({ status: 200, bytes: sent }); }
    }, 20);
  });
}

describe('speedFigure: a figure never rests on one steady window', () => {
  // 100 ms samples of a link that moved 50 MB a second for 2.3 s: two whole windows, the last one
  // is dropped as the tail, so one steady window is left. Seen live as "35 Mbit" on a 1 Gbit line.
  const samples = (seconds: number): ByteSample[] => Array.from({ length: Math.round(seconds * 10) + 1 }, (_x, i) => ({ t: i / 10, bytes: i * 5e6 }));
  it('one steady window: the whole transfer, marked as a floor', () => {
    const f = speedFigure(samples(2.3), 115e6, 2300, 4);
    expect(f).toMatchObject({ basis: 'transfer', p90Mbps: null });
    expect(f!.mbps).toBe(400);
  });
  it('two or more steady windows: the steady figure', () => {
    expect(speedFigure(samples(4.3), 215e6, 4300, 4)).toMatchObject({ basis: 'steady', mbps: 400 });
  });
});

describe('our own speed origin, by pinned key', () => {
  const PIN = pinOf(generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ type: 'spki', format: 'der' }));
  const own = parseSpeedOrigin('https://origin.test:8443/', PIN)!;

  it('the pin is curl\'s --pinnedpubkey form, and both settings must be well-formed', () => {
    expect(PIN).toMatch(/^sha256\/\/[A-Za-z0-9+/]{43}=$/);
    expect(own).toEqual({ origin: 'https://origin.test:8443', pin: PIN });
    expect(parseSpeedOrigin('', '')).toBeNull();
    expect(parseSpeedOrigin('http://origin.test', PIN)).toBeNull(); // not TLS
    expect(parseSpeedOrigin('https://origin.test/path', PIN)).toBeNull();
    expect(parseSpeedOrigin('https://origin.test', 'sha256//short')).toBeNull();
  });

  it('one request per stream for the whole cap (no 25 MB limit), a new seed each', async () => {
    const log: string[] = [];
    let n = 0;
    const src = originSource(own, link(10, log), () => `seed${n++}`);
    const r = await settle(steadyDownload({ capBytesPerStream: 150e6, streams: 2, seconds: 5, sources: [src, ...SRC], fetch: link(1) }));
    expect(log).toEqual(['https://origin.test:8443/d/seed0.bin?s=seed0&n=150000000', 'https://origin.test:8443/d/seed1.bin?s=seed1&n=150000000']);
    expect(r).toMatchObject({ ok: true, source: 'origin.test:8443' });
    if (r.ok) expect(r.figure.basis).toBe('steady');
  }, 10_000);

  it('a wrong key is tampering: no figure, and no falling back to another source on the same path', async () => {
    const asked: string[] = [];
    const src = originSource(own, () => Promise.reject(new Error(PIN_MISMATCH)));
    const r = await settle(steadyDownload({ capBytesPerStream: 1e6, streams: 2, seconds: 1, sources: [src, ...SRC], fetch: link(8, asked) }));
    expect(r).toMatchObject({ ok: false, tampered: true, reached: true });
    expect(asked).toEqual([]);
  });

  it('the origin not answering is not tampering: the public hosts are used', async () => {
    const src = originSource(own, () => Promise.reject(new Error('connect ECONNREFUSED')));
    const r = await settle(steadyDownload({ capBytesPerStream: 500e6, streams: 2, seconds: 3, sources: [src, ...SRC], fetch: link(8) }));
    expect(r).toMatchObject({ ok: true, source: 'a.test' });
  }, 10_000);
});

describe('steadyDownload', () => {
  it('adds the streams up and reads the steady rate', async () => {
    const r = await settle(steadyDownload({ capBytesPerStream: 500e6, streams: 4, seconds: 4, sources: SRC, fetch: link(10) }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe('a.test');
    expect(r.figure).toMatchObject({ method: 'steady-v1', basis: 'steady', streams: 4 });
    expect(r.figure.mbps).toBeGreaterThan(34);
    expect(r.figure.mbps).toBeLessThan(46);
  }, 10_000);

  it('one request per stream, never for more than 25 MB or the cap; a fast line reads as a floor', async () => {
    const log: string[] = [];
    const r = await settle(steadyDownload({ capBytesPerStream: 30e6, streams: 2, seconds: 5, sources: SRC, fetch: link(400, log) }));
    expect(log).toEqual([`https://a.test/d?bytes=${REQUEST_BYTES}`, `https://a.test/d?bytes=${REQUEST_BYTES}`]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.figure.basis).toBe('transfer'); // 2 × 25 MB at 800 Mbit is over in half a second
    expect(r.figure.mbps).toBeGreaterThan(500);
    expect(r.figure.bytes).toBeLessThanOrEqual(2 * REQUEST_BYTES);
    const small: string[] = [];
    await settle(steadyDownload({ capBytesPerStream: 3e6, streams: 1, seconds: 1, sources: SRC, fetch: link(400, small) }));
    expect(small).toEqual(['https://a.test/d?bytes=3000000']);
  }, 10_000);

  it('the window ends when the first stream stops, so slower windows after it never count', async () => {
    let n = 0;
    // Stream 1 is served 2 MB and stops; stream 2 would run on at the same rate.
    const fetch: StreamFetch = (url, idle, onBytes, socks, maxMs) => link(8)(n++ === 0 ? 'https://a.test/d?bytes=2000000' : url, idle, onBytes, socks, maxMs);
    const r = await settle(steadyDownload({ capBytesPerStream: 500e6, streams: 2, seconds: 4, sources: SRC, fetch }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.figure.ms).toBeLessThan(2600); // cut at ~2 s, not 4 s
    expect(r.figure.mbps).toBeGreaterThan(13); // both streams' rate, not one stream's 8
  }, 10_000);

  it('falls back to the next source when the first gives nothing', async () => {
    const fetch: StreamFetch = (url, idle, onBytes, socks, maxMs) => (url.includes('a.test') ? Promise.resolve({ status: 503, bytes: 0 }) : link(8)(url, idle, onBytes, socks, maxMs));
    const r = await settle(steadyDownload({ capBytesPerStream: 500e6, streams: 2, seconds: 3, sources: SRC, fetch }));
    expect(r).toMatchObject({ ok: true, source: 'b.test' });
  }, 10_000);

  it('says whether anything answered when no data came: path dead vs source refusing', async () => {
    const dead: StreamFetch = () => Promise.reject(new Error('socket hang up'));
    expect(await settle(steadyDownload({ capBytesPerStream: 1e6, streams: 2, seconds: 1, sources: SRC, fetch: dead })))
      .toMatchObject({ ok: false, reached: false, error: 'a.test: socket hang up; b.test: socket hang up' });
    const refused: StreamFetch = () => Promise.resolve({ status: 429, bytes: 0 });
    expect(await settle(steadyDownload({ capBytesPerStream: 1e6, streams: 2, seconds: 1, sources: SRC, fetch: refused })))
      .toMatchObject({ ok: false, reached: true });
  });

  it('passes the proxy endpoint to every request', async () => {
    const seen: Array<string | undefined> = [];
    const fetch: StreamFetch = (url, idle, onBytes, socks, maxMs) => { seen.push(socks); return link(8)(url, idle, onBytes, socks, maxMs); };
    await settle(steadyDownload({ capBytesPerStream: 500e6, streams: 2, seconds: 1, sources: SRC, fetch, socks: '127.0.0.1:1080' }));
    expect(seen).toEqual(['127.0.0.1:1080', '127.0.0.1:1080']);
  }, 10_000);
});
