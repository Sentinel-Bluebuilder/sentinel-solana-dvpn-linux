// ─── Setup gate: when the setup screen may take the whole window ───
import { tr } from '../../shared/i18n';
export type SetupStep = 'wallet' | 'device' | 'permission' | 'service' | 'done';

/** The device pays its own transaction fees; below this it cannot start a session. */
export const DEVICE_MIN_LAMPORTS = 5_000_000;

/** Why the wallet is not ready, so the words match the fix. Only device SOL short is common after
 *  setup: test deposits eat it as rent (ddv-win-a 2026-10-22: 0.0043 SOL said "permission"). */
export function notReadyReason(w: { grant: unknown; delegated: string; deviceLamports: number } | null | undefined): 'permission' | 'device-sol' {
  if (!w || !w.grant || BigInt(w.delegated || '0') === 0n) return 'permission';
  return w.deviceLamports < DEVICE_MIN_LAMPORTS ? 'device-sol' : 'permission';
}

/** The device SOL a first-connect setup fills up to (= DEVICE_SOL_TARGET in core/app/device-setup). */
export const SETUP_DEVICE_SOL_TARGET = 50_000_000;
/** Owner SOL for rent (token account, grant) and fees on top of the device top-up. */
export const SETUP_OWNER_EXTRA = 10_000_000;

/** Owner SOL needed to set this device up at first connect. Renderer-safe (no chain imports). */
export function ownerSolForSetup(deviceLamports: number): number {
  return Math.max(0, SETUP_DEVICE_SOL_TARGET - deviceLamports) + SETUP_OWNER_EXTRA;
}

const sol = (lamports: number): string => (lamports / 1e9).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');

/** One line for a device short of fee SOL: what it has, what it needs. */
export function deviceSolCopy(lamports: number): string {
  return tr('This device needs a little SOL for transaction fees (has {lamports}, needs {DEVICE_MIN_LAMPORTS}).', { lamports: sol(lamports), DEVICE_MIN_LAMPORTS: sol(DEVICE_MIN_LAMPORTS) });
}

/** Once someone is set up, a step that goes missing later (the service stops answering for a
 *  moment, a balance read fails) must not swap the whole window for setup: the menu, the session
 *  and Disconnect would vanish mid-session (VM ddv-win-a 2026-10-22, WireGuard split run). Setup
 *  takes the window only on first use and after logout; otherwise the main layout shows a banner.
 *  A device already registered on chain counts as set up, so a slow service start at launch shows
 *  the banner too, not "Install service".
 *  deviceUnknown: the service is not answering AND the wallet has not been read yet, so "no device"
 *  only means "not read yet". Right after an app restart that showed "Create this device's key" to
 *  a set-up user; the banner says the device could not be read yet instead. */
/**
 * deviceUnknown for showSetupScreen: the service is not answering and the wallet has not been read
 * yet, after an app restart (Q0330). Not during setup in this run (Q0386): right after "Create a new
 * wallet" on a fresh install the service is still starting and the wallet is not read yet, and taking
 * that as "unknown" swapped the setup screen for the main layout.
 */
export function deviceUnread(daemonReachable: boolean, walletRead: boolean, setupThisRun: boolean): boolean {
  return !setupThisRun && !daemonReachable && !walletRead;
}

export function showSetupScreen(step: SetupStep, setupSeen: boolean, deviceOnChain: boolean, deviceUnknown = false): boolean {
  if (step === 'done') return false;
  if (step === 'wallet') return true;
  // Owner 2026-11-11: the spending permission is never a setup step. The app signs it in the
  // background (setting autoDevicePermission); until then the main layout shows a banner.
  if (step === 'permission') return false;
  if (setupSeen) return false;
  if (step === 'device' && deviceUnknown) return false;
  return !(step === 'service' && deviceOnChain);
}

/** The banner for a step lost after setup: what is wrong and where to fix it. */
export function lostSetupCopy(
  step: SetupStep,
  w?: { grant: unknown; delegated: string; deviceLamports: number } | null,
  auto?: { state: string; error?: string } | null,
): { text: string; screen: 'diagnostics' | 'wallet' | 'settings' } | null {
  // Q0576 (owner laptop 0.3.0-rc.2): 'keeps retrying' read as 'wait'; a stopped service never comes back by waiting. Say what to press.
  if (step === 'service') return { text: tr('The VPN service is off, so you cannot connect. Press Start the VPN service to turn it back on.'), screen: 'diagnostics' };
  if (step === 'permission' && w && notReadyReason(w) === 'device-sol') return { text: `${deviceSolCopy(w.deviceLamports)} ${tr('Top it up in Wallet.')}`, screen: 'wallet' } /* two whole sentences side by side */;
  if (step === 'permission' && auto?.state === 'running') return { text: tr('Setting up this device\'s spending limit…'), screen: 'wallet' };
  if (step === 'permission' && auto?.state === 'failed') return { text: auto.error ? tr('Setting up this device\'s spending limit failed: {error}. You can try again in Wallet (Update device setup).', { error: auto.error }) : tr('Setting up this device\'s spending limit failed. You can try again in Wallet (Update device setup).'), screen: 'wallet' };
  // Not set up yet and nothing wrong: the first Connect signs it. No banner (owner 2026-11-11).
  if (step === 'permission' && (auto?.state === 'pending' || auto?.state === 'idle')) return null;
  if (step === 'permission' && auto?.state === 'off') return { text: tr('This device has no spending limit, so it cannot pay servers. Turn on automatic setup in Settings, or set it up in Wallet.'), screen: 'settings' };
  if (step === 'permission') return { text: tr('Add devnet SOL to your wallet (about 0.06 SOL) and the app sets up this device\'s spending limit by itself.'), screen: 'wallet' };
  if (step === 'device') return { text: tr('This device could not be read from the service or the chain yet.'), screen: 'diagnostics' };
  return null;
}

