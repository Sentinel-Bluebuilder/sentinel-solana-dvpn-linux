// rc.4 E-27 (review, Linux rc2): with DVPN_KEYFILE = wallet 2, connect answered active and wallet 1 paid; the
// answer never named the payer. Now the started session names the wallet that paid, read from the deposit
// account itself (so it is right even when this computer keeps no device record), and a mismatch is logged.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const warn = vi.hoisted(() => vi.fn());
vi.mock('../../src/main/logger', () => ({ log: { warn, info: vi.fn(), error: vi.fn() } }));
const { payerOf } = await import('../../src/main/services/connection');

const W1 = 'W1111zqJ5VnSxW4wZGkdcwF5ydW3z7jRMNTgZyU2LvcF';
const W2 = 'W2222zqJ5VnSxW4wZGkdcwF5ydW3z7jRMNTgZyU2LvcF';

describe('payerOf', () => {
  it('names the deposit account\'s owner and logs when it is not the loaded wallet (the E-27 case)', async () => {
    warn.mockClear();
    expect(await payerOf('Chan', W2, async () => ({ owner: W1 }))).toBe(W1);
    expect(warn).toHaveBeenCalledWith('the deposit was paid by another wallet than the loaded one', { channel: 'Chan', payer: W1, loaded: W2 });
  });
  it('negative control: the loaded wallet paid, nothing logged', async () => {
    warn.mockClear();
    expect(await payerOf('Chan', W1, async () => ({ owner: W1 }))).toBe(W1);
    expect(warn).not.toHaveBeenCalled();
  });
  it('unreadable or no deposit: null, never a guess', async () => {
    expect(await payerOf('Chan', W1, async () => { throw new Error('429'); })).toBeNull();
    expect(await payerOf('Chan', W1, async () => null)).toBeNull();
    expect(await payerOf('', W1, async () => ({ owner: W1 }))).toBeNull();
  });
  it('connect() puts it on the session it answers with', () => {
    const src = readFileSync('src/main/services/connection.ts', 'utf8');
    expect(src).toContain("const live: LiveSession = { ...toLive(s), payer: await payerOf(s.channel, ownerAddress() ?? '') };");
  });
});
