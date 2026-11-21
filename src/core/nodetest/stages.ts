// ─── Node test: stages and fixed result codes (rows 150, 151) ───
// Ported from sentinel-node-tester-solana (lib/constants.js ERR + STAGES, audit/node-test.js):
// a test walks fixed stages in order and stops at the first one that fails. Every outcome
// is one code from this table, with one plain sentence, who is at fault, and whether any
// money had been put on deposit by then. No free text decides a verdict.
import type { Basis } from '../pricing/cost';
import type { CensusReason } from '../nodes/census';
import { tr } from '../../shared/i18n';

export const STAGES = ['found', 'reachable', 'verified', 'paid', 'connected', 'exit-address', 'dns', 'speed', 'closed'] as const;
export type Stage = typeof STAGES[number];

/** What is happening while a stage runs: the sentence under the stage row (the row already names the stage). */
export const STAGE_DOING = (): Record<Stage, string> => ({
  found: tr('Looking the server up on the network…'),
  reachable: tr('Asking the server to answer…'),
  verified: tr('Checking the server\'s details…'),
  paid: tr('Paying the test deposit…'),
  connected: 'Connecting…',
  'exit-address': tr('Checking that traffic leaves through the server…'),
  dns: tr('Checking that names resolve…'),
  speed: tr('Measuring speed for about 10 seconds…'),
  closed: tr('Closing the test deposit…'),
});

/** Short label per stage for the stage dots and the result drawer. */
export const STAGE_LABEL: Record<Stage, string> = {
  found: 'On the network',
  reachable: 'Answers',
  verified: 'Details verified',
  paid: 'Deposit paid',
  connected: 'Connected',
  'exit-address': 'Traffic leaves through it',
  dns: 'Names resolve',
  speed: 'Speed',
  closed: 'Deposit closed',
};

/** server = counts against the server; app = our side or the network, never against the server; user = stopped or a limit the user set. */
export type Fault = 'server' | 'app' | 'user';

interface CodeInfo { stage: Stage; fault: Fault; sentence: string }

export const RESULT_CODES = () => ({
  // found
  LOOKUP_FAILED: { stage: 'found', fault: 'app', sentence: tr('The server could not be looked up on the Solana network. Test it again.') },
  NOT_FOUND: { stage: 'found', fault: 'server', sentence: tr('This server is not on the network.') },
  DELISTED: { stage: 'found', fault: 'server', sentence: tr('This server has left the network.') },
  LISTING_EXPIRED: { stage: 'found', fault: 'server', sentence: tr('This server has not checked in with the network recently.') },
  // reachable
  BAD_ADDRESS: { stage: 'reachable', fault: 'server', sentence: tr('The address this server published is not usable.') },
  UNREACHABLE: { stage: 'reachable', fault: 'server', sentence: tr('The server could not be reached.') },
  NO_ANSWER: { stage: 'reachable', fault: 'server', sentence: tr('The server was reached but did not answer in time.') },
  BAD_ANSWER: { stage: 'reachable', fault: 'server', sentence: tr('The server answered with an error.') },
  // verified
  BAD_SIGNATURE: { stage: 'verified', fault: 'server', sentence: tr('The server\'s details are not signed correctly. It may be running an old version.') },
  SIGNER_NOT_ALLOWED: { stage: 'verified', fault: 'server', sentence: tr('The server\'s details are signed by someone its owner has not allowed.') },
  SIGNER_CHECK_FAILED: { stage: 'verified', fault: 'app', sentence: tr('Could not confirm who signed the server\'s details. Test it again.') },
  DETAILS_MISMATCH: { stage: 'verified', fault: 'server', sentence: tr('The server\'s details do not match its listing on the network.') },
  DETAILS_EXPIRED: { stage: 'verified', fault: 'server', sentence: tr('The server\'s details are out of date.') },
  CERTIFICATE_MISMATCH: { stage: 'verified', fault: 'server', sentence: tr('The server\'s security certificate does not match its signed details.') },
  SERVER_FULL: { stage: 'verified', fault: 'app', sentence: tr('The server is full right now, so it was not tested.') },
  PROTOCOL_UNSUPPORTED: { stage: 'verified', fault: 'app', sentence: tr('This app cannot use that connection type, so it was not tested.') },
  PROTOCOL_NOT_CHOSEN: { stage: 'verified', fault: 'app', sentence: tr('The VPN service picks the connection type itself and picked another one, so this one was not tested.') },
  NO_PRICE: { stage: 'verified', fault: 'server', sentence: tr('The server lists no price, so nothing can be paid to it.') },
  // paid
  NOT_ENOUGH_FUNDS: { stage: 'paid', fault: 'user', sentence: tr('There was not enough tDVPN or SOL for the deposit.') },
  SPENDING_LIMIT: { stage: 'paid', fault: 'user', sentence: tr('The deposit is larger than the deposit limit of this run, or than what is left of this computer\'s spending limit.') },
  SOLANA_BUSY: { stage: 'paid', fault: 'app', sentence: tr('The Solana network was busy, so the deposit was not paid. Test it again.') },
  PAYMENT_FAILED: { stage: 'paid', fault: 'app', sentence: tr('The deposit could not be paid.') },
  // connected
  SERVICE_NOT_READY: { stage: 'connected', fault: 'app', sentence: tr('The VPN service on this computer was not ready.') },
  CONNECT_REFUSED: { stage: 'connected', fault: 'server', sentence: tr('The server refused the connection.') },
  CONNECT_TIMEOUT: { stage: 'connected', fault: 'server', sentence: tr('The server did not finish connecting in time.') },
  CONNECT_FAILED: { stage: 'connected', fault: 'server', sentence: tr('The connection could not be set up.') },
  // exit address
  EXIT_UNKNOWN: { stage: 'exit-address', fault: 'server', sentence: tr('Connected, but no traffic came back through the server.') },
  EXIT_NOT_SERVER: { stage: 'exit-address', fault: 'server', sentence: tr('Traffic did not leave through this server.') },
  // dns
  DNS_FAILED: { stage: 'dns', fault: 'server', sentence: tr('Website names could not be looked up through the server.') },
  // speed
  NO_DATA: { stage: 'speed', fault: 'server', sentence: tr('Connected, but no data came through.') },
  SPEED_SOURCE_DOWN: { stage: 'speed', fault: 'app', sentence: tr('The speed test source was not available, so speed was not measured.') },
  SPEED_TAMPERED: { stage: 'speed', fault: 'server', sentence: tr('The data that arrived was not the data that was sent.') },
  // closed
  CLOSE_FAILED: { stage: 'closed', fault: 'app', sentence: tr('The deposit could not be closed yet. The app will close it later.') },
  // any stage
  STOPPED: { stage: 'found', fault: 'user', sentence: tr('The test was stopped.') },
  TEST_ERROR: { stage: 'found', fault: 'app', sentence: tr('The test itself hit a problem, so this server was not tested.') },
  OK: { stage: 'closed', fault: 'app', sentence: tr('Every check passed.') },
} as const satisfies Record<string, CodeInfo>);

