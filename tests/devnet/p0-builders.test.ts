// ─── P0 spike 3: every new owner-signed builder lands on devnet ───
// Spends from the #28 devnet wallet (TEST_KEYFILE). Sequential, 7 s between txs.
// Channels created here are recorded in tests/devnet/state.json so the voucher
// channel can be closed after the 7200 s grace (tests/devnet/p0-settle.test.ts).
//
//   TEST_KEYFILE=…/sentinel-solana/keys/devnet/client.json P0_DEVICE=<device pubkey> npx vitest run tests/devnet/p0-builders.test.ts
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PublicKey } from '@solana/web3.js';
import { getAccount, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { setRpcUrls, rpcCall } from '../../src/core/chain/rpc';
import { ata, pda } from '../../src/core/chain/program';
import * as b from '../../src/core/chain/builders';
import { channelByPda, grantOf, nodeByPda, userByOwner } from '../../src/core/chain/accounts';
import { buildTx } from '../../src/core/chain/tx';
import { ProgramError, devnetCodeOf } from '../../src/core/chain/errors';
import { CHANNEL_STATUS_CLOSING, PERMS_CLIENT } from '../../src/core/chain/idl';
import { testKeypair, land } from './_signer';

if (process.env.SOLANA_RPC_URLS) setRpcUrls(process.env.SOLANA_RPC_URLS.split(','));
const kp = testKeypair();
const DEVICE = process.env.P0_DEVICE ?? '';
const NODE = process.env.P0_NODE ?? '6AaXvhWpFDMf8FimxSb2Tb3bKcgPmbZxj4Tdtb31nP8F'; // set P0_NODE to one of our ddv- nodes
const STATE = 'tests/devnet/state.json';

function saveState(patch: Record<string, unknown>): void {
  const cur = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
  writeFileSync(STATE, `${JSON.stringify({ ...cur, ...patch }, null, 2)}\n`);
}

describe.skipIf(!kp || !DEVICE).sequential('P0 builders on devnet', () => {
  const owner = kp ? kp.publicKey : PublicKey.default; // the body is collected even when skipped (no TEST_KEYFILE)
  let voucherCh = '';
  let streamCh = '';

  it('approve: adds to the shared delegate allowance instead of overwriting it', async () => {
    const acct = await rpcCall((c) => getAccount(c, ata(owner), 'confirmed', TOKEN_2022_PROGRAM_ID), { label: 'ata' });
    const current = acct.delegate && acct.delegate.equals(pda.config()) ? acct.delegatedAmount : 0n;
    const next = current + 2_000_000n; // + 2 tDVPN
    await land(kp!, [b.approveDelegate({ owner, amount: next })], 'approve_delegate');
    const after = await rpcCall((c) => getAccount(c, ata(owner), 'confirmed', TOKEN_2022_PROGRAM_ID), { label: 'ata' });
    expect(after.delegate?.toBase58()).toBe(pda.config().toBase58());
    expect(after.delegatedAmount).toBe(next);
  });

  it('open_grant → update_grant', async () => {
    const existing = await grantOf(owner, DEVICE);
    if (!existing) await land(kp!, [await b.openGrant({ owner, grantee: DEVICE, allowance: '2000000' })], 'open_grant');
    await land(kp!, [await b.updateGrant({ owner, grantee: DEVICE, allowance: '1500000' })], 'update_grant');
    const g = await grantOf(owner, DEVICE);
    expect(g.grantee).toBe(DEVICE);
    expect(g.target).toBe(PublicKey.default.toBase58());
    expect(Number(g.permissions)).toBe(PERMS_CLIENT);
    expect(g.allowance).toBe('1500000');
    saveState({ device: DEVICE, grant: pda.grant(owner, DEVICE).toBase58() });
  });

  it('open_channel (voucher) → fund_channels → start_close_channel', async () => {
    const node = await nodeByPda(NODE);
    const id = randomBytes(32);
    voucherCh = pda.channel(owner, id).toBase58();
    await land(kp!, [await b.openChannel({ owner, node, channelId: id, escrow: '10000', mode: 0 })], 'open_channel:voucher');
    saveState({ voucherChannel: voucherCh });
    await land(kp!, [await b.fundChannels({ owner, channels: [{ address: voucherCh, amount: '5000' }] })], 'fund_channels');
    expect((await channelByPda(voucherCh)).escrow).toBe('15000');
    await land(kp!, [await b.startCloseChannel({ owner, channel: voucherCh })], 'start_close_channel');
    const ch = await channelByPda(voucherCh);
    expect(ch.status).toBe(CHANNEL_STATUS_CLOSING);
    saveState({ voucherCloseStartedAt: Number(ch.closeStartedAt) });
  });

  it('close_channel before the grace is refused with GraceNotElapsed (by number)', async () => {
    const ch = await channelByPda(voucherCh);
    const ix = await b.closeChannel({ signer: owner, ch: { address: voucherCh, owner: ch.owner, opener: ch.opener, node: ch.node, rentPayer: ch.rentRecipient, mode: ch.mode } });
    const err = await buildTx([ix], owner, { label: 'close_channel:early' }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ProgramError);
    expect((err as ProgramError).code).toBe(devnetCodeOf('GraceNotElapsed'));
    console.log(`early close refused: ${(err as Error).message}`);
  });

  it('open_channel (stream) → close_channel immediately → refund in User.balance', async () => {
    const node = await nodeByPda(NODE);
    const id = randomBytes(32);
    streamCh = pda.channel(owner, id).toBase58();
    const before = BigInt((await userByOwner(owner))?.balance ?? '0');
    await land(kp!, [await b.openChannel({ owner, node, channelId: id, escrow: '10000', mode: 1, expectedRate: node.channelPricePerHour })], 'open_channel:stream');
    saveState({ streamChannel: streamCh });
    const ch = await channelByPda(streamCh);
    await land(kp!, [await b.closeChannel({ signer: owner, ch: { address: streamCh, owner: ch.owner, opener: ch.opener, node: ch.node, rentPayer: ch.rentRecipient, mode: ch.mode } })], 'close_channel:stream');
    expect(await channelByPda(streamCh)).toBeNull();
    const after = BigInt((await userByOwner(owner)).balance);
    console.log(`User.balance ${before} → ${after}`);
    expect(after > before).toBe(true);
    saveState({ streamChannel: null, streamClosed: true });
  });

  it('withdraw_user_balance empties User.balance', async () => {
    const user = await userByOwner(owner);
    await land(kp!, [await b.withdrawUserBalance({ owner, userRentPayer: user.rentRecipient })], 'withdraw_user_balance');
    const after = await userByOwner(owner);
    expect(after === null || after.balance === '0').toBe(true);
  });

  it('grant is kept for the daemon spike (closed in p0-settle)', async () => {
    const g = await grantOf(owner, DEVICE);
    expect(new PublicKey(g.granter).equals(owner)).toBe(true);
  });
});
