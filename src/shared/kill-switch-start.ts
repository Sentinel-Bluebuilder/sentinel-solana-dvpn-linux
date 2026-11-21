// ─── Kill switch on + a restart while connected (owner 2026-11-13) ───
// The block stays across a restart (nothing goes out before the VPN is back, as Mullvad lockdown / Proton's
// advanced kill switch). What was missing: the app stayed closed, so the internet was blocked with nothing on
// screen saying why. With the kill switch on the app starts at log-in, and a block found at start is shown.

/** Start at log-in when the user asked for it, and always while the kill switch is on. */
import { tr } from './i18n';
export function loginItemWanted(startWithOs: boolean, killSwitch: string | undefined): boolean {
  return startWithOs || (killSwitch !== undefined && killSwitch !== 'off');
}

export const BLOCKED_AT_START_NOTICE = (): string => tr('The kill switch is blocking the internet since your last session ended (for example, the computer restarted while connected). Open Devnet dVPN to reconnect or restore your network.');

export const START_WITH_KILL_SWITCH_HINT = (): string => tr('On while the kill switch is on, so a blocked internet after a restart is explained.');

/** How often the running app re-checks the log-in item (the kill switch can change outside the app: the CLI, another
 *  account, an Apply whose daemon-change event came before the new setting was readable). DVPN-WIN hunt t-ksrun. */
export const LOGIN_ITEM_TICK_MS = 15_000;

/** Q0575: how long after app start the held block is looked for while the VPN service has not answered yet. */
export const SERVICE_START_GRACE_MS = 8_000;
