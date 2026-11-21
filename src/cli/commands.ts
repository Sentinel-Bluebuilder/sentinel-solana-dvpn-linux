// ─── CLI commands — every one calls the same services the desktop app uses ───
// Spend commands print what they will do and stop unless --yes is given (exit 2).
import { cliErr, CLI_NAME, deviceNext, noDeviceKeyNext } from './cli-fail';
import fs from 'node:fs';
import os from 'node:os';
import QRCode from 'qrcode';
import { MODE_STREAM, MODE_VOUCHER, PROGRAM_ID, MINT } from '../core/chain/idl';
import { lanRanges } from '../core/net/lan';
import { tailLog, log } from '../main/logger';
import type { Args } from './args';
import { flag, str, whole, UsageError, requireValues } from './args';
import { isWalletAddress } from '../core/wallet/keys';
import { plural, formatPeriod, formatBytes } from '../shared/format';
import type { Result, PendingSettlement } from '../shared/types';
import { snapshot } from '../main/app-state';
import { refreshWallet, deviceSetup, deviceSetupPlan, send, recipientTokenRent, revokeDeviceAccess, revokeOtherDevice, switchWallet, SERVICE_NOT_STARTED } from '../main/services/wallet';
import { refreshNodes, nodeViews, findNode, toggleFavourite } from '../main/services/nodes';
import { connect, disconnect, adoptRunningSession, stopOtherConnect } from '../main/services/connection';
import { clearSystemProxy } from '../main/system/proxy';
import { readSettlements, runSettlement, withdraw } from '../main/services/settlement';
import { refreshPlans, refreshSubscriptions, roster, subscribe, closeSub } from '../main/services/plans';
import { recentNodes, fundChannel, withChainStatus } from '../main/services/activity';
import { daemon, daemonInfo, registerDevice, detectDevice, deviceRecord, deviceHomeGone, startServiceIfStopped, discardHalfFinishedSetup } from '../main/daemon/manager';
import { DaemonError } from '../core/daemon/client';
import { getDaemonSettings } from '../main/daemon/settings';
import { getSettings } from '../main/system/settings';
import { createWallet, importWallet, logout, ownerAddress, ownerSigner, noWallet } from '../main/wallet/vault';
import { createKeyfile } from '../core/wallet/new-keyfile';
import { keyfileModeProblem, keyfileModeNext } from './keystore';
import { discoverNode, probeNode } from '../core/nodes/discovery';
import { costPreview, priceLabel, type Basis } from '../core/pricing/cost';
import { tdvpn, sol, toBaseUnits, toLamports } from '../core/chain/amounts';
import { clearAgentMarker } from '../main/services/agent-marker';
import { formatCountdown } from '../core/settlement/settlement';
import { closeReasonCopy } from '../core/session/state';
import { testCmd } from './test-cmd';
import { rivalVpns } from '../main/system/tunnels';
import { daemonCmd } from './daemon-cmd';
import { statusCmd } from './status-cmd';
import { pollCmd } from './poll-cmd';
import { splitCmd } from './split-cmd';
import { agentCmd } from './agent-cmd';
import { splitAndroidCmd } from './android/split-android-cmd';
import { isAndroid } from '../shared/is-android';
import { cliActionHint } from './action-hint';
import { payerNote } from './payer';
import { sendCheck, badRecipient, allowanceCheck, BASE_FEE_LAMPORTS } from './send-check';
const SPLIT_HELP = 'status | apps [--search TEXT] (desktop: change it with daemon set --split-*) | show | set all|include|exclude [package…] | routes all|include|exclude [address…] (Android)';
import { historyCmd, qualityCmd, rpcCmd, settingsCmd, proxyCmd } from './info-cmd';
import { leftoverTunnels } from '../main/system/tunnels';

export interface Out { json: boolean; print(human: string, data?: unknown): void }
export class NeedsConfirm extends Error {}

export type Cmd = (a: Args, o: Out) => Promise<void>;

export function need(r: Result<unknown>): void {
  if (!r.ok) {
    const e = new Error(r.error ?? 'failed') as Error & { code?: string; action?: string | null };
    e.code = r.code;
    e.action = r.action;
    throw e;
  }
}

export function confirm(a: Args, o: Out, what: string, data?: unknown): void {
  if (flag(a, 'yes')) return;
  o.print(`${what}\nRe-run with --yes to do it.`, { needsConfirm: true, what, ...((data as object) ?? {}) });
  throw new NeedsConfirm(what);
}

const APP_VERSION = process.env.DVPN_APP_VERSION ?? 'dev';
const short = (s: string): string => (s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s);
const basisOf = (a: Args): Basis => {
  const b = str(a, 'basis', getSettings().defaultBasis);
  if (b !== 'per_gb' && b !== 'per_hour') throw new UsageError('--basis must be per_gb or per_hour');
  return b;
};

/** Balances, or a clear error when a wallet exists but the read failed (null means both otherwise). */
/**
 * `device register <address> [--home <dir>]`: the form that works without administrator rights (it reads no key
 * file). The address comes from this computer's device record, else the running service's device, else a placeholder.
 */
/**
 * One `settle list` line. rc.3.1 F1: the list now holds every device's deposits (engine readSettlements); a row
 * another device opened names it, and an open one that device can still spend says how to refund it (settle run
 * skips it unless named). Exported for tests.
 */
export function settleRow(s: PendingSettlement & { device?: string; unverified?: boolean }): string {
  const ready = s.readyAt ? `  ready in ${formatCountdown(s.readyAt - Date.now() / 1000)}` : '';
  const dev = s.device ? `  (device ${s.device.length > 12 ? `${s.device.slice(0, 4)}…${s.device.slice(-4)}` : s.device})` : '';
  const open = s.unverified ? `  open on another device: settle run --channel ${s.channel} --yes refunds it` : '';
  return `${s.channel}  ${s.status.padEnd(7)} refundable ${tdvpn(s.refundable)}${ready}${dev}${open}`;
}

/** "This computer" / "This phone" (Q0497: Android reads as a phone). */
function here(cap: 'This' | 'this'): string {
  return `${cap} ${isAndroid() ? 'phone' : 'computer'}`;
}

export function registerByAddress(home?: string): string {
  const addr = deviceRecord()?.device || daemonInfo().device || '<device address>';
  return `devnet-dvpn device register ${addr}${home ? ` --home ${home}` : ''}`;
}

/**
 * E-18 / M9: "no wallet" as an error. A --keyfile / DVPN_KEYFILE file that is gone is 'keyfile-missing' with vault's
 * sentence (restore it; a new wallet holds none of the funds), so `wallet show` and the reads exit 1, not 0.
 */
