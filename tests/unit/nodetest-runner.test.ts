import { describe, it, expect } from 'vitest';
import { runJob, uriIp, type ConnectOutcome, type JobDeps, type ServerRecord, type SpeedOutcome } from '../../src/core/nodetest/runner';
import { resultSentence, type DepositState } from '../../src/core/nodetest/stages';
import type { TestJob } from '../../src/core/nodetest/plan';
import type { ProbeResult } from '../../src/core/nodes/discovery';
import type { SpeedFigure } from '../../src/core/nodetest/steady';

// Rows 150–152: one server through the nine stages; stop at the first failure; always
// disconnect what was connected and close a deposit the test opened.
const NOW = Date.UTC(2026, 10, 15, 12, 0, 0);
const job: TestJob = { id: 'S1:wireguard', server: 'S1', protocol: 'wireguard', country: 'Germany', basis: 'per_hour', deposit: '200000' };
const rec: ServerRecord = { address: 'S1', owner: 'O1', uri: 'https://203.0.113.7:8443', listed: true, expiresAt: NOW / 1000 + 3600, country: 'Germany', protocolNames: ['wireguard', 'v2ray'] };
const goodProbe = (over: Partial<ProbeResult> = {}): ProbeResult => ({
  ok: true, reachable: true, latencyMs: 50, signatureValid: true, claimsMatch: true, signerIsOwner: true, signerAuthorized: true,
  metadataExpired: false, tlsPinMatch: true, peers: 1, maxPeers: 10, downloadMbps: 1, uploadMbps: 1, city: null, serviceType: 'wireguard',
  version: '1', error: null, probedAt: NOW, ...over,
});
const figure: SpeedFigure = { method: 'steady-v1', mbps: 80, basis: 'steady', p90Mbps: 90, rampSeconds: 1, falling: false, bytes: 1e8, ms: 10_000, streams: 4 };

interface Fake { deps: JobDeps; calls: string[] }
function fake(over: {
  rec?: ServerRecord | null; probe?: ProbeResult; connect?: ConnectOutcome; exit?: string | null; dns?: boolean; speed?: SpeedOutcome;
  close?: DepositState | Error; stopAt?: string; findThrows?: boolean; reportDeposit?: string | null; speedThrows?: boolean; connectThrows?: boolean;
} = {}): Fake {
  const calls: string[] = [];
  let clock = NOW;
  const deps: JobDeps = {
    now: () => (clock += 100),
    stopAsked: () => (over.stopAt ? calls.includes(over.stopAt) : false),
    find: async () => { calls.push('find'); if (over.findThrows) throw new Error('429'); return over.rec === undefined ? rec : over.rec; },
    check: async () => { calls.push('check'); return over.probe ?? goodProbe(); },
    connect: async (_j, _r, onDeposit) => {
      calls.push('connect');
      const dep = over.reportDeposit === undefined ? 'Dep1' : over.reportDeposit;
      if (dep) onDeposit(dep);
      if (over.connectThrows) throw new Error('engine crashed after paying');
      return over.connect ?? { ok: true, session: { proxy: null, service: 'wireguard' }, deposit: dep, reused: false };
    },
    exitAddress: async () => { calls.push('exit'); return over.exit === undefined ? '203.0.113.7' : over.exit; },
    dns: async () => { calls.push('dns'); return over.dns ?? true; },
    speed: async () => { calls.push('speed'); if (over.speedThrows) throw new Error('boom'); return over.speed ?? { ok: true, figure }; },
    disconnect: async () => { calls.push('disconnect'); return true; },
    closeDeposit: async (d) => { calls.push(`close:${d}`); if (over.close instanceof Error) throw over.close; return over.close ?? 'closed'; },
    onDeposit: (_j, d) => calls.push(`recorded:${d}`),
    onDepositClosed: (_j, d, s) => calls.push(`closed:${d}:${s}`),
  };
  return { deps, calls };
}
const stageNames = (r: { stages: Array<{ stage: string; ok: boolean }> }): string => r.stages.map((s) => `${s.stage}${s.ok ? '' : '!'}`).join(' ');

describe('audit U-1: a connect that throws after paying', () => {
  it('still disconnects and closes the deposit it reported', async () => {
    const f = fake({ connectThrows: true });
    const r = await runJob(job, f.deps, 100);
    expect(r.code).toBe('TEST_ERROR');
    expect(f.calls).toContain('disconnect');
    expect(f.calls).toContain('close:Dep1');
    expect(r.depositState).toBe('closed');
  });
});

