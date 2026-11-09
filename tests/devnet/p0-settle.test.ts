// ─── P0 cleanup: finish what p0-builders left open, after the 7200 s grace ───
// close_channel (voucher) → withdraw_user_balance → close_grant for the scratch device.
// Each step is skipped when already done, so a re-run is safe.
//
//   TEST_KEYFILE=…/sentinel-solana/keys/devnet/client.json npx vitest run tests/devnet/p0-settle.test.ts
import { describe, it, expect } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { setRpcUrls } from '../../src/core/chain/rpc';
import * as b from '../../src/core/chain/builders';
import { channelByPda, grantOf, userByOwner } from '../../src/core/chain/accounts';
import { fetchConfig } from '../../src/core/chain/program';
import { CHANNEL_STATUS_CLOSING } from '../../src/core/chain/idl';
import { testKeypair, land } from './_signer';

if (process.env.SOLANA_RPC_URLS) setRpcUrls(process.env.SOLANA_RPC_URLS.split(','));
const kp = testKeypair();
const STATE = 'tests/devnet/state.json';
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) as Record<string, unknown> : {};
const save = (patch: Record<string, unknown>): void => {
  const cur = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
  writeFileSync(STATE, `${JSON.stringify({ ...cur, ...patch }, null, 2)}\n`);
};

describe.skipIf(!kp || !state.voucherChannel && !state.grant).sequential('P0 settle on devnet', () => {
  const owner = kp ? kp.publicKey : PublicKey.default; // the body is collected even when skipped (no TEST_KEYFILE)

  it('close_channel on the voucher channel once its grace has passed', async () => {
    const addr = String(state.voucherChannel ?? '');
    const ch = addr ? await channelByPda(addr) : null;
    if (!ch) { console.log('voucher channel already closed'); save({ voucherChannel: null }); return; }
    expect(Number(ch.status)).toBe(CHANNEL_STATUS_CLOSING);
    const cfg = await fetchConfig();
    const readyAt = Number(ch.closeStartedAt) + cfg.channelCloseGraceSeconds;
    expect(Math.floor(Date.now() / 1000)).toBeGreaterThanOrEqual(readyAt);
    await land(kp!, [await b.closeChannel({ signer: owner, ch: { address: addr, owner: String(ch.owner), opener: String(ch.opener), node: String(ch.node), rentPayer: String(ch.rentRecipient), mode: Number(ch.mode) } })], 'close_channel:p0-voucher');
    expect(await channelByPda(addr)).toBeNull();
    save({ voucherChannel: null });
  });

  it('withdraw_user_balance moves the refund to the wallet', async () => {
    const user = await userByOwner(owner);
    if (!user || BigInt(String(user.balance)) === 0n) { console.log('nothing to withdraw'); return; }
    await land(kp!, [await b.withdrawUserBalance({ owner, userRentPayer: String(user.rentRecipient) })], 'withdraw_user_balance:p0');
    expect(BigInt(String((await userByOwner(owner))?.balance ?? 0))).toBe(0n);
  });

  it('close_grant for the P0 scratch device', async () => {
    const device = String(state.device ?? '');
    const g = device ? await grantOf(owner, device) : null;
    if (!g) { console.log('grant already closed'); save({ grant: null }); return; }
    await land(kp!, [await b.closeGrant({ owner, grantee: device, rentPayer: String(g.rentRecipient) })], 'close_grant:p0');
    expect(await grantOf(owner, device)).toBeNull();
    save({ grant: null });
  });
});
