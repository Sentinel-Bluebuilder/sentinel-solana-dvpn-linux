// ─── Server census (rows 143–147) ───
// One count for every screen and the CLI. Pure: (server list, check results, now) in,
// numbers and one state per server out. A check result is only believed for
// CHECK_TTL_MS; after that the server reads "not checked", never "online". The
// listing itself is re-judged against `now`, so a list loaded from disk cannot keep
// a server that left the network yesterday.
//
// Method ported from sentinel-node-tester-solana (lib/discovery.js + audit/pipeline.js
// scanNodesParallel): on the network = listed and listing TTL not lapsed; answering =
// the server returned its signed details; verified = those details check out against
// the chain. `usable` adds the two app-only refusals (full, unsupported transport).
import type { ProbeResult } from './discovery';
import { tr } from '../../shared/i18n';

export const CHECK_TTL_MS = 10 * 60_000;

/** The slice of a server record the census reads (NodeView satisfies it). */
export interface CensusInput {
  address: string;
  listed: boolean;
  expiresAt: number; // unix seconds; 0 = never listed
  probe: ProbeResult | null;
}

export type CensusState =
  | 'usable' // verified and can take a connection now
  | 'verified-busy' // verified, but full or on a transport this app cannot use
  | 'unverified' // answered, details did not check out
  | 'not-answering'
  | 'not-checked' // on the network, no check result younger than CHECK_TTL_MS
  | 'listing-expired';

export type CensusReason =
  | 'delisted' | 'listing-lapsed'
  | 'never-checked' | 'check-too-old'
  | 'bad-address' | 'unreachable' | 'no-answer' | 'bad-answer'
  | 'old-version-or-bad-signature' | 'signer-not-allowed' | 'signer-check-failed' | 'details-mismatch' | 'details-expired' | 'certificate-mismatch'
  | 'full' | 'unsupported-transport';

/** One plain sentence per reason. Glossary: "server", never "node". */
export const CENSUS_SENTENCE = (): Record<CensusReason, string> => ({
  delisted: tr('This server has left the network.'),
  'listing-lapsed': tr('This server has not checked in with the network recently.'),
  'never-checked': tr('Not checked yet.'),
  'check-too-old': tr('Last check is more than 10 minutes old.'),
  'bad-address': tr('The address this server published is not usable.'),
  unreachable: tr('The server could not be reached.'),
  'no-answer': tr('The server was reached but did not answer in time.'),
  'bad-answer': tr('The server answered with an error.'),
  'old-version-or-bad-signature': tr('The server\'s details are not signed correctly. It may be running an old version.'),
  'signer-not-allowed': tr('The server\'s details are signed by someone its owner has not allowed.'),
  'signer-check-failed': tr('Could not confirm who signed the server\'s details. It will be checked again.'),
  'details-mismatch': tr('The server\'s details do not match its listing on the network.'),
  'details-expired': tr('The server\'s details are out of date.'),
  'certificate-mismatch': tr('The server\'s security certificate does not match its signed details.'),
  full: tr('This server is full right now.'),
  'unsupported-transport': tr('This server uses a connection type this app does not support.'),
});

export interface CensusEntry {
  address: string;
  state: CensusState;
  reason: CensusReason | null; // null only for 'usable'
  sentence: string | null;
  /** ms epoch of the check this entry rests on; null when no fresh check. */
  checkedAt: number | null;
  /**
   * Only on 'not-checked' with an expired check: what that check said, so a screen can keep the
   * row visible, greyed, as "last checked 14:02, checking again". Never counted as online.
   */
  previous: { state: CensusState; reason: CensusReason | null; checkedAt: number; latencyMs: number | null } | null;
}

export interface Census {
  at: number;
  /** Every server account found, in any state. */
  known: number;
  /** Listed, listing current. The denominator everywhere. */
  onNetwork: number;
  listingExpired: number;
  /** On the network with a check younger than CHECK_TTL_MS. */
  checked: number;
  notChecked: number;
  answering: number;
  notAnswering: number;
  /** Answering and details check out (includes full / unsupported). */
  verified: number;
  unverified: number;
  /** Verified and connectable now: the "online" number. */
  usable: number;
  /** Newest check among the fresh ones; null when none. */
  lastCheckedAt: number | null;
  /** Servers shown from an expired check while the re-check runs (entries with `previous`). */
  recheckDue: number;
  /** Newest expired check; null when none. For "Last checked at 14:02, checking again". */
  previousCheckedAt: number | null;
  byReason: Partial<Record<CensusReason, number>>;
  entries: CensusEntry[];
}

/** True while the listing has not lapsed at `now` (ms). Never trusts a stored flag. */
export function listingCurrent(n: Pick<CensusInput, 'listed' | 'expiresAt'>, now: number): boolean {
  return n.listed && n.expiresAt > 0 && n.expiresAt * 1000 > now;
}

/** A check result is believed only inside the TTL; one from the future (clock change) is not. */
export function checkFresh(probe: ProbeResult | null, now: number, ttlMs = CHECK_TTL_MS): boolean {
  if (!probe || !Number.isFinite(probe.probedAt)) return false;
  const age = now - probe.probedAt;
  return age >= 0 && age <= ttlMs;
}

