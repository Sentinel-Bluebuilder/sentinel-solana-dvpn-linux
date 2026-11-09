// ─── Devnet reads (free, no signing) ───
// Proves the devnet IDL + deployed sizes decode the live registry.
import { describe, it, expect } from 'vitest';
import { setRpcUrls } from '../../src/core/chain/rpc';
import { fetchConfig } from '../../src/core/chain/program';
import { allNodes, allPlans, allProviders, userByOwner, channelsByOwner } from '../../src/core/chain/accounts';

const WALLET = '11111111111111111111111111111111';
if (process.env.SOLANA_RPC_URLS) setRpcUrls(process.env.SOLANA_RPC_URLS.split(','));

describe('devnet chain reads', () => {
  it('reads Config', async () => {
    const cfg = await fetchConfig();
    expect(cfg.feeBps).toBe(200);
    expect(cfg.channelCloseGraceSeconds).toBe(7200);
    expect(cfg.nodeListingTtlSeconds).toBe(86400);
  });

  it('decodes every node, plan and provider', async () => {
    const nodes = await allNodes();
    const plans = await allPlans();
    const providers = await allProviders();
    console.log(`nodes=${nodes.length} plans=${plans.length} providers=${providers.length}`);
    for (const n of nodes) {
      expect(n.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
      expect(Array.isArray(n.protocolNames)).toBe(true);
      expect(typeof n.uri).toBe('string');
    }
    if (nodes[0]) console.log(JSON.stringify(nodes[0]));
    if (plans[0]) console.log(JSON.stringify(plans[0]));
  });

  it('reads the test wallet User + channels', async () => {
    const user = await userByOwner(WALLET);
    const chans = await channelsByOwner(WALLET);
    console.log(`user=${JSON.stringify(user)} channels=${chans.length}`);
    expect(Array.isArray(chans)).toBe(true);
  });
});
