// ─── Did money move? One sentence on every failure answer (hub docs/ENGLISH-REVIEW.md, P8) ───
// An agent that reads a failure must know at once whether a deposit is open. `money` is a field of every
// { ok:false } line and a line of the text error. The classes are the code's true state: 'none' = refused before
// anything was paid; 'open' = the failure can come after the deposit step, so a deposit may be open; 'unclear' =
// the code does not say; 'refund' = a refund step failed (the money is still held, nothing new was spent).
import { PREFLIGHT_CODES } from '../core/session/state';

const CLI = process.env.DVPN_CLI_NAME || 'devnet-dvpn';

export type Money = 'none' | 'open' | 'unclear' | 'refund';

/** W-A1 (the agent kit rc.8, T-A money audit ta2-c1): a value the command could not read is refused before anything is built or
 *  signed. `device plan/setup --allowance 0.0000001 | -1 | abc` answered invalid-amount with "It is not known whether
 *  the transaction went through"; every parse/usage-class code is 'none' for every command. */
export const PARSE_CODES: readonly string[] = ['invalid-amount', 'invalid-address', 'usage'];

const NONE: readonly string[] = [
  ...PREFLIGHT_CODES,
  ...PARSE_CODES,
  'insufficient-funds', 'bad-recipient', 'low-sol-after', 'allowance-above-balance', // W-A2/W-A3 rc.8: refused before signing
  'price-cap', // S7 rc.6: agent up refuses a deposit above the default cap before paying
  // refused before anything starts (connect-checks, the daemon link, the wallet)
  // R2 (the agent kit rc.7): commands that sign nothing on failure (device, daemon, nodes, plans, settings, test, key store)
  'device-home-gone', 'no-plan', 'driver-repair-failed', 'no-device-key', 'migrate-failed', 'device-not-ready',
  'install-failed', 'daemon-settings-empty', 'daemon-settings-unreadable', 'dns-no-answer', 'uninstall-failed', 'checks-off', 'test-plan-failed',
  'no-test-run', 'keystore-unavailable', 'keyfile-read-only', 'keyfile-unreadable', 'needs-admin', 'device-key-unreadable', 'setting-rejected', 'keyfile-lock-failed', // AUD-2 M12; WIN-W1
  'not-confirmed', 'no-wallet', 'keyfile-missing', 'keyfile-mode', 'wallet-switch-needed', 'clock-skew', 'no-device', 'device-permission',
  'plan-limit', 'busy', 'test-running', 'unsupported', 'daemon-missing', 'daemon-relogin', 'daemon-restarting',
  'daemon-unavailable', 'network-mismatch', 'kill-switch-held', 'switch-reconnecting', 'kill-switch-remote', // rc9-e: refused before any change
  // refused before paying (connection.ts reads the price and the open deposits first)
  'price-changed', 'deposit-unusable', 'deposits-unread',
  // agent-cmd's own checks and the shared service copy
  'no-nodes', 'not-funded', 'no-subscription', 'service-down', 'service-not-ready',
  // L-RPC (the agent kit rc.8): the service's own preflight to its RPC failed ("waiting for network: preflight failed: rpc").
  'waiting-for-network',
  // TX-LAND (rc9-f2): the transaction expired and the chain never took it
  'tx-not-landed',
];

const OPEN: readonly string[] = [
  // after the start was asked of the service
  'cancelled', 'switch-offline', 'ticket-other-owner', 'approval-revoked', 'service-stopped-connecting',
  'node-identity', 'node-ledger', 'node-price', 'node-error', 'kill-switch-failed',
  'tunnel-failed', 'tunnel-dead', 'tunnel-mtu', 'tunnel-closing', 'port-in-use', 'dns-apply', 'protocol-missing',
  'deposit-pending', 'rpc-network', 'rpc-timeout', 'rpc-quota', 'timeout', 'chain-encoding',
  // a node's own refusal (it comes after the deposit)
  'credit_exhausted', 'peer_limit_reached', 'lease_insufficient', 'subscription_invalid', 'ticket_request_stale',
  'provider_unreachable', 'ticket_invalid', 'unauthorized', 'cannot cover the prepay', 'voucher_exceeds_escrow',
  'channel_node_reopened', 'terms_rejected', 'rate_limited', 'voucher_signature_invalid', 'mode_not_voucher', 'mode_not_stream',
  // leaving, and the two answers of this CLI after a deposit
  'stop-failed', 'dns-revert-failed', 'tunnel-left', 'node-refused', 'server-stopped',
];

const UNCLEAR: readonly string[] = ['unknown', 'connect-failed', 'rpc-busy', 'rpc-unavailable', 'rpc-ws', 'tx-unknown']; // tx-unknown: TX-LAND rc9-f2

const REFUND: readonly string[] = ['settle-failed', 'daemon-gone']; // daemon-gone: the service stopped mid-refund (review #3, rc.6)

/** The class of a failure code. A code nobody classified is 'unclear' (never "nothing was paid"). */
export function moneyOf(code: string | null | undefined): Money {
  if (!code) return 'unclear';
  if (NONE.includes(code)) return 'none';
  if (OPEN.includes(code)) return 'open';
  if (REFUND.includes(code)) return 'refund';
  return 'unclear';
}

const WORDS: Record<Money, string> = {
  none: 'Nothing was paid.',
  open: `A deposit may be open: ${CLI} agent down --yes closes it and refunds the unused part.`,
  unclear: `It is not known whether a deposit was opened: ${CLI} agent status lists it, and ${CLI} agent down --yes closes any that is open.`,
  refund: `No new money was spent. The unused part of a deposit is still held: ${CLI} settle run --yes returns it.`,
};

/** The sentence for a failure code. A transfer command (wallet send, device setup, settle) opens no deposit, so its
 *  words name the transfer, not a deposit (R2, the agent kit rc.7: "a deposit may be open" after a failed wallet send misled). */
export const TRANSFER_COMMANDS: readonly string[] = ['wallet', 'device', 'settle'];
const TRANSFER_WORDS: Record<Money, string> = {
  none: 'Nothing was sent or signed.',
  open: `It is not known whether the transaction went through: ${CLI} wallet show --json reads the balances before you try again.`,
  unclear: `It is not known whether the transaction went through: ${CLI} wallet show --json reads the balances before you try again.`,
  refund: WORDS.refund,
};
export function moneyNote(code: string | null | undefined, command?: string): string {
  return (command && TRANSFER_COMMANDS.includes(command) ? TRANSFER_WORDS : WORDS)[moneyOf(code)];
}

/** The words, by class (the doc quotes them; a test compares). */
export const MONEY_WORDS: Readonly<Record<Money, string>> = WORDS;

/** Codes the table classifies, for the doc test. */
export const MONEY_CODES: readonly string[] = [...NONE, ...OPEN, ...UNCLEAR, ...REFUND];
