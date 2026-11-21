// ─── Node test: what a run does, in what order, and what it holds on deposit (rows 144, 149, 152, 154, 156) ───
// Pure. One job = one server on one protocol. No cap on the number of jobs: a run is cut
// into batches so the amount on deposit at any moment stays inside the limit the user set.
// A per-hour deposit is closed right after its session and frees its amount at once; a
// per-GB deposit starts its refund at once and stays on deposit for about 2 hours.
import { costPreview, type Basis } from '../pricing/cost';
import { tally, type ServerTestResult, type TestVerdict, type ResultCode, type Stage, type Tally } from './stages';
import { median } from './steady';
import { tr } from '../../shared/i18n';

export interface TestableServer {
  address: string;
  country: string;
  protocolNames: string[];
  pricePerGb: string;
  pricePerHour: string;
}

export interface TestJob {
  /** `${server}:${protocol}`: stable across a resume. */
  id: string;
  server: string;
  protocol: string;
  country: string;
  basis: Basis | null;
  /** Base units put on deposit for this job; '0' when the server lists no price. */
  deposit: string;
}

/** Rough seconds one job takes (check, pay, connect, checks, 10 s speed, close), for the time-left line. */
export const SECONDS_PER_JOB = 50;
/** Chain rule on devnet: this long between two transactions of one wallet. */
export const TX_GAP_MS = 7000;
/** A per-GB refund takes this long by program rule. */
export const PER_GB_REFUND_SECONDS = 7200;

export const jobId = (server: string, protocol: string): string => `${server}:${protocol}`;

/** The cheapest closable deposit: per hour (closes at once) when sold, else 1 GB. */
export function testBasis(n: Pick<TestableServer, 'pricePerGb' | 'pricePerHour'>): Basis | null {
  if (BigInt(n.pricePerHour || '0') > 0n) return 'per_hour';
  if (BigInt(n.pricePerGb || '0') > 0n) return 'per_gb';
  return null;
}

/** Every protocol each server offers, one job each, unless narrowed. Order: servers as given, protocols as listed. */
export function jobsFor(servers: readonly TestableServer[], only: { protocols?: readonly string[] } = {}): TestJob[] {
  const want = only.protocols?.length ? new Set(only.protocols.map((p) => p.toLowerCase())) : null;
  const seen = new Set<string>();
  const jobs: TestJob[] = [];
  for (const s of servers) {
    const basis = testBasis(s);
    const deposit = basis ? String(costPreview(s, basis, 1).escrow) : '0';
    for (const protocol of s.protocolNames) {
      if (want && !want.has(protocol.toLowerCase())) continue;
      const id = jobId(s.address, protocol);
      if (seen.has(id)) continue; // a server named twice is tested once
      seen.add(id);
      jobs.push({ id, server: s.address, protocol, country: s.country, basis, deposit });
    }
  }
  return jobs;
}

export interface Batch {
  jobs: TestJob[];
  /** Most on deposit at any moment during this batch (base units). */
  peak: string;
  /** Still on deposit when the batch ends: per-GB refunds on their way (base units). */
  heldAtEnd: string;
}

export interface RunPlan {
  batches: Batch[];
  /** Jobs whose single deposit is larger than the limit; they are reported, not run. */
  overLimit: TestJob[];
  /** Jobs with no price: reported as NO_PRICE without paying. */
  unpriced: TestJob[];
  jobs: number;
  servers: number;
  /** Most on deposit at any moment over the whole run. */
  peak: string;
  /** Sum of every deposit the run pays (what the spending limit of this computer must cover over the run). */
  totalDeposits: string;
  /** Seconds of testing; waits between batches come on top. */
  seconds: number;
  /** Seconds of waiting for per-GB refunds between batches (0 with one batch). */
  waitSeconds: number;
}

/**
 * Cut the jobs into batches that never hold more than `limit` on deposit. A new batch starts
 * only after the refunds of the previous one are back, so its held amount starts at zero.
 */
