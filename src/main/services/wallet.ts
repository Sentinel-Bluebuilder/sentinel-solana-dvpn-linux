// ─── Wallet actions (F2.4–F2.6, F3) ───
import { deviceLimitFor, firstSetupLimit } from '../../core/session/device-limit';
import { PublicKey, SystemProgram, type TransactionInstruction } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAccountLenForMint, getMint } from '@solana/spl-token';
import { rpcCall } from '../../core/chain/rpc';
import type { Result, WalletStatus } from '../../shared/types';
import { readWalletStatus, lowFundsWarnings } from '../../core/app/wallet-status';
import { planDeviceSetup, runDeviceSetup, revokeDevice, sameKeyMessage, autoSetupDecision, needsPermission, ownerSolForSetup, type SetupPlan, type DeviceAutoState } from '../../core/app/device-setup';
import { getSettings, updateSettings } from '../system/settings';
import { readSettlements } from './settlement';
import { signAndSend } from '../../core/app/signer';
import { ata } from '../../core/chain/program';
import { MINT, TOKEN_DECIMALS } from '../../core/chain/idl';
import { toBaseUnits, toLamports, tdvpn as tdvpnText } from '../../core/chain/amounts';
import { errorText } from '../../core/chain/errors';
import { isWalletAddress } from '../../core/wallet/keys';
import { hasWallet, ownerAddress, ownerSigner } from '../wallet/vault';
import { daemonInfo, deviceRecord, installPending, installService, startServiceIfStopped, stageSwitchDevice, switchHome, commitSwitch, deviceStateFor, discardHalfFinishedSetup } from '../daemon/manager';
import { getHost } from '../host';
import { isAndroid } from '../../shared/is-android';
import { viewFor } from '../../core/session/state';
import { patch, snapshot, toast } from '../app-state';
import { log } from '../logger';
import { tr } from '../../shared/i18n';

export async function refreshWallet(): Promise<WalletStatus | null> {
  const owner = ownerAddress();
  patchDeviceState(owner); // rc.4 E-55: the Connect sheet asks before a wallet switch; Diagnostics offers the removal
  if (!owner) { patch({ wallet: null, hasWallet: false, owner: null }); return null; }
  if (!snapshot().hasWallet) patch({ hasWallet: true, owner });
  try {
    const w = await readWalletStatus(owner, daemonInfo().device);
    patch({ wallet: w, hasWallet: true, owner, signerKind: 'in-app', walletRefreshFailed: null });
    warnLowFunds(w);
    patch({ deviceAuto: { state: autoState(w), error: lastAutoError ?? undefined }, serviceSwitchPending: serviceSwitchPending() });
    return w;
  } catch (err) {
    log.warn('wallet refresh failed', { err: (err as Error).message });
    // Row 140: the balances on screen are the last good read (wallet.at); say they could not be updated. The
    // first failure's time is kept so the screen can say since when.
    patch({ walletRefreshFailed: { since: snapshot().walletRefreshFailed?.since ?? Date.now() } });
    return null;
  }
}

const raised = new Set<string>();
/** Toast (and notify, when hidden) once when a balance first drops below its floor. */
function warnLowFunds(w: WalletStatus): void {
  const now = lowFundsWarnings(w);
  for (const x of now) if (!raised.has(x.key)) { raised.add(x.key); toast('warn', x.message); }
  for (const k of [...raised]) if (!now.some((x) => x.key === k)) raised.delete(k);
}

const errText = errorText;

// ─── Device permission at first connect (setting autoDevicePermission) ───
// Replaces the "Sign device permission" setup step (owner 2026-11-11). Nothing is signed in the
// background: connect() calls this first, so the permission is signed only when the user connects.
let autoRunning = false;
let lastAutoError: string | null = null;

function autoState(w: WalletStatus): DeviceAutoState {
  if (autoRunning) return 'running';
  if (lastAutoError) return 'failed'; // even with a grant: a wallet switch can fail after signing
  if (!needsPermission(w)) return 'idle';
  if (!getSettings().autoDevicePermission) return 'off';
  return 'pending';
}

/** A device key made for this wallet still waits for the service install (a declined or failed admin
 *  prompt, then an app restart). Never throws: a check that cannot run means "not pending". */
