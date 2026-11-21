// ─── Node list service (F5 row "node list", F6, F7) ───
// Stale-while-revalidate: the last list is served from disk at once, refreshed
// from chain, then every listing-fresh node is probed 30-way with progress events.
import type { NodeView, ProbeResult } from '../../shared/types';
import { discoverNodes, probeAll, type NodeRecord } from '../../core/nodes/discovery';
import { census, dueForCheck, listingCurrent, type Census } from '../../core/nodes/census';
import { EVENTS } from '../../shared/ipc';
import { readJson, writeJson } from '../store';
import { getSettings, updateSettings } from '../system/settings';
import { broadcast } from '../app-state';
import { log } from '../logger';
import { ShownError } from '../../shared/i18n';

const CACHE = 'nodes-cache.json';
let nodes: NodeRecord[] = [];
const probes = new Map<string, ProbeResult>();
let refreshing: Promise<NodeView[]> | null = null;
let lastRefresh = 0;

export function loadNodeCache(): void {
  const c = readJson<{ nodes: NodeRecord[]; probes: Array<[string, ProbeResult]> } | null>(CACHE, null);
  if (!c) return;
  nodes = c.nodes;
  for (const [k, v] of c.probes) probes.set(k, v);
}

export function nodeViews(): NodeView[] {
  const fav = new Set(getSettings().favourites);
  return nodes.map((n) => ({ ...n, probe: probes.get(n.address) ?? null, favourite: fav.has(n.address) }));
}

export function refreshNodes({ probe = true } = {}): Promise<NodeView[]> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      nodes = await discoverNodes();
      lastRefresh = Date.now();
      broadcast(EVENTS.NODES, nodeViews());
      // A check result for a server that is no longer on the list would otherwise live on disk for ever (row 146).
      const known = new Set(nodes.map((n) => n.address));
      for (const k of [...probes.keys()]) if (!known.has(k)) probes.delete(k);
      if (probe) {
        const fresh = nodes.filter((n) => listingCurrent(n, Date.now()));
        let done = 0;
        await probeAll(fresh, (addr, r) => {
          probes.set(addr, r);
          done += 1;
          broadcast(EVENTS.PROBE, { address: addr, probe: r, done, total: fresh.length });
        });
      }
      writeJson(CACHE, { nodes, probes: [...probes.entries()] });
      broadcast(EVENTS.NODES, nodeViews());
      return nodeViews();
    } catch (err) {
      log.warn('node refresh failed', { err: (err as Error).message });
      throw err;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** The one server count (rows 143–147): every screen and the CLI read this, never their own filter. */
export function nodeCensus(now = Date.now()): Census {
  return census(nodeViews(), now);
}

/**
 * True when a server on the network has no check, or one older than 10 minutes (row 145): the list
 * should be checked again now, not at the next scheduled refresh. False while a check is running.
 */
export function recheckDue(now = Date.now()): boolean {
  return !refreshing && dueForCheck(nodeViews(), now).length > 0;
}

export const nodesAge =(): number => (lastRefresh ? Date.now() - lastRefresh : Infinity);

export function toggleFavourite(address: string): boolean {
  // Same rule as the settings allow-list: an address it would drop is refused here, out loud.
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) throw new ShownError('"{address}" is not a server address.', { address });
  const fav = new Set(getSettings().favourites);
  const on = !fav.has(address);
  if (on) fav.add(address); else fav.delete(address);
  // Report what was stored, not what was asked (the list is capped at 500).
  return updateSettings({ favourites: [...fav] }).favourites.includes(address);
}

export function findNode(address: string): NodeView | null {
  return nodeViews().find((n) => n.address === address) ?? null;
}
