// ─── wallet send: refuse before the preview (W-A2, the agent kit rc.8, T-A money audit ta2-c1) ───
// The preview asked for --yes on a send that could not work or would strand the wallet: more than the balance, to the
// system program / this app's program / the tDVPN mint (funds there are gone), or a SOL send that leaves too little to
// pay fees. These are refused with ok:false BEFORE needsConfirm. Sending to yourself or to your own device is allowed
// with a note. Pure: the caller passes the balances and the addresses; unit-tested.

/** One Solana signature (the base fee of a one-signer transfer). */
export const BASE_FEE_LAMPORTS = 5000n;
/** Below this the wallet cannot pay the fees of a connect, a settle or a withdraw. */
export const MIN_SOL_AFTER_LAMPORTS = 10_000_000n; // 0.01 SOL
export const SYSTEM_PROGRAM = '11111111111111111111111111111111';

export interface SendCheckInput {
  to: string;
  tdvpnBase: bigint;
  lamports: bigint;
  owner: string;
  ownerLamports: bigint;
  ownerTdvpnBase: bigint;
  device: string | null;
  programId: string;
  mint: string;
  allowEmpty: boolean;
  /** A22: lamports the sender pays to create the recipient's tDVPN account (0 or absent when it exists). Counted
   *  only for a tDVPN send (recipientTokenRent in main/services/wallet.ts). */
  recipientRentLamports?: bigint;
}

export type SendCheck =
  | { ok: false; code: 'insufficient-funds' | 'bad-recipient' | 'low-sol-after'; message: string }
  | { ok: true; feeLamports: string; rentLamports: string; balanceAfter: { lamports: string; tdvpnBase: string }; notes: string[] };

const SOL = (l: bigint): string => {
  const w = l / 1_000_000_000n;
  const f = (l % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return `${w}${f ? `.${f}` : ''}`;
};
const TD = (b: bigint): string => {
  const w = b / 1_000_000n;
  const f = (b % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${w}${f ? `.${f}` : ''}`;
};

/** The refusal for a recipient that is not a wallet (free: no balance read). Null when it is fine. */
export function badRecipient(to: string, programId: string, mint: string): string | null {
  const what = to === SYSTEM_PROGRAM ? "the Solana system program" : to === programId ? "this app's on-chain program" : to === mint ? "the tDVPN mint" : null;
  return what ? `${to} is ${what}, not a wallet: anything sent there is lost. Nothing was sent or signed.` : null;
}

export function sendCheck(i: SendCheckInput): SendCheck {
  const bad = badRecipient(i.to, i.programId, i.mint);
  if (bad) return { ok: false, code: 'bad-recipient', message: bad };
  const fee = BASE_FEE_LAMPORTS;
  // A22: a tDVPN send to a wallet with no tDVPN account creates it, and the sender pays its rent.
  const rent = i.tdvpnBase > 0n && (i.recipientRentLamports ?? 0n) > 0n ? (i.recipientRentLamports as bigint) : 0n;
  const cost = fee + rent;
  const costWords = rent > 0n ? "the send, its fee and the recipient's token account rent need" : 'the send and its fee need';
  if (i.tdvpnBase > i.ownerTdvpnBase) return { ok: false, code: 'insufficient-funds', message: `This wallet holds ${TD(i.ownerTdvpnBase)} tDVPN; the send asks for ${TD(i.tdvpnBase)}. Nothing was sent or signed.` };
  if (i.lamports + cost > i.ownerLamports) return { ok: false, code: 'insufficient-funds', message: `This wallet holds ${SOL(i.ownerLamports)} SOL; ${costWords} ${SOL(i.lamports + cost)}. Nothing was sent or signed.` };
  const after = i.ownerLamports - i.lamports - cost;
  // A tDVPN-only send moves SOL only by the fee, unless it pays the recipient's account rent (A22).
  if ((i.lamports > 0n || rent > 0n) && after < MIN_SOL_AFTER_LAMPORTS && !i.allowEmpty) {
    return { ok: false, code: 'low-sol-after', message: `This send leaves ${SOL(after)} SOL, less than the ${SOL(MIN_SOL_AFTER_LAMPORTS)} SOL the wallet needs for fees. Send less, or add --allow-empty to empty it. Nothing was sent or signed.` };
  }
  const notes: string[] = [];
  if (rent > 0n) notes.push(`This creates the recipient's tDVPN token account (rent ${SOL(rent)} SOL, paid by you).`);
  if (i.to === i.owner) notes.push('This is your own address: only the fee moves.');
  if (i.device && i.to === i.device) notes.push("This is this computer's device: its SOL pays the fees of your VPN sessions.");
  return { ok: true, feeLamports: fee.toString(), rentLamports: rent.toString(), balanceAfter: { lamports: after.toString(), tdvpnBase: (i.ownerTdvpnBase - i.tdvpnBase).toString() }, notes };
}

// ─── device plan / setup --allowance (W-A3, the agent kit rc.8, T-A money audit ta2-c1) ───
/** An allowance above the wallet's tDVPN is refused (exit 4) unless --force; 0 is allowed with a warning. Pure. */
export function allowanceCheck(allowanceBase: bigint, ownerTdvpnBase: bigint | null, force: boolean): { ok: false; code: 'allowance-above-balance'; message: string } | { ok: true; warning: string | null } {
  if (allowanceBase === 0n) return { ok: true, warning: 'An allowance of 0 blocks every deposit: this device cannot pay for any VPN session.' };
  if (ownerTdvpnBase !== null && allowanceBase > ownerTdvpnBase && !force) {
    return { ok: false, code: 'allowance-above-balance', message: `The allowance ${TD(allowanceBase)} tDVPN is above this wallet's ${TD(ownerTdvpnBase)} tDVPN. Use a lower --allowance, or add --force. Nothing was sent or signed.` };
  }
  return { ok: true, warning: null };
}
