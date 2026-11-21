// ─── P4 (the agent kit plan): odd input on the agent path, as properties over many seeded random inputs ───
// No new dependency: a small seeded generator (mulberry32) stands in for fast-check, so a failure prints the seed
// and the exact input, and re-runs are identical. Covers the argv parser, --units / --max-price / --country /
// --basis / empty values (agentInputs), amounts (toBaseUnits), and the node filters (filterNodes, cheapestBand).
import { describe, it, expect, vi } from 'vitest';

// agent-cmd imports the app runtime at load time; these stubs keep the import pure (only pure functions are used).
vi.mock('../../src/cli/commands', () => ({ confirm: () => undefined, disconnectCmd: async () => undefined }));
vi.mock('../../src/cli/status-cmd', () => ({ within: <T>(p: Promise<T>) => p, STATUS_NET_BUDGET_MS: 2500, internetProbe: async () => true, reconnectBlockedNext: () => null, RECONNECT_BLOCKED_ALSO: 'then devnet-dvpn agent up --yes to reconnect, or devnet-dvpn agent down --yes to close the deposit' }));
vi.mock('../../src/main/app-state', () => ({ snapshot: () => ({ session: null, publicIp: null, homeIp: null }) }));
vi.mock('../../src/main/daemon/settings', () => ({ serviceUsesTun: () => false }));
vi.mock('../../src/main/home-ip', () => ({ loadHomeIp: () => undefined }));
vi.mock('../../src/main/services/agent-marker', () => ({ writeAgentMarker: () => undefined }));
vi.mock('../../src/main/scheduler', () => ({ runJobNow: async () => ({ ok: true }) }));
vi.mock('../../src/main/services/wallet', () => ({ refreshWallet: async () => null }));
vi.mock('../../src/main/services/nodes', () => ({ refreshNodes: async () => [], nodeViews: () => [] }));
vi.mock('../../src/main/services/history', () => ({ listHistory: () => [] }));
vi.mock('../../src/main/services/connection', () => ({ adoptRunningSession: async () => undefined, sessionStateUnknown: () => false, connect: async () => ({ ok: false }) }));
vi.mock('../../src/main/services/settlement', () => ({ readSettlements: async () => [], runSettlement: async () => ({ ok: true, data: [] }) }));
vi.mock('../../src/main/services/plans', () => ({ refreshSubscriptions: async () => [], roster: async () => [] }));
vi.mock('../../src/main/daemon/manager', () => ({ daemonInfo: () => ({ reachable: false, device: null }), initDevice: async () => ({ ok: false }), deviceRecord: () => null }));
vi.mock('../../src/main/system/tunnels', () => ({ rivalVpns: async () => [] }));
vi.mock('../../src/main/system/settings', () => ({ getSettings: () => ({ defaultBasis: 'per_gb', defaultGb: 1, defaultHours: 1 }) }));
vi.mock('../../src/main/wallet/vault', () => ({ ownerAddress: () => null, noWallet: () => ({ error: 'Set up a wallet first.', code: 'no-wallet' }) }));

const { parseArgs, whole, UsageError } = await import('../../src/cli/args');
const { agentInputs, filterNodes, pickPool } = await import('../../src/cli/agent-cmd');
const { toBaseUnits } = await import('../../src/core/chain/amounts');
const { cheapestBand, QUICK_PRICE_BAND } = await import('../../src/shared/quick-pick');
import type { NodeView } from '../../src/shared/types';
import { PROTOCOLS } from '../../src/shared/protocols';

