// ─── Node test page: made-up states for the gallery (screenshots without a service) ───
// Every address, amount and speed here is invented. Times are built from `now`, so the check
// results never age out while a preview is on screen.
import type { NodeView, ProbeResult } from '../../shared/types';
import { jobsFor, newRun, planRun, recordHistory, runRow, type PlanReply, type RunRow, type ServerHistory, type TestProgress, type TestRun } from './plan';
import { RESULT_CODES, STAGES, verdictOf, type ResultCode, type ServerTestResult, type Stage } from './stages';
import { tr } from '../../shared/i18n';

export interface NodeTestPreview {
  id: string;
  name: string;
  nodes: NodeView[];
  picked: string[];
  plan: PlanReply | null;
  limit: string;
  progress: TestProgress | null;
  hist: { runs: RunRow[]; run: TestRun | null; running: TestRun | null; history: ServerHistory };
  /** A result row shown opened (`server:protocol`), so a picture shows its stages and facts. */
  open?: string;
}

const ADDR = ['7Gq2mVx4Lk9pRt3sWz8bNc5dHf1jYu6aEo2iKv4mPq9T', '3Hn8cXv2Bz5mKq7wRt4yLp9sDf6gJa1eUo3iNb8vCx2M', '9Kp4tYr7Ws2nBv6cXz3mLq8dGf5hJa1eUi4oPb7vNc6R', 'BvC5xZ2mNq8wLk4pRt7sYd3fGh6jUa9eIo1iKb5vMn2Q', '5Jd9fGh3kLz7xCv2bNm6qWr4tYp8sUa1eIo5iKb9vMc3T', 'DfG7hJk2lZx4cVb9nMq3wRt6yPs8uAe1iOo5kBv7mNc4X'];
const SPEC = (): Array<{ country: string; code: string; protocol: string; hour: string; state: 'ok' | 'offline' | 'full' }> => ([
  { country: 'Germany', code: 'DE', protocol: 'wireguard', hour: '1000', state: 'ok' },
  { country: tr('United States'), code: 'US', protocol: 'v2ray', hour: '1500', state: 'ok' },
  { country: 'Japan', code: 'JP', protocol: 'xray', hour: '97500000', state: 'ok' },
  { country: 'Brazil', code: 'BR', protocol: 'openvpn', hour: '3000', state: 'ok' },
  { country: 'France', code: 'FR', protocol: 'hysteria2', hour: '2000', state: 'offline' },
  { country: 'Singapore', code: 'SG', protocol: 'amneziawg', hour: '2000', state: 'full' },
]);

function probe(now: number, state: 'ok' | 'offline' | 'full', latencyMs: number, serviceType: string): ProbeResult {
  if (state === 'offline') {
    const error = tr('Server is not reachable'); // the check's own fixed text (core/nodes/discovery.ts), read by the census
    return { ok: false, reachable: false, latencyMs: null, signatureValid: null, claimsMatch: null, signerIsOwner: null, signerAuthorized: null, metadataExpired: null, tlsPinMatch: null, peers: null, maxPeers: null, downloadMbps: null, uploadMbps: null, city: null, serviceType: null, version: null, error, probedAt: now - 60_000 };
  }
  return {
    ok: state !== 'full', reachable: true, latencyMs, signatureValid: true, claimsMatch: true, signerIsOwner: true, signerAuthorized: true, metadataExpired: false, tlsPinMatch: true,
    peers: state === 'full' ? 50 : 3, maxPeers: 50, downloadMbps: null, uploadMbps: null, city: null, serviceType, version: '1.0.0', error: null, probedAt: now - 60_000,
  };
}

function servers(now: number): NodeView[] {
  return SPEC().map((s, i) => ({
    address: ADDR[i], owner: ADDR[(i + 1) % ADDR.length], listed: true, listedAt: Math.floor(now / 1000) - 600, expiresAt: Math.floor(now / 1000) + 3000, listingFresh: true,
    uri: `https://203.0.113.${10 + i}:8443`, countryCode: s.code, country: s.country, continent: '', protocols: 1, protocolNames: [s.protocol],
    pricePerGb: '0', pricePerHour: s.hour, probe: probe(now, s.state, 40 + i * 35, s.protocol), favourite: false,
  }));
}