export function walletMissingError(): Error & { code: string } {
  const w = noWallet();
  return Object.assign(new Error(w.code === 'keyfile-missing' ? w.error : 'No wallet. Run "wallet create" or "wallet import <file>".'), { code: w.code });
}

export async function walletRead(): Promise<NonNullable<Awaited<ReturnType<typeof refreshWallet>>>> {
  const w = await refreshWallet();
  if (w) return w;
  if (!ownerAddress()) throw walletMissingError();
  throw cliErr('rpc-busy', `${CLI_NAME} wallet show --json`, `Could not read the balances of ${ownerAddress()} right now (network or RPC busy). Try again in a moment.`);
}

// ─── wallet ───
const wallet: Cmd = async (a, o) => {
  const sub = a._[1] ?? 'show';
  if (sub === 'show') {
    if (!ownerAddress()) {
      if (noWallet().code === 'keyfile-missing') throw walletMissingError(); // M9: exit 1, the file is named
      o.print(`No wallet. Run "${CLI_NAME} wallet create --keyfile <path> --yes" or "${CLI_NAME} wallet import <file>".`, { wallet: null, next: `${CLI_NAME} wallet create --keyfile <path> --yes` }); // AUD-2 M13
      return;
    }
    const w = await walletRead();
    // K-WIN2 (the agent kit rc.9): an open key file is a warning here (agent up refuses it); next is the fix.
    const kfm = keyfileModeProblem(str(a, 'keyfile') ?? process.env.DVPN_KEYFILE);
    const kfmText = kfm ? `The key file ${kfm.path} can be read by other users (mode ${kfm.mode}).` : null;
    o.print(`Address    ${w.owner}\nSOL        ${sol(w.ownerLamports)}\ntDVPN      ${tdvpn(w.ownerTdvpn)}\nRefundable ${tdvpn(w.userBalance)}\nApproved   ${tdvpn(w.delegated)} (shared by all devices)${kfm ? `\nWarning: ${kfmText} Fix: ${keyfileModeNext(kfm.path)}` : ''}`,
      { ...w, ...(kfm ? { keyfileMode: kfmText } : {}), next: kfm ? keyfileModeNext(kfm.path) : `${CLI_NAME} agent status --json` });
  } else if (sub === 'create') {
    // Q0490: --keyfile / DVPN_KEYFILE naming a file that does not exist yet = make a NEW key file there (no keyring needed).
    const kf = str(a, 'keyfile') ?? process.env.DVPN_KEYFILE;
    if (kf && !fs.existsSync(kf)) {
      confirm(a, o, `Create a new wallet key file at ${kf} (readable by this account only).`);
      const k = createKeyfile(kf);
      o.print(`Created ${k.address}\nKey file ${k.path}: it is the only key to this wallet, so keep a copy somewhere safe.\nUse it with --keyfile ${k.path} or DVPN_KEYFILE.`, { ...k, next: `send SOL and tDVPN to ${k.address}, then ${CLI_NAME} agent status --json` });
      return;
    }
    confirm(a, o, 'Create a new wallet on this computer and show its 24-word recovery phrase once.');
    const r = createWallet();
    o.print(`Created ${r.address}\nWrite these 24 words down. They are shown once:\n${r.mnemonic}`, { ...r, next: `send SOL and tDVPN to ${r.address}, then ${CLI_NAME} agent status --json` });
  } else if (sub === 'import') {
    const src = a._[2];
    if (!src) throw new UsageError('wallet import <keyfile.json | -> (- reads stdin)');
    const text = src === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(src, 'utf8');
    o.print(`Imported ${importWallet(text).address}`, { address: ownerAddress(), next: `${CLI_NAME} agent status --json` });
  } else if (sub === 'receive') {
    const addr = ownerAddress();
    if (!addr) throw new UsageError('no wallet');
    const qr = await QRCode.toString(addr, { type: 'terminal', small: true });
    o.print(`${addr}
${qr}Devnet SOL: https://faucet.solana.com/`, { address: addr });
  } else if (sub === 'logout') {
    confirm(a, o, 'Remove the wallet key from this computer. Funds stay on chain; you need your backup to get back in.');
    logout();
    o.print('Wallet removed.', { ok: true });
  } else if (sub === 'send') {
    const to = str(a, 'to');
    if (!to) throw new UsageError('wallet send --to <address> [--tdvpn N] [--sol N] --yes');
    // Check everything that costs nothing BEFORE asking for --yes.
    if (!isWalletAddress(to)) throw new UsageError(`"${to}" is not a Solana wallet address.`);
    const amt = (k: string): number => { const v = str(a, k); const n = v === undefined ? 0 : Number(v); if (!Number.isFinite(n) || n < 0) throw new UsageError(`--${k} must be a positive number`); return n; };
    if (amt('tdvpn') === 0 && amt('sol') === 0) throw new UsageError(str(a, 'tdvpn') !== undefined || str(a, 'sol') !== undefined ? 'The amount must be more than 0.' : 'Give --tdvpn N and/or --sol N.');
    // CODE-AUDIT U-24: Number() takes 1e3 and 0x10; send() parses with toBaseUnits / toLamports, which refuse them. Same check, before --yes.
    parsedOrUsage(() => { if (str(a, 'tdvpn') !== undefined) toBaseUnits(str(a, 'tdvpn')!); if (str(a, 'sol') !== undefined) toLamports(str(a, 'sol')!); });
    // W-A2 (rc.8): a send that cannot work, loses the funds or strands the wallet is refused here, before needsConfirm.
    for (const k of ['tdvpn', 'sol']) if (str(a, k) !== undefined && amt(k) === 0) throw new UsageError(`--${k}: the amount must be more than 0.`);
    { const br = badRecipient(to, PROGRAM_ID.toBase58(), MINT.toBase58()); if (br) throw cliErr('bad-recipient', `${CLI_NAME} wallet send --to <wallet address> --yes`, br); }
    const wb = await walletRead();
    const sendBase = BigInt(str(a, 'tdvpn') !== undefined ? toBaseUnits(str(a, 'tdvpn')!) : '0');
    // A22: a tDVPN send to a wallet without a tDVPN account pays that account's rent; counted before the preview.
    const recipientRentLamports = sendBase > 0n ? await recipientTokenRent(to) : 0n;
    const sc = sendCheck({
      recipientRentLamports, to, tdvpnBase: sendBase, lamports: str(a, 'sol') !== undefined ? toLamports(str(a, 'sol')!) : 0n,
      owner: wb.owner, ownerLamports: BigInt(String(wb.ownerLamports ?? 0)), ownerTdvpnBase: BigInt(String(wb.ownerTdvpn ?? 0)),
      device: deviceRecord()?.device ?? null, programId: PROGRAM_ID.toBase58(), mint: MINT.toBase58(), allowEmpty: flag(a, 'allow-empty'),
    });
    if (!sc.ok) throw cliErr(sc.code, sc.code === 'insufficient-funds' ? `${CLI_NAME} wallet show --json` : sc.code === 'low-sol-after' ? `${CLI_NAME} wallet send --to ${to} --sol <less> --yes` : `${CLI_NAME} wallet send --to <wallet address> --yes`, sc.message);
    const parts = [amt('tdvpn') ? `${str(a, 'tdvpn')} tDVPN` : '', amt('sol') ? `${str(a, 'sol')} SOL` : ''].filter(Boolean).join(' and ');
    confirm(a, o, `Send ${parts} to ${to} on Solana devnet. Fee ${sol(sc.feeLamports)} SOL${sc.rentLamports !== '0' ? ` + ${sol(sc.rentLamports)} SOL token account rent` : ''}; after: ${sol(sc.balanceAfter.lamports)} SOL, ${tdvpn(sc.balanceAfter.tdvpnBase)} tDVPN.${sc.notes.length ? ` ${sc.notes.join(' ')}` : ''}`, { feeLamports: sc.feeLamports, balanceAfter: sc.balanceAfter, notes: sc.notes });
    const r = await send({ to, tdvpn: str(a, 'tdvpn'), sol: str(a, 'sol'), confirmed: true });
    need(r);
    o.print(`Sent. ${r.data}`, { signature: r.data, next: `${CLI_NAME} wallet show --json` });
  } else throw new UsageError(`unknown: wallet ${sub}`);
};