export function serviceSwitchPending(): boolean {
  try {
    return installPending();
  } catch (err) {
    log.warn('could not check for a pending service switch', { err: (err as Error).message });
    return false;
  }
}

export const OWNER_SOL_SHORT = (needLamports: number): string =>
  tr('Add devnet SOL to your wallet first: setting up payments for this computer needs about {needLamports} SOL for fees.', { needLamports: (needLamports / 1e9).toFixed(3) });

/**
 * Before a connect: set up this device's spending permission if it has none. Returns null when the
 * device can pay (already set up, or set up now), or the reason it cannot, in plain words.
 */
export async function ensureDevicePermission(minAllowanceBase = '0', opts: { confirmSwitch?: boolean } = {}): Promise<{ error: string; action: string | null; code?: string } | null> {
  // Switched wallets on this computer (2026-11-11: CWT5 -> 4Xrk): the service still spends for the old
  // wallet. rc.4 E-55: that switch is its own flow, asked first, and writes nothing until it is done.
  const owner = ownerAddress();
  const rec = deviceRecord();
  if (owner && rec && rec.owner !== owner) return switchWallet(owner, rec.owner, minAllowanceBase, !!opts.confirmSwitch);
  const w = await refreshWallet();
  if (!w) return null; // balances unreadable: let the normal preflight report it
  const floorBase = BigInt(minAllowanceBase || '0');
  const limitShort = !!w.grant && floorBase > 0n && (BigInt(w.grant.allowance) < floorBase || BigInt(w.delegated) < floorBase);
  const base = autoSetupDecision(w, { on: getSettings().autoDevicePermission, hasKey: hasWallet() });
  // A limit below this deposit is raised like a missing permission (same signature, updateGrant + approve).
  const decision = base === 'not-needed' && limitShort ? autoSetupDecision({ ...w, grant: null }, { on: getSettings().autoDevicePermission, hasKey: hasWallet() }) : base;
  if (decision === 'no-device') return null;
  if (decision === 'off') return { error: tr('This computer has no spending limit, so it cannot pay for a connection. Turn on "Set up payments on first connect" in Settings, or set a spending limit in Wallet.'), action: 'Open Settings' };
  if (decision === 'no-key') return { error: tr('Set up this computer\'s spending limit in Wallet first.'), action: 'Open Wallet' };
  if (decision === 'owner-short') return { error: OWNER_SOL_SHORT(ownerSolForSetup(w.deviceLamports)), action: 'Open Wallet' };
  autoRunning = true;
  patch({ deviceAuto: { state: 'running' }, conn: viewFor('preflight', tr('Setting up payments for this computer…')) });
  log.info('device permission at first connect', { owner: w.owner, device: w.device, decision });
  try {
    if (decision === 'run') {
      // Room for several deposits (device-limit.ts): sized to one, every Connect signed it again.
      // W91b: a first setup (no grant yet) is capped at the wallet's tDVPN; a raise of an existing limit is not.
      const want = firstSetupLimit(deviceLimitFor(BigInt(toBaseUnits(getSettings().allowanceTdvpn)), BigInt(minAllowanceBase || '0')), w.grant ? null : BigInt(String(w.ownerTdvpn ?? 0)), BigInt(minAllowanceBase || '0'));
      const r = await deviceSetup(tdvpnText(want.toString()), { auto: true });
      if (!r.ok) throw new Error(r.error);
    }
    // A new device key is only in the staging home: the service switches to it with one admin prompt.
    if (installPending()) {
      patch({ conn: viewFor('preflight', `${process.platform === 'win32' ? tr('Windows asks') : tr('Your system asks')} once to switch the VPN service to this wallet…`) });
      const inst = await installService();
      if (!inst.ok) throw new Error(inst.error ?? 'The VPN service could not be switched to this wallet.');
      log.info('service switched to this wallet', { owner: w.owner, device: w.device });
      patch({ serviceSwitchPending: false });
    }
    lastAutoError = null;
    return null;
  } catch (err) {
    lastAutoError = errText(err);
    log.error('device permission at first connect failed', { err: lastAutoError });
    return { error: tr('Could not set up payments for this computer: {lastAutoError}', { lastAutoError }), action: 'Retry' };
  } finally {
    autoRunning = false;
    const now = snapshot().wallet;
    patch({ deviceAuto: { state: now ? autoState(now) : (lastAutoError ? 'failed' : 'idle'), error: lastAutoError ?? undefined } });
  }
}

