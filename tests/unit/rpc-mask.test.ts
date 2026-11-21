import { describe, expect, it } from 'vitest';
import { KEY_MASK, maskRpcKey, unmaskRpcUrls } from '../../src/shared/rpc-mask';

const KEYED = 'https://devnet.helius-rpc.com/?api-key=0123456789abcdef';

describe('RPC key masking (Settings shows no API keys)', () => {
  it('hides the key and keeps the rest of the URL', () => {
    const m = maskRpcKey(KEYED);
    expect(m).toBe(`https://devnet.helius-rpc.com/?api-key=${KEY_MASK}`);
    expect(m).not.toContain('0123456789abcdef');
  });

  it('leaves URLs without a key alone', () => {
    expect(maskRpcKey('https://api.devnet.solana.com')).toBe('https://api.devnet.solana.com');
  });

  it('masks other key spellings', () => {
    expect(maskRpcKey('https://x.example/rpc?foo=1&token=abc')).toBe(`https://x.example/rpc?foo=1&token=${KEY_MASK}`);
    expect(maskRpcKey('https://x.example/?apikey=abc')).toBe(`https://x.example/?apikey=${KEY_MASK}`);
  });

  // Audit U-22: Alchemy and QuickNode put the key in the path; a user:password@ is a credential too.
  it('masks a key in the path and a user:password, and keeps short path parts', () => {
    const alchemy = 'https://solana-devnet.g.alchemy.com/v2/AbCdEfGhIjKlMnOpQrStUvWx12';
    const quicknode = 'https://red-x.solana-devnet.quiknode.pro/0123456789abcdef0123456789abcdef01234567/';
    expect(maskRpcKey(alchemy)).toBe(`https://solana-devnet.g.alchemy.com/v2/${KEY_MASK}`);
    expect(maskRpcKey(quicknode)).toBe(`https://red-x.solana-devnet.quiknode.pro/${KEY_MASK}/`);
    expect(maskRpcKey('https://me:s3cretpass@rpc.example/')).toBe(`https://${KEY_MASK}@rpc.example/`);
    expect(maskRpcKey('https://rpc.example/solana/devnet')).toBe('https://rpc.example/solana/devnet');
    expect(unmaskRpcUrls([maskRpcKey(alchemy)], [alchemy])).toEqual([alchemy]);
  });

  it('an unchanged masked line saves the stored URL; an edited one saves what was typed', () => {
    const stored = [KEYED, 'https://api.devnet.solana.com'];
    expect(unmaskRpcUrls([maskRpcKey(KEYED), 'https://api.devnet.solana.com'], stored)).toEqual(stored);
    expect(unmaskRpcUrls(['https://devnet.helius-rpc.com/?api-key=newkey'], stored)).toEqual(['https://devnet.helius-rpc.com/?api-key=newkey']);
  });
});
