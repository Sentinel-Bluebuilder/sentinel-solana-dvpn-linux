// ─── Device setup / allowance (F3) — one owner signature ───
// The device key lives in dvpnd and opens channels for the owner. It needs:
//   1. Token-2022 delegate = Config PDA on the owner ATA. The delegate amount is
//      ONE shared number for every device, and ApproveChecked SETS it — so we add
//      to what is already approved instead of overwriting another device's room.
//   2. a Grant (owner → device, every target, dvpnd's client permissions, no expiry) whose
//      allowance is the device's cumulative spend cap.
//   3. a little SOL: the device pays fees and the channel account rent.
// All three go in one transaction so onboarding is a single approval.
import { PublicKey, SystemProgram, type TransactionInstruction } from '@solana/web3.js';
import * as b from '../chain/builders';
import { tdvpn } from '../chain/amounts';
import { sol } from '../../shared/format';
import { readWalletStatus, type WalletStatus } from './wallet-status';
import { signAndSend, type OwnerSigner } from './signer';
import { DEVICE_SOL_MIN } from '../pricing/cost';
import { MINT, PERMS_CLIENT } from '../chain/idl';
import { ata } from '../chain/program';
import { TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import { ownerSolForSetup } from '../session/setup-gate';
import { ShownError, tr } from '../../shared/i18n';

export const DEVICE_SOL_TARGET = 50_000_000; // 0.05 SOL: fees + ~0.0022 SOL rent per open channel (returned on close), ~20 channels (F3)

/** What the owner keeps for its own fees when it tops up a device. */
export const OWNER_SOL_RESERVE = 2_000_000;

/**
 * Automatic device top-up before a connect (soak 2026-10-21: every small per-GB deposit holds
 * ~0.004 SOL of rent until it is settled ~2 h later, so a busy device ran dry after ~50
 * connects). Lamports to send so the device is back at DEVICE_SOL_TARGET; 0 when no top-up is
 * needed; null when the owner wallet cannot spare it.
 */
export function deviceTopUpLamports(deviceLamports: number, ownerLamports: number): number | null {
  if (deviceLamports >= DEVICE_SOL_MIN) return 0;
  const need = DEVICE_SOL_TARGET - deviceLamports;
  return ownerLamports - OWNER_SOL_RESERVE >= need ? need : null;
}

// ─── Device permission at first connect (setting autoDevicePermission) ───
// Owner 2026-11-11: no "Sign device permission" setup step. The first Connect signs it with the
// in-app wallet (the Connect dialog says so; no second popup), starts the service, then pays the
// deposit. Settings turns it off; Wallet → This device still sets it up or removes it by hand.

/** Where the first-connect setup stands, for the banner and Settings. */
export type DeviceAutoState = 'off' | 'pending' | 'running' | 'failed' | 'idle';


export type AutoSetupDecision = 'run' | 'off' | 'no-key' | 'no-device' | 'not-needed' | 'owner-short';

/** True when the device cannot pay nodes for want of the permission itself (not just device SOL). */
export function needsPermission(w: Pick<WalletStatus, 'grant' | 'delegated'>): boolean {
  return !w.grant || (w.grant.permissions & PERMS_CLIENT) !== PERMS_CLIENT || BigInt(w.delegated || '0') === 0n;
}

export { ownerSolForSetup };

export function autoSetupDecision(
  w: Pick<WalletStatus, 'grant' | 'delegated' | 'device' | 'deviceLamports' | 'ownerLamports'>,
  o: { on: boolean; hasKey: boolean },
): AutoSetupDecision {
  if (!w.device) return 'no-device';
  if (!needsPermission(w)) return 'not-needed';
  if (!o.on) return 'off';
  if (!o.hasKey) return 'no-key';
  if (w.ownerLamports < ownerSolForSetup(w.deviceLamports)) return 'owner-short';
  return 'run';
}

export async function sendDeviceSol(signer: OwnerSigner, device: string, lamports: number): Promise<string> {
  const ix = SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: new PublicKey(device), lamports });
  return (await signAndSend(signer, [ix], 'device_topup')).signature;
}

/** The wallet in use is this computer's device key itself (e.g. imported from the service's operator.json). */
export function sameKeyMessage(device: string): string {
  return tr('This wallet is this computer\'s own device key ({device}), so it cannot give itself a spending limit. Use your own wallet (the one holding your tDVPN), not the VPN service\'s key file. Nothing was signed.', { device });
}

export interface SetupPlan {
  ixs: TransactionInstruction[];
  steps: string[];
  approveTo: string | null;
  allowance: string;
  topUpLamports: number;
  /** SOL the owner wallet needs for this setup (device top-up + rent + fees, = ownerSolForSetup). */
  ownerNeedLamports: number;
  /** How much of that the owner wallet is missing; 0 = enough (or nothing to sign). */
  ownerShortLamports: number;
}

