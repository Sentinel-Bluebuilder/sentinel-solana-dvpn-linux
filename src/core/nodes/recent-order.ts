// ─── "Recently connected": newest first (owner 2026-11-12) ───
// The list came back newest first, then the screen re-sorted it into server-list order.

/** Servers you connected to, newest first; favourites you have not used yet follow. */
export function recentlyConnected<T extends { address: string; favourite?: boolean }>(nodes: T[], recentNewestFirst: string[]): T[] {
  const byAddr = new Map(nodes.map((n) => [n.address, n]));
  const out: T[] = [];
  for (const a of recentNewestFirst) {
    const n = byAddr.get(a);
    if (n && !out.includes(n)) out.push(n);
  }
  for (const n of nodes) if (n.favourite && !out.includes(n)) out.push(n);
  return out;
}
