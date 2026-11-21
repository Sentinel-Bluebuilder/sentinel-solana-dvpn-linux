// ─── Sweep 1 (hub docs/AGENT-EDGE-MATRIX.md): every code connect() can answer gets a command, never an app screen ───
// review' first pass: 34 of 48 codes answered only "agent status" (reports, fixes nothing) and 14 messages named a
// screen or button. This fails when a new code reaches CONNECT_CODES without a CLI next step, or a next names a screen.
import { describe, it, expect, vi } from 'vitest';
import { CONNECT_CODES } from '../../src/core/session/state';

vi.mock('../../src/main/app-state', () => ({ snapshot: () => ({}), patch: () => undefined }));
const { nextFor, SWEEP1_NEXT, SWEEP1_GENERIC } = await import('../../src/cli/agent-cmd');

const GENERIC = 'devnet-dvpn agent status';
// App words an agent cannot act on: a screen, a button, a status title.
const SCREEN = /\b(Settings|Wallet|Diagnostics|Protected|Open [A-Z]\w*|[Pp]ress|Set up device|Top up device|Restore network)\b/;
const codes = [...CONNECT_CODES, 'connect-failed'];

describe('agent up: no dead end', () => {
  it('positive control: the code list is the real one', () => {
    expect(CONNECT_CODES.length).toBeGreaterThan(60);
    expect(codes).toEqual(expect.arrayContaining(['kill-switch-held', 'node-identity', 'rpc-quota', 'credit_exhausted']));
  });
  for (const platform of ['linux', 'win32', 'darwin']) {
    it(`${platform}: every code names a command (only ${SWEEP1_GENERIC.join(', ')} may answer agent status)`, () => {
      const dead = codes.filter((c) => !SWEEP1_GENERIC.includes(c) && nextFor(c, platform) === GENERIC);
      expect(dead).toEqual([]);
    });
    it(`${platform}: no next step names an app screen or button`, () => {
      const screens = codes.map((c) => [c, nextFor(c, platform)]).filter(([, n]) => SCREEN.test(n));
      expect(screens).toEqual([]);
    });
  }
  it('every mapped code is a real code (no typo keeps a dead end alive)', () => {
    expect(codes).toContain('keyfile-missing'); // E-18 engine half (a64b3a1e)
    expect(Object.keys(SWEEP1_NEXT).filter((c) => !codes.includes(c))).toEqual([]);
  });
  it('negative control: the check sees a screen word and a dead end', () => {
    expect(SCREEN.test('Raise it in Wallet → Device.')).toBe(true);
    expect(nextFor('unknown')).toBe(GENERIC);
  });
  it('E-6: a preflight refusal follows its button', () => {
    expect(nextFor('preflight', 'linux', { action: 'Open diagnostics', error: 'x' })).toBe('devnet-dvpn daemon doctor, then devnet-dvpn agent up --yes');
    expect(nextFor('preflight', 'linux', { action: 'Open settings', error: 'x' })).toBe('devnet-dvpn daemon settings, then devnet-dvpn agent up --yes');
    expect(nextFor('preflight', 'linux', { action: 'Open diagnostics', error: 'Repair drivers in Diagnostics.' })).toBe('devnet-dvpn daemon repair-drivers --yes, then devnet-dvpn agent up --yes');
    expect(nextFor('preflight', 'linux', { action: 'Pick another server', error: 'x' })).toMatch(/^devnet-dvpn nodes list --online --json, then devnet-dvpn agent up --node <another node> --yes$/);
  });
});
