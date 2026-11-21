import { describe, it, expect } from 'vitest';
import { median, percentile, perStreamCap, speedFigure, steadyState, type ByteSample } from '../../src/core/nodetest/steady';
import {
  CENSUS_TO_CODE, RESULT_CODES, SLOW_BELOW_MBPS, STAGES, STAGE_LABEL, costSentence, depositExistsAt, resultSentence, slowFloor, tally, verdictOf,
  type ResultCode, type ServerTestResult,
} from '../../src/core/nodetest/stages';
import {
  baselineDue, jobsFor, newRun, planRun, progressOf, recordHistory, remainingJobs, resumable, selectServers, serverSummary,
  withDepositClosed, withDepositOpened, withResult, BASELINE_TTL_MS, HISTORY_KEEP, type ServerHistory, type TestableServer,
} from '../../src/core/nodetest/plan';
import { CENSUS_SENTENCE } from '../../src/core/nodes/census';

// ─── Steady speed method (row 148) ───

/** Cumulative samples every 100 ms for a link that ramps for `rampS` seconds then holds `mbps`. */
function link(mbps: number, seconds: number, rampS = 0, tail = 1): ByteSample[] {
  const out: ByteSample[] = [];
  let bytes = 0;
  for (let i = 0; i <= seconds * 10; i++) {
    const t = i / 10;
    out.push({ t, bytes });
    const rate = t < rampS ? mbps * ((t + 0.1) / rampS) * 0.5 : t >= seconds - 1 ? mbps * tail : mbps;
    bytes += (rate * 1e6) / 8 / 10;
  }
  return out;
}

describe('steady speed method', () => {
  it('median and percentile', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(percentile([], 90)).toBeNull();
  });

  it('reads a flat 100 Mbit link as 100, dropping the tail window', () => {
    const s = steadyState(link(100, 10, 0, 0.2));
    expect(s.medianBps).toBeCloseTo(100e6, -4);
    expect(s.rampSeconds).toBe(0);
    expect(s.falling).toBe(false);
    expect(s.windows).toBe(9);
  });

  it('discards the ramp: 3 s of slow start does not pull the figure down', () => {
    const samples = link(200, 10, 3);
    const s = steadyState(samples);
    expect(s.medianBps).toBeCloseTo(200e6, -5);
    expect(s.rampSeconds).toBeGreaterThanOrEqual(2);
    // The old method (bytes over total time) reads well under the true rate on the same samples.
    const naive = (samples[samples.length - 1].bytes * 8) / 10;
    expect(naive).toBeLessThan(0.9 * 200e6);
  });

  it('flags burst-then-throttle', () => {
    const samples: ByteSample[] = [];
    let bytes = 0;
    for (let i = 0; i <= 100; i++) { samples.push({ t: i / 10, bytes }); bytes += ((i < 40 ? 100 : 20) * 1e6) / 80; }
    expect(steadyState(samples).falling).toBe(true);
  });

  it('gives a figure, a floor, or nothing', () => {
    const f = speedFigure(link(50, 10), 62_500_000, 10_000, 4);
    expect(f).toMatchObject({ method: 'steady-v1', basis: 'steady', streams: 4 });
    expect(f?.mbps).toBeCloseTo(50, 0);
    // Budget ran out before two whole windows: whole transfer, marked as a floor.
    expect(speedFigure([{ t: 0, bytes: 0 }, { t: 0.9, bytes: 90e6 }], 90e6, 900, 4)).toMatchObject({ basis: 'transfer', mbps: 800 });
    expect(speedFigure([], 0, 10_000, 4)).toBeNull();
  });

  it('keeps a per-GB test inside 60 % of the data paid for', () => {
    expect(perStreamCap(null)).toBe(150_000_000);
    expect(perStreamCap(1e9)).toBe(Math.floor((0.6e9 - 10e6) / 4));
    expect(perStreamCap(100e6) * 4 + 10e6).toBeLessThanOrEqual(0.6 * 100e6);
    expect(perStreamCap(1e6)).toBe(1_000_000); // never under 1 MB a stream
  });
});

// ─── Stages and codes (rows 150, 151) ───