/** What it takes to let `device` spend up to `allowance` (base units). */
export async function planDeviceSetup(owner: string, device: string, allowance: string, current?: WalletStatus): Promise<SetupPlan> {
  // The program refuses a grant to its own granter (grant.rs require_keys_neq → ParamOutOfRange 6003), which read as
  // a range error on the amount (TLX 0.1.16: wallet loaded from the device's own key file). Say what it is, sign nothing.
  if (owner === device) throw new Error(sameKeyMessage(device));
  const st = current ?? await readWalletStatus(owner, device);
  const ixs: TransactionInstruction[] = [];
  const steps: string[] = [];
  const want = BigInt(allowance);
  // LIM-2 (the agent kit rc.9, T-A 15 least privilege): the shared approval is SET to the limit, never added. It was "what is
  // still approved + the new room", so each raise stacked on what deposits had not used yet (delegated 150.005 →
  // 150.010 → 299.997 on one device). It is approved only when below the limit, and never lowered here (another
  // device of this wallet may rely on it; `device revoke` is the way down).
  let approveTo: string | null = null;
  if (BigInt(st.delegated) < want) {
    approveTo = want.toString();
    // A new wallet has no tDVPN token account, and approving on a missing account fails
    // (2026-11-11: "[object Object]" on a fresh wallet). Create it first, in the same transaction.
    if (st.ownerAta === false) {
      const ownerPk = new PublicKey(owner);
      ixs.push(createAssociatedTokenAccountIdempotentInstruction(ownerPk, ata(ownerPk), ownerPk, MINT, TOKEN_2022_PROGRAM_ID));
    }
    ixs.push(b.approveDelegate({ owner, amount: approveTo }));
    steps.push(tr('Approve the dVPN program to spend up to {approveTo} tDVPN from your wallet (shared by your devices)', { approveTo: tdvpn(approveTo) }));
  }
  if (!st.grant) {
    ixs.push(await b.openGrant({ owner, grantee: device, allowance }));
    steps.push(tr('Allow this device to pay servers for you, up to {allowance} tDVPN', { allowance: tdvpn(allowance) }));
  } else if (st.grant.allowance !== allowance || (st.grant.permissions & PERMS_CLIENT) !== PERMS_CLIENT) {
    const fixPerms = (st.grant.permissions & PERMS_CLIENT) !== PERMS_CLIENT;
    ixs.push(await b.updateGrant({ owner, grantee: device, allowance, permissions: fixPerms ? Number(BigInt(st.grant.permissions) | BigInt(PERMS_CLIENT)) : undefined }));
    steps.push(st.grant.allowance !== allowance
      ? tr('Change this device\'s spending limit from {allowance} to {allowance2} tDVPN', { allowance: tdvpn(st.grant.allowance), allowance2: tdvpn(allowance) })
      : tr('Let this device open, top up and close deposits for you'));
  }
  const topUpLamports = st.deviceLamports < DEVICE_SOL_TARGET ? DEVICE_SOL_TARGET - st.deviceLamports : 0;
  if (topUpLamports > 0) {
    ixs.push(SystemProgram.transfer({ fromPubkey: new PublicKey(owner), toPubkey: new PublicKey(device), lamports: topUpLamports }));
    steps.push(tr('Send this device {topUpLamports} SOL for network fees', { topUpLamports: sol(topUpLamports) }));
  }
  // Q0484 H2 (Mac, fresh wallet with 0.05 SOL): the plan offered "Send this device 0.05 SOL" and the
  // signed transaction failed as a bare "Not enough SOL". Same bar as the first-connect setup.
  const ownerNeedLamports = ownerSolForSetup(st.deviceLamports);
  const ownerShortLamports = ixs.length ? Math.max(0, ownerNeedLamports - st.ownerLamports) : 0;
  return { ixs, steps, approveTo, allowance, topUpLamports, ownerNeedLamports, ownerShortLamports };
}

/** The words for a setup the owner wallet cannot pay for (shared by the app and the CLI). */
export function ownerSolShortMessage(needLamports: number): string {
  return tr('Add devnet SOL to your wallet first: setting up this computer to pay servers needs about {needLamports} SOL for fees.', { needLamports: (needLamports / 1e9).toFixed(3) });
}

export async function runDeviceSetup(signer: OwnerSigner, device: string, allowance: string): Promise<{ signature: string | null; plan: SetupPlan }> {
  const plan = await planDeviceSetup(signer.publicKey.toBase58(), device, allowance);
  if (!plan.ixs.length) return { signature: null, plan };
  // Nothing is signed when the wallet cannot pay for it (the chain would refuse with "Not enough SOL").
  if (plan.ownerShortLamports > 0) throw new Error(ownerSolShortMessage(plan.ownerNeedLamports));
  const res = await signAndSend(signer, plan.ixs, 'device_setup');
  return { signature: res.signature, plan };
}

/**
 * Revoke a device. Refused only while it is using a deposit in a live session. Settling never
 * needs the grant: start_close / close / withdraw are signed by the owner and take the grant as
 * an optional account (devnet IDL cf4c372), and nodes redeem without it. So closing or idle
 * deposits still settle and refund after the device is removed (the Linux app 2026-10-22).
 */
export async function revokeDevice(signer: OwnerSigner, device: string, liveSessions: number): Promise<string> {
  if (liveSessions > 0) throw new ShownError('Disconnect first: this computer is using a deposit right now. Deposits are still refunded to your wallet after you remove the device.');
  const st = await readWalletStatus(signer.publicKey.toBase58(), device);
  if (!st.grant) throw new ShownError('This device has no spending limit to remove.');
  const res = await signAndSend(signer, [await b.closeGrant({ owner: signer.publicKey, grantee: device, rentPayer: st.grant.rentPayer })], 'close_grant');
  return res.signature;
}
