// ─── rc9-d (review live, Linux + Mac rc.9): this computer is set up for another wallet ───
// The installed service runs for the wallet in its config (owner); device.json names the wallet the device key was
// set up for. When either is not the loaded wallet, the service cannot pay for this one (its preflight fails on
// "grant"), and install / doctor / status walked a loop. The way out is device switch, or that wallet's key file.
import { CLI_NAME } from './cli-fail';
import { deviceRecord, serviceOwner } from '../main/daemon/manager';
import { log } from '../main/logger';

export const SWITCH_NEXT = `${CLI_NAME} device switch --yes`;
export const switchAlsoNext = (other: string): string =>
  `or load the key file of wallet ${other} (--keyfile <its path>, or DVPN_KEYFILE), then ${CLI_NAME} agent up --yes`;
export const switchMessage = (other: string, loaded: string): string =>
  `This computer's VPN service is set up for another wallet (${other}), so it cannot pay for the loaded wallet (${loaded}). Nothing was paid. next sets this computer up for the loaded wallet (the other wallet's deposits stay refundable); alsoNext loads the other wallet instead.`;

/** The other wallet this computer is set up for, or null. Pure; unit-tested. */
export function otherWallet(loaded: string | null, recordOwner: string | null | undefined, serviceOwnerV: string | null | undefined): string | null {
  if (!loaded) return null;
  if (serviceOwnerV && serviceOwnerV !== loaded) return serviceOwnerV;
  if (recordOwner && recordOwner !== loaded) return recordOwner;
  return null;
}

/** otherWallet from this computer's files (a read that fails is logged and claims nothing). */
export function readOtherWallet(loaded: string | null): string | null {
  try {
    const rec = deviceRecord();
    return otherWallet(loaded, rec?.owner ?? null, rec?.home ? serviceOwner(rec.home) : serviceOwner());
  } catch (err) {
    log.warn('the wallet this computer is set up for could not be read', { err: (err as Error).message });
    return null;
  }
}

/** The coded error every command throws for it (code, next, alsoNext as the JSON line carries them). */
export function switchNeeded(other: string, loaded: string): Error & { code: string; action: string; alsoNext: string } {
  return Object.assign(new Error(switchMessage(other, loaded)), { code: 'wallet-switch-needed', action: SWITCH_NEXT, alsoNext: switchAlsoNext(other) });
}