function result(n: NodeView, code: ResultCode, at: number, o: { mbps?: number; basis?: 'steady' | 'transfer'; deposit?: boolean } = {}): ServerTestResult {
  const failAt: Stage = code === 'OK' ? 'closed' : RESULT_CODES()[code].stage;
  const reached = STAGES.slice(0, STAGES.indexOf(code === 'OK' ? 'speed' : failAt) + 1);
  const stages = reached.map((stage, i) => ({ stage, ok: code === 'OK' || i < reached.length - 1, ms: stage === 'speed' ? 10_200 : stage === 'connected' ? 3400 : stage === 'paid' ? 2100 : 300 }));
  const paid = o.deposit ?? STAGES.indexOf(failAt) > STAGES.indexOf('paid');
  if (paid) stages.push({ stage: 'closed', ok: true, ms: 15_000 });
  const mbps = o.mbps ?? null;
  return {
    server: n.address, protocol: n.protocolNames[0], country: n.country, basis: 'per_hour', stages, code, verdict: verdictOf(code, mbps, 180), mbps, speedBasis: mbps === null ? null : o.basis ?? 'steady',
    baselineMbps: 180, connectMs: paid ? 3400 : null, exitIp: code === 'OK' ? n.uri.replace(/^https:\/\/|:\d+$/g, '') : null,
    deposit: paid ? ADDR[(ADDR.indexOf(n.address) + 3) % ADDR.length] : null, depositState: paid ? 'closed' : 'none', closeCode: null, startedAt: at - 48_000, endedAt: at,
  };
}

function planFor(nodes: NodeView[], limit?: bigint): PlanReply {
  const jobs = jobsFor(nodes);
  const open = planRun(jobs, 1n << 62n);
  const lim = limit ?? BigInt(open.peak);
  const p = planRun(jobs, lim);
  const largest = jobs.reduce((m, j) => (BigInt(j.deposit) > m ? BigInt(j.deposit) : m), 0n);
  return { ...p, limit: lim.toString(), smallestLimit: largest.toString(), oneBatchLimit: open.peak, unknown: [], estimateText: `${Number(p.peak) / 1e6} tDVPN` };
}

export function nodeTestPreviews(now: number): NodeTestPreview[] {
  const nodes = servers(now);
  const usable = nodes.filter((_n, i) => SPEC()[i].state === 'ok');
  const [de, us, jp, br] = usable;
  const base = (t: number): TestRun => ({ ...newRun(jobsFor(usable), 97_500_000n, t), baselineMbps: 180, baselineAt: t + 12_000 });

  const done = [result(de, 'OK', now - 300_000, { mbps: 86.4 }), result(us, 'OK', now - 250_000, { mbps: 6.4 }) /* under the 10 Mbps bar: Slow (UI-194) */, result(jp, 'EXIT_NOT_SERVER', now - 200_000), result(br, 'SOLANA_BUSY', now - 150_000)];
  const finished: TestRun = { ...base(now - 360_000), results: done, endedAt: now - 140_000 };
  const earlier: TestRun = { ...base(now - 90_000_000), results: [result(de, 'OK', now - 89_000_000, { mbps: 92.1 }), result(us, 'CONNECT_TIMEOUT', now - 88_900_000), result(jp, 'OK', now - 88_800_000, { mbps: 240, basis: 'transfer' }), result(br, 'OK', now - 88_700_000, { mbps: 12.2 })], endedAt: now - 88_600_000 };
  let history: ServerHistory = {};
  for (const r of [...earlier.results, ...finished.results]) history = recordHistory(history, r);

  const going: TestRun = { ...base(now - 100_000), results: [result(de, 'OK', now - 40_000, { mbps: 86.4 })] };
  const stoppedRun: TestRun = { ...base(now - 3_600_000), results: [result(de, 'OK', now - 3_500_000, { mbps: 86.4 })], endedAt: now - 3_480_000, stopped: true };
  const none = { runs: [] as RunRow[], run: null, running: null, history: {} as ServerHistory };
  const past = [runRow(finished), runRow(earlier)];
  const all = usable.map((n) => n.address);

  return [
    { id: 'empty', name: tr('No run yet, nothing picked'), nodes, picked: [], plan: null, limit: '', progress: null, hist: none },
    { id: 'picked', name: tr('Servers picked, plan shown'), nodes, picked: all, plan: planFor(usable), limit: '97.5', progress: null, hist: { ...none, history } },
    { id: 'low-limit', name: tr('Limit under the largest deposit'), nodes, picked: all, plan: planFor(usable, 5000n), limit: '0.005', progress: null, hist: { ...none, history } },
    { id: 'running', name: tr('Run going: second server, speed stage'), nodes, picked: all, plan: planFor(usable), limit: '97.5', progress: { runId: going.id, done: 1, total: 4, secondsLeft: 150, server: us.address, protocol: us.protocolNames[0], step: 'speed' }, hist: { runs: [runRow(going), ...past], run: going, running: going, history } },
    { id: 'finished', name: tr('Run finished: working, slow, failed, not tested'), nodes, picked: [], plan: null, limit: '', progress: null, hist: { runs: past, run: finished, running: null, history }, open: `${de.address}:${de.protocolNames[0]}` },
    { id: 'unfinished', name: tr('Run stopped: can be continued'), nodes, picked: [], plan: null, limit: '', progress: null, hist: { runs: [runRow(stoppedRun), ...past], run: stoppedRun, running: null, history } },
  ];
}
