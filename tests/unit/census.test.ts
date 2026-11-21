import { describe, it, expect } from 'vitest';
import {
  census, censusLine, classify, checkFresh, dueForCheck, listingCurrent, verifyProblem,
  CENSUS_SENTENCE, CHECK_TTL_MS, type CensusInput,
} from '../../src/core/nodes/census';
import type { ProbeResult } from '../../src/core/nodes/discovery';

// Rows 143–147: one count for every screen; a check result expires after 10 minutes.
const NOW = Date.UTC(2026, 10, 15, 12, 4, 0);
const SEC = Math.floor(NOW / 1000);

function probe(over: Partial<ProbeResult> = {}): ProbeResult {
  return {
    ok: true, reachable: true, latencyMs: 80, signatureValid: true, claimsMatch: true, signerIsOwner: true, signerAuthorized: true,
    metadataExpired: false, tlsPinMatch: true, peers: 1, maxPeers: 50, downloadMbps: 100, uploadMbps: 100,
    city: 'Frankfurt', serviceType: 'wireguard', version: '1', error: null, probedAt: NOW - 60_000, ...over,
  };
}
const failed = (over: Partial<ProbeResult>): ProbeResult => probe({ ok: false, ...over });
const silent = (error: string): ProbeResult => failed({
  reachable: false, latencyMs: null, signatureValid: null, claimsMatch: null, signerIsOwner: null, signerAuthorized: null,
  metadataExpired: null, tlsPinMatch: null, peers: null, maxPeers: null, error,
});
function server(address: string, p: ProbeResult | null, over: Partial<CensusInput> = {}): CensusInput {
  return { address, listed: true, expiresAt: SEC + 3600, probe: p, ...over };
}

describe('census: listing and check freshness', () => {
  it('judges the listing against now, not against a stored flag', () => {
    expect(listingCurrent({ listed: true, expiresAt: SEC + 1 }, NOW)).toBe(true);
    expect(listingCurrent({ listed: true, expiresAt: SEC }, NOW)).toBe(false);
    expect(listingCurrent({ listed: true, expiresAt: 0 }, NOW)).toBe(false);
    expect(listingCurrent({ listed: false, expiresAt: SEC + 3600 }, NOW)).toBe(false);
  });

  it('believes a check for exactly 10 minutes and never one from the future', () => {
    expect(CHECK_TTL_MS).toBe(600_000);
    expect(checkFresh(probe({ probedAt: NOW - CHECK_TTL_MS }), NOW)).toBe(true);
    expect(checkFresh(probe({ probedAt: NOW - CHECK_TTL_MS - 1 }), NOW)).toBe(false);
    expect(checkFresh(probe({ probedAt: NOW + 1 }), NOW)).toBe(false);
    expect(checkFresh(probe({ probedAt: Number.NaN }), NOW)).toBe(false);
    expect(checkFresh(null, NOW)).toBe(false);
  });

  it('a server that answered yesterday reads "not checked", never online (row 146)', () => {
    const e = classify(server('A', probe({ probedAt: NOW - 86_400_000 })), NOW);
    expect(e).toMatchObject({ state: 'not-checked', reason: 'check-too-old', checkedAt: null });
    expect(classify(server('B', null), NOW)).toMatchObject({ state: 'not-checked', reason: 'never-checked', previous: null });
  });

  it('keeps what the expired check said, for a greyed "checking again" row, without counting it', () => {
    const at = NOW - CHECK_TTL_MS - 5000;
    const good = classify(server('A', probe({ probedAt: at, latencyMs: 42 })), NOW);
    expect(good.previous).toEqual({ state: 'usable', reason: null, checkedAt: at, latencyMs: 42 });
    const bad = classify(server('B', silent('Node is not reachable'), {}), NOW + CHECK_TTL_MS);
    expect(bad.previous).toMatchObject({ state: 'not-answering', reason: 'unreachable' });
    expect(classify(server('C', probe({ probedAt: NOW + 1 })), NOW).previous).toBeNull(); // a check from the future is not shown
    expect(classify(server('D', probe()), NOW).previous).toBeNull(); // fresh: nothing previous
    const c = census([server('A', probe({ probedAt: at })), server('E', probe({ probedAt: at - 9000 }))], NOW);
    expect(c).toMatchObject({ usable: 0, answering: 0, recheckDue: 2, previousCheckedAt: at });
    expect(censusLine(c, (ms) => new Date(ms).toISOString().slice(11, 16))).toBe('Last checked at 11:53, checking again');
  });

  it('a lapsed listing wins over a fresh good check', () => {
    expect(classify(server('A', probe(), { expiresAt: SEC - 1 }), NOW)).toMatchObject({ state: 'listing-expired', reason: 'listing-lapsed' });
    expect(classify(server('B', probe(), { listed: false }), NOW)).toMatchObject({ state: 'listing-expired', reason: 'delisted' });
  });
});

