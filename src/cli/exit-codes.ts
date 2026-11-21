// ─── Exit codes by failure class (S4, the agent kit rc.6) ───
// An agent branches on the exit code before it reads any text. 0 ok · 1 error (anything not below) · 2 needs --yes ·
// 3 wrong usage · 4 needs you or your operator (money or a wallet) · 5 refused for safety (kill switch) ·
// 6 network or RPC with no deposit possibly open: retry later. The `code` field in --json stays the precise reason.
// review (rc.6 review): a network code after which a deposit MAY be open (money class `open`, e.g. rpc-timeout
// during a connect) stays exit 1, so "retry later" never hides an open deposit; read `money` for that case.
import { moneyOf } from './money-note';

/** AUD-2 M3: the commands that can open a deposit (their failures carry the deposit money words). */
export const PAYING_COMMANDS: readonly string[] = ['agent', 'connect', 'switch', 'test'];

export const EXIT = { ok: 0, error: 1, needsYes: 2, usage: 3, needsHuman: 4, safety: 5, network: 6 } as const;

const NEEDS_HUMAN: readonly string[] = ['insufficient-funds', 'allowance-above-balance', 'not-funded', 'spending-limit', 'price-cap', 'no-wallet', 'keyfile-missing', 'keyfile-mode', 'clock-skew', 'keyfile-unreadable', 'needs-admin'];
const SAFETY: readonly string[] = ['bad-recipient', 'low-sol-after', 'kill-switch', 'kill-switch-held', 'kill-switch-failed', 'kill-switch-remote'];
const NETWORK: readonly string[] = ['rpc-busy', 'rpc-timeout', 'rpc-quota', 'rpc-network', 'rpc-ws', 'rpc-unavailable', 'timeout', 'waiting-for-network'];

/** The exit code for a failure's `code` (1 when the code is missing or in no class). */
// AUD-2 M3: on a command that can pay, an 'unclear' rpc code (the money line: "not known whether a deposit was
// opened") is exit 1, not 6 ("no deposit possibly open"). Without `paying` (other commands) it stays 6.
export function exitCodeFor(code: string | null | undefined, paying = false): number {
  if (!code) return EXIT.error;
  if (NEEDS_HUMAN.includes(code)) return EXIT.needsHuman;
  if (SAFETY.includes(code)) return EXIT.safety;
  if (NETWORK.includes(code) && moneyOf(code) !== 'open' && !(paying && moneyOf(code) === 'unclear')) return EXIT.network;
  return EXIT.error;
}