export type ResultCode = keyof ReturnType<typeof RESULT_CODES>;

export const codeInfo = (code: ResultCode): CodeInfo => RESULT_CODES()[code];

/** True once the 'paid' stage has passed: from here a deposit exists and must be closed. */
export function depositExistsAt(stage: Stage): boolean {
  return STAGES.indexOf(stage) > STAGES.indexOf('paid');
}

/** What a failure cost, in the words the page shows after the reason. */
export function costSentence(failedStage: Stage, deposit: 'none' | 'closed' | 'refund-started' | 'open'): string {
  if (!depositExistsAt(failedStage) || deposit === 'none') return tr('Nothing was paid.');
  if (deposit === 'closed') return tr('The deposit was closed and the unused part is back in your wallet.');
  if (deposit === 'refund-started') return tr('The refund of the unused deposit has started and takes about 2 hours.');
  return tr('The deposit is still open. The app will close it.');
}

/** The census reason of a server that cannot be tested, as a test code. */
export const CENSUS_TO_CODE: Record<CensusReason, ResultCode | null> = {
  delisted: 'DELISTED',
  'listing-lapsed': 'LISTING_EXPIRED',
  'never-checked': null, // not a result: check it first
  'check-too-old': null,
  'bad-address': 'BAD_ADDRESS',
  unreachable: 'UNREACHABLE',
  'no-answer': 'NO_ANSWER',
  'bad-answer': 'BAD_ANSWER',
  'old-version-or-bad-signature': 'BAD_SIGNATURE',
  'signer-not-allowed': 'SIGNER_NOT_ALLOWED',
  'signer-check-failed': 'SIGNER_CHECK_FAILED',
  'details-mismatch': 'DETAILS_MISMATCH',
  'details-expired': 'DETAILS_EXPIRED',
  'certificate-mismatch': 'CERTIFICATE_MISMATCH',
  full: 'SERVER_FULL',
  'unsupported-transport': 'PROTOCOL_UNSUPPORTED',
};

// ─── One test = one server on one protocol ───

export interface StageResult { stage: Stage; ok: boolean; ms: number | null }