describe('census: one state and one reason per server', () => {
  const cases: Array<[string, ProbeResult, string, string | null]> = [
    ['usable', probe(), 'usable', null],
    ['bad address', silent('Node address on chain is not a valid URL'), 'not-answering', 'bad-address'],
    ['tcp closed', silent('Node is not reachable'), 'not-answering', 'unreachable'],
    ['timeout', silent('Node did not answer: request to 1.2.3.4:443 timed out after 6000ms'), 'not-answering', 'no-answer'],
    ['http 502', silent('Node answered HTTP 502'), 'not-answering', 'bad-answer'],
    ['bad signature', failed({ signatureValid: false, signerAuthorized: null }), 'unverified', 'old-version-or-bad-signature'],
    ['signer not allowed', failed({ signerAuthorized: false }), 'unverified', 'signer-not-allowed'],
    ['signer check failed', failed({ signerAuthorized: null }), 'unverified', 'signer-check-failed'],
    ['claims mismatch', failed({ claimsMatch: false }), 'unverified', 'details-mismatch'],
    ['details expired', failed({ metadataExpired: true }), 'unverified', 'details-expired'],
    ['pin mismatch', failed({ tlsPinMatch: false }), 'unverified', 'certificate-mismatch'],
    ['full', failed({ peers: 50, maxPeers: 50, error: 'Node is full' }), 'verified-busy', 'full'],
    ['reality', failed({ error: 'Transport not supported (REALITY)' }), 'verified-busy', 'unsupported-transport'],
  ];
  for (const [name, p, state, reason] of cases) {
    it(name, () => {
      const e = classify(server('X', p), NOW);
      expect(e.state).toBe(state);
      expect(e.reason).toBe(reason);
      expect(e.sentence).toBe(reason ? CENSUS_SENTENCE()[reason as keyof ReturnType<typeof CENSUS_SENTENCE>] : null);
      expect(e.checkedAt).toBe(p.probedAt);
    });
  }

  it('a missing pin is not a mismatch; signature is judged before the signer', () => {
    expect(verifyProblem(probe({ tlsPinMatch: null }))).toBeNull();
    expect(verifyProblem(failed({ signatureValid: false, signerAuthorized: false, claimsMatch: false }))).toBe('old-version-or-bad-signature');
  });

  it('no sentence says "node", "daemon" or "metadata" (glossary)', () => {
    for (const s of Object.values(CENSUS_SENTENCE())) expect(s).not.toMatch(/\bnodes?\b|daemon|metadata|rpc/i);
    expect('This node is full').toMatch(/\bnodes?\b/i); // positive control
  });
});

describe('census: the numbers', () => {
  const list: CensusInput[] = [
    server('ok1', probe({ probedAt: NOW - 1000 })),
    server('ok2', probe({ probedAt: NOW - 5000 })),
    server('full', failed({ peers: 9, maxPeers: 9, error: 'Node is full' })),
    server('badsig', failed({ signatureValid: false, signerAuthorized: null })),
    server('down', silent('Node is not reachable')),
    server('stale', probe({ probedAt: NOW - CHECK_TTL_MS - 1 })),
    server('new', null),
    server('lapsed', probe(), { expiresAt: SEC - 10 }),
    server('gone', null, { listed: false, expiresAt: 0 }),
  ];
  const c = census(list, NOW);

  it('counts each server once and the parts add up', () => {
    expect(c).toMatchObject({
      known: 9, onNetwork: 7, listingExpired: 2, checked: 5, notChecked: 2,
      answering: 4, notAnswering: 1, verified: 3, unverified: 1, usable: 2,
    });
    expect(c.answering + c.notAnswering + c.notChecked).toBe(c.onNetwork);
    expect(c.onNetwork + c.listingExpired).toBe(c.known);
    expect(c.entries.map((e) => e.address)).toEqual(list.map((n) => n.address));
    expect(c.byReason).toEqual({
      full: 1, 'old-version-or-bad-signature': 1, unreachable: 1, 'check-too-old': 1, 'never-checked': 1, 'listing-lapsed': 1, delisted: 1,
    });
  });

  it('the same list ten minutes later has nobody online', () => {
    const later = census(list, NOW + CHECK_TTL_MS);
    expect(later).toMatchObject({ usable: 0, answering: 0, checked: 0, notChecked: 7, lastCheckedAt: null });
  });

  it('prints the checked line from the newest fresh check', () => {
    const clock = (ms: number): string => new Date(ms).toISOString().slice(11, 16);
    expect(c.lastCheckedAt).toBe(NOW - 1000);
    expect(censusLine(c, clock)).toBe('Checked 5 of 7 at 12:03');
    expect(censusLine(census(list, NOW + CHECK_TTL_MS), clock)).toBe('Last checked at 12:03, checking again');
    expect(censusLine(census([server('n', null)], NOW), clock)).toBe('Not checked yet (1 on the network)');
    expect(censusLine(census([], NOW), clock)).toBe('No servers on the network');
  });

  it('lists what the next check must visit', () => {
    expect(dueForCheck(list, NOW).map((n) => n.address)).toEqual(['stale', 'new']);
  });
});
