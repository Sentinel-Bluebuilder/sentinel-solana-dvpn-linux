// ─── Node test: one job through the nine stages (rows 150–152) ───
// Ported from sentinel-node-tester-solana audit/node-test.js (the order of checks and the
// rule that a deposit is closed right after its session). Everything that touches the
// chain, the VPN service or the network is injected, so the whole walk is unit-tested:
// found → reachable → verified → paid → connected → exit address → DNS → speed → closed.
// It stops at the first failing stage, always disconnects what it connected and always
// closes a deposit it opened, whatever happened in between.
import type { Basis } from '../pricing/cost';
import type { ProbeResult } from '../nodes/discovery';
import { classify } from '../nodes/census';
import type { SpeedFigure } from './steady';
import type { TestJob } from './plan';
import {
  CENSUS_TO_CODE, verdictOf,
  type DepositState, type ResultCode, type ServerTestResult, type Stage, type StageResult,
} from './stages';

export interface ServerRecord {
  address: string;
  owner: string;
  uri: string;
  listed: boolean;
  expiresAt: number;
  country: string;
  protocolNames: string[];
}

export interface TestSession {
  /** Local proxy address for V2Ray / Xray sessions; null when the whole computer is tunnelled. */
  proxy: string | null;
  service: string;
}

export type ConnectOutcome =
  | { ok: true; session: TestSession; deposit: string | null; /** true = a deposit the user already had; the test leaves it alone */ reused: boolean }
  | { ok: false; code: ResultCode; deposit: string | null };

export type SpeedOutcome = { ok: true; figure: SpeedFigure } | { ok: false; code: 'NO_DATA' | 'SPEED_SOURCE_DOWN' | 'SPEED_TAMPERED' };

export interface JobDeps {
  now: () => number;
  stopAsked: () => boolean;
  find: (server: string) => Promise<ServerRecord | null>;
  check: (rec: ServerRecord) => Promise<ProbeResult>;
  /** `onDeposit` must be called the moment the VPN service reports the deposit account. */
  connect: (job: TestJob, rec: ServerRecord, onDeposit: (deposit: string) => void) => Promise<ConnectOutcome>;
  exitAddress: (s: TestSession) => Promise<string | null>;
  dns: (s: TestSession) => Promise<boolean>;
  speed: (s: TestSession, job: TestJob) => Promise<SpeedOutcome>;
  disconnect: () => Promise<boolean>;
  closeDeposit: (deposit: string, basis: Basis) => Promise<DepositState>;
  onStage?: (job: TestJob, stage: Stage) => void;
  onDeposit?: (job: TestJob, deposit: string) => void;
  onDepositClosed?: (job: TestJob, deposit: string, state: DepositState) => void;
}

