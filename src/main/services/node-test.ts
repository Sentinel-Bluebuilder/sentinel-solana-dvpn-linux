// ─── In-app node testing (rows 148–156) ───
// Real paid sessions, one server at a time, through the app's own connect and disconnect,
// never while the user's VPN is on. The walk through the stages, the result codes, the
// batches and the resume rules are pure code in core/nodetest (runner, stages, plan); this
// file only supplies what touches the chain, the VPN service, the network and the disk.
//
// Money: the deposit of a job is written to the run file the moment it is known and closed
// right after that job's session (per hour: closed at once; per GB: refund started, about
// 2 hours). A run that stopped or crashed is picked up from the file: the deposits still
// open are closed first, then the jobs that have no result yet are run.
// Files: <data>/node-tests/latest.json, history/<id>.json, server-history.json, failures.log.
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns';
import type { Result } from '../../shared/types';
import type { Basis } from '../../core/pricing/cost';
import {
  jobsFor, planRun, newRun, remainingJobs, resumable, withResult, withDepositOpened, withDepositClosed, baselineDue, progressOf,
  recordHistory, runRow, limitShortfall, fitsLimit, TX_GAP_MS,
  type PlanReply, type RunRow, type ServerHistory, type TestJob, type TestProgress, type TestRun,
} from '../../core/nodetest/plan';
import { runJob, notRun, uriIp, type ConnectOutcome, type JobDeps, type ServerRecord, type TestSession } from '../../core/nodetest/runner';
import { RESULT_CODES, type DepositState, type ServerTestResult } from '../../core/nodetest/stages';
import { connectResultCode } from '../../core/nodetest/connect-codes';
import { perStreamCap } from '../../core/nodetest/steady';
import { discoverNode, probeNode } from '../../core/nodes/discovery';
import { publicIp } from '../../core/quality/quality';
import { steadyDownload, SPEED_SOURCES, type SpeedSource } from '../../core/quality/steady-download';
import { originSource, parseSpeedOrigin } from '../../core/quality/pinned-origin';
import { getSettings } from '../system/settings';
import { channelByPda, channelsByOwner } from '../../core/chain/accounts';
import { deviceRecord } from '../daemon/manager';
import { CHANNEL_STATUS_OPEN } from '../../core/chain/idl';
import { tdvpn } from '../../core/chain/amounts';
import { connect, disconnect } from './connection';
import { readSettlements, runSettlement } from './settlement';
import { refreshWallet } from './wallet';
import { noWallet, ownerAddress } from '../wallet/vault';
import { snapshot, setNodeTestProgress } from '../app-state';
import { storePath } from '../store';
import { log } from '../logger';
import { isAndroid } from '../../shared/is-android';
import { tr } from '../../shared/i18n';

let running: TestRun | null = null;
let stopRequested = false;

const dir = (): string => storePath('node-tests');
const pause = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

// ─── Disk ───

function writeAtomic(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, body, 'utf8');
  fs.renameSync(`${file}.tmp`, file);
}

function save(run: TestRun): void {
  const body = JSON.stringify(run, null, 2) + '\n';
  writeAtomic(path.join(dir(), 'latest.json'), body);
  writeAtomic(path.join(dir(), 'history', `${run.id}.json`), body);
}

function readRun(file: string): TestRun | null {
  if (!fs.existsSync(file)) return null;
  try {
    const run = JSON.parse(fs.readFileSync(file, 'utf8')) as TestRun;
    return run && run.version === 2 ? run : null; // runs written before the rebuild are not shown
  } catch (err) {
    log.warn('node test: run file unreadable', { file, err: (err as Error).message });
    return null;
  }
}

const historyFile = (): string => path.join(dir(), 'server-history.json');

export function serverHistory(): ServerHistory {
  if (!fs.existsSync(historyFile())) return {};
  try {
    return JSON.parse(fs.readFileSync(historyFile(), 'utf8')) as ServerHistory;
  } catch (err) {
    log.warn('node test: server history unreadable, starting a new one', { err: (err as Error).message });
    return {};
  }
}