// ─── device ───
const device: Cmd = async (a, o) => {
  const sub = a._[1] ?? 'show';
  let allowance = str(a, 'allowance', getSettings().allowanceTdvpn)!;
  if (sub === 'show') {
    const w = await walletRead();
    const d = deviceRecord();
    o.print(`Device     ${d?.device ?? 'none'}\nHome       ${d?.home ?? '-'}\nAllowance  ${w?.grant ? tdvpn(w.grant.allowance) + ' tDVPN' : 'none'}\nDevice SOL ${w ? sol(w.deviceLamports) : '-'}\nReady      ${w?.ready ? 'yes' : 'no'}`, { device: d, grant: w?.grant ?? null, ready: !!w?.ready });
  } else if (sub === 'register') {
    const owner = ownerAddress();
    if (!owner) throw new UsageError('device register [device-pubkey] [--home <dir>]   (wallet required)');
    let pk = a._[2];
    if (!pk) {
      const d = await detectDevice(str(a, 'home'));
      if (!d.ok || !d.device) {
        // Windows live run (E-55): the service's keys folder is admin-only, so reading it fails in a normal terminal,
        // while the address form needs no admin. Name that form, the address filled in when this computer knows it.
        const e = registerByAddress(str(a, 'home'));
        throw Object.assign(new Error(`${(d.error ?? 'Could not read the device key.').replace(/ Enter its address instead\.$/, '')} Pass the device address instead (no administrator needed): ${e}`), { code: 'device-key-unreadable', action: e });
      }
      pk = d.device;
    }
    registerDevice(pk, owner, str(a, 'home'));
    o.print(`Recorded device ${pk}`, { device: pk });
  } else if (sub === 'plan' || sub === 'setup') {
    // The service's message names the Welcome screen; a CLI user has none (the Linux app 92fce1ef).
    if (ownerAddress() && !daemonInfo().device) throw cliErr('no-device-key', noDeviceKeyNext(daemonInfo().reachable), `${isAndroid() ? 'This phone' : 'This computer'} has no device key yet. ${daemonInfo().reachable ? `${CLI_NAME} agent up --yes creates it and sets this device up in one step.` : `The service is not installed; ${CLI_NAME} daemon init --yes creates the key (no administrator needed), then device setup --yes, then daemon install --yes.`} Nothing was signed.`); // E-85 + P-N (rc.8): code + ONE command for agents
    // LIM-2 (the agent kit rc.9, T-A 5): without --allowance, plan/setup keep this computer's current limit. The Settings amount
    // was the default, so `device setup --yes` (to fix permissions, SOL or the service) changed the limit as a side
    // effect. The Settings amount stays the default for a first setup (no grant yet).
    // W91 (the agent kit rc.9, review rc.8 live): a first setup with no --allowance takes min(Settings limit, wallet tDVPN),
    // with a warning when capped; it is never refused for the balance (agent up --yes set the device up on the same
    // wallet). Only an explicit --allowance above the wallet is refused (W-A3).
    const implicit = !str(a, 'allowance');
    let capNote: string | null = null;
    if (implicit) {
      const cur = await refreshWallet().catch((err: unknown) => { log.warn('device plan: grant read failed, the Settings limit is used', { err: (err as Error).message }); return null; });
      if (cur?.grant?.allowance !== undefined && cur?.grant?.allowance !== null) allowance = tdvpn(String(cur.grant.allowance));
      else if (cur && /^\d+(\.\d+)?$/.test(allowance)) {
        const own = BigInt(String(cur.ownerTdvpn ?? 0));
        const setting = BigInt(toBaseUnits(allowance));
        if (own < setting) {
          capNote = own > 0n
            ? `No --allowance: the spending limit is this wallet's ${tdvpn(own.toString())} tDVPN, below the Settings limit of ${tdvpn(setting.toString())} tDVPN. After funding, raise it with ${CLI_NAME} device setup --allowance <N> --yes.`
            : `This wallet holds 0 tDVPN: the spending limit is the Settings ${tdvpn(setting.toString())} tDVPN, and no deposit can be paid until the wallet is funded.`;
          if (own > 0n) allowance = tdvpn(own.toString());
        }
      }
    }
    // LIM-4 (the agent kit rc.9): --max-price is the agent's own cap; it is not used here, only carried into the next.
    const mpFlag = str(a, 'max-price');
    if (mpFlag !== undefined && !/^\d+(\.\d+)?$/.test(mpFlag)) throw new UsageError(`--max-price needs a number of tDVPN per GB or per hour (got "${mpFlag}").`);
    const upFlags = mpFlag ? ` --max-price ${mpFlag}` : '';
    // W-A3 (rc.8): an allowance above the wallet's tDVPN is refused before the plan (exit 4, --force overrides); 0 warns.
    // An allowance that does not parse is left to deviceSetupPlan, which answers invalid-amount as before.
    let allowanceBase: bigint | null = null;
    try { allowanceBase = BigInt(toBaseUnits(allowance)); } catch (err) { log.info('device plan: allowance does not parse; the plan refuses it', { err: (err as Error).message }); }
    const wa = allowanceBase === null ? null : await refreshWallet().catch((err: unknown) => { log.warn('device plan: balance read failed', { err: (err as Error).message }); return null; });
    const ownTd = wa ? BigInt(String(wa.ownerTdvpn ?? 0)) : null;
    const ac0 = allowanceBase === null ? { ok: true as const, warning: null } : allowanceCheck(allowanceBase, ownTd, flag(a, 'force') || implicit);
    const ac = ac0.ok ? { ok: true as const, warning: ac0.warning ?? capNote } : ac0;
    if (!ac.ok) throw cliErr(ac.code, `${CLI_NAME} device ${sub} --allowance ${tdvpn(ownTd ?? 0n)}${sub === 'setup' ? ' --yes' : ''}`, ac.message);
    const p = await deviceSetupPlan(allowance);
    need(p);
    const solCost = (BigInt(p.data!.topUpLamports || 0) + BASE_FEE_LAMPORTS).toString();
    const extra = { solCost, ...(ac.warning ? { warning: ac.warning } : {}) };
    if (!p.data!.steps.length) {
      // On chain all set, but the service folder this device lives in is gone (Q0431, the Linux app TLX 0.1.15): say so and the way
      // out, before starting a service with no home (systemd then creates it empty, and install loops on it).
      // Platform export on every OS (null when the home is present or the OS has no such folder).
      const gone = sub === 'setup' ? deviceHomeGone() : null;
      if (gone) throw cliErr('device-home-gone', `${CLI_NAME} daemon install --yes`, gone);
      const svc = sub === 'setup' ? await startServiceIfStopped() : undefined;
      o.print(`Device already set up for that allowance.${svc === 'started' ? ' VPN service started.' : svc === 'no-right' || svc === 'failed' ? `\n${SERVICE_NOT_STARTED}` : ''}`, { steps: [], service: svc, next: deviceNext(svc, upFlags) });
      return;
    }
    if (sub === 'plan') { o.print(`${p.data!.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\nSOL cost: ${sol(solCost)}${ac.warning ? `\nWarning: ${ac.warning}` : ''}`, { ok: true, ...p.data, ...extra, next: `${CLI_NAME} device setup --allowance ${allowance}${upFlags} --yes` }); return; }
    confirm(a, o, `One transaction:\n${p.data!.steps.map((s) => `  - ${s}`).join('\n')}${ac.warning ? `\nWarning: ${ac.warning}` : ''}`, { ...p.data, ...extra });
    const r = await deviceSetup(allowance);
    need(r);
    const svc = await startServiceIfStopped();
    o.print(`Device ready.${r.data ? ` Transaction: ${r.data}.` : ''}${svc === 'no-right' || svc === 'failed' ? `\n${SERVICE_NOT_STARTED}` : svc === 'no-service' ? `\n${NO_SERVICE_NOTE}` : ''}`, { signature: r.data, solSentToDevice: String(p.data!.topUpLamports || 0), feeLamports: BASE_FEE_LAMPORTS.toString(), ...(ac.warning ? { warning: ac.warning } : {}), service: svc, next: deviceNext(svc, upFlags), ...(svc === 'no-service' ? { serviceNote: NO_SERVICE_NOTE } : {}) });
  } else if (sub === 'revoke' && str(a, 'device')) {
    // Another device of this wallet (gap #95): a computer that is gone, its key lost.
    const other = str(a, 'device')!;
    confirm(a, o, `Remove spending permission for ANOTHER device ${other}. Do this only for a computer you no longer use: it can no longer pay for VPN sessions. Then: settle run --device ${other} --yes`);
    const r = await revokeOtherDevice(other);
    need(r);
    o.print(`Removed. ${r.data}\nNext: settle run --device ${other} --yes`, { signature: r.data });
  } else if (sub === 'revoke') {
    const d = deviceRecord();
    if (!d) throw new UsageError('no device recorded');
    confirm(a, o, `Remove spending permission for device ${d.device}.`);
    const r = await revokeDeviceAccess();
    need(r);
    o.print(`Removed. ${r.data}`, { signature: r.data });
  } else if (sub === 'switch') {
    // E-55: set this computer up for the loaded wallet (the one in device.json keeps its deposits, refundable).
    const owner = ownerAddress();
    if (!owner) throw walletMissingError();
    const recorded = deviceRecord()?.owner;
    if (!recorded) throw cliErr('no-device', `${CLI_NAME} device setup --yes`, `${here('This')} is not set up for any wallet yet: run "device setup --yes" instead.`);
    if (recorded === owner) { o.print(`${here('This')} is already set up for ${owner}: nothing to switch.`, { switched: false, owner }); return; }
    // rc.3.1 F2 (Windows run): each switch makes a new device and leaves its fee float on the old one. Sentence from UI-ENGINE.
    confirm(a, o, `Switch ${here('this')} from ${recorded} to ${owner}. This sets ${here('this')} up as a new device for the loaded wallet, which pays about 0.05 SOL of fee float for it. About 0.05 SOL of fee float stays on the previous device and cannot be sent back yet. Deposits made with the previous device stay refundable: settle list shows them.`, { from: recorded, to: owner, floatSol: '0.05' });
    const r = await switchWallet(owner, recorded, '0', true);
    if (r) throw Object.assign(new Error(r.error), { code: r.code ?? 'switch-failed', ...(r.action ? { action: cliActionHint(r.action, r.error) } : {}) });
    o.print(`${here('This')} is now set up for ${owner}.`, { switched: true, from: recorded, owner, next: `${CLI_NAME} agent status --json` });
  } else if (sub === 'discard-setup') {
    // E-55: a half-finished setup / wallet switch the engine names ("or: devnet-dvpn device discard-setup --yes").
    confirm(a, o, `Remove the half-finished device setup on ${here('this')} (a set-up device is never touched).`);
    const { removed } = discardHalfFinishedSetup();
    o.print(removed.length ? `Removed:\n${removed.map((f) => `  ${f}`).join('\n')}` : 'Nothing to remove.', { removed });
  } else throw new UsageError(`unknown: device ${sub}`);
};

