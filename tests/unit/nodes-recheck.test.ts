// ─── Row 145: the server list says when it must be checked again ───
// main/scheduler.ts runs the 'nodes' job at once when recheckDue() is true (a server on the
// network with no check, or one older than 10 minutes), instead of waiting for its interval.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const NOW = 1_800_000_000_000;
const h = vi.hoisted(() => ({ cache: null as unknown, hold: null as null | (() => void) }));
vi.mock('../../src/main/store', () => ({ readJson: () => h.cache, writeJson: () => undefined }));
vi.mock('../../src/main/system/settings', () => ({ getSettings: () => ({ favourites: [] }), updateSettings: () => ({ favourites: [] }) }));
vi.mock('../../src/main/app-state', () => ({ broadcast: () => undefined }));
vi.mock('../../src/main/logger', () => ({ log: { warn: () => undefined } }));
vi.mock('../../src/core/nodes/discovery', () => ({
  discoverNodes: () => new Promise((resolve) => { h.hold = () => resolve([]); }),
  probeAll: async () => undefined,
}));
const svc = await import('../../src/main/services/nodes');

const server = (address: string, expiresAt: number, listed = true) => ({ address, owner: 'o', listed, listedAt: 1, expiresAt, listingFresh: true, uri: 'https://10.0.0.1:1', countryCode: 'US', country: 'US', continent: '', protocols: 1, protocolNames: ['wireguard'], pricePerGb: '1', pricePerHour: '1' });
const probe = (probedAt: number) => ({ ok: true, reachable: true, probedAt, error: null });
const future = Math.floor(NOW / 1000) + 3600;
const load = (nodes: unknown[], probes: Array<[string, unknown]>): void => { h.cache = { nodes, probes }; svc.loadNodeCache(); };

describe('recheckDue', () => {
  beforeEach(() => { h.hold = null; });

  it('false when every server on the network has a check under 10 minutes old', () => {
    load([server('A', future), server('B', future)], [['A', probe(NOW - 60_000)], ['B', probe(NOW - 9 * 60_000)]]);
    expect(svc.recheckDue(NOW)).toBe(false);
  });

  it('true when one check is older than 10 minutes, or a server was never checked', () => {
    load([server('A', future), server('B', future)], [['A', probe(NOW - 60_000)], ['B', probe(NOW - 11 * 60_000)]]);
    expect(svc.recheckDue(NOW)).toBe(true);
    load([server('A', future), server('C', future)], [['A', probe(NOW - 60_000)]]);
    expect(svc.recheckDue(NOW)).toBe(true);
  });

  it('servers that left the network never ask for a check', () => {
    load([server('A', future), server('OLD', Math.floor(NOW / 1000) - 10), server('OFF', future, false)], [['A', probe(NOW - 60_000)]]);
    expect(svc.recheckDue(NOW)).toBe(false);
  });

  it('false while a check is already running', async () => {
    load([server('Z', future)], []); // a server with no check yet (check results of earlier loads stay in memory)
    expect(svc.recheckDue(NOW)).toBe(true);
    const going = svc.refreshNodes();
    expect(svc.recheckDue(NOW)).toBe(false);
    h.hold?.();
    await going;
  });
});