const result = (over: Partial<ServerTestResult> = {}): ServerTestResult => ({
  server: 'S1', protocol: 'wireguard', country: 'Germany', basis: 'per_hour', stages: STAGES.map((stage) => ({ stage, ok: true, ms: 1 })),
  code: 'OK', verdict: 'working', mbps: 80, speedBasis: 'steady', baselineMbps: 100, connectMs: 900, exitIp: '1.2.3.4',
  deposit: 'Dep1', depositState: 'closed', closeCode: null, startedAt: 1000, endedAt: 2000, ...over,
});

describe('stages and result codes', () => {
  it('the nine stages, in the plan\'s order, each with a label', () => {
    expect([...STAGES]).toEqual(['found', 'reachable', 'verified', 'paid', 'connected', 'exit-address', 'dns', 'speed', 'closed']);
    for (const s of STAGES) expect(STAGE_LABEL[s].length).toBeGreaterThan(3);
  });

  it('every code names a real stage and a glossary-clean sentence', () => {
    for (const [code, info] of Object.entries(RESULT_CODES())) {
      expect(STAGES, code).toContain(info.stage);
      expect(info.sentence, code).not.toMatch(/\bnodes?\b|daemon|dvpnd|metadata|\brpc\b|escrow|\block(ed)?\b|channel|ticket/i);
      expect(info.sentence, code).toMatch(/\.$/);
    }
  });

  it('a failure before "paid" costs nothing and says so', () => {
    expect(depositExistsAt('verified')).toBe(false);
    expect(depositExistsAt('paid')).toBe(false); // paying itself failed: nothing on deposit
    expect(depositExistsAt('connected')).toBe(true);
    expect(costSentence('verified', 'none')).toBe('Nothing was paid.');
    expect(costSentence('connected', 'closed')).toMatch(/back in your wallet/);
    expect(costSentence('speed', 'refund-started')).toMatch(/about 2 hours/);
    expect(costSentence('speed', 'open')).toMatch(/still open/);
  });

  it('only a server fault reads "failed"; our own faults and a stop never count against it', () => {
    expect(verdictOf('BAD_SIGNATURE', null, 100)).toBe('failed');
    expect(verdictOf('EXIT_NOT_SERVER', null, 100)).toBe('failed');
    expect(verdictOf('SOLANA_BUSY', null, 100)).toBe('not-tested');
    expect(verdictOf('SPEED_SOURCE_DOWN', null, 100)).toBe('not-tested');
    expect(verdictOf('SPENDING_LIMIT', null, 100)).toBe('not-tested');
    expect(verdictOf('STOPPED', null, 100)).toBe('stopped');
  });

  it('UI-194: Slow is under 10 Mbps measured, Working at 10 or more, whatever the speed without VPN', () => {
    expect(SLOW_BELOW_MBPS).toBe(10);
    for (const base of [null, 12, 100, 1450]) expect(slowFloor(base)).toBe(10);
    expect(verdictOf('OK', 10, 1450)).toBe('working');
    expect(verdictOf('OK', 9.99, 12)).toBe('slow');
    expect(verdictOf('OK', 10, null)).toBe('working');
    expect(verdictOf('OK', 9.9, null)).toBe('slow');
    expect(verdictOf('OK', 160, 1450)).toBe('working'); // was Slow under the old 20 % bar (290 Mbps on the VM)
    expect(verdictOf('OK', 0.5, null)).toBe('slow');
    expect(verdictOf('OK', null, 100)).toBe('failed');
  });

  it('one plain line per result', () => {
    expect(resultSentence(result())).toBe('80 Mbps (80% of your speed without VPN).');
    expect(resultSentence(result({ verdict: 'slow', mbps: 5 }))).toBe('5 Mbps, under the 10 Mbps a working server reaches (5% of your speed without VPN).');
    const failed = result({ code: 'DETAILS_EXPIRED', verdict: 'failed', mbps: null, depositState: 'none', stages: [{ stage: 'found', ok: true, ms: 1 }, { stage: 'reachable', ok: true, ms: 1 }, { stage: 'verified', ok: false, ms: 1 }] });
    expect(resultSentence(failed)).toBe('The server\'s details are out of date. Nothing was paid.');
  });

  it('every census reason maps to a test code or to "check first"', () => {
    for (const reason of Object.keys(CENSUS_SENTENCE())) expect(CENSUS_TO_CODE).toHaveProperty(reason);
    const mapped = Object.values(CENSUS_TO_CODE).filter((c): c is ResultCode => c !== null);
    for (const c of mapped) expect(RESULT_CODES()).toHaveProperty(c);
    expect(CENSUS_TO_CODE['never-checked']).toBeNull();
  });

  it('tally', () => {
    expect(tally([result(), result({ verdict: 'slow' }), result({ verdict: 'failed' }), result({ verdict: 'not-tested' }), result({ verdict: 'stopped' })]))
      .toEqual({ tested: 3, working: 1, slow: 1, failed: 1, notTested: 1, stopped: 1 });
  });
});

