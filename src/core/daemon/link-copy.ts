// ─── Plain copy for "cannot reach the VPN service" (F23: never raw errors) ───
// The raw gRPC / pipe text still goes to the log; the user sees one of these.

// Every sentence comes from the one table in service-state.ts (UI pass rows 119-142): the raw text only
// decides the kind of link failure, the facts decide the state, the state has one sentence.
import { linkFault, OS_STATE_UNKNOWN, serviceView, serviceViewFor, type OsServiceState } from './service-state';
import { tr } from '../../shared/i18n';

/** The service runs but refuses this account (its pipe is open to the sentinel-dvpn group and to accounts granted
 *  directly). One administrator step fixes it (grant-pipe.ps1); no sign-out (owner 2026-11-12). */
export const RELOGIN_COPY = serviceView('no-permission').sentence;

/** The sentence for a failed link attempt. Without OS facts (a caller that cannot ask) a missing pipe reads as
 *  "off" and a refusal as "not allowed yet"; main/daemon/manager.ts passes what the OS says. */
export function daemonLinkCopy(raw: string, os: OsServiceState = OS_STATE_UNKNOWN, startedAgoMs: number | null = null): string {
  return serviceViewFor({
    answered: false, networkOk: null, transition: false,
    installed: os.installed, running: os.running, startPending: os.startPending,
    link: linkFault(raw), startedAgoMs,
  }).sentence;
}

// ─── Plain copy for a daemon call that failed (Q0433, Q0453) ───
// TLX2 on final3 131d3a2: the service stopped mid-command, a second start, or a revoked spending approval
// came through as raw gRPC text ("rpc error: code = Unavailable desc = …", "token-2022 error: OwnerMismatch").
export const SERVICE_START_HINT = 'devnet-dvpn daemon install --yes';

export interface DaemonCopy { code: string; message: string; action: string | null }

export function daemonErrorCopy(raw: string): DaemonCopy | null {
  const t = String(raw ?? '');
  // A spending approval the owner revoked: the device signs an open whose delegate is gone.
  if (/OwnerMismatch|owner does not match/i.test(t)) {
    return { code: 'approval-revoked', message: tr('This wallet\'s spending approval for this computer was revoked, so nothing was paid. Set it up again (device setup) from your wallet.'), action: 'devnet-dvpn device setup --yes' };
  }
  if (/token-2022 error: InsufficientFunds/i.test(t)) {
    return { code: 'not-enough-tdvpn', message: tr('Your wallet doesn\'t have enough tDVPN for this deposit, so nothing was paid. Add tDVPN or pick a smaller deposit.'), action: null };
  }
  if (/a session is already active/i.test(t)) {
    // K13 (rc9-c2): the action is an agent's `next` too (cli/error-out.ts plainError): another run holds this
    // session, so look, never end it (agent-cmd.ts SWEEP1_NEXT['session-active']). A person still has Disconnect.
    return { code: 'session-active', message: tr('A session is already active; disconnect it first.'), action: 'devnet-dvpn agent status --json' };
  }
  // The service's own CLI already says it plainly before the socket path: keep that part only.
  const plain = /^(?:error:\s*)?(.+?)\s*\((?:unix:\/\/)?\/[^)]*\.sock\):\s*rpc error:/is.exec(t);
  if (plain) return { code: 'service-down', message: plain[1].replace(/\s+/g, ' ').trim(), action: null };
  if (/not ready \(starting up or stopping\)/i.test(t)) {
    return { code: 'service-not-ready', message: tr('The VPN service is starting up or stopping. Try again in a moment.'), action: null };
  }
  if (/code = Unavailable|\b14 UNAVAILABLE\b|No connection established|connect ECONNREFUSED|daemon\.sock[^\n]*(refused|no such file)/i.test(t)) {
    // L-31: the old "is not running" sentence (owner: gone everywhere). The service-state table's word for it is "off".
    return { code: 'service-down', message: tr('The VPN service is off.'), action: SERVICE_START_HINT };
  }
  return null;
}

/** Q0520: the service is restarting (an Apply, a crash restart): said instead of 'not answering' or 'sign out'. */
export const RESTARTING_COPY = serviceView('restarting').sentence;