describe('runJob: the nine stages', () => {
  it('a good server passes every stage, in order, and its deposit is closed', async () => {
    const f = fake();
    const r = await runJob(job, f.deps, 100);
    expect(stageNames(r)).toBe('found reachable verified paid connected exit-address dns speed closed');
    expect(r).toMatchObject({ code: 'OK', verdict: 'working', mbps: 80, speedBasis: 'steady', exitIp: '203.0.113.7', deposit: 'Dep1', depositState: 'closed', closeCode: null });
    expect(r.connectMs).toBeGreaterThan(0);
    expect(f.calls).toEqual(['find', 'check', 'connect', 'recorded:Dep1', 'exit', 'dns', 'speed', 'disconnect', 'close:Dep1', 'closed:Dep1:closed']);
  });

  it('the deposit is recorded before the connection finishes (row 152)', async () => {
    const f = fake();
    await runJob(job, f.deps, null);
    expect(f.calls.indexOf('recorded:Dep1')).toBeLessThan(f.calls.indexOf('exit'));
  });

  const before: Array<[string, Parameters<typeof fake>[0], string, string]> = [
    ['not on chain', { rec: null }, 'NOT_FOUND', 'found!'],
    ['lookup failed (our side)', { findThrows: true }, 'LOOKUP_FAILED', 'found!'],
    ['left the network', { rec: { ...rec, listed: false } }, 'DELISTED', 'found!'],
    ['listing lapsed', { rec: { ...rec, expiresAt: NOW / 1000 - 5 } }, 'LISTING_EXPIRED', 'found!'],
    ['unreachable', { probe: goodProbe({ ok: false, reachable: false, error: 'Node is not reachable' }) }, 'UNREACHABLE', 'found reachable!'],
    ['timeout', { probe: goodProbe({ ok: false, reachable: false, error: 'Node did not answer: timed out' }) }, 'NO_ANSWER', 'found reachable!'],
    ['bad signature', { probe: goodProbe({ ok: false, signatureValid: false, signerAuthorized: null }) }, 'BAD_SIGNATURE', 'found reachable verified!'],
    ['details expired', { probe: goodProbe({ ok: false, metadataExpired: true }) }, 'DETAILS_EXPIRED', 'found reachable verified!'],
    ['pin mismatch', { probe: goodProbe({ ok: false, tlsPinMatch: false }) }, 'CERTIFICATE_MISMATCH', 'found reachable verified!'],
    ['full', { probe: goodProbe({ ok: false, peers: 10, maxPeers: 10 }) }, 'SERVER_FULL', 'found reachable verified!'],
    ['protocol not offered', { rec: { ...rec, protocolNames: ['v2ray'] } }, 'PROTOCOL_UNSUPPORTED', 'found reachable verified!'],
  ];
  for (const [name, over, code, walked] of before) {
    it(`${name}: stops before paying, costs nothing`, async () => {
      const f = fake(over);
      const r = await runJob(job, f.deps, 100);
      expect(r.code).toBe(code);
      expect(stageNames(r)).toBe(walked);
      expect(r).toMatchObject({ deposit: null, depositState: 'none', mbps: null });
      expect(f.calls).not.toContain('connect');
      expect(f.calls).not.toContain('disconnect');
      expect(resultSentence(r)).toMatch(/Nothing was paid\.$/);
    });
  }

  it('no price: nothing can be paid', async () => {
    const f = fake();
    const r = await runJob({ ...job, basis: null, deposit: '0' }, f.deps, 100);
    expect(r).toMatchObject({ code: 'NO_PRICE', verdict: 'failed' });
    expect(f.calls).not.toContain('connect');
  });

  it('payment refused before any deposit: fails at "paid", not held against the server', async () => {
    const f = fake({ reportDeposit: null, connect: { ok: false, code: 'NOT_ENOUGH_FUNDS', deposit: null } });
    const r = await runJob(job, f.deps, 100);
    expect(stageNames(r)).toBe('found reachable verified paid!');
    expect(r).toMatchObject({ code: 'NOT_ENOUGH_FUNDS', verdict: 'not-tested', depositState: 'none' });
    expect(f.calls.some((c) => c.startsWith('close:'))).toBe(false);
  });

  it('connect fails after the deposit was paid: fails at "connected" and the deposit is closed', async () => {
    const f = fake({ connect: { ok: false, code: 'CONNECT_TIMEOUT', deposit: 'Dep1' } });
    const r = await runJob(job, f.deps, 100);
    expect(stageNames(r)).toBe('found reachable verified paid connected! closed');
    expect(r).toMatchObject({ code: 'CONNECT_TIMEOUT', verdict: 'failed', deposit: 'Dep1', depositState: 'closed' });
    expect(f.calls).toContain('disconnect');
    expect(f.calls).toContain('close:Dep1');
    expect(resultSentence(r)).toBe('The server did not finish connecting in time. The deposit was closed and the unused part is back in your wallet.');
  });

  const after: Array<[string, Parameters<typeof fake>[0], string, string]> = [
    ['no exit address', { exit: null }, 'EXIT_UNKNOWN', 'exit-address!'],
    ['traffic leaves elsewhere', { exit: '198.51.100.1' }, 'EXIT_NOT_SERVER', 'exit-address!'],
    ['names do not resolve', { dns: false }, 'DNS_FAILED', 'exit-address dns!'],
    ['no data', { speed: { ok: false, code: 'NO_DATA' } }, 'NO_DATA', 'exit-address dns speed!'],
    ['altered data', { speed: { ok: false, code: 'SPEED_TAMPERED' } }, 'SPEED_TAMPERED', 'exit-address dns speed!'],
    ['speed source down (our side)', { speed: { ok: false, code: 'SPEED_SOURCE_DOWN' } }, 'SPEED_SOURCE_DOWN', 'exit-address dns speed!'],
    ['the test code throws', { speedThrows: true }, 'TEST_ERROR', 'exit-address dns speed!'],
  ];
  for (const [name, over, code, tail] of after) {
    it(`${name}: disconnects and closes the deposit`, async () => {
      const f = fake(over);
      const r = await runJob(job, f.deps, 100);
      expect(r.code).toBe(code);
      expect(stageNames(r)).toBe(`found reachable verified paid connected ${tail} closed`);
      expect(f.calls.slice(-3)).toEqual(['disconnect', 'close:Dep1', 'closed:Dep1:closed']);
      expect(r.depositState).toBe('closed');
    });
  }

  it('our own faults read "not tested", a server fault reads "failed"', async () => {
    expect((await runJob(job, fake({ speed: { ok: false, code: 'SPEED_SOURCE_DOWN' } }).deps, 100)).verdict).toBe('not-tested');
    expect((await runJob(job, fake({ speedThrows: true }).deps, 100)).verdict).toBe('not-tested');
    expect((await runJob(job, fake({ dns: false }).deps, 100)).verdict).toBe('failed');
  });

  it('a per-GB deposit starts its refund at once', async () => {
    const f = fake({ close: 'refund-started' });
    const r = await runJob({ ...job, basis: 'per_gb' }, f.deps, 100);
    expect(r).toMatchObject({ code: 'OK', depositState: 'refund-started', closeCode: null });
    expect(stageNames(r).endsWith('closed')).toBe(true);
  });

  it('a close that fails keeps the server\'s own verdict and flags the deposit', async () => {
    for (const close of ['open' as const, new Error('rate limited')]) {
      const r = await runJob(job, fake({ close }).deps, 100);
      expect(r).toMatchObject({ code: 'OK', verdict: 'working', depositState: 'open', closeCode: 'CLOSE_FAILED' });
      expect(stageNames(r).endsWith('closed!')).toBe(true);
    }
  });

  it('a deposit the user already had with that server is left alone', async () => {
    const f = fake({ connect: { ok: true, session: { proxy: null, service: 'wireguard' }, deposit: 'Mine', reused: true } });
    const r = await runJob(job, f.deps, 100);
    expect(r).toMatchObject({ code: 'OK', deposit: null, depositState: 'none' });
    expect(f.calls).toContain('disconnect');
    expect(f.calls.some((c) => c.startsWith('close:'))).toBe(false);
  });

  it('Stop before paying costs nothing; Stop mid-session still disconnects and closes', async () => {
    const early = fake({ stopAt: 'check' });
    const r1 = await runJob(job, early.deps, 100);
    expect(r1).toMatchObject({ code: 'STOPPED', verdict: 'stopped', depositState: 'none' });
    expect(early.calls).not.toContain('connect');
    const late = fake({ stopAt: 'exit' });
    const r2 = await runJob(job, late.deps, 100);
    expect(r2).toMatchObject({ code: 'STOPPED', verdict: 'stopped', depositState: 'closed' });
    expect(late.calls).not.toContain('speed');
    expect(late.calls.slice(-3)).toEqual(['disconnect', 'close:Dep1', 'closed:Dep1:closed']);
  });

  it('slow against the speed without VPN', async () => {
    const r = await runJob(job, fake({ speed: { ok: true, figure: { ...figure, mbps: 5 } } }).deps, 100);
    expect(r).toMatchObject({ code: 'OK', verdict: 'slow', mbps: 5 });
  });
});

describe('uriIp', () => {
  it('reads a literal address and nothing else', () => {
    expect(uriIp('https://203.0.113.7:8443')).toBe('203.0.113.7');
    expect(uriIp('https://[2001:db8::1]:8443')).toBe('2001:db8::1');
    expect(uriIp('https://node.example.com:8443')).toBeNull();
    expect(uriIp('nonsense')).toBeNull();
  });
});