// ─── nodes ───
// Added beside the raw prices in `nodes list --json` (fresh-agent test: "base units with no unit field").
// device setup before daemon install (blind round 2: a bare "no-service" in the JSON).
export const NO_SERVICE_NOTE = 'The VPN service is not installed yet: next, run "daemon install --yes".';

export const PRICE_UNIT = 'pricePerGb and pricePerHour are tDVPN base units (1 tDVPN = 1000000), per GB and per hour; "0" = not offered';

const nodes: Cmd = async (a, o) => {
  const sub = a._[1] ?? 'list';
  if (sub === 'list') {
    await refreshNodes({ probe: !flag(a, 'no-probe') });
    let list = nodeViews();
    if (flag(a, 'online')) list = list.filter((n) => n.probe?.ok);
    const c = str(a, 'country');
    if (c) list = list.filter((n) => n.countryCode === c.toUpperCase());
    const p = str(a, 'protocol');
    if (p) list = list.filter((n) => n.protocolNames.includes(p));
    if (str(a, 'sort') === 'price') list.sort((x, y) => Number(BigInt(x.pricePerGb) - BigInt(y.pricePerGb)));
    // --limit N: the first N after the filters and the sort (blind round 2: --online --json was 26 KB on one line).
    const lim = str(a, 'limit');
    if (lim !== undefined) {
      const n = Number(lim);
      if (!Number.isInteger(n) || n < 1) throw new UsageError('nodes list --limit N   (N = a whole number, 1 or more)');
      list = list.slice(0, n);
    }
    o.print(list.map((n) => `${n.probe?.ok ? 'up  ' : n.listingFresh ? 'down' : 'gone'}  ${n.address}  ${n.countryCode.padEnd(2)} ${priceLabel(n.pricePerGb, 'per_gb').padEnd(18)} ${priceLabel(n.pricePerHour, 'per_hour').padEnd(18)} ${n.protocolNames.join(',')}${n.probe && !n.probe.ok ? `  (${n.probe.error})` : ''}`).join('\n') || 'No nodes.', list.map((n) => ({ ...n, priceUnit: PRICE_UNIT })));
  } else if (sub === 'show' || sub === 'probe') {
    const addr = a._[2];
    if (!addr) throw new UsageError(`nodes ${sub} <node>`);
    const n = await discoverNode(addr);
    if (!n) throw cliErr('node-gone', `${CLI_NAME} nodes list --online --json`, 'No such node.');
    const probe = await probeNode(n);
    o.print(`${n.address}\n  ${n.country} (${n.continent})  ${n.uri}\n  listed ${n.listed} fresh ${n.listingFresh}\n  ${priceLabel(n.pricePerGb, 'per_gb')}  ${priceLabel(n.pricePerHour, 'per_hour')}\n  protocols ${n.protocolNames.join(', ')}\n  probe ${probe.ok ? 'OK' : probe.error}${probe.latencyMs ? `  ${probe.latencyMs} ms` : ''}`, { ...n, probe });
  } else if (sub === 'fav') {
    const addr = a._[2];
    if (!addr) throw new UsageError('nodes fav <node>');
    const on = toggleFavourite(addr);
    o.print(on ? 'Added to favourites.' : 'Removed from favourites.', { favourite: on });
  } else if (sub === 'recent') {
    const r = recentNodes();
    const views = nodeViews();
    o.print(r.map((addr) => {
      const n = views.find((x) => x.address === addr);
      return n ? `${addr}  ${n.country}  ${n.protocolNames.join(', ')}` : addr;
    }).join('\n') || 'No recent servers.', r);
  } else throw new UsageError(`unknown: nodes ${sub}`);
};