export function planRun(jobs: readonly TestJob[], limit: bigint): RunPlan {
  const batches: Batch[] = [];
  const overLimit: TestJob[] = [];
  const unpriced: TestJob[] = [];
  let cur: TestJob[] = [];
  let held = 0n;
  let peak = 0n;
  let runPeak = 0n;
  let total = 0n;
  const close = (): void => {
    if (!cur.length) return;
    batches.push({ jobs: cur, peak: peak.toString(), heldAtEnd: held.toString() });
    cur = [];
    held = 0n;
    peak = 0n;
  };
  for (const j of jobs) {
    const d = BigInt(j.deposit);
    if (!j.basis || d === 0n) { unpriced.push(j); continue; }
    if (d > limit) { overLimit.push(j); continue; }
    if (held + d > limit) close();
    cur.push(j);
    if (held + d > peak) peak = held + d;
    if (peak > runPeak) runPeak = peak;
    if (j.basis === 'per_gb') held += d; // stays on deposit until its refund lands
    total += d;
  }
  close();
  const run = batches.reduce((n, b) => n + b.jobs.length, 0);
  return {
    batches, overLimit, unpriced,
    jobs: jobs.length,
    servers: new Set(jobs.map((j) => j.server)).size,
    peak: runPeak.toString(),
    totalDeposits: total.toString(),
    seconds: run * SECONDS_PER_JOB,
    waitSeconds: Math.max(0, batches.length - 1) * PER_GB_REFUND_SECONDS,
  };
}

/**
 * What is left of this computer's spending limit against what the run pays in deposits. A deposit uses the
 * limit up and closing it does not give it back (Windows VM 2026-11-15: limit 100, one 97.5 deposit, then
 * 32 servers refused). Null = enough, or the limit is not known.
 */
export function limitShortfall(totalDeposits: string, limitLeft: string | null | undefined): { needs: string; left: string } | null {
  if (limitLeft === null || limitLeft === undefined || !/^\d+$/.test(limitLeft)) return null;
  return BigInt(limitLeft) < BigInt(totalDeposits) ? { needs: totalDeposits, left: limitLeft } : null;
}

/** A plan as the service answers it (page and CLI). */
export interface PlanReply extends RunPlan {
  /** The limit this plan was cut for (base units). */
  limit: string;
  /** Largest single deposit: a limit under this leaves servers out. */
  smallestLimit: string;
  /** Most on deposit at once when everything runs as one batch: the limit that needs no waiting. */
  oneBatchLimit: string;
  /** Addresses that are not on the network. */
  unknown: string[];
  estimateText: string;
}

// ─── A run on disk: enough to resume after the app closed (row 154) ───

export interface OpenDeposit { job: string; deposit: string; basis: Basis; openedAt: number }

export interface TestRun {
  version: 2;
  id: string; // ISO time, file-name safe
  startedAt: number;
  endedAt: number | null;
  /** Base units: most on deposit at once, confirmed by the user before the run. */
  limit: string;
  jobs: TestJob[];
  results: ServerTestResult[];
  /** Deposits reported by the VPN service and not yet closed. Written the moment each one is known. */
  openDeposits: OpenDeposit[];
  baselineMbps: number | null;
  baselineAt: number | null;
  stopped: boolean;
}

export const runIdFor = (t: number): string => new Date(t).toISOString().replace(/[:.]/g, '-');

export function newRun(jobs: readonly TestJob[], limit: bigint, now: number): TestRun {
  return {
    version: 2, id: runIdFor(now), startedAt: now, endedAt: null, limit: limit.toString(), jobs: [...jobs],
    results: [], openDeposits: [], baselineMbps: null, baselineAt: null, stopped: false,
  };
}

/** A result that ends a job. 'stopped' does not: a stopped job runs again on resume. */
const FINAL: ReadonlySet<TestVerdict> = new Set<TestVerdict>(['working', 'slow', 'failed', 'not-tested']);

/** Jobs still to run, in their original order. */
export function remainingJobs(run: Pick<TestRun, 'jobs' | 'results'>): TestJob[] {
  const done = new Set(run.results.filter((r) => FINAL.has(r.verdict)).map((r) => jobId(r.server, r.protocol)));
  return run.jobs.filter((j) => !done.has(j.id));
}

/** A run that did not finish and can be picked up: jobs left, or deposits still to close. */
export function resumable(run: TestRun | null): boolean {
  return !!run && run.version === 2 && (remainingJobs(run).length > 0 || run.openDeposits.length > 0);
}

/** Record a result; a re-run of the same job replaces its earlier 'stopped' entry. */
export function withResult(run: TestRun, r: ServerTestResult): TestRun {
  const id = jobId(r.server, r.protocol);
  return { ...run, results: [...run.results.filter((x) => jobId(x.server, x.protocol) !== id), r] };
}

/**
 * Audit U-3: what this run holds on deposit right now (base units), from the deposits it has not closed. A per-hour
 * deposit whose close failed is still held, so the next deposit must fit beside it inside the run's limit.
 */
