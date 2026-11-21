// Row 73: refund transactions keep the project's 7 s apart on the public Solana endpoint, and do not wait on the
// user's own endpoint. settleWaitMs is the rule; the source scan makes sure every refund transaction uses it.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => ({ n: 0, chans: [] as Array<Record<string, unknown>> }));
vi.mock('../../src/main/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../src/main/daemon/manager', () => ({ daemon: () => ({}), daemonInfo: () => ({ reachable: false, device: 'Dev' }) }));
vi.mock('../../src/main/app-state', () => ({ snapshot: () => ({ session: null }), patch: vi.fn(), toast: vi.fn() }));
vi.mock('../../src/main/wallet/vault', () => ({ ownerAddress: () => 'Owner', ownerSigner: () => ({ publicKey: 'Owner' }) }));
vi.mock('../../src/core/app/signer', () => ({ signAndSend: async () => { sent.n += 1; return { signature: `sig${sent.n}`, label: 'x' }; } }));
vi.mock('../../src/core/chain/accounts', () => ({ channelsByOwner: async () => sent.chans, userByOwner: async () => ({ balance: '5', rentRecipient: 'Owner' }) }));
vi.mock('../../src/core/chain/builders', () => ({ approveDelegate: () => ({}), closeChannel: async () => ({}), startCloseChannel: async () => ({}), withdrawUserBalance: async () => ({}) }));

vi.mock('../../src/core/chain/program', () => ({ fetchConfig: async () => ({ channelCloseGraceSeconds: 7200 }) }));

const S = await import('../../src/main/services/settlement');
const { MODE_STREAM, MODE_VOUCHER, CHANNEL_STATUS_OPEN } = await import('../../src/core/chain/idl');

describe('a per-hour deposit carries its price per hour (row 78)', () => {
  const base = { owner: 'Owner', node: 'NodeA', opener: 'Dev', status: CHANNEL_STATUS_OPEN, escrow: '3000', redeemed: '0', closeStartedAt: '0', rentRecipient: 'Owner', openedAt: '100', streamBase: '0', streamStartedAt: String(Math.floor(Date.now() / 1000)) };
  it('per hour: ratePerHour is there; per GB and a zero rate: it is not', async () => {
    sent.chans = [
      { ...base, address: 'Hour', mode: MODE_STREAM, ratePerHour: '1500' },
      { ...base, address: 'Gb', mode: MODE_VOUCHER, ratePerHour: '1500' },
      { ...base, address: 'Zero', mode: MODE_STREAM, ratePerHour: '0' },
    ];
    const l = await S.readSettlements();
    expect(l.find((x) => x.channel === 'Hour')?.ratePerHour).toBe('1500');
    expect(l.find((x) => x.channel === 'Gb')).toBeDefined();
    expect(l.find((x) => x.channel === 'Gb')?.ratePerHour).toBeUndefined();
    expect(l.find((x) => x.channel === 'Zero')?.ratePerHour).toBeUndefined();
    sent.chans = [];
  });
});

describe('the wait between refund transactions (row 73)', () => {
  it('nothing waits before the first transaction', () => {
    expect(S.settleWaitMs(1_000_000, true)).toBe(0);
  });

  it('after a transaction: the public endpoint waits out the 7 s, the user\'s own endpoint does not', async () => {
    const r = await S.withdraw();
    expect(r.ok).toBe(true);
    expect(sent.n).toBe(1);
    const now = Date.now();
    expect(S.settleWaitMs(now, true)).toBeGreaterThan(S.SETTLE_TX_GAP_MS - 1_000);
    expect(S.settleWaitMs(now, true)).toBeLessThanOrEqual(S.SETTLE_TX_GAP_MS);
    expect(S.settleWaitMs(now + S.SETTLE_TX_GAP_MS, true)).toBe(0);
    expect(S.settleWaitMs(now, false)).toBe(0); // negative control
  });

  it('every refund transaction goes through the paced sender', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/main/services/settlement.ts'), 'utf8');
    expect(src.match(/await signAndSend\(/g)?.length).toBe(1); // the one inside paced()
    expect(src.match(/await paced\(/g)?.length).toBeGreaterThanOrEqual(6);
    expect(S.SETTLE_TX_GAP_MS).toBe(7000);
  });
});
