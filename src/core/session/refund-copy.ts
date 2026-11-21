// ─── What a deposit is doing, in plain words, with timing (owner 2026-11-12) ───
// "Ready to refund" with no button and no timing confused the owner. Every state says what happens
// next and when; a state the user can speed up names the button that does it.
// Timing facts: dvpnd sweeps finished deposits every 10 min (closeChannelsInterval); closing then
// waits the program's 7200 s before the refund can be withdrawn.

import { tr } from '../../shared/i18n';
export type DepositStatus = 'in-use' | 'open' | 'closing' | 'ready';

export interface RefundLine {
  text: string;
  /** The row's button, or null when nothing can speed it up. */
  action: { label: string; help: string } | null;
}

export const CLOSE_WAIT_S = 7200;
export const SWEEP_MIN = 10;

/** "1 h 40 min", "25 min", "under a minute". */
export function aboutTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return 'under a minute';
  const total = Math.ceil(s / 60); // whole minutes, rounded up: never promise sooner than real
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** `perHour`: a per-hour deposit (its clock runs while idle, so it is refunded within 10 min; per GB is kept a day). */
export function refundLine(status: DepositStatus, refundable: bigint, readyAtUnix: number | null | undefined, nowMs: number, perHour = false): RefundLine {
  const nothing = refundable <= 0n;
  switch (status) {
    case 'in-use':
      return { text: nothing ? tr('In use.') : tr('In use. What is left is refunded after you disconnect.'), action: null };
    case 'open':
      return nothing
        ? { text: tr('Fully used. Nothing to refund.'), action: null }
        : perHour
          ? {
              text: tr('Refund starts automatically within {SWEEP_MIN} min, then takes about {aboutTime}.', { SWEEP_MIN, aboutTime: aboutTime(CLOSE_WAIT_S) }),
              action: { label: tr('Refund now'), help: tr('Starts the refund now instead of in {SWEEP_MIN} min. It still takes about {aboutTime}. Your wallet signs once.', { SWEEP_MIN, aboutTime: aboutTime(CLOSE_WAIT_S) }) },
            }
          : {
              text: tr('Kept for a day so you can reconnect, then refunded automatically.'),
              action: { label: tr('Refund now'), help: tr('Starts the refund now instead of keeping it for a reconnect. It takes about {aboutTime}. Your wallet signs once.', { aboutTime: aboutTime(CLOSE_WAIT_S) }) },
            };
    case 'closing': {
      const left = readyAtUnix ? readyAtUnix - nowMs / 1000 : CLOSE_WAIT_S;
      return { text: nothing ? tr('Fully used. Nothing to refund.') : tr('Refunding. Arrives in about {aboutTime}.', { aboutTime: aboutTime(left) }), action: null };
    }
    case 'ready':
      return nothing
        ? { text: tr('Fully used. Nothing to refund.'), action: null }
        : {
            text: tr('Refund ready. Arrives automatically within {SWEEP_MIN} min.', { SWEEP_MIN }),
            action: { label: tr('Refund now'), help: tr('Sends it to your wallet now. Your wallet signs once.') },
          };
  }
}

/** Plain help for the money cards and sections, one place so every screen says the same thing. */
export const HELP = () => ({
  deposit: tr('Connecting sets a deposit aside for the server. You pay only for what you use; the rest is refunded to your wallet after you disconnect.'),
  comingBack: tr('The unused part of your deposits. A per-GB deposit is kept a day so a reconnect can use it, then refunded automatically. Details in Activity.'),
  readyToWithdraw: tr('Refunds that finished but are not in your wallet balance yet. Claim refunds moves them there.'),
  balance: 'tDVPN in your wallet, free to spend on servers. Test tokens on Solana devnet.',
  fees: tr('SOL pays the small network fee for each transaction. Keep a little here.'),
  spent: tr('What servers charged for the data or time you used.'),
  sessionSpent: tr('What this session has cost so far. Updates every minute and includes the first block, which is paid up front.'),
  serversOnline: tr('Servers that answered a check just now. Listed servers include ones that did not answer.'),
  refunds: tr('Every deposit is refunded automatically. Refund now speeds one up.'),
} as const);
