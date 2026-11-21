// ─── rc.4 E-55: is a connect a wallet switch? ───
// Shared (no JSX, in both tsconfigs) so the Connect dialog and the unit tests use the same rule.
import type { AppSnapshot } from './types';

/**
 * This computer is set up for another wallet than the one loaded. A connect then answers
 * 'wallet-switch-needed' and writes nothing unless it carries confirmWalletSwitch, so the dialog asks first.
 * Returns the wallet the computer is set up for, or null when no switch is needed.
 */
export function walletSwitchFrom(snap: Pick<AppSnapshot, 'owner' | 'deviceOwner'>): string | null {
  return snap.owner && snap.deviceOwner && snap.deviceOwner !== snap.owner ? snap.deviceOwner : null;
}