function logFailure(r: ServerTestResult): void {
  const last = r.stages.length ? r.stages[r.stages.length - 1].stage : RESULT_CODES()[r.code].stage;
  const line = `${new Date(r.endedAt).toISOString()} ${r.server} ${r.protocol} ${r.verdict} ${r.code} at ${last}\n`;
  fs.mkdirSync(dir(), { recursive: true });
  fs.appendFileSync(path.join(dir(), 'failures.log'), line, 'utf8');
}

// ─── Stop ───

const stopFile = (): string => path.join(dir(), 'stop');
const stopAsked = (): boolean => stopRequested || fs.existsSync(stopFile());
const clearStop = (): void => { stopRequested = false; fs.rmSync(stopFile(), { force: true }); };

export function nodeTestRunning(): TestRun | null { return running; }

/** Stop at the next stage (the server being tested is disconnected and its deposit closed first). Also a marker file, so `test stop` in another terminal reaches a CLI run. */
export function stopNodeTest(): boolean {
  stopRequested = true;
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(stopFile(), String(Date.now()), 'utf8');
  return running !== null;
}

// ─── Reading runs ───

export function listRuns(): RunRow[] {
  const h = path.join(dir(), 'history');
  if (!fs.existsSync(h)) return [];
  const rows: RunRow[] = [];
  for (const f of fs.readdirSync(h).filter((x) => x.endsWith('.json')).sort().reverse().slice(0, 50)) {
    const run = readRun(path.join(h, f));
    if (run) rows.push(runRow(run));
  }
  return rows;
}

export function getRun(id?: string): TestRun | null {
  return readRun(id ? path.join(dir(), 'history', `${id.replace(/[^0-9A-Za-z-]/g, '')}.json`) : path.join(dir(), 'latest.json'));
}

// ─── Plan ───

export type { PlanReply };

export interface PlanOptions { protocols?: string[]; limit?: string }

async function jobsOf(servers: string[], protocols?: string[]): Promise<{ jobs: TestJob[]; unknown: string[] }> {
  const wanted = [...new Set(servers)]; // a server named twice is tested once
  const recs = await Promise.all(wanted.map((n) => discoverNode(n)));
  return { jobs: jobsFor(recs.filter((r): r is NonNullable<typeof r> => !!r), { protocols }), unknown: wanted.filter((_n, i) => !recs[i]) };
}

function planOf(jobs: TestJob[], unknown: string[], limit?: string): PlanReply {
  const open = planRun(jobs, 1n << 62n);
  const largest = jobs.reduce((m, j) => (BigInt(j.deposit) > m ? BigInt(j.deposit) : m), 0n);
  const lim = limit !== undefined ? BigInt(limit) : BigInt(open.peak);
  const plan = planRun(jobs, lim);
  return { ...plan, limit: lim.toString(), smallestLimit: largest.toString(), oneBatchLimit: open.peak, unknown, estimateText: `${tdvpn(plan.peak)} tDVPN` };
}

/** What a run would hold on deposit, before the user confirms. No transaction. */
export async function planNodeTest(servers: string[], opts: PlanOptions = {}): Promise<Result<PlanReply>> {
  if (!servers.length) return { ok: false, error: tr('Pick at least one server.'), code: 'no-nodes' };
  const { jobs, unknown } = await jobsOf(servers, opts.protocols);
  return { ok: true, data: planOf(jobs, unknown, opts.limit) };
}

// ─── Deposits ───

async function openChannels(owner: string): Promise<Map<string, string>> {
  const out = new Map<string, string>(); // deposit → server
  for (const c of await channelsByOwner(owner)) if (Number(c.status) === CHANNEL_STATUS_OPEN) out.set(String(c.address), String((c as { node?: unknown }).node ?? ''));
  return out;
}

/**
 * Close one test deposit now. Per hour: start the close, then close (two transactions, 7 s apart).
 * Per GB: start the refund; the program releases it about 2 hours later.
 */
