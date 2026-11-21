// ─── cliErr: one coded failure for every CLI command (the agent kit R2) ───
// A bare `throw new Error(…)` reached an agent as `code: null, action: null`, exit 1 (ERROR-MAP: 24 sites on the
// agent path). Every failure now carries a code (exit + money class by code) and the one command to run next.
// No imports: keystore.ts and the command files all use it without a cycle.

/** How the agent runs this CLI (as agent-cmd.ts). */
export const CLI_NAME = process.env.DVPN_CLI_NAME || 'devnet-dvpn';

/** An Error that errorOutput prints as { ok:false, error: message, code, action: next, next }. */
export function cliErr(code: string, next: string | null, message: string): Error & { code: string; action: string | null } {
  return Object.assign(new Error(message), { code, action: next });
}

/** R2: the next step after device setup: the service when it is not running, else the connect. Pure; unit-tested. */
/** LIM-4 (the agent kit rc.9): `upFlags` (e.g. " --max-price 0.01") are the agent's own, carried into the agent up line. */
export function deviceNext(service: string | undefined | null, upFlags = ''): string {
  return service === 'no-service' || service === 'no-right' || service === 'failed'
    ? `${CLI_NAME} daemon install --yes`
    : `${CLI_NAME} agent up${upFlags} --yes`;
}

/** P-N (the agent kit rc.8, Windows R4): `device setup` before the service holds a device key. ONE command: `agent up --yes`
 *  creates the key and sets the device up itself when the service is installed; without the service, install it.
 *  Pure; unit-tested. */
export function noDeviceKeyNext(serviceReachable: boolean): string {
  // AUD-1 (the agent kit rc.9 final audit): without a service the next was `daemon install`, which refuses an unset-up device
  // (device-not-ready -> device setup -> no-device-key: a loop). `daemon init` makes the key, no administrator needed.
  return serviceReachable ? `${CLI_NAME} agent up --yes` : `${CLI_NAME} daemon init --yes, then ${CLI_NAME} device setup --yes`;
}

/** AUD-1: after `daemon init` (the key exists, nothing signed yet). */
export const INIT_NEXT = `${CLI_NAME} device setup --yes`;

/** AUD-1: `daemon install` before the device is set up: init first when this computer has no device key. Pure. */
export function installNotReadyNext(hasDeviceKey: boolean): string {
  return hasDeviceKey
    ? `${CLI_NAME} device setup --yes, then ${CLI_NAME} daemon install --yes`
    : `${CLI_NAME} daemon init --yes, then ${CLI_NAME} device setup --yes, then ${CLI_NAME} daemon install --yes`;
}

/** R2 (S5): the public row that explains a code (docs/CODES.md, one anchor per code, checked by check-glossary). */
export const CODES_URL = 'https://github.com/Sentinel-Bluebuilder/agentic-privacy-solana-devnet/blob/main/docs/CODES.md';
export function docUrlFor(code: string): string {
  return `${CODES_URL}#code-${code.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')}`;
}

/** RESTORE-DEAD-NEXT (the agent kit rc.9): `daemon restore-network` when the service does not answer. A kill switch kept by a
 *  dead service is lifted only once it runs again (Windows WFP filters stay with "On" = persist), so the next starts
 *  it, then restores again. Pure; exported for tests. */
export const restoreDeadNext = (platform: string = process.platform): string => platform === 'win32'
  ? `Start-Service 'sentinel-dvpnd$c0' in an administrator PowerShell, then ${CLI_NAME} daemon restore-network`
  : platform === 'linux'
    ? `sudo systemctl restart sentinel-dvpnd@c0, then ${CLI_NAME} daemon restore-network`
    : `${CLI_NAME} daemon doctor --json`;