// ─── cost / connect / disconnect / sessions ───
const cost: Cmd = async (a, o) => {
  const n = a._[1] ? await discoverNode(a._[1]) : null;
  if (!n) throw new UsageError('cost <node> [--basis per_gb|per_hour] [--units N]');
  const basis = basisOf(a);
  const c = costPreview(n, basis, whole(a, 'units', basis === 'per_gb' ? getSettings().defaultGb : getSettings().defaultHours, 1, 1000));
  o.print(c.available ? `Deposit ${c.escrowText} for ${c.units} ${basis === 'per_gb' ? 'GB' : 'h'}. ${c.feeText}. Unused deposit is refunded automatically.` : `This node does not sell ${basis}.`, c);
};

const connectCmd: Cmd = async (a, o) => {
  const node = a._[1];
  if (!node) throw new UsageError('connect <node> [--basis] [--units N] [--plan <subscription>] --yes');
  // E-21 (money): `--plan` with nothing after it read as "no plan" and paid a deposit.
  requireValues(a, ['plan', 'basis', 'units']);
  // Inputs first: a bad value is a usage error before anything runs (linux edge: --units 0 --yes paid for 1 unit).
  whole(a, 'units', 1, 1, 1000);
  await adoptRunningSession();
  // Cosmos lesson D6: warn (stderr, not stdout: --json stays clean) when another VPN holds the route.
  const rivals = await rivalVpns();
  if (rivals.length) process.stderr.write(`Warning: another VPN is on (${rivals.join(', ')}). Turn it off first: two VPNs fight over the same traffic and this one may carry nothing.\n`);
  try {
    const basis = basisOf(a);
    const units = whole(a, 'units', basis === 'per_gb' ? getSettings().defaultGb : getSettings().defaultHours, 1, 1000);
    const subAddr = str(a, 'plan');
    let subscription: { provider: string; subscription: string } | undefined;
    // CODE-AUDIT U-23: the deposit this prompt showed; connect() refuses a higher fresh price ('price-changed', nothing paid).
    let shownEscrow: string | undefined;
    if (subAddr) {
      const s = (await refreshSubscriptions()).find((x) => x.address === subAddr);
      if (!s) throw cliErr('no-subscription', `${CLI_NAME} plans subscriptions`, 'You do not hold that subscription. Nothing was paid.'); // AUD-2 M14
      subscription = { provider: s.provider, subscription: s.address };
      confirm(a, o, `Connect to ${node} using plan subscription ${subAddr} (no deposit).`);
    } else {
      const n = await discoverNode(node);
      if (!n) throw cliErr('node-gone', `${CLI_NAME} nodes list --online --json`, 'No such node. Nothing was paid.'); // AUD-2 M14
      const c = costPreview(n, basis, units);
      shownEscrow = c.escrow;
      confirm(a, o, `Connect to ${node}: deposit up to ${c.escrowText} (${units} ${basis === 'per_gb' ? 'GB' : 'h'}), unused part refunded automatically.`, c);
      // E-1 (Windows rc2, review): connect() decides the first permission and the limit raise from snapshot().wallet,
      // null in a fresh CLI process, so the raise was skipped and the preflight refused. Read it first, as agent up does.
      await refreshWallet();
    }
    const r = await connect({ node, basis, units, confirmed: true, subscription, switch: flag(a, 'switch'), ...(shownEscrow ? { shownEscrow } : {}) });
    need(r);
    // E-27: name the wallet that paid (from the deposit account); say so when it is not the loaded one.
    const paid = payerNote(r.data!.payer, ownerAddress());
    o.print(`Connected. Session ${r.data!.id}  ${r.data!.service}${r.data!.proxyEndpoint && !isAndroid() ? `  SOCKS ${r.data!.proxyEndpoint}` : ''}${paid ? `\n${paid}` : ''}`, { ...r.data, payerNote: paid }); // Android: internal to the VPN
    if (flag(a, 'follow')) await follow(o);
  } catch (err) {
    // With another VPN on, a failed connect is usually caused by that VPN (rival-d9: the network
    // looked unreachable because the other tunnel swallowed all traffic). Name the cause (D6).
    if (rivals.length && !(err instanceof UsageError) && !(err as Error).message.includes('Another VPN (')) throw Object.assign(new Error(`${(err as Error).message}\n-> Another VPN (${rivals.join(', ')}) is on and is probably blocking this: turn it off, then connect again.`), { code: (err as { code?: string }).code, action: (err as { action?: string | null }).action ?? null }); // AUD-2 M15: keep the code
    throw err;
  }
};