// ─── Plan, batches, resume, history (rows 144, 149, 152, 154, 156) ───

const srv = (address: string, protocolNames: string[], over: Partial<TestableServer> = {}): TestableServer =>
  ({ address, country: 'Germany', protocolNames, pricePerGb: '1000000', pricePerHour: '200000', ...over });

describe('run plan', () => {
  it('one job per server and protocol, no cap (row 144, 149)', () => {
    const many = Array.from({ length: 78 }, (_, i) => srv(`S${i}`, ['wireguard', 'v2ray']));
    const jobs = jobsFor(many);
    expect(jobs).toHaveLength(156);
    expect(jobs[1]).toMatchObject({ id: 'S0:v2ray', server: 'S0', protocol: 'v2ray', basis: 'per_hour', deposit: '200000' });
    expect(jobsFor(many, { protocols: ['V2Ray'] })).toHaveLength(78);
    expect(jobsFor([srv('A', ['wireguard']), srv('A', ['wireguard'])])).toHaveLength(1);
  });

  it('per-hour deposits free their amount at once: one batch, peak = one deposit', () => {
    const p = planRun(jobsFor(Array.from({ length: 78 }, (_, i) => srv(`S${i}`, ['wireguard']))), 200_000n);
    expect(p.batches).toHaveLength(1);
    expect(p).toMatchObject({ peak: '200000', totalDeposits: String(78 * 200_000), jobs: 78, servers: 78, waitSeconds: 0 });
    expect(p.batches[0].heldAtEnd).toBe('0');
  });

  it('per-GB deposits stay on deposit for their refund: batches never pass the limit', () => {
    const gb = Array.from({ length: 5 }, (_, i) => srv(`G${i}`, ['wireguard'], { pricePerHour: '0' }));
    const p = planRun(jobsFor(gb), 2_500_000n);
    expect(p.batches.map((b) => b.jobs.length)).toEqual([2, 2, 1]);
    for (const b of p.batches) expect(BigInt(b.peak)).toBeLessThanOrEqual(2_500_000n);
    expect(p.peak).toBe('2000000');
    expect(p.waitSeconds).toBe(2 * 7200);
  });

  it('reports what it will not run instead of dropping it silently', () => {
    const p = planRun(jobsFor([srv('big', ['wireguard'], { pricePerHour: '9000000' }), srv('free', ['wireguard'], { pricePerGb: '0', pricePerHour: '0' }), srv('ok', ['wireguard'])]), 1_000_000n);
    expect(p.overLimit.map((j) => j.server)).toEqual(['big']);
    expect(p.unpriced.map((j) => j.server)).toEqual(['free']);
    expect(p.batches.flatMap((b) => b.jobs).map((j) => j.server)).toEqual(['ok']);
    expect(p.jobs).toBe(3);
  });
});

