// ─── One plain error line (text) or one { ok:false } object (--json), for every way a command fails ───
// index.ts used it only inside the command's try. E-66 (macOS rc.3): `status` over SSH with the login Keychain locked
// printed "fatal: <stack>" because the key store threw outside it (the daemon link start, or a promise nobody awaited).
// The same formatting now covers those paths too.
import { log, redact } from '../main/logger';
import { daemonErrorCopy } from '../core/daemon/link-copy';
import { rpcUnavailableCopy } from '../core/chain/rpc';
import { cliActionHint, cliMessage, commandNext } from './action-hint';
import { moneyNote, TRANSFER_COMMANDS } from './money-note';
import { docUrlFor, CLI_NAME } from './cli-fail';

/** rc.8 (the agent kit T-A 14, T-C 18): a usage error (exit 3) with --json was plain text on stderr, so an agent parsing stdout
 *  got nothing. With --json it is one { ok:false, code:'usage' } object on stdout; text mode is unchanged. A usage
 *  error is found before anything runs, so nothing was ever sent or signed. Pure; unit-tested. */
export function usageOutput(message: string, json: boolean, usage: string | null): { stream: 'stdout' | 'stderr'; text: string } {
  if (!json) return { stream: 'stderr', text: `${message}\n` };
  const next = `${CLI_NAME} help`;
  return { stream: 'stdout', text: JSON.stringify({ ok: false, error: message, code: 'usage', usage, action: next, next, docUrl: docUrlFor('usage'), money: 'Nothing was sent or signed.' }) + '\n' };
}

/** The service / RPC raw text replaced by the plain copy, as the command path always did. */
export function plainError(err: unknown, command: string): Error & { code?: string; action?: string | null } {
  let e = err instanceof Error ? err : new Error(String(err));
  const dc = daemonErrorCopy(e.message);
  if (dc) {
    log.warn('cli command failed in the VPN service', { command, err: e.message });
    e = Object.assign(new Error(dc.message), { code: dc.code, action: dc.action });
  }
  const rpc = dc ? null : rpcUnavailableCopy(e);
  if (rpc) {
    log.warn('cli command failed on every RPC endpoint', { command, err: e.message });
    e = Object.assign(new Error(rpc.message), { code: 'rpc-unavailable', action: rpc.action });
  }
  return e as Error & { code?: string; action?: string | null };
}

/** Commands that can pay: their failure says whether money moved (P8). Others (`status`, `nodes list`…) never pay. */
export const MONEY_COMMANDS: readonly string[] = ['agent', 'connect', 'switch', 'test', ...TRANSFER_COMMANDS]; // R2: transfers say whether money moved too

/** What to write: stdout for --json, stderr for text. Never a stack. */
export function errorOutput(err: unknown, json: boolean, command: string): { stream: 'stdout' | 'stderr'; text: string; code: string | null } {
  const e = plainError(err, command);
  const money = MONEY_COMMANDS.includes(command) ? moneyNote(e.code, command) : null;
  if (json) return { stream: 'stdout', code: e.code ?? null, text: JSON.stringify({ ok: false, error: redact(cliMessage(e.message)), code: e.code ?? null, action: e.action ?? null, next: commandNext(e.action, e.message), ...((e as { alsoNext?: unknown }).alsoNext ? { alsoNext: (e as { alsoNext?: unknown }).alsoNext } : {}), ...(e.code ? { docUrl: docUrlFor(e.code) } : {}), ...(money ? { money } : {}) }) + '\n' };
  // Q0430 (the Linux app TLX 0.1.12): the action is the app's button label; on the command line, name the command to type.
  const hint = cliActionHint(e.action, e.message);
  return { stream: 'stderr', code: e.code ?? null, text: `Error: ${redact(cliMessage(e.message))}${money ? `\nMoney: ${money}` : ''}${hint ? `\n→ ${hint}` : ''}\n` };
}