async function closeDeposit(deposit: string, basis: Basis): Promise<DepositState> {
  for (let pass = 0; pass < 8; pass++) {
    await pause(pass === 0 ? TX_GAP_MS : 4000);
    const p = (await readSettlements()).find((x) => x.channel === deposit);
    if (!p) {
      // Not in this wallet's list is not proof: only the Solana network says a deposit is closed
      // (Windows VM 2026-11-15: three deposits of another wallet were reported closed this way).
      const onChain = await channelByPda(deposit);
      if (!onChain) return 'closed';
      const theirs = String((onChain as { owner?: unknown }).owner ?? '') !== (ownerAddress() ?? '');
      if (theirs) { log.warn('node test: a test deposit belongs to another wallet and cannot be closed from here', { deposit }); return 'open'; }
      if (Number((onChain as { status?: unknown }).status) !== CHANNEL_STATUS_OPEN) return 'refund-started';
      continue;
    }
    // Refund started: per GB (or any wait longer than a minute) is released later by the program.
    if (p.status === 'closing' && (basis === 'per_gb' || (p.readyAt ?? 0) * 1000 - Date.now() > 60_000)) return 'refund-started';
    if (p.status === 'closing' || p.status === 'in-use') continue; // a short wait, or the VPN service still lists the session that just ended
    const r = await runSettlement([deposit]);
    if (!r.ok && r.code !== 'busy') log.warn('node test: closing a deposit failed, trying again', { deposit, pass, err: r.error });
    await pause(TX_GAP_MS);
  }
  return 'open';
}

/** Deposits of this run that are still open: close what can be closed now. Returns the run with the closed ones removed. */
async function sweepDeposits(run: TestRun): Promise<TestRun> {
  let out = run;
  for (const d of run.openDeposits) {
    try {
      const state = await closeDeposit(d.deposit, d.basis);
      if (state === 'closed') out = withDepositClosed(out, d.deposit);
    } catch (err) {
      log.warn('node test: deposit sweep failed for one deposit', { deposit: d.deposit, err: (err as Error).message });
    }
  }
  return out;
}

// ─── Checks through a session ───

async function dnsWorks(): Promise<boolean> {
  try {
    await dns.promises.lookup(`node-test-${Date.now()}.example.com`).catch((err: NodeJS.ErrnoException) => {
      // NXDOMAIN is an answer: the resolver was reached.
      if (err.code !== 'ENOTFOUND') throw err;
    });
    await dns.promises.lookup('www.wikipedia.org');
    return true;
  } catch (err) {
    log.warn('node test: dns lookup failed', { err: (err as Error).message });
    return false;
  }
}

/** Android: every protocol is inside the VPN and checks go through the tunnel probe; there is no local proxy port to dial. */
const proxyOf = (s: TestSession): string | undefined => (isAndroid() ? undefined : s.proxy || undefined);

async function exitAddress(s: TestSession, expected: string | null): Promise<string | null> {
  await pause(2000);
  let ip = await publicIp(8000, proxyOf(s));
  // Android (row 162): the probe answers "no session" for a moment after connect and the check then
  // runs on the phone's own route. Give it up to 10 s more; a wrong exit after that still fails.
  for (let n = 0; isAndroid() && expected && !('ip' in ip && ip.ip === expected) && n < 5; n++) {
    await pause(2000);
    ip = await publicIp(8000, proxyOf(s));
  }
  if (!('ip' in ip)) log.warn('node test: exit address not read', { err: ip.error });
  return 'ip' in ip ? ip.ip : null;
}

/**
 * Where the speed is measured: our own origin first when its address and pin are set (no 25 MB
 * limit per request, so a fast server reaches a steady state), then the public hosts.
 * Both values are public: Settings → Advanced (speedOrigin, speedPin); the environment
 * (DVPN_SPEED_ORIGIN, DVPN_SPEED_PIN) wins when set, for the test scripts.
 */
function speedSources(): readonly SpeedSource[] {
  const s = getSettings();
  const own = parseSpeedOrigin(process.env.DVPN_SPEED_ORIGIN, process.env.DVPN_SPEED_PIN) ?? parseSpeedOrigin(s.speedOrigin, s.speedPin);
  return own ? [originSource(own), ...SPEED_SOURCES] : SPEED_SOURCES;
}

