// ─── CLI next-step hint ───
// Errors carry the app's button label as `action` ("Open diagnostics"). On the command line there is
// nothing to open (TLX, Q0430 proof on 0.1.12), so the text output names the command to type instead.
// JSON output keeps the label unchanged for scripts that already read it.

const SCREEN_TO_COMMAND: Record<string, string> = {
  'Open diagnostics': 'devnet-dvpn daemon doctor',
  'Open settings': 'devnet-dvpn daemon settings',
  'Open Wallet': 'devnet-dvpn wallet show',
  'Restore network': 'devnet-dvpn daemon restore-network',
  // rc9-f2 B41: the app's button for session-active (state.ts). On the command line the live session may be
  // another run's (often a second agent up started at once): look first, never end it on this answer.
  Disconnect: 'devnet-dvpn agent status --json',
};

/** DVPN-WIN q0563f: the error text names the app's Restore network button; on the command line, name the command. */
export function cliMessage(message: string): string {
  return message
    // E-4: 'kill-switch-held' starts its sentence with "Press Restore network" (state.ts): the capital form too.
    .replace(/\b([Pp])ress Restore network\b/g, (_m, p: string) => `${p === 'P' ? 'Run' : 'run'} devnet-dvpn daemon restore-network`)
    // WIN-W10 (the agent kit rc.9): the service-state sentences (service-state.ts 'not-installed' / 'stopped') name the command.
    .replace(/\bPress Start the VPN service to turn it back on\./g, 'Run devnet-dvpn daemon install --yes (administrator once) to start it.')
    .replace(/\bPress Install the VPN service to set it up\./g, 'Run devnet-dvpn daemon install --yes (administrator once) to set it up.')
    // P8 S-1: the engine sentences name app screens; on the command line they name the command.
    .replace(/\bRaise (?:it|the limit|the spending limit) in Wallet(?: → Device)?(?: to at least ([\d.]+) tDVPN)?/g, (_m, n: string | undefined) => `Raise it: run devnet-dvpn device setup --allowance ${n ?? '<N>'} --yes`)
    .replace(/\bTop it up in Wallet( → Device)?/g, 'Top it up: run devnet-dvpn device setup --yes')
    .replace(/\bset a spending limit in Wallet\b/g, 'run devnet-dvpn device setup --allowance <N> --yes')
    .replace(/\bTurn on "Set up payments on first connect" in Settings, or /g, 'Run devnet-dvpn device setup --yes, or ')
    .replace(/\bYour spending approval\b/g, 'Your spending limit').replace(/\bspending approval\b/g, 'spending limit')
    // One term per idea: a computer that sells traffic is a node.
    .replace(/(?<!DNS )\bservers\b/g, 'nodes').replace(/(?<!DNS )\bserver\b/g, 'node').replace(/\bServers\b/g, 'Nodes').replace(/\bServer\b/g, 'Node'); // AUD-2 M2: a DNS server stays one
}

/** E-1: the spending approval or device limit is below the deposit (core/pricing/cost.ts fundingBlocker). */
export const RAISE_LIMIT_HINT = 'devnet-dvpn device setup --allowance <N> --yes (N = grant.allowance from "devnet-dvpn device show --json" divided by 1000000, plus the deposit, in tDVPN), then connect again';
const LIMIT_SHORT = /spending approval is lower than this deposit|spending limit is lower than this deposit/;

/** True when the error is the approval / limit shortfall (by text, or code 'spending-limit'). */
export function isLimitShort(message: string, code?: string | null): boolean {
  return code === 'spending-limit' || LIMIT_SHORT.test(message);
}

/** The hint line for an error's action, or null for none. */
export function cliActionHint(action: string | null | undefined, message: string): string | null {
  // Its app action is "Open Wallet" (a screen): the terminal fix is one command.
  if (LIMIT_SHORT.test(message)) return RAISE_LIMIT_HINT;
  if (!action) return null;
  // A missing driver names its own fix: the one command that installs it.
  if (/Repair drivers/.test(message)) return 'devnet-dvpn daemon repair-drivers --yes';
  return screenCommand(action) ?? action;
}

/** AUD-2 M1: the app label as a command; case-insensitive ('Open Diagnostics' too); 'Retry' reads the state. */
function screenCommand(action: string): string | null {
  const k = Object.keys(SCREEN_TO_COMMAND).find((x) => x.toLowerCase() === action.toLowerCase());
  if (k) return SCREEN_TO_COMMAND[k];
  return /^retry$/i.test(action) ? 'devnet-dvpn agent status --json' : null;
}

/** AUD-2 M1: the --json `next` for an error: a command, never a button label (`action` keeps the label). Pure. */
export function commandNext(action: string | null | undefined, message: string): string | null {
  if (!action) return null;
  if (/Repair drivers/.test(message)) return 'devnet-dvpn daemon repair-drivers --yes';
  return screenCommand(action) ?? action;
}
