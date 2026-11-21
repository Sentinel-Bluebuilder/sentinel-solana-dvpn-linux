// ─── Recently connected: newest first (owner 2026-11-12) ───
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { recentlyConnected } from '../../src/core/nodes/recent-order';

const n = (address: string, favourite = false) => ({ address, favourite });

describe('recentlyConnected', () => {
  it('keeps the newest-first order, not the server list order', () => {
    const nodes = [n('A'), n('B'), n('C'), n('D')];
    expect(recentlyConnected(nodes, ['C', 'A', 'D']).map((x) => x.address)).toEqual(['C', 'A', 'D']);
  });
  it('favourites never used come after; servers gone from the list are skipped', () => {
    const nodes = [n('A', true), n('B'), n('C')];
    expect(recentlyConnected(nodes, ['C', 'GONE']).map((x) => x.address)).toEqual(['C', 'A']);
  });
  it('the Home list uses it and reloads when the session changes', () => {
    const h = readFileSync('src/renderer/src/screens/Home.tsx', 'utf8');
    expect(h).toContain('const mine = recentlyConnected(nodes, recent);');
    expect(h).toContain('}, [current]);');
    expect(h).not.toContain('Number(b.favourite) - Number(a.favourite)');
  });
});
