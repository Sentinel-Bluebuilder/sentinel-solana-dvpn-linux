// ─── Words for a VPN service settings copy that cannot be used (Q0544), shared by the CLI and every screen ───
// DVPN-LINUX Q0544 UI arm: the Kill switch and Settings pages said "Install the service first" on an installed
// service whose copy was empty; the CLI already said what it is. One string, so both say the same.

import { tr } from './i18n';
export const EMPTY_SETTINGS_COPY = 'The copy of the VPN service settings this app reads is empty (the computer stopped while it was being written). Run Install service (Settings) or `devnet-dvpn daemon install` to rewrite it; the service\'s own settings are unchanged.';

/** The banner when the service settings can't be shown: an empty copy says so; otherwise not installed yet. */
export function unreadableSettingsCopy(empty: boolean | undefined): string {
  return empty ? EMPTY_SETTINGS_COPY : tr('The VPN service settings can\'t be read yet. Install the service first.');
}