export function heldOnDeposit(run: Pick<TestRun, 'jobs' | 'openDeposits'>): bigint {
  const size = new Map(run.jobs.map((j) => [j.id, BigInt(j.deposit || '0')]));
  return run.openDeposits.reduce((n, d) => n + (size.get(d.job) ?? 0n), 0n);
}

/** True when paying job now keeps the run inside its limit. */
export function fitsLimit(run: Pick<TestRun, 'jobs' | 'openDeposits' | 'limit'>, job: Pick<TestJob, 'deposit'>): boolean {
  return heldOnDeposit(run) + BigInt(job.deposit || '0') <= BigInt(run.limit);
}

export function withDepositOpened(run: TestRun, d: OpenDeposit): TestRun {
  return run.openDeposits.some((x) => x.deposit === d.deposit) ? run : { ...run, openDeposits: [...run.openDeposits, d] };
}

export function withDepositClosed(run: TestRun, deposit: string): TestRun {
  return { ...run, openDeposits: run.openDeposits.filter((x) => x.deposit !== deposit) };
}

/** The speed without VPN goes stale over a long run (row 153): measure again after this long. */
export const BASELINE_TTL_MS = 30 * 60_000;
export function baselineDue(run: Pick<TestRun, 'baselineAt'>, now: number): boolean {
  return run.baselineAt === null || now - run.baselineAt > BASELINE_TTL_MS || now < run.baselineAt;
}

export interface Progress {
  done: number;
  total: number;
  /** Seconds left at SECONDS_PER_JOB, or from the measured pace once three jobs are done. */
  secondsLeft: number;
}

export function progressOf(run: Pick<TestRun, 'jobs' | 'results' | 'startedAt'>, now: number): Progress {
  const left = remainingJobs(run).length;
  const done = run.jobs.length - left;
  const pace = done >= 3 ? Math.max(5, (now - run.startedAt) / 1000 / done) : SECONDS_PER_JOB;
  return { done, total: run.jobs.length, secondsLeft: Math.round(left * pace) };
}

/** What the service reports while a run goes (event EVENTS.NODE_TEST, CLI lines). */
export interface TestProgress {
  runId: string;
  done: number;
  total: number;
  secondsLeft: number;
  /** '' between servers. */
  server: string;
  protocol: string;
  /** A stage of the server being tested, or what the run is doing between servers. */
  step: Stage | 'baseline' | 'closing-deposits' | 'waiting-for-refunds';
  /** Set once, when a job has its result. */
  result?: ServerTestResult;
}

/** One line of the past-runs list. */
export interface RunRow extends Omit<Tally, 'stopped'> {
  /** Jobs whose test was stopped part-way (they run again when the run is continued). */
  stoppedJobs: number;
  id: string;
  startedAt: number;
  endedAt: number | null;
  total: number;
  done: number;
  stopped: boolean;
  resumable: boolean;
  openDeposits: number;
}

export function runRow(run: TestRun): RunRow {
  const { stopped: stoppedJobs, ...counts } = tally(run.results);
  return {
    ...counts, stoppedJobs, id: run.id, startedAt: run.startedAt, endedAt: run.endedAt, total: run.jobs.length,
    done: run.jobs.length - remainingJobs(run).length, stopped: run.stopped, resumable: resumable(run), openDeposits: run.openDeposits.length,
  };
}

/** Jobs whose verdict differs between two runs (the same server and protocol in both). */
export function compareRuns(prev: Pick<TestRun, 'results'>, next: Pick<TestRun, 'results'>): Array<{ server: string; protocol: string; before: TestVerdict; after: TestVerdict }> {
  const before = new Map(prev.results.map((r) => [jobId(r.server, r.protocol), r.verdict]));
  const out: Array<{ server: string; protocol: string; before: TestVerdict; after: TestVerdict }> = [];
  for (const r of next.results) {
    const b = before.get(jobId(r.server, r.protocol));
    if (b && b !== r.verdict) out.push({ server: r.server, protocol: r.protocol, before: b, after: r.verdict });
  }
  return out;
}

// ─── Per-server history (row 156) ───

export interface HistoryEntry { at: number; protocol: string; verdict: TestVerdict; code: ResultCode; mbps: number | null }

/** address → newest first, at most HISTORY_KEEP per server. */
export type ServerHistory = Record<string, HistoryEntry[]>;
export const HISTORY_KEEP = 20;