// ─── Seeded generator ───
const RUNS = 400;
const SEED = Number(process.env.PROPS_SEED ?? 20261119);
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const int = (r: () => number, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
const digits = (r: () => number, n: number): string => Array.from({ length: n }, () => String(int(r, 0, 9))).join('');

/** Odd strings an agent or a typo can produce: signs, exponents, separators, unicode digits, spaces, huge values. */
const ODD = ['', ' ', '-1', '+1', '0', '00', '1e3', '1E3', '0x10', '1,5', '1.5', '.5', '5.', '1..2', ' 7', '7 ', '1 000',
  '１', '٣', 'NaN', 'Infinity', '-0', '999999999', '1000000000', '18446744073709551616', 'null', 'undefined', '--', '=', '\t3'];
function oddish(r: () => number): string {
  const k = r();
  if (k < 0.35) return pick(r, ODD);
  if (k < 0.7) return digits(r, int(r, 1, 12));
  if (k < 0.85) return `${digits(r, int(r, 1, 4))}.${digits(r, int(r, 0, 9))}`;
  return pick(r, ['-', '+', '.', 'e', ' ', 'a', '１']) + digits(r, int(r, 0, 4));
}
const isWhole = (v: string, min: number, max: number): boolean => /^\d{1,9}$/.test(v) && Number(v) >= min && Number(v) <= max;
const isAmount = (v: string): boolean => {
  const s = v.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return false;
  const [w, f = ''] = s.split('.');
  return f.length <= 6 && BigInt(w) * 1_000_000n + BigInt((f + '000000').slice(0, 6)) <= 18446744073709551615n;
};
const D = { basis: 'per_gb', gb: 1, hours: 1 };
const usage = (fn: () => unknown): boolean => { try { fn(); return false; } catch (err) { if (err instanceof UsageError) return true; throw err; } };

describe(`P4 properties (seed ${SEED}, ${RUNS} runs each)`, () => {
  it('parseArgs never throws, and --name=value is kept exactly', () => {
    const r = rng(SEED);
    for (let i = 0; i < RUNS; i++) {
      const name = pick(r, ['units', 'max-price', 'country', 'protocol', 'plan', 'node', 'basis']);
      const value = oddish(r);
      const noise = Array.from({ length: int(r, 0, 4) }, () => pick(r, ['--json', '--yes', '-y', 'up', 'x', '--online']));
      const argv = [...noise, `--${name}=${value}`, ...noise];
      const a = parseArgs(argv);
      expect(a.flags[name], JSON.stringify(argv)).toBe(value);
    }
  });

  it('a boolean flag never swallows the next word', () => {
    const r = rng(SEED + 1);
    for (let i = 0; i < RUNS; i++) {
      const word = oddish(r) || 'w';
      if (word.startsWith('--')) continue;
      const a = parseArgs([pick(r, ['--json', '--yes', '--online', '--all']), word]);
      expect(a._, word).toContain(word);
    }
  });

  it('whole() accepts exactly the whole numbers in range and rejects everything else (never a silent fallback)', () => {
    const r = rng(SEED + 2);
    for (let i = 0; i < RUNS; i++) {
      const v = oddish(r);
      const a = parseArgs([`--units=${v}`]);
      if (isWhole(v, 1, 1000)) expect(whole(a, 'units', 7, 1, 1000), v).toBe(Number(v));
      else expect(usage(() => whole(a, 'units', 7, 1, 1000)), JSON.stringify(v)).toBe(true);
    }
  });

  it('toBaseUnits: valid amounts convert exactly (6 decimals), everything else throws', () => {
    const r = rng(SEED + 3);
    for (let i = 0; i < RUNS; i++) {
      const v = oddish(r);
      if (isAmount(v)) {
        const s = v.trim(); const [w, f = ''] = s.split('.');
        expect(toBaseUnits(v), v).toBe((BigInt(w) * 1_000_000n + BigInt((f + '000000').slice(0, 6))).toString());
      } else {
        expect(() => toBaseUnits(v), JSON.stringify(v)).toThrow();
      }
    }
  });

  it('agentInputs: every odd --units / --max-price / --country / --basis / --protocol is either valid or a usage error (exit 3)', () => {
    const r = rng(SEED + 4);
    for (let i = 0; i < RUNS; i++) {
      const units = oddish(r); const mp = oddish(r);
      const country = pick(r, ['de', 'DE', 'De', 'D', 'DEU', '', '1A', 'ü', 'us', ' us']);
      const basis = pick(r, ['per_gb', 'per_hour', 'PER_GB', 'gb', '', 'per-gb']);
      const protocol = pick(r, ['any', 'ANY', 'wireguard', 'WireGuard', 'wg', '', ...PROTOCOLS]);
      const argv = [`--units=${units}`, `--max-price=${mp}`, `--country=${country}`, `--basis=${basis}`, `--protocol=${protocol}`];
      const valid = isWhole(units, 1, 1000) && isAmount(mp) && /^[A-Za-z]{2}$/.test(country)
        && (basis === 'per_gb' || basis === 'per_hour')
        && (protocol.toLowerCase() === 'any' || (PROTOCOLS as readonly string[]).includes(protocol.toLowerCase()));
      if (valid) {
        const got = agentInputs(parseArgs(argv), D);
        expect(got.units, argv.join(' ')).toBe(Number(units));
        expect(got.maxPrice, argv.join(' ')).toBe(toBaseUnits(mp));
        expect(got.country, argv.join(' ')).toBe(country.toUpperCase());
      } else {
        expect(usage(() => agentInputs(parseArgs(argv), D)), argv.join(' ')).toBe(true);
      }
    }
  });

  it('agentInputs: a value flag given with no value is a usage error, wherever it sits (E-21: never a paid fallback)', () => {
    const r = rng(SEED + 5);
    for (let i = 0; i < RUNS; i++) {
      const name = pick(r, ['plan', 'node', 'country', 'protocol', 'max-price', 'basis', 'units']);
      const form = pick(r, [[`--${name}=`], [`--${name}`], [`--${name}`, '--yes'], [`--${name}`, '--json'], [`--${name}=   `]]);
      const argv = pick(r, [[...form], ['--yes', ...form], [...form, '--yes']]);
      expect(usage(() => agentInputs(parseArgs(argv), D)), argv.join(' ')).toBe(true);
    }
  });

  // ─── Node filters ───
  const node = (r: () => number, i: number, price: () => string): NodeView => ({
    address: `N${i}`, countryCode: pick(r, ['DE', 'US', 'NL']), favourite: false, listingFresh: r() > 0.1,
    pricePerGb: price(), pricePerHour: price(), protocolNames: [pick(r, PROTOCOLS)], probe: { ok: r() > 0.2, latencyMs: int(r, 5, 500) },
  } as unknown as NodeView);

  it('filterNodes: every node kept is priced, within --max-price, and of the asked protocol and country', () => {
    const r = rng(SEED + 6);
    for (let i = 0; i < RUNS; i++) {
      const list = Array.from({ length: int(r, 0, 12) }, (_, k) => node(r, k, () => (r() < 0.15 ? '0' : digits(r, int(r, 1, 12)).replace(/^0+(?=\d)/, ''))));
      const maxPrice = r() < 0.5 ? undefined : digits(r, int(r, 1, 12)).replace(/^0+(?=\d)/, '');
      const protocol = r() < 0.5 ? undefined : pick(r, PROTOCOLS);
      const country = r() < 0.5 ? undefined : pick(r, ['DE', 'US', 'NL']);
      for (const n of filterNodes(list, { basis: 'per_gb', protocol, country, maxPrice })) {
        expect(BigInt(n.pricePerGb) > 0n).toBe(true);
        if (maxPrice) expect(BigInt(n.pricePerGb) <= BigInt(maxPrice)).toBe(true);
        if (protocol) expect(n.protocolNames).toContain(protocol);
        if (country) expect(n.countryCode).toBe(country);
      }
    }
  });

  it('filterNodes: a malformed price counts as unpriced (left out), never a crash of agent up', () => {
    const r = rng(SEED + 7);
    for (let i = 0; i < RUNS; i++) {
      const bad = pick(r, ['1.5', 'abc', '-3', ' 7', '1e9', '', 'null', '０']);
      const list = [node(r, 0, () => bad), node(r, 1, () => '2000')];
      let kept: NodeView[] = [];
      expect(() => { kept = filterNodes(list, { basis: 'per_gb' }); }, bad).not.toThrow();
      expect(kept.map((n) => n.address), bad).not.toContain('N0');
    }
  });

  it('cheapestBand / pickPool: the pool is a subset within QUICK_PRICE_BAND × the cheapest answering node', () => {
    const r = rng(SEED + 8);
    for (let i = 0; i < RUNS; i++) {
      const list = Array.from({ length: int(r, 1, 12) }, (_, k) => node(r, k, () => String(int(r, 1, 60) * 1_000_000)));
      const pool = pickPool(list, { basis: 'per_gb', units: 1 }, false);
      const answering = list.filter((n) => n.probe?.ok && n.listingFresh !== false);
      for (const n of pool) expect(answering).toContain(n);
      if (answering.length) {
        const floor = answering.reduce((m, n) => (BigInt(n.pricePerGb) < m ? BigInt(n.pricePerGb) : m), BigInt(answering[0].pricePerGb));
        expect(pool.length).toBeGreaterThan(0);
        for (const n of pool) expect(BigInt(n.pricePerGb) <= floor * QUICK_PRICE_BAND).toBe(true);
      }
      expect(cheapestBand([], { basis: 'per_gb', units: 1 })).toEqual([]);
    }
  });
});
