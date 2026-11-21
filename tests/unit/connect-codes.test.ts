// The fixed list of connect failure codes (core/session/state.ts CONNECT_CODES): every code the connect path
// can answer with is in it, so a caller that maps codes (the server test, the CLI) can test itself against it.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONNECT_CODES, PREFLIGHT_CODES, connectErrorCopy, preflightCode } from '../../src/core/session/state';

const read = (p: string): string => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

/** Codes written in the source: `code: 'x'`, fail(…, 'x'…), no(…, 'x'…), and the NODE_ERRORS keys. */
function codesIn(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(/\bcode: '([a-z][a-z0-9_ -]*)'/g)) out.add(m[1]);
  for (const m of src.matchAll(/\b(?:fail|no)\((?:[^()]|\([^()]*\))*?, '([a-z][a-z0-9-]*)'/g)) out.add(m[1]);
  return [...out];
}

describe('a protocol program the VPN service cannot start (Windows VM 2026-11-15, build c975868)', () => {
  it('is this computer\'s fault, says the deposit is kept, and sends the user to Diagnostics', () => {
    const c = connectErrorCopy('StartSession: failed precondition: starting service: starting v2ray: process not started: binary not found: v2ray');
    expect(c.code).toBe('protocol-missing');
    expect(c.message).toMatch(/\(v2ray\)/);
    expect(c.message).toMatch(/deposit with this server is kept and is used the next time you connect/);
    expect(c.message).not.toMatch(/server may be down/);
    expect(c.action).toBe('Open diagnostics');
  });

  it('negative control: a tunnel that did not come up for another reason still blames the tunnel', () => {
    expect(connectErrorCopy('starting service: handshake did not complete').code).toBe('tunnel-failed');
  });
});

describe('CONNECT_CODES', () => {
  it('has no duplicates', () => {
    expect(new Set(CONNECT_CODES).size).toBe(CONNECT_CODES.length);
  });

  it('holds every code written in the connect path (positive control: the scan finds the well-known ones)', () => {
    const conn = codesIn(read('src/main/services/connection.ts'));
    const copy = codesIn(read('src/core/session/state.ts'));
    // ('no-wallet' / 'keyfile-missing' come from vault.ts noWallet() since rc.4 E-18: tests/unit/keyfile-missing.test.ts)
    for (const known of ['daemon-missing', 'daemon-unavailable', 'kill-switch-held', 'plan-limit', 'cancelled']) expect(conn).toContain(known);
    for (const known of ['rpc-busy', 'tunnel-failed', 'node-ledger', 'unknown']) expect(copy).toContain(known);
    // codes of other tables that live in the same files and are not connect results
    const notConnect = new Set(['service-down', 'service-not-ready', 'not-found']);
    const missing = [...conn, ...copy].filter((c) => !CONNECT_CODES.includes(c) && !notConnect.has(c));
    expect(missing).toEqual([]);
  });

  it('holds every node refusal key and whatever connectErrorCopy answers for sample errors', () => {
    const keys = [...read('src/core/session/state.ts').matchAll(/^\s+\['([a-z_ ]+)', \{ message:/gm)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(10);
    for (const k of keys) expect(CONNECT_CODES).toContain(k);
    for (const raw of ['', 'boom', 'peer_limit_reached', 'stop requested while connecting', '429 Too Many Requests', 'deadline exceeded', '14 UNAVAILABLE: No connection established', 'token-2022 error: InsufficientFunds']) {
      expect(CONNECT_CODES).toContain(connectErrorCopy(raw).code);
    }
  });

  it('a code that is not in the list is caught (negative control for the scan)', () => {
    expect(codesIn("return fail('x', 'made-up-code', null);")).toEqual(['made-up-code']);
    expect(codesIn("return { ok: false, code: 'another-new-one' };")).toEqual(['another-new-one']);
    expect(CONNECT_CODES).not.toContain('made-up-code');
  });
});

describe('preflightCode: the blocker found before paying, as a fixed code', () => {
  it('reads the sentences connect-checks preflight returns', () => {
    expect(preflightCode('Disconnect the current session first.')).toBe('session-active');
    expect(preflightCode('That server is not on the network any more.')).toBe('node-gone');
    expect(preflightCode('That server has not checked in recently. Pick another.')).toBe('node-stale');
    expect(preflightCode('Node is not reachable. Nothing was paid.')).toBe('node-offline');
    expect(preflightCode('Server check failed. Nothing was paid.')).toBe('node-offline');
    expect(preflightCode('This server does not sell per hour.')).toBe('basis-unavailable');
    expect(preflightCode('The OpenVPN network adapter is missing and could not be added back (x). Repair drivers, then connect again. Nothing was paid.')).toBe('driver-missing');
    expect(preflightCode('something nobody wrote a rule for')).toBe('preflight');
  });

  it('every answer is one of PREFLIGHT_CODES, and those are all connect codes', () => {
    for (const c of PREFLIGHT_CODES) expect(CONNECT_CODES).toContain(c);
    expect(PREFLIGHT_CODES).toContain(preflightCode('x'));
  });

  it('the funding blockers map to their own codes (the real sentences from core fundingBlocker)', async () => {
    const { fundingBlocker } = await import('../../src/core/pricing/cost');
    const base = { escrow: '1000', walletTdvpn: '5000', userBalance: '0', delegated: '5000', allowance: '5000', deviceLamports: 50_000_000 };
    expect(fundingBlocker(base)).toBeNull();
    expect(preflightCode(fundingBlocker({ ...base, walletTdvpn: '10' })!)).toBe('not-enough-tdvpn');
    expect(preflightCode(fundingBlocker({ ...base, delegated: '10' })!)).toBe('spending-limit');
    expect(preflightCode(fundingBlocker({ ...base, allowance: '10' })!)).toBe('spending-limit');
    expect(preflightCode(fundingBlocker({ ...base, deviceLamports: 1 })!)).toBe('device-sol');
  });
});