/** Add a finished result. Results that say nothing about the server (not tested, stopped) are not kept. */
export function recordHistory(h: ServerHistory, r: ServerTestResult): ServerHistory {
  if (r.verdict === 'not-tested' || r.verdict === 'stopped') return h;
  const entry: HistoryEntry = { at: r.endedAt, protocol: r.protocol, verdict: r.verdict, code: r.code, mbps: r.mbps };
  return { ...h, [r.server]: [entry, ...(h[r.server] ?? [])].slice(0, HISTORY_KEEP) };
}

export interface ServerSummary {
  tested: boolean;
  lastVerdict: TestVerdict | null;
  lastAt: number | null;
  /** Newest first, at most five: for "working 4 of the last 5". */
  lastFive: TestVerdict[];
  workingOfLastFive: number;
  medianMbps: number | null;
  lastFailure: ResultCode | null;
}

export function serverSummary(h: ServerHistory, address: string): ServerSummary {
  const list = h[address] ?? [];
  const five = list.slice(0, 5);
  const speeds = list.filter((e) => e.mbps !== null && e.mbps > 0).map((e) => e.mbps as number);
  const m = median(speeds);
  return {
    tested: list.length > 0,
    lastVerdict: list[0]?.verdict ?? null,
    lastAt: list[0]?.at ?? null,
    lastFive: five.map((e) => e.verdict),
    workingOfLastFive: five.filter((e) => e.verdict === 'working').length,
    medianMbps: m === null ? null : Math.round(m * 100) / 100,
    lastFailure: list.find((e) => e.verdict === 'failed')?.code ?? null,
  };
}

/**
 * One line for a server's past tests: the last result, then how many of the recent tests got a
 * connection (working or slow), kept apart so "Slow" never sits next to "working 0". A speed is
 * shown only when the last test measured one.
 */
export function historyLine(s: ServerSummary, lastWord: string): string {
  // UI-187: one phrase, not fragments: "Slow last time, connected 1 of 2 times (typically 21.3 Mbps)".
  const { head, tally, speed } = historyParts(s, lastWord);
  return `${head}${tally ? `, ${tally}` : ''}${speed ? ` (${speed})` : ''}`;
}

/**
 * The same, in parts, for a narrow cell that shows it on two lines: `head` ("Slow last time"), then
 * the tally and the speed ("Connected 1 of 2 times, typically 21.3 Mbps"). `tally`/`speed` are null when absent.
 */
export function historyParts(s: ServerSummary, lastWord: string): { head: string; tally: string | null; speed: string | null; detail: string | null } {
  if (!s.tested) return { head: tr('Never tested'), tally: null, speed: null, detail: null };
  const n = s.lastFive.length;
  const connected = s.lastFive.filter((v) => v === 'working' || v === 'slow').length;
  const judged = s.lastFive.filter((v) => v === 'working' || v === 'slow' || v === 'failed').length;
  const tally = n > 1 && judged > 0 ? `connected ${connected} of ${judged} times` : null;
  const speed = (s.lastVerdict === 'working' || s.lastVerdict === 'slow') && s.medianMbps !== null ? `typically ${s.medianMbps} Mbps` : null;
  const rest = [tally, speed].filter(Boolean).join(', ');
  return { head: `${lastWord} last time`, tally, speed, detail: rest ? rest[0].toUpperCase() + rest.slice(1) : null };
}

// ─── Selection (row 144: any number, by country, protocol, "failed last time", "never tested") ───

export interface Selection { countries?: readonly string[]; protocols?: readonly string[]; failedLast?: boolean; neverTested?: boolean }

export function selectServers<T extends TestableServer & { countryCode?: string }>(servers: readonly T[], sel: Selection, h: ServerHistory): T[] {
  const countries = sel.countries?.length ? new Set(sel.countries.map((c) => c.toLowerCase())) : null;
  const protocols = sel.protocols?.length ? new Set(sel.protocols.map((p) => p.toLowerCase())) : null;
  return servers.filter((s) => {
    if (countries && !countries.has((s.countryCode ?? '').toLowerCase()) && !countries.has(s.country.toLowerCase())) return false;
    if (protocols && !s.protocolNames.some((p) => protocols.has(p.toLowerCase()))) return false;
    const sum = serverSummary(h, s.address);
    if (sel.neverTested && sum.tested) return false;
    if (sel.failedLast && sum.lastVerdict !== 'failed') return false;
    return true;
  });
}