const short = (a: string): string => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** A --keyfile / DVPN_KEYFILE wallet (read in place). No host yet = not one. */
function keyFileWallet(): boolean {
  try {
    return getHost().keyStore.kind === 'keyfile';
  } catch (err) {
    log.warn('no host to read the wallet kind from', { err: (err as Error).message });
    return false;
  }
}

/** rc.4 E-55/E-27: why a connect will not switch this computer to the loaded wallet on its own. */
export function switchNeededCopy(loaded: string, recorded: string, keyfile: boolean): string {
  return keyfile
    ? tr('This computer is set up for another wallet ({recorded}), so the key file you loaded ({loaded}) cannot pay here. Load that wallet\'s key file, or switch this computer to this wallet with: {command}. Nothing was paid.', { recorded: short(recorded), loaded: short(loaded), command: 'devnet-dvpn device switch --yes' })
    : tr('This computer is set up for another wallet ({recorded}). Connecting with this wallet ({loaded}) first sets the computer up for it; deposits made with the other wallet stay refundable when you load it again. Nothing was paid.', { recorded: short(recorded), loaded: short(loaded) });
}

/**
 * rc.4 E-55: switch this computer to `owner`. Every check that can refuse runs before anything is written;
 * the new key lives in the scratch folder; the setup signs for it there; device.json changes only after the
 * service runs the new key. A failure leaves device.json and the staging home as they were.
 */
export async function switchWallet(owner: string, recorded: string, minAllowanceBase: string, confirmed: boolean): Promise<{ error: string; action: string | null; code?: string } | null> {
  if (!confirmed) return { error: switchNeededCopy(owner, recorded, keyFileWallet()), action: null, code: 'wallet-switch-needed' };
  const s = getSettings();
  if (!hasWallet()) return { error: tr('Set up this computer\'s spending limit in Wallet first.'), action: 'Open Wallet', code: 'device-permission' };
  // Balances of the loaded wallet, for a device that does not exist yet (no grant, no SOL).
  let w: WalletStatus;
  try {
    w = await readWalletStatus(owner, null);
  } catch (err) {
    return { error: tr('Could not read this wallet\'s balances, so nothing was changed or paid ({errText}).', { errText: errText(err) }), action: 'Retry', code: 'device-permission' };
  }
  const need = ownerSolForSetup(0);
  if (w.ownerLamports < need) return { error: OWNER_SOL_SHORT(need), action: 'Open Wallet', code: 'device-sol' };
  const want = firstSetupLimit(deviceLimitFor(BigInt(toBaseUnits(s.allowanceTdvpn)), BigInt(minAllowanceBase || '0')), BigInt(String(w.ownerTdvpn ?? 0)), BigInt(minAllowanceBase || '0')); // W91b: a new device
  patch({ conn: viewFor('preflight', tr('Setting up this computer for this wallet…')) });
  const staged = await stageSwitchDevice(owner);
  if (!staged.ok || !staged.device) return { error: staged.error ?? tr('Could not set up this computer for this wallet.'), action: 'Open Diagnostics', code: 'device-permission' };
  try {
    await runDeviceSetup(ownerSigner(), staged.device, want.toString());
  } catch (err) {
    // The key stays in the scratch folder (it may hold what the setup sent it); nothing else changed.
    return { error: tr('Could not set up payments for this wallet: {errText}', { errText: errText(err) }), action: 'Retry', code: 'device-permission' };
  }
  patch({ conn: viewFor('preflight', `${process.platform === 'win32' ? tr('Windows asks') : tr('Your system asks')} once to switch the VPN service to this wallet…`) });
  const inst = await installService(switchHome());
  if (!inst.ok) return { error: `${inst.error ?? tr('The VPN service could not be switched to this wallet.')} This computer stays set up for the other wallet; the next Connect finishes the switch.`, action: 'Retry', code: 'device-permission' };
  // (from what was staged, not the scratch file: the installer may have moved the folder)
  commitSwitch({ device: staged.device, owner, at: Date.now() });
  log.info('service switched to this wallet', { owner, device: staged.device, was: recorded });
  await refreshWallet();
  return null;
}