/** Host of a server address when it is a literal IP (what the exit address should equal). */
export function uriIp(uri: string): string | null {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:\[([0-9a-f:.]+)\]|([^/:?#]+))/i.exec(uri.trim());
  if (!m) return null;
  if (m[1]) return m[1];
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(m[2]) ? m[2] : null;
}

/** A result for a job that was not run at all (over the limit, protocol not chosen, stopped before it began). */
export function notRun(job: TestJob, code: ResultCode, now: number, baselineMbps: number | null): ServerTestResult {
  return {
    server: job.server, protocol: job.protocol, country: job.country, basis: job.basis, stages: [], code, verdict: verdictOf(code, null, baselineMbps),
    mbps: null, speedBasis: null, baselineMbps, connectMs: null, exitIp: null, deposit: null, depositState: 'none', closeCode: null,
    startedAt: now, endedAt: now,
  };
}

class Halt extends Error {
  constructor(readonly code: ResultCode) { super(code); }
}

export async function runJob(job: TestJob, deps: JobDeps, baselineMbps: number | null): Promise<ServerTestResult> {
  const startedAt = deps.now();
  const stages: StageResult[] = [];
  const out: ServerTestResult = {
    server: job.server, protocol: job.protocol, country: job.country, basis: job.basis, stages, code: 'OK', verdict: 'not-tested',
    mbps: null, speedBasis: null, baselineMbps, connectMs: null, exitIp: null, deposit: null, depositState: 'none', closeCode: null,
    startedAt, endedAt: startedAt,
  };
  let connected = false;
  let mine: string | null = null; // a deposit this job opened and must close
  let stage: Stage = 'found';
  let t0 = startedAt;
  const begin = (s: Stage): void => {
    if (deps.stopAsked()) throw new Halt('STOPPED');
    stage = s;
    t0 = deps.now();
    deps.onStage?.(job, s);
  };
  const pass = (): void => { stages.push({ stage, ok: true, ms: deps.now() - t0 }); };
  // Named stopWith on purpose: scripts/error-inventory.mjs reads a quoted string passed to a function
  // called "fail" as a message shown to a person, and these are result codes (their sentences live in
  // stages.ts and are checked there).
  const stopWith = (code: ResultCode): never => { throw new Halt(code); };

  try {
    begin('found');
    let rec: ServerRecord | null = null;
    try {
      rec = await deps.find(job.server);
    } catch (err) {
      console.warn(`[nodetest] lookup of ${job.server} failed: ${(err as Error).message}`);
      stopWith('LOOKUP_FAILED');
    }
    if (!rec) return stopWith('NOT_FOUND');
    out.country = rec.country || out.country;
    const probe = await deps.check(rec);
    const seen = classify({ address: rec.address, listed: rec.listed, expiresAt: rec.expiresAt, probe }, deps.now());
    if (seen.state === 'listing-expired') stopWith(CENSUS_TO_CODE[seen.reason ?? 'listing-lapsed'] ?? 'LISTING_EXPIRED');
    pass();

    begin('reachable');
    if (seen.state === 'not-answering' || seen.state === 'not-checked') stopWith((seen.reason && CENSUS_TO_CODE[seen.reason]) || 'NO_ANSWER');
    pass();

    begin('verified');
    if (seen.state !== 'usable') stopWith((seen.reason && CENSUS_TO_CODE[seen.reason]) || 'DETAILS_MISMATCH');
    if (!rec.protocolNames.some((p) => p.toLowerCase() === job.protocol.toLowerCase())) stopWith('PROTOCOL_UNSUPPORTED');
    if (!job.basis || BigInt(job.deposit || '0') === 0n) stopWith('NO_PRICE');
    pass();

    begin('paid');
    const c0 = deps.now();
    const c = await deps.connect(job, rec, (deposit) => {
      out.deposit = deposit;
      // Audit U-1: ours from this moment, so a connect that throws after paying still disconnects and closes it.
      mine = deposit;
      deps.onDeposit?.(job, deposit);
    });
    if (c.deposit) out.deposit = c.deposit;
    if (c.ok && c.reused) { out.deposit = null; mine = null; } // the user's own deposit: not ours to close
    else mine = out.deposit;
    if (!c.ok) {
      // A failure after the deposit was paid belongs to 'connected'; one before it stops at 'paid'.
      if (mine) {
        pass();
        stage = 'connected';
        t0 = deps.now();
      }
      return stopWith(c.code);
    }
    connected = true;
    pass();
    stage = 'connected';
    stages.push({ stage, ok: true, ms: deps.now() - c0 });
    out.connectMs = deps.now() - c0;

    begin('exit-address');
    out.exitIp = await deps.exitAddress(c.session);
    if (!out.exitIp) stopWith('EXIT_UNKNOWN');
    const expected = uriIp(rec.uri);
    if (expected && out.exitIp !== expected) stopWith('EXIT_NOT_SERVER');
    pass();

    begin('dns');
    if (!(await deps.dns(c.session))) stopWith('DNS_FAILED');
    pass();

    begin('speed');
    const sp = await deps.speed(c.session, job);
    if (!sp.ok) return stopWith(sp.code);
    out.mbps = sp.figure.mbps;
    out.speedBasis = sp.figure.basis;
    if (!(sp.figure.mbps > 0)) stopWith('NO_DATA');
    pass();
  } catch (err) {
    if (err instanceof Halt) {
      out.code = err.code;
    } else {
      console.warn(`[nodetest] ${job.id} stopped at ${stage}: ${(err as Error).message}`);
      out.code = 'TEST_ERROR';
    }
    if (out.code !== 'STOPPED') stages.push({ stage, ok: false, ms: deps.now() - t0 });
  } finally {
    if (connected || mine) {
      try {
        if (!(await deps.disconnect())) console.warn(`[nodetest] ${job.id}: disconnect reported a failure`);
      } catch (err) {
        console.warn(`[nodetest] ${job.id}: disconnect failed: ${(err as Error).message}`);
      }
    }
    if (mine && job.basis) {
      const c1 = deps.now();
      let state: DepositState = 'open';
      try {
        state = await deps.closeDeposit(mine, job.basis);
      } catch (err) {
        console.warn(`[nodetest] ${job.id}: closing deposit ${mine} failed: ${(err as Error).message}`);
      }
      out.depositState = state === 'none' ? 'open' : state;
      out.closeCode = out.depositState === 'open' ? 'CLOSE_FAILED' : null;
      stages.push({ stage: 'closed', ok: out.depositState !== 'open', ms: deps.now() - c1 });
      deps.onDepositClosed?.(job, mine, out.depositState);
    }
  }
  out.verdict = verdictOf(out.code, out.mbps, baselineMbps);
  out.endedAt = deps.now();
  return out;
}