export type TestVerdict = 'working' | 'slow' | 'failed' | 'not-tested' | 'stopped';
export type DepositState = 'none' | 'closed' | 'refund-started' | 'open';

export interface ServerTestResult {
  server: string;
  protocol: string;
  country: string;
  basis: Basis | null;
  /** Stages reached, in order; the last one is the failing stage unless code is OK. */
  stages: StageResult[];
  code: ResultCode;
  verdict: TestVerdict;
  mbps: number | null;
  speedBasis: 'steady' | 'transfer' | null;
  baselineMbps: number | null;
  connectMs: number | null;
  exitIp: string | null;
  /** The deposit account, recorded the moment the VPN service reports it. */
  deposit: string | null;
  depositState: DepositState;
  /** Set when closing failed although the server itself passed or failed on its own. */
  closeCode: 'CLOSE_FAILED' | null;
  startedAt: number;
  endedAt: number;
}

/**
 * UI-194 (owner via UI-LEAD 2026-11-15, the recommended bar): Slow = a measured speed under 10 Mbps, Working = 10 Mbps
 * or more, whatever this computer's own line does. The old bar (20 % of the speed without VPN) called 33 of 36
 * connected servers Slow on a 1450 Mbps VM line, and the same server Working or Slow depending on the tester's line.
 */
export const SLOW_BELOW_MBPS = 10;

/** The bar a measured speed must reach to count as Working. The speed without VPN no longer moves it. */
export function slowFloor(_baselineMbps?: number | null): number {
  return SLOW_BELOW_MBPS;
}

/**
 * The verdict from the code and the speed. A fault on our side or a stop is never held
 * against the server: it reads "not tested" / "stopped", not "failed".
 */
export function verdictOf(code: ResultCode, mbps: number | null, baselineMbps: number | null): TestVerdict {
  if (code === 'STOPPED') return 'stopped';
  if (code !== 'OK') return RESULT_CODES()[code].fault === 'server' ? 'failed' : 'not-tested';
  if (mbps === null || mbps <= 0) return 'failed';
  return mbps < slowFloor(baselineMbps) ? 'slow' : 'working';
}

/** One plain line for a result row: the reason, then what it cost. */
export function resultSentence(r: Pick<ServerTestResult, 'code' | 'verdict' | 'mbps' | 'baselineMbps' | 'depositState' | 'stages'> & { speedBasis?: ServerTestResult['speedBasis'] }): string {
  if (r.code === 'OK' && r.mbps !== null) {
    const v = { mbps: r.mbps, slow: SLOW_BELOW_MBPS, share: r.baselineMbps && r.baselineMbps > 0 ? Math.round((r.mbps / r.baselineMbps) * 100) : null };
    // 'transfer' = the test data ran out before the speed settled: the true speed is this or more.
    // One whole sentence per case (at least / exact × slow / not × compared with no VPN or not).
    const atLeast = r.speedBasis === 'transfer';
    if (r.verdict === 'slow') {
      if (atLeast) return v.share !== null ? tr('At least {mbps} Mbps, under the {slow} Mbps a working server reaches ({share}% of your speed without VPN).', v) : tr('At least {mbps} Mbps, under the {slow} Mbps a working server reaches.', v);
      return v.share !== null ? tr('{mbps} Mbps, under the {slow} Mbps a working server reaches ({share}% of your speed without VPN).', v) : tr('{mbps} Mbps, under the {slow} Mbps a working server reaches.', v);
    }
    if (atLeast) return v.share !== null ? tr('At least {mbps} Mbps ({share}% of your speed without VPN).', v) : tr('At least {mbps} Mbps.', v);
    return v.share !== null ? tr('{mbps} Mbps ({share}% of your speed without VPN).', v) : tr('{mbps} Mbps.', v);
  }
  const failedStage = r.stages.length ? r.stages[r.stages.length - 1].stage : RESULT_CODES()[r.code].stage;
  return `${RESULT_CODES()[r.code].sentence} ${costSentence(failedStage, r.depositState)}`;
}

export interface Tally { tested: number; working: number; slow: number; failed: number; notTested: number; stopped: number }

export function tally(results: readonly Pick<ServerTestResult, 'verdict'>[]): Tally {
  const t: Tally = { tested: 0, working: 0, slow: 0, failed: 0, notTested: 0, stopped: 0 };
  for (const r of results) {
    if (r.verdict === 'working') t.working += 1;
    else if (r.verdict === 'slow') t.slow += 1;
    else if (r.verdict === 'failed') t.failed += 1;
    else if (r.verdict === 'not-tested') t.notTested += 1;
    else t.stopped += 1;
  }
  t.tested = t.working + t.slow + t.failed;
  return t;
}