/** Diagnostics → "Remove half-finished setup" (IPC.DISCARD_SETUP): the folders removed; the snapshot follows. */
export function discardSetup(): { removed: string[] } {
  const r = discardHalfFinishedSetup();
  patchDeviceState(ownerAddress());
  return r;
}

function patchDeviceState(owner: string | null): void {
  try {
    patch(deviceStateFor(owner));
  } catch (err) {
    log.warn('could not read the device record for the snapshot', { err: (err as Error).message });
  }
}

/** `refresh`: read the balances again first (the setup screen's "Check again" after funding). */
export async function deviceSetupPlan(allowanceTdvpn: string, refresh = false): Promise<Result<{ steps: string[]; topUpLamports: number; approveTo: string | null }>> {
  const owner = ownerAddress();
  const device = daemonInfo().device;
  // Name the exact missing step: on a fresh machine "set up the service first" sent CLI users in
  // a loop (daemon install asks for device setup, which needs the device key from daemon init).
  if (!owner) return { ok: false, error: tr('Create or import a wallet first (wallet create / wallet import).') };
  if (!device) return { ok: false, error: `${isAndroid() ? tr('This phone') : tr('This computer')} has no device key yet. Create it on the Welcome screen first.` };
  if (owner === device) return { ok: false, error: sameKeyMessage(device), code: 'wallet-is-device' };
  if (refresh) await refreshWallet();
  const p: SetupPlan = await planDeviceSetup(owner, device, toBaseUnits(allowanceTdvpn));
  // Q0484 H2: say before any signature that the wallet cannot pay for it (setup refuses the same).
  const steps = p.ownerShortLamports > 0 ? [...p.steps, tr('Not yet: {OWNER_SOL_SHORT}', { OWNER_SOL_SHORT: OWNER_SOL_SHORT(p.ownerNeedLamports) })] : p.steps;
  return { ok: true, data: { steps, topUpLamports: p.topUpLamports, approveTo: p.approveTo } };
}

export const SERVICE_NOT_STARTED = 'Permission saved, but the VPN service did not start. Start it with one admin prompt: devnet-dvpn daemon install --yes';

export async function deviceSetup(allowanceTdvpn: string, opts: { auto?: boolean } = {}): Promise<Result<string | null>> {
  const device = daemonInfo().device;
  if (!device) return { ok: false, error: tr('The VPN service has no device key yet.') };
  // Set up by hand: the user wants it, so automatic upkeep comes back on and retries start fresh.
  if (!opts.auto) {
    lastAutoError = null;
    if (!getSettings().autoDevicePermission) updateSettings({ autoDevicePermission: true });
  }
  try {
    const r = await runDeviceSetup(ownerSigner(), device, toBaseUnits(allowanceTdvpn));
    await refreshWallet();
    // The service will not start without this permission; start it now that it exists.
    const svc = await startServiceIfStopped();
    log.info('service after device setup', { svc });
    // SERVICE_NOT_STARTED stays English for the terminal (src/cli); the app shows the same sentence translated.
    if (svc === 'no-right' || svc === 'failed') toast('warn', tr('Permission saved, but the VPN service did not start. Start it with one admin prompt: {command}', { command: 'devnet-dvpn daemon install --yes' }));
    return { ok: true, data: r.signature };
  } catch (err) {
    log.error('device setup failed', { err: errText(err) });
    return { ok: false, error: errText(err), code: 'device-setup-failed' };
  }
}

/** Remove this device's spending permission (F3.4). Blocked while any of its deposits is still on chain. */
export async function revokeDeviceAccess(): Promise<Result<string>> {
  const device = daemonInfo().device;
  if (!device) return { ok: false, error: tr('No device is set up.'), code: 'no-device' };
  try {
    const live = snapshot().session ? 1 : (await readSettlements()).filter((s) => s.status === 'in-use').length;
    const sig = await revokeDevice(ownerSigner(), device, live);
    // Removed on purpose: the background setup must not sign it straight back.
    updateSettings({ autoDevicePermission: false });
    await refreshWallet();
    return { ok: true, data: sig };
  } catch (err) {
    return { ok: false, error: errText(err), code: 'revoke-failed' };
  }
}

/**
 * Remove ANOTHER device's spending permission (gap #95): a computer that is gone and whose key is
 * lost. The owner signs; the device itself is not needed. Its deposits then settle with
 * `settle run --device`. A session it may still be running elsewhere cannot be seen from here,
 * which is why the CLI asks the user to confirm the device is no longer in use.
 */