async function measureBaseline(): Promise<number | null> {
  const r = await steadyDownload({ capBytesPerStream: perStreamCap(null), sources: speedSources() });
  if (!r.ok) log.warn('node test: speed without VPN not measured', { err: r.error });
  return r.ok ? r.figure.mbps : null;
}

// ─── Run ───

export interface RunRequest {
  nodes: string[];
  /** Base units: most on deposit at once. */
  maxSpend: string;
  confirmed: true;
  protocols?: string[];
  /** Pick up the last run where it stopped (nodes and maxSpend are taken from it). */
  resume?: boolean;
}

export async function runNodeTest(req: RunRequest, onProgress: (p: TestProgress) => void = () => undefined): Promise<Result<TestRun>> {
  if (req.confirmed !== true) return { ok: false, error: tr('Confirm the deposit limit first.'), code: 'not-confirmed' };
  if (running) return { ok: false, error: tr('A test run is already going.'), code: 'busy' };
  if (snapshot().session) return { ok: false, error: tr('Disconnect first: a test uses the VPN service, which runs one session at a time.'), code: 'vpn-active' };
  const owner = ownerAddress();
  if (!owner) return { ok: false, ...noWallet() };
  // Windows VM 2026-11-15: the VPN service was still set up for another wallet, so it paid the three
  // test deposits from THAT wallet and this run could neither see nor close them. A test never pays
  // from a wallet it was not started with.
  const rec = deviceRecord();
  if (rec && rec.owner !== owner) {
    return { ok: false, error: tr('The VPN service on this computer is set up for a different wallet, so a test would pay from that wallet. Connect once with this wallet (that sets the service up for it), disconnect, then run the test again. Nothing was paid.'), code: 'other-wallet' };
  }

  let run: TestRun;
  if (req.resume) {
    const last = getRun();
    if (!last || !resumable(last)) return { ok: false, error: tr('There is no unfinished test run to continue.'), code: 'nothing-to-resume' };
    run = { ...last, endedAt: null, stopped: false };
  } else {
    if (!req.nodes.length) return { ok: false, error: tr('Pick at least one server.'), code: 'no-nodes' };
    if (!/^\d+$/.test(req.maxSpend || '')) return { ok: false, error: tr('Set the deposit limit first.'), code: 'no-limit' };
    const { jobs } = await jobsOf(req.nodes, req.protocols);
    if (!jobs.length) return { ok: false, error: tr('None of those servers is on the network.'), code: 'no-nodes' };
    const plan = planOf(jobs, [], req.maxSpend);
    if (plan.batches.length === 0 && plan.overLimit.length) {
      return { ok: false, error: tr('Each of these servers needs a deposit over your limit of {maxSpend} tDVPN. The smallest limit that tests any of them is {smallestLimit} tDVPN.', { maxSpend: tdvpn(req.maxSpend), smallestLimit: tdvpn(plan.smallestLimit) }), code: 'over-limit' };
    }
    // The whole run must fit in what is left of this computer's spending limit: a closed deposit does not give it back.
    const w = await refreshWallet().catch((err: Error) => { log.warn('node test: spending limit not read before the run', { err: err.message }); return null; });
    const short = limitShortfall(plan.totalDeposits, w?.grant?.allowance);
    if (short) {
      return { ok: false, error: tr('This run pays {needs} tDVPN in deposits, one server after another, and this computer\'s spending limit has {left} tDVPN left. A closed deposit does not give the limit back. Raise the spending limit in Wallet to at least {needs} tDVPN, then start again. Nothing was paid.', { needs: tdvpn(short.needs), left: tdvpn(short.left) }), code: 'spending-limit' };
    }
    run = newRun(jobs, BigInt(req.maxSpend), Date.now());
  }
  // Deposits the user already had are never the test's to close. Audit U-2: when that list cannot be read, a test
  // could not tell the user's deposit with a server from its own and would close it, so the run does not start.
  let before: Map<string, string>;
  try {
    before = await openChannels(owner);
  } catch (err) {
    log.warn('node test: deposit list not read', { err: (err as Error).message });
    return { ok: false, error: tr('Your open deposits could not be read from the Solana network, so a test could not tell them from its own. Try again in a minute. Nothing was paid.'), code: 'deposits-unread' };
  }
  for (const d of run.openDeposits) before.delete(d.deposit);
  running = run;
  clearStop();
  const keep = (next: TestRun): void => { run = next; running = next; save(next); };
  const tell = (server: string, protocol: string, step: TestProgress['step'], result?: ServerTestResult): void => {
    const p = progressOf(run, Date.now());
    setNodeTestProgress({ done: p.done, total: p.total, server }); // the status card on every page
    onProgress({ runId: run.id, ...p, server, protocol, step, result });
  };

  let history = serverHistory();
  const finish = (r: ServerTestResult): void => {
    keep(withResult(run, r));
    if (r.verdict === 'failed') logFailure(r);
    const next = recordHistory(history, r);
    if (next !== history) { history = next; writeAtomic(historyFile(), JSON.stringify(history) + '\n'); }
    tell(r.server, r.protocol, 'closed', r);
  };

  try {
    keep(run);
    if (run.openDeposits.length) {
      tell('', '', 'closing-deposits');
      keep(await sweepDeposits(run));
    }

    let used = ''; // the connection type the VPN service used for the session of the job being run
    let expected: string | null = null; // the address the traffic of that session should leave from
    const deps: JobDeps = {
      now: Date.now,
      stopAsked,
      find: async (server) => {
        const rec = await discoverNode(server) as ServerRecord | null;
        expected = rec ? uriIp(rec.uri) : null;
        return rec;
      },
      check: (rec) => probeNode(rec),
      connect: async (job, _rec, onDeposit): Promise<ConnectOutcome> => {
        // A test connect is quiet (nothing on the Connect screen, no toast, no system proxy) and
        // reports a deposit the moment it is paid for this start; one that was already open with
        // the server is the user's and is not reported.
        let paidNow: string | null = null;
        // Audit U-15: the deposit this run planned and counted against its limit; a higher fresh price is refused, not paid.
        const shown = job.deposit && job.deposit !== '0' ? { shownEscrow: job.deposit } : {};
        const r = await connect({ node: job.server, basis: job.basis as Basis, units: 1, confirmed: true, purpose: 'test', ...shown }, {
          onDeposit: (channel) => { if (!before.has(channel)) { paidNow = channel; onDeposit(channel); } },
        });
        if (r.ok && r.data) {
          used = (r.data.service || '').toLowerCase();
          const deposit = r.data.channel || null;
          const reused = !!deposit && before.has(deposit);
          if (deposit && !reused && deposit !== paidNow) onDeposit(deposit);
          return { ok: true, session: { proxy: r.data.proxyEndpoint || null, service: r.data.service }, deposit, reused };
        }
        // The connect failed. A deposit paid for it is ours to close: the hook, the answer, or (backstop) the chain.
        let deposit: string | null = paidNow ?? (r.channel && !before.has(r.channel) ? r.channel : null);
        if (!deposit && r.paid !== false) {
          try {
            for (const [addr, server] of await openChannels(owner)) {
              if (server === job.server && !before.has(addr) && !run.openDeposits.some((d) => d.deposit === addr)) deposit = addr;
            }
          } catch (err) {
            log.warn('node test: could not look for a deposit after a failed connect', { server: job.server, err: (err as Error).message });
          }
        }
        if (deposit && deposit !== paidNow) onDeposit(deposit);
        log.info('node test: connect failed', { server: job.server, code: r.code, paid: !!deposit });
        return { ok: false, code: connectResultCode(r.code, !!deposit), deposit };
      },
      exitAddress: (s) => exitAddress(s, expected),
      dns: (s) => (proxyOf(s) ? Promise.resolve(true) : dnsWorks()), // through a proxy, names are looked up at the exit: the exit address check proved it
      speed: async (s, job) => {
        const r = await steadyDownload({ socks: proxyOf(s), capBytesPerStream: perStreamCap(job.basis === 'per_gb' ? 1_000_000_000 : null), throughSession: true, sources: speedSources() });
        if (r.ok) return { ok: true, figure: r.figure };
        log.warn('node test: speed not measured', { server: job.server, reached: r.reached, tampered: r.tampered, err: r.error });
        return { ok: false, code: r.tampered ? 'SPEED_TAMPERED' : r.reached ? 'SPEED_SOURCE_DOWN' : 'NO_DATA' };
      },
      // A test session is never the snapshot's session: it is ended by its own purpose.
      disconnect: async () => (await disconnect({ purpose: 'test' })).ok,
      closeDeposit,
      onStage: (job, stage) => tell(job.server, job.protocol, stage),
      onDeposit: (job, deposit) => keep(withDepositOpened(run, { job: job.id, deposit, basis: job.basis as Basis, openedAt: Date.now() })),
      onDepositClosed: (_job, deposit, state) => { if (state === 'closed') keep(withDepositClosed(run, deposit)); },
    };

    const plan = planRun(remainingJobs(run), BigInt(run.limit));
    for (const j of plan.overLimit) finish(notRun(j, 'SPENDING_LIMIT', Date.now(), run.baselineMbps));

    const batches = [...plan.batches];
    if (plan.unpriced.length) batches.push({ jobs: plan.unpriced, peak: '0', heldAtEnd: '0' }); // checked without paying
    for (let b = 0; b < batches.length && !stopAsked(); b++) {
      // A new batch starts only when the refunds of the one before are back.
      while (b > 0 && run.openDeposits.length && !stopAsked()) {
        tell('', '', 'waiting-for-refunds');
        await pause(60_000);
        keep(await sweepDeposits(run));
      }
      const tested = new Set<string>(); // servers that had their one session in this batch
      const settled = new Set<string>(); // jobs that already got the result of another job's session
      for (const job of batches[b].jobs) {
        if (stopAsked()) break;
        if (settled.has(job.id)) continue;
        // The VPN service picks the connection type itself: one session per server.
        if (tested.has(job.server)) { finish(notRun(job, 'PROTOCOL_NOT_CHOSEN', Date.now(), run.baselineMbps)); continue; }
        if (baselineDue(run, Date.now())) {
          tell('', '', 'baseline');
          keep({ ...run, baselineMbps: await measureBaseline(), baselineAt: Date.now() });
        }
        // Audit U-3: the plan keeps each batch inside the limit, but a per-hour deposit whose close failed is still
        // held. Pay the next one only when it fits beside what is held; close what can be closed first.
        if (!fitsLimit(run, job)) {
          keep(await sweepDeposits(run));
          if (!fitsLimit(run, job)) { finish(notRun(job, 'SPENDING_LIMIT', Date.now(), run.baselineMbps)); continue; }
        }
        used = '';
        const r = await runJob(job, deps, run.baselineMbps);
        if (r.verdict === 'stopped') { keep(withResult(run, r)); tell(r.server, r.protocol, 'closed', r); break; }
        tested.add(job.server);
        const other = used && used !== job.protocol.toLowerCase() ? batches[b].jobs.find((x) => x.server === job.server && x.protocol.toLowerCase() === used) : undefined;
        if (other) {
          // The session ran on another listed connection type: the result belongs to that one.
          finish(notRun(job, 'PROTOCOL_NOT_CHOSEN', Date.now(), run.baselineMbps));
          finish({ ...r, protocol: other.protocol });
          settled.add(other.id);
        } else {
          finish(r);
        }
        if (r.deposit) await pause(TX_GAP_MS); // 7 s between this job's last transaction and the next deposit
      }
    }
    if (run.openDeposits.length) {
      tell('', '', 'closing-deposits');
      keep(await sweepDeposits(run));
    }
  } catch (err) {
    log.error('node test: the run stopped on an error', { err: (err as Error).message });
    keep({ ...run, endedAt: Date.now(), stopped: true });
    return { ok: false, error: tr('The test run stopped on a problem of its own. Deposits it opened are closed when you continue the run.'), code: 'run-error', data: run };
  } finally {
    const stopped = stopAsked() || remainingJobs(run).length > 0;
    keep({ ...run, endedAt: Date.now(), stopped });
    running = null;
    setNodeTestProgress(null);
    clearStop();
  }
  return { ok: true, data: run };
}