/** Why a check that never got a signed answer failed. Reads the fixed texts of discovery.ts probeNode. */
function silentReason(error: string | null): CensusReason {
  const e = (error ?? '').toLowerCase();
  if (e.includes('not a valid url')) return 'bad-address';
  if (e.includes('not reachable')) return 'unreachable';
  if (e.includes('answered http')) return 'bad-answer';
  return 'no-answer';
}

/** Why an answering server is not verified, or null when it is. Order = the tester's (signature, signer, claims, expiry, pin). */
export function verifyProblem(p: ProbeResult): CensusReason | null {
  if (p.signatureValid !== true) return 'old-version-or-bad-signature';
  if (p.signerAuthorized === null) return 'signer-check-failed';
  if (p.signerAuthorized !== true) return 'signer-not-allowed';
  if (p.claimsMatch !== true) return 'details-mismatch';
  if (p.metadataExpired === true) return 'details-expired';
  if (p.tlsPinMatch === false) return 'certificate-mismatch';
  return null;
}

export function classify(n: CensusInput, now: number, ttlMs = CHECK_TTL_MS): CensusEntry {
  const entry = (state: CensusState, reason: CensusReason | null, checkedAt: number | null): CensusEntry =>
    ({ address: n.address, state, reason, sentence: reason ? CENSUS_SENTENCE()[reason] : null, checkedAt, previous: null });
  if (!listingCurrent(n, now)) return entry('listing-expired', n.listed ? 'listing-lapsed' : 'delisted', null);
  const p = n.probe;
  if (!p || !checkFresh(p, now, ttlMs)) {
    const e = entry('not-checked', p ? 'check-too-old' : 'never-checked', null);
    if (p && Number.isFinite(p.probedAt) && p.probedAt <= now) {
      // What the expired check said, judged as if it were fresh at its own time.
      const then = classify({ ...n, expiresAt: Number.MAX_SAFE_INTEGER / 1000, listed: true }, p.probedAt, ttlMs);
      e.previous = { state: then.state, reason: then.reason, checkedAt: p.probedAt, latencyMs: p.latencyMs };
    }
    return e;
  }
  if (!p.reachable) return entry('not-answering', silentReason(p.error), p.probedAt);
  const problem = verifyProblem(p);
  if (problem) return entry('unverified', problem, p.probedAt);
  if (p.ok) return entry('usable', null, p.probedAt);
  const full = p.maxPeers !== null && p.peers !== null && p.maxPeers > 0 && p.peers >= p.maxPeers;
  return entry('verified-busy', full ? 'full' : 'unsupported-transport', p.probedAt);
}

export function census(nodes: readonly CensusInput[], now: number, ttlMs = CHECK_TTL_MS): Census {
  const entries = nodes.map((n) => classify(n, now, ttlMs));
  const count = (...s: CensusState[]): number => entries.filter((e) => s.includes(e.state)).length;
  const byReason: Partial<Record<CensusReason, number>> = {};
  let lastCheckedAt: number | null = null;
  let recheckDue = 0;
  let previousCheckedAt: number | null = null;
  for (const e of entries) {
    if (e.previous) {
      recheckDue += 1;
      if (previousCheckedAt === null || e.previous.checkedAt > previousCheckedAt) previousCheckedAt = e.previous.checkedAt;
    }
    if (e.reason) byReason[e.reason] = (byReason[e.reason] ?? 0) + 1;
    if (e.checkedAt !== null && (lastCheckedAt === null || e.checkedAt > lastCheckedAt)) lastCheckedAt = e.checkedAt;
  }
  const listingExpired = count('listing-expired');
  const notChecked = count('not-checked');
  const notAnswering = count('not-answering');
  const unverified = count('unverified');
  const usable = count('usable');
  const verified = usable + count('verified-busy');
  const onNetwork = entries.length - listingExpired;
  return {
    at: now,
    known: entries.length,
    onNetwork,
    listingExpired,
    checked: onNetwork - notChecked,
    notChecked,
    answering: verified + unverified,
    notAnswering,
    verified,
    unverified,
    usable,
    lastCheckedAt,
    recheckDue,
    previousCheckedAt,
    byReason,
    entries,
  };
}

/** "Checked 78 of 79 at 12:04", or "Not checked yet (79 on the network)" when no fresh check exists. `clock` formats ms → "12:04". */
export function censusLine(c: Census, clock: (ms: number) => string): string {
  if (c.lastCheckedAt === null) {
    if (!c.onNetwork) return tr('No servers on the network');
    return c.previousCheckedAt !== null ? tr('Last checked at {clock}, checking again', { clock: clock(c.previousCheckedAt) }) : tr('Not checked yet ({onNetwork} on the network)', { onNetwork: c.onNetwork });
  }
  return tr('Checked {checked} of {onNetwork} at {clock}', { checked: c.checked, onNetwork: c.onNetwork, clock: clock(c.lastCheckedAt) });
}

/** Servers the check should (re)visit: on the network and without a fresh result. */
export function dueForCheck<T extends CensusInput>(nodes: readonly T[], now: number, ttlMs = CHECK_TTL_MS): T[] {
  return nodes.filter((n) => listingCurrent(n, now) && !checkFresh(n.probe, now, ttlMs));
}