describe('resume (row 154)', () => {
  const jobs = jobsFor([srv('A', ['wireguard', 'v2ray']), srv('B', ['wireguard'])]);
  it('picks up after the last finished job; a stopped job runs again', () => {
    let run = newRun(jobs, 1_000_000n, Date.UTC(2026, 10, 15));
    expect(run.id).toBe('2026-11-15T00-00-00-000Z');
    run = withResult(run, result({ server: 'A', protocol: 'wireguard' }));
    run = withResult(run, result({ server: 'A', protocol: 'v2ray', verdict: 'stopped', code: 'STOPPED' }));
    expect(remainingJobs(run).map((j) => j.id)).toEqual(['A:v2ray', 'B:wireguard']);
    expect(resumable(run)).toBe(true);
    run = withResult(run, result({ server: 'A', protocol: 'v2ray' }));
    expect(run.results).toHaveLength(2); // the stopped entry was replaced
    run = withResult(run, result({ server: 'B', protocol: 'wireguard', verdict: 'failed', code: 'UNREACHABLE' }));
    expect(remainingJobs(run)).toEqual([]);
    expect(resumable(run)).toBe(false);
  });

  it('a deposit is on record from the moment it is reported until it is closed (row 152)', () => {
    let run = newRun(jobs, 1_000_000n, 0);
    run = withDepositOpened(run, { job: 'A:wireguard', deposit: 'Dep1', basis: 'per_hour', openedAt: 5 });
    run = withDepositOpened(run, { job: 'A:wireguard', deposit: 'Dep1', basis: 'per_hour', openedAt: 6 });
    expect(run.openDeposits).toHaveLength(1);
    for (const j of jobs) run = withResult(run, result({ server: j.server, protocol: j.protocol }));
    expect(resumable(run)).toBe(true); // all jobs done, one deposit still to close
    run = withDepositClosed(run, 'Dep1');
    expect(resumable(run)).toBe(false);
    expect(resumable(null)).toBe(false);
  });

  it('measures the speed without VPN again after 30 minutes (row 153)', () => {
    expect(baselineDue({ baselineAt: null }, 1000)).toBe(true);
    expect(baselineDue({ baselineAt: 1000 }, 1000 + BASELINE_TTL_MS)).toBe(false);
    expect(baselineDue({ baselineAt: 1000 }, 1001 + BASELINE_TTL_MS)).toBe(true);
  });

  it('time left follows the measured pace once three jobs are done', () => {
    let run = newRun(jobsFor(Array.from({ length: 10 }, (_, i) => srv(`S${i}`, ['wireguard']))), 1n, 0);
    expect(progressOf(run, 0)).toEqual({ done: 0, total: 10, secondsLeft: 500 });
    for (let i = 0; i < 4; i++) run = withResult(run, result({ server: `S${i}` }));
    expect(progressOf(run, 80_000)).toEqual({ done: 4, total: 10, secondsLeft: 120 });
  });
});

describe('per-server history (row 156)', () => {
  it('keeps the last results per server and sums them up', () => {
    let h: ServerHistory = {};
    const add = (over: Partial<ServerTestResult>): void => { h = recordHistory(h, result(over)); };
    add({ endedAt: 1, mbps: 10 });
    add({ endedAt: 2, mbps: 30 });
    add({ endedAt: 3, verdict: 'failed', code: 'NO_DATA', mbps: null });
    add({ endedAt: 4, mbps: 20 });
    add({ endedAt: 5, verdict: 'not-tested', code: 'SOLANA_BUSY', mbps: null }); // says nothing about the server
    add({ endedAt: 6, verdict: 'stopped', code: 'STOPPED', mbps: null });
    const s = serverSummary(h, 'S1');
    expect(s).toEqual({ tested: true, lastVerdict: 'working', lastAt: 4, lastFive: ['working', 'failed', 'working', 'working'], workingOfLastFive: 3, medianMbps: 20, lastFailure: 'NO_DATA' });
    expect(serverSummary(h, 'other')).toMatchObject({ tested: false, lastVerdict: null, medianMbps: null });
    for (let i = 0; i < 40; i++) add({ endedAt: 100 + i });
    expect(h.S1).toHaveLength(HISTORY_KEEP);
  });

  it('selects by country, protocol, failed last time, never tested', () => {
    const list = [
      { ...srv('A', ['wireguard']), countryCode: 'DE' },
      { ...srv('B', ['v2ray'], { country: 'France' }), countryCode: 'FR' },
      { ...srv('C', ['wireguard', 'v2ray'], { country: 'France' }), countryCode: 'FR' },
    ];
    let h: ServerHistory = {};
    h = recordHistory(h, result({ server: 'A', verdict: 'failed', code: 'UNREACHABLE', mbps: null }));
    h = recordHistory(h, result({ server: 'B' }));
    const pick = (sel: Parameters<typeof selectServers>[1]): string[] => selectServers(list, sel, h).map((s) => s.address);
    expect(pick({})).toEqual(['A', 'B', 'C']);
    expect(pick({ countries: ['fr'] })).toEqual(['B', 'C']);
    expect(pick({ protocols: ['V2Ray'] })).toEqual(['B', 'C']);
    expect(pick({ failedLast: true })).toEqual(['A']);
    expect(pick({ neverTested: true })).toEqual(['C']);
    expect(pick({ countries: ['France'], neverTested: true })).toEqual(['C']);
  });
});