export async function revokeOtherDevice(other: string): Promise<Result<string>> {
  if (!isWalletAddress(other)) return { ok: false, error: tr('That is not a device address.'), code: 'bad-device' };
  if (other === daemonInfo().device) return { ok: false, error: isAndroid() ? tr('That is this phone\'s device: run {command} without --device.', { command: 'device revoke' }) : tr('That is this computer\'s device: run {command} without --device.', { command: 'device revoke' }), code: 'own-device' };
  try {
    const sig = await revokeDevice(ownerSigner(), other, 0);
    await refreshWallet();
    return { ok: true, data: sig };
  } catch (err) {
    return { ok: false, error: errText(err), code: 'revoke-failed' };
  }
}

/**
 * A22 (rc9-c2): what the sender pays to create `to`'s tDVPN account in transferInstructions (its
 * createAssociatedTokenAccountIdempotent): 0 when the account exists, else the rent-exempt minimum for the size
 * the mint needs (Token-2022, extensions included). A failed read throws: nothing is previewed on a guess.
 */
export async function recipientTokenRent(
  to: string,
  deps: { exists?: (addr: PublicKey) => Promise<boolean>; accountLen?: () => Promise<number>; rentFor?: (len: number) => Promise<number> } = {},
): Promise<bigint> {
  const exists = deps.exists ?? ((addr: PublicKey) => rpcCall((c) => c.getAccountInfo(addr, 'confirmed'), { label: 'send:recipient-ata' }).then((x) => x !== null));
  if (await exists(ata(new PublicKey(to)))) return 0n;
  const accountLen = deps.accountLen ?? (() => rpcCall((c) => getMint(c, MINT, 'confirmed', TOKEN_2022_PROGRAM_ID), { label: 'send:mint' }).then(getAccountLenForMint));
  const rentFor = deps.rentFor ?? ((len: number) => rpcCall((c) => c.getMinimumBalanceForRentExemption(len, 'confirmed'), { label: 'send:rent' }));
  return BigInt(await rentFor(await accountLen()));
}

export function transferInstructions(from: PublicKey, to: PublicKey, tdvpnBase: bigint, lamports: bigint): TransactionInstruction[] {
  const ixs: TransactionInstruction[] = [];
  if (lamports > 0n) ixs.push(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports }));
  if (tdvpnBase > 0n) {
    ixs.push(createAssociatedTokenAccountIdempotentInstruction(from, ata(to), to, MINT, TOKEN_2022_PROGRAM_ID));
    ixs.push(createTransferCheckedInstruction(ata(from), MINT, ata(to), from, tdvpnBase, TOKEN_DECIMALS, [], TOKEN_2022_PROGRAM_ID));
  }
  return ixs;
}

/** Send tDVPN and/or SOL (F2.5). Amounts are display strings. */
export async function send(req: { to: string; tdvpn?: string; sol?: string; confirmed: true }): Promise<Result<string>> {
  if (req.confirmed !== true) return { ok: false, error: tr('Confirm the transfer first.'), code: 'not-confirmed' };
  if (!isWalletAddress(req.to)) return { ok: false, error: tr('That is not a Solana wallet address.'), code: 'invalid-address' };
  const base = BigInt(req.tdvpn ? toBaseUnits(req.tdvpn) : '0');
  const lamports = req.sol ? toLamports(req.sol) : 0n;
  if (base === 0n && lamports === 0n) return { ok: false, error: tr('Enter an amount.'), code: 'invalid-amount' };
  try {
    const s = ownerSigner();
    const r = await signAndSend(s, transferInstructions(s.publicKey, new PublicKey(req.to), base, lamports), 'transfer');
    await refreshWallet();
    return { ok: true, data: r.signature };
  } catch (err) {
    // TX-LAND (rc9-f2 H): not sent (tx-not-landed) or not known (tx-unknown) keep their code; the balances are read
    // again so the screen shows what really moved before anyone sends again.
    const code = (err as { code?: string }).code;
    if (code === 'tx-unknown') await refreshWallet().catch((e: Error) => log.warn('send: balance re-read after an unknown result failed', { err: e.message }));
    return { ok: false, error: errText(err), code: code === 'tx-unknown' || code === 'tx-not-landed' ? code : 'send-failed' };
  }
}