/** Exported for tests (A10). */
export function follow(o: Out): Promise<void> {
  return new Promise((resolve, reject) => {
    let last = '';
    const t = setInterval(() => {
      const s = snapshot();
      if (!s.session) { clearInterval(t); o.print(s.lastCloseMessage?.message ?? 'Session ended.'); resolve(); return; }
      // Usage is metered every 60 s, so print only when a line would change.
      const line = `${s.conn.title}  down ${formatBytes(s.session.rxBytes)}  up ${formatBytes(s.session.txBytes)}  spent ${tdvpn(s.session.spent)} tDVPN`;
      if (line !== last) { last = line; o.print(line, s.session); }
    }, 5000);
    // A10 (review audit): a disconnect that rejected was an unhandled rejection (Node 22 exited with a stack, no coded
    // line, no money note). It now ends follow with disconnect-failed and the status read as next.
    process.once('SIGINT', () => {
      clearInterval(t);
      disconnect().then(() => resolve(), (err: unknown) => reject(cliErr('disconnect-failed', `${CLI_NAME} agent status --json`, `Ctrl+C: the session could not be closed (${(err as Error)?.message ?? String(err)}).`)));
    });
  });
}

// Exported for `agent down` (agent-cmd.ts), which runs it as is.
/** Run an amount parser; its error ('"1e3" is not a tDVPN amount…') becomes a usage error (exit 3, before --yes). */
function parsedOrUsage(check: () => unknown): void {
  try {
    check();
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
}

export const disconnectCmd: Cmd = async (_a, o) => {
  await adoptRunningSession();
  if (!snapshot().session) {
    // DC1: a connect still running in another window (paying its deposit) is stopped, not ignored.
    const other = await stopOtherConnect();
    if (other.stopped) {
      await adoptRunningSession();
      if (!snapshot().session) {
        o.print(other.ended ? 'Stopped the connect that was still in progress.' : 'Asked the connect that is still in progress to stop. Run "status" in a moment to check.', { ok: true, session: null, stoppedConnect: true, ended: other.ended });
        return;
      }
      // It got up before the stop landed: disconnect it below like any session.
    }
  }
  if (!snapshot().session) {
    // The session may be gone already (service restarted, node closed it) while the system proxy we
    // set for it is still on: put it back here too. the macOS app matrix adopt v2ray. Also one left with no backup (Q0281).
    await clearSystemProxy({ orphan: true });
    // A dead session keeps the kill switch until StopSession (kss151). On (= persist) keeps it until Restore network (kdp173).
    if (getDaemonSettings().settings.killSwitch === 'persist') { o.print('No active session. The kill switch may still be blocking the internet: if "quality ip" shows no address, run "daemon restore-network" to lift it for now; "daemon set --kill-switch off --yes" stops it coming back.',{ ok: true, session: null, killSwitchReleased: false, next: `${CLI_NAME} daemon restore-network` }); return; }
    let released = false;
    try { released = (await daemon().stopSession('')).killSwitchReleased; } catch (err) {
      if (!(err instanceof DaemonError) || err.kind !== 'not-found') throw err;
    }
    o.print(released ? 'No active session. Kill switch released: the internet is back.' : 'No active session.', { ok: true, session: null, killSwitchReleased: released, next: `${CLI_NAME} agent status --json` });
    return;
  }
  const paidByDeposit = !!snapshot().session?.channel; // plan (ticket) sessions have no deposit
  const r = await disconnect();
  need(r);
  clearAgentMarker(); // after a successful disconnect only (agent down runs this too): the app drops 'Agentic connection is on'
  // Stands alone (fresh-agent test: "the app" and "a day" were unclear). The START of a refund comes from the app
  // (per hour at session end, per GB after SETTLE_AFTER_MS) or settle run; dvpnd's 10-min sweep only finishes closes
  // past the 7200 s grace (connect-5e, sentinel-dvpnd channel.go closeChannels). This CLI command starts none.
  o.print(paidByDeposit ? 'Disconnected. The unused part of the deposit is refunded once its close is started: by the Devnet dVPN desktop app if it is running (a per-hour deposit 10 minutes after the session ends, a per-GB one after a day unused, so a reconnect can still use it), or now with "settle run --yes". A per-GB deposit then waits about 2 hours before it can be closed; run "settle run --yes" again then. "settle list" shows where each one is.' : 'Disconnected.', { ...r, next: `${CLI_NAME} agent status --json` });
};

const sessions: Cmd = async (a, o) => {
  const what = a._[0];
  if (what === 'sessions') {
    const l = await daemon().listSessions();
    o.print(l.map((s) => `${s.id}  ${s.status.padEnd(7)} ${short(s.node)}  ${s.service}  spent ${tdvpn(s.spent)}${s.error ? `  ${closeReasonCopy(s.error).message}` : ''}`).join('\n') || 'No sessions.', l);
  } else if (what === 'channels' && a._[1] === 'fund') {
    const ch = a._[2];
    const amt = str(a, 'tdvpn');
    if (!ch || !amt) throw new UsageError('channels fund <channel> --tdvpn N --yes');
    parsedOrUsage(() => toBaseUnits(amt)); // CODE-AUDIT U-25: refused before --yes, as fundChannel would after it
    confirm(a, o, `Add ${amt} tDVPN to deposit ${ch}. Unused deposit is refunded automatically.`);
    const r = await fundChannel(ch, amt);
    need(r);
    o.print(`Topped up. ${r.data}`, { signature: r.data });
  } else if (what === 'channels') {
    const l = await withChainStatus(await daemon().listChannels());
    // Chain modes: voucher = per-GB, stream = per-hour. Name the node so a person can tell channels apart.
    const basis = (m: number): string => (Number(m) === MODE_VOUCHER ? 'per-GB  ' : Number(m) === MODE_STREAM ? 'per-hour' : `mode ${m}  `);
    o.print(l.map((c) => `${c.address}  ${c.status.padEnd(7)} ${basis(c.mode)}  node ${c.node}  deposit ${tdvpn(c.escrow)}  used ${tdvpn(c.cumulative)}`).join('\n') || 'No channels.', l);
  } else {
    const l = await daemon().listTickets();
    o.print(l.map((t) => `${t.hash.slice(0, 12)}  sub ${short(t.subscription)}  node ${short(t.node)}`).join('\n') || 'No tickets.', l);
  }
};

// ─── plans ───
const plans: Cmd = async (a, o) => {
  const sub = a._[1] ?? 'list';
  if (sub === 'list') {
    const l = await refreshPlans();
    o.print(l.map((p) => `${p.address}  ${tdvpn(p.price)} tDVPN / ${formatPeriod(p.durationSeconds)}  ${p.dataCapGb ? `${p.dataCapGb} GB` : 'no data cap'}  ${(p.maxConnections ? plural(p.maxConnections, 'server') : 'any number of servers')}${p.providerListed ? '' : '  (provider inactive)'}${p.providerAnswering === false ? '  (provider offline)' : ''}`).join('\n') || 'No plans.', l);
  } else if (sub === 'roster') {
    if (!a._[2]) throw new UsageError('plans roster <plan>');
    const plan = (await refreshPlans()).find((p) => p.address === a._[2]);
    if (!plan) throw cliErr('no-plan', `${CLI_NAME} plans list`, `No plan ${a._[2]} on devnet. Run "plans list" to see the plans.`);
    const r = await roster(plan.provider, plan.address);
    // Servers this wallet's subscriptions to the plan already hold access (a ticket) on.
    const subs = (await refreshSubscriptions()).filter((x) => x.plan === plan.address && x.active).map((x) => x.address);
    let held: string[] = [];
    try {
      const now = Math.floor(Date.now() / 1000);
      held = (await daemon().listTickets()).filter((t) => subs.includes(t.subscription) && Number(t.expiresAt) > now).map((t) => t.node);
    } catch (err) {
      console.warn(`[cli] tickets unavailable: ${(err as Error).message}`);
    }
    const lines = r.map((x) => `${x.node}  ${x.live ? 'live' : 'down'}${held.includes(x.node) ? '  your access' : ''}`);
    if (plan.maxConnections && lines.length) lines.push(`Access on up to ${plural(plan.maxConnections, 'server')}; in use: ${new Set(held).size}.`);
    o.print(lines.join('\n') || 'Empty roster.', { roster: r, held, maxConnections: plan.maxConnections });
  } else if (sub === 'subscribe') {
    const plan = (await refreshPlans()).find((p) => p.address === a._[2]);
    if (!plan) throw new UsageError('plans subscribe <plan> --yes');
    confirm(a, o, `Subscribe for ${tdvpn(plan.price)} tDVPN, paid now. Cancelling later refunds nothing.`, plan);
    // CODE-AUDIT E11: the price printed above is the most paid; a higher one is refused ('price-changed', nothing paid).
    const r = await subscribe({ plan: plan.address, confirmed: true, shownPrice: plan.price });
    need(r);
    o.print(`Subscribed. ${r.data!.subscription}  ${r.data!.signature}`, r.data);
  } else if (sub === 'subscriptions') {
    const l = await refreshSubscriptions();
    o.print(l.map((s) => `${s.address}  plan ${short(s.plan)}  ${s.active ? `expires in ${formatCountdown(s.expiresAt - Date.now() / 1000)}` : 'expired'}`).join('\n') || 'No subscriptions.', l);
  } else if (sub === 'close') {
    const id = a._[2];
    if (!id) throw new UsageError('plans close <subscription> --yes');
    confirm(a, o, `Close subscription ${id}. Only the account rent comes back; the price is not refunded.`);
    const r = await closeSub(id);
    need(r);
    o.print(`Closed. ${r.data}`, { signature: r.data });
  } else throw new UsageError(`unknown: plans ${sub}`);
};

// ─── settle ───
const settle: Cmd = async (a, o) => {
  const sub = a._[1] ?? 'list';
  // --device <address>: another device of this wallet whose permission is removed (gap #95).
  const other = str(a, 'device');
  // readSettlements() is [] with no wallet (settlement.ts, kept for the app's background refresh): without this a user
  // whose wallet is not in the CLI vault is told "Nothing to settle." while deposits are open (connect-5e, ddv3-dvw-proof).
  if ((sub === 'list' || sub === 'run' || sub === 'withdraw') && !ownerAddress()) {
    throw walletMissingError();
  }
  if (sub === 'list') {
    const l = await readSettlements(other);
    o.print(l.map(settleRow).join('\n') || 'Nothing to settle.', l);
  } else if (sub === 'run') {
    const l = (await readSettlements(other)).filter((s) => s.status === 'open' || s.status === 'ready');
    const only = str(a, 'channel') ? [str(a, 'channel')!] : undefined;
    confirm(a, o, `Settle ${only ? 1 : l.length} deposit(s)${other ? ` of device ${other}` : ''} now and withdraw refunds to your wallet.`, { pending: l });
    const r = await runSettlement(only, other);
    need(r);
    // Blind round 2: say what is still closing, when it is ready and what to run then, not only the signatures.
    const closing = (await readSettlements(other)).filter((s) => s.status === 'closing');
    const head = r.data!.length ? `Done. Transactions (${r.data!.length}): ${r.data!.join(', ')}.` : 'Nothing was due.';
    const rows = closing.map((s) => `Still closing: ${s.channel}, refundable ${tdvpn(s.refundable)} tDVPN${s.readyAt ? `, ready in ${formatCountdown(s.readyAt - Date.now() / 1000)}` : ''}.`);
    const next = closing.length ? 'Next: run "settle run --yes" again once it is ready; it closes it and moves the refund to your wallet. "settle list" shows the time left.' : null;
    // R2: `next` is ONE runnable command (the prose stays in the text); nextAfter = when the last close is ready.
    const readyAll = closing.map((s) => s.readyAt ?? 0).filter((t) => t > 0);
    o.print([head, ...rows, ...(next ? [next] : [])].join('\n'), { signatures: r.data, stillClosing: closing.map((s) => ({ channel: s.channel, refundable: s.refundable, readyAt: s.readyAt })), next: closing.length ? `${CLI_NAME} settle run --yes` : `${CLI_NAME} wallet show --json`, ...(closing.length ? { nextAfter: readyAll.length ? Math.max(...readyAll) : null } : {}) });
  } else if (sub === 'withdraw') {
    confirm(a, o, 'Move your refundable balance back to your wallet.');
    const r = await withdraw();
    // Nothing to withdraw is a normal answer, not a failure: scripts can run this any time.
    if (!r.ok && r.code === 'nothing') { o.print('Nothing to withdraw: your refundable balance is 0.', { signature: null, next: `${CLI_NAME} wallet show --json` }); return; }
    need(r);
    o.print(`Withdrawn. ${r.data}`, { signature: r.data, next: `${CLI_NAME} wallet show --json` });
  } else throw new UsageError(`unknown: settle ${sub}`);
};

// ─── version / logs ───
const version: Cmd = async (_a, o) => {
  // E-81 (the agent kit): the catalogue promises "App version, network, program and mint"; an agent checks it is on the
  // right deployment before it pays, so the JSON names both ids.
  const v = { app: process.env.DVPN_APP_VERSION ?? APP_VERSION, network: 'devnet', programId: PROGRAM_ID.toBase58(), mint: MINT.toBase58(), platform: process.platform, node: process.version, lan: lanRanges(os.networkInterfaces()) };
  o.print(`devnet-dvpn ${v.app}  network ${v.network}  ${v.platform}\nprogram ${v.programId}  mint ${v.mint}\nlocal network ${v.lan.join(', ') || 'none found'}`, v);
};

const logs: Cmd = async (a, o) => {
  const text = tailLog(whole(a, 'lines', 100, 1, 100000));
  o.print(text || '(log is empty)', { log: text });
};

export const COMMANDS: Record<string, { run: Cmd; help: string; needsDaemon?: boolean }> = {
  version: { run: version, help: 'app version and network' },
  logs: { run: logs, help: '[--lines N] app log (secrets redacted)' },
  status: { run: statusCmd, help: 'wallet, device, daemon and session at a glance', needsDaemon: true },
  wallet: { run: wallet, help: 'show | receive | create | import <file|-> | send --to A [--tdvpn N] [--sol N] | logout' },
  device: { run: device, help: 'show | plan [--allowance N] | setup [--allowance N] | register [pubkey] (reads it from the service home if omitted) | revoke | switch --yes (this device to the loaded wallet) | discard-setup --yes (a half-finished setup)' },
  daemon: { run: daemonCmd, help: 'version | doctor | dns-check [--dns handshake|cloudflare|ip,ip] | drivers | repair-drivers | init | install | migrate [--legacy-dvpnd PATH] | settings | set [--kill-switch off|on|persist] [--dns handshake|cloudflare|ip,ip] [--allow-lan true] [--whole-device true|false] [--split-mode off|include|exclude] [--split-apps PATH;PATH|none] [--split-routes IP-or-CIDR,...|none] [--basis] [--escrow tDVPN] [--prepay-mb N] [--prepay-minutes N] [--rpc URL] [--rpc-ws URL] | restore-network | uninstall', needsDaemon: true },
  nodes: { run: nodes, help: 'list [--online] [--country DE] [--protocol wireguard] [--sort price] [--no-probe] | show <node> | fav <node> | recent' },
  cost: { run: cost, help: '<node> [--basis per_gb|per_hour] [--units N]' },
  connect: { run: connectCmd, help: '<node> [--basis] [--units N] [--plan <subscription>] [--switch] [--follow]', needsDaemon: true },
  disconnect: { run: disconnectCmd, help: 'stop the session (deposit stays open until settled)', needsDaemon: true },
  // the agent kit: three commands for an AI agent, built only on the calls above (agent-cmd.ts).
  agent: { run: agentCmd, help: 'up [--protocol P] [--country CC] [--node N] [--basis per_gb|per_hour] [--units N] [--plan S] [--max-price N] --yes | down --yes | status', needsDaemon: true },
  sessions: { run: sessions, help: 'daemon sessions', needsDaemon: true },
  channels: { run: sessions, help: 'daemon channels | fund <channel> --tdvpn N', needsDaemon: true },
  tickets: { run: sessions, help: 'daemon plan tickets', needsDaemon: true },
  plans: { run: plans, help: 'list | roster <plan> | subscribe <plan> | subscriptions | close <subscription>', needsDaemon: true },
  settle: { run: settle, help: 'list | run [--channel C] | withdraw', needsDaemon: true },
  history: { run: historyCmd, help: 'list | summary | export [--out file.csv]' },
  // Daemon is optional here: with a proxy session, `ip` also measures the VPN exit.
  quality: { run: qualityCmd, help: 'ip | speed (third-party services)', needsDaemon: true },
  rpc: { run: rpcCmd, help: 'state | set <url> [url...]' },
  settings: { run: settingsCmd, help: 'get | set key=value ... | reset --yes (favourites and RPC endpoints kept)' },
  proxy: { run: proxyCmd, help: 'status | on (needs a V2Ray/Xray session) | off | browser [--browser edge|chrome] [--url U]', needsDaemon: true },
  // Android chooses apps and addresses in the VPN service (android/split-android-cmd); desktop through dvpnd.
  // One help text for both: the desktop forms (status, daemon set --split-*) and the Android ones.
  split: isAndroid()
    ? { run: splitAndroidCmd, help: SPLIT_HELP }
    : { run: splitCmd, help: SPLIT_HELP, needsDaemon: true },
  poll: { run: pollCmd, help: 'show | set <job>=<seconds> … | reset [job…] | run [job…] | watch [--seconds N] [--hidden]' },
  test: { run: testCmd, help: 'servers | plan <server…>|--online [filters] | run <server…>|--online [filters] [--limit N] | run --resume | stop | history | show [run-id] [--compare] | export [run-id] [--out f]', needsDaemon: true },
};
