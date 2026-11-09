// ─── Plain copy for "cannot reach the VPN service" (F23: never raw errors) ───
// The raw gRPC / pipe text still goes to the log; the user sees one of these.

export function daemonLinkCopy(raw: string): string {
  if (/access is denied|permission|EACCES|EPERM/i.test(raw)) {
    return 'This app is not allowed to talk to the VPN service. Log out and back in (setup added your account to the dvpn group), or set the service up again.';
  }
  if (/deadline|timed? ?out/i.test(raw)) return 'The VPN service did not answer in time.';
  if (/ECONNREFUSED|ENOENT|UNAVAILABLE|No connection established|cannot reach|dial|not found|cannot find/i.test(raw)) {
    return 'The VPN service is not running.';
  }
  return 'The VPN service could not be reached.';
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
    return { code: 'approval-revoked', message: "This wallet's spending approval for this computer was revoked, so nothing was paid. Set it up again (device setup) from your wallet.", action: 'devnet-dvpn device setup --yes' };
  }
  if (/token-2022 error: InsufficientFunds/i.test(t)) {
    return { code: 'not-enough-tdvpn', message: "Your wallet doesn't have enough tDVPN for this deposit, so nothing was paid. Add tDVPN or pick a smaller deposit.", action: null };
  }
  if (/a session is already active/i.test(t)) {
    return { code: 'session-active', message: 'A session is already active; disconnect it first.', action: 'devnet-dvpn disconnect' };
  }
  // The service's own CLI already says it plainly before the socket path: keep that part only.
  const plain = /^(?:error:\s*)?(.+?)\s*\((?:unix:\/\/)?\/[^)]*\.sock\):\s*rpc error:/is.exec(t);
  if (plain) return { code: 'service-down', message: plain[1].replace(/\s+/g, ' ').trim(), action: null };
  if (/not ready \(starting up or stopping\)/i.test(t)) {
    return { code: 'service-not-ready', message: 'The VPN service is starting up or stopping. Try again in a moment.', action: null };
  }
  if (/code = Unavailable|\b14 UNAVAILABLE\b|No connection established|connect ECONNREFUSED|daemon\.sock[^\n]*(refused|no such file)/i.test(t)) {
    return { code: 'service-down', message: 'The VPN service is not running.', action: SERVICE_START_HINT };
  }
  return null;
}
