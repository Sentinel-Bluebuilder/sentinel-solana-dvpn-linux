// ─── CLI next-step hint ───
// Errors carry the app's button label as `action` ("Open diagnostics"). On the command line there is
// nothing to open (TLX, Q0430 proof on 0.1.12), so the text output names the command to type instead.
// JSON output keeps the label unchanged for scripts that already read it.

const SCREEN_TO_COMMAND: Record<string, string> = {
  'Open diagnostics': 'devnet-dvpn daemon doctor',
  'Open settings': 'devnet-dvpn daemon settings',
  'Open Wallet': 'devnet-dvpn wallet show',
};

/** The hint line for an error's action, or null for none. */
export function cliActionHint(action: string | null | undefined, message: string): string | null {
  if (!action) return null;
  // A missing driver names its own fix: the one command that installs it.
  if (/Repair drivers/.test(message)) return 'devnet-dvpn daemon repair-drivers --yes';
  return SCREEN_TO_COMMAND[action] ?? action;
}
