// ─── IPC handlers (ARCHITECTURE "IPC tiers", F23, F24) ───
// Every channel in shared/ipc TIERS gets exactly one handler here; the tier
// test proves the two sets are equal. Handlers never throw raw errors at the
// renderer: they return Result { ok, error, code, action } with plain copy.
// Spend-tier payloads must carry `confirmed: true` — set only after the UI
// showed the cost and the user pressed the confirm button.
import path from 'node:path';
import { app, ipcMain, shell, clipboard, dialog, BrowserWindow } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import QRCode from 'qrcode';
import { lanRanges } from '../core/net/lan';
import { dnsProbeProblem, probeDns } from './system/dns-probe';
import { IPC, EVENTS, TIERS, type IpcChannel } from '../shared/ipc';
import type { ConnectRequest, Result } from '../shared/types';
import { snapshot, patch, broadcast } from './app-state';
import { planNodeTest, runNodeTest, stopNodeTest, listRuns, getRun, nodeTestRunning, serverHistory } from './services/node-test';
import { refreshNow } from './scheduler';
import { refreshWallet, deviceSetup, deviceSetupPlan, send, revokeDeviceAccess, revokeOtherDevice, discardSetup } from './services/wallet';
import { nodeViews, refreshNodes, toggleFavourite, findNode } from './services/nodes';
import { connect, disconnect, restoreNetwork, cancelConnect } from './services/connection';
import { runSettlement, withdraw, readSettlements } from './services/settlement';
import { cachedPlans, refreshPlans, refreshSubscriptions, roster, subscribe, closeSub } from './services/plans';
import { listHistory, historyCsv } from './services/history';
import { daemonLists, spendSummary, recentNodes, fundChannel } from './services/activity';
import { runCliLine, openPowerShell } from './services/cli-exec';
import { getHost } from './host';
import { dnsLabel } from '../core/daemon/dns-presets';
import { driversStatus, repairDrivers } from './system/drivers';
import { runDoctor, initDevice, installService, uninstallService, daemonInfo, detectDevice, registerDevice, fixService, serviceNow } from './daemon/manager';
import { getDaemonSettings } from './daemon/settings';
import { applyServiceSettings } from './services/daemon-apply';
import { dnsDoctorRow } from './system/dns-probe';
import { rivalVpnRow } from './system/tunnels';
import { isAndroid } from '../shared/is-android';
import { getSettings, resetSettings, updateSettings } from './system/settings';
import { clearSystemProxy, setSystemProxy, systemProxyActive } from './system/proxy';
import { launchBrowser } from './system/browser';
import { listApps, APP_PICK_DIALOG, resolvePickedApp } from './system/apps';
import { splitApps, splitGet, splitRoutesSet, splitSet } from './android/split-apps';
import { createWallet, importWallet, logout, ownerAddress } from './wallet/vault';
import { isWalletAddress } from '../core/wallet/keys';
import { costPreview, type Basis } from '../core/pricing/cost';
import { getRpcState } from '../core/chain/rpc';
import { publicIp, speedTest } from '../core/quality/quality';
import type { DaemonSettings } from '../core/daemon/config';
import { log, tailLog, redactUrls } from './logger';
import { uiSmokeEnv } from './dev/hooks';
import { ShownError, shownMessage, tr } from '../shared/i18n';

type Handler = (payload: never) => Promise<unknown> | unknown;

function ok<T>(data?: T): Result<T> {
  return { ok: true, data };
}

function wrap(channel: IpcChannel, fn: Handler): void {
  ipcMain.handle(channel, async (_e, payload: unknown) => {
    const tier = TIERS[channel];
    if (tier === 'spend' && channel !== IPC.DISCONNECT && channel !== IPC.DEVICE_SETUP_PLAN && (payload as { confirmed?: unknown } | undefined)?.confirmed !== true) {
      return { ok: false, error: tr('Confirm first.'), code: 'not-confirmed' } satisfies Result;
    }
    try {
      const out = await (fn as (p: unknown) => unknown)(payload);
      return out && typeof out === 'object' && 'ok' in (out as object) ? out : ok(out);
    } catch (err) {
      log.error(`ipc ${channel} failed`, err);
      return { ok: false, error: shownMessage(err, tr('Something went wrong.')), code: 'internal' } satisfies Result;
    }
  });
}

const str = (v: unknown, max = 512): string => {
  if (typeof v !== 'string' || v.length > max) throw new Error('invalid input'); // copy:internal
  return v;
};

export const HANDLERS: Record<IpcChannel, Handler> = {
  // ui
  [IPC.APP_INFO]: () => ({ version: app.getVersion(), network: 'devnet', platform: process.platform, lan: lanRanges(os.networkInterfaces()) }),
  [IPC.OPEN_EXTERNAL]: (url: string) => {
    const u = new URL(str(url, 2048));
    if (u.protocol !== 'https:') throw new Error('only https links open externally'); // copy:internal
    return shell.openExternal(u.toString());
  },
  [IPC.COPY]: (text: string) => clipboard.writeText(str(text, 4096)),
  // Q0324 (Windows twin of Android Q0309): while the recovery phrase shows, the window is left out of
  // screenshots, screen recording and screen sharing (WDA_EXCLUDEFROMCAPTURE on Windows).
  [IPC.PROTECT_SCREEN]: (on: boolean) => { for (const w of BrowserWindow.getAllWindows()) w.setContentProtection(on === true); },
  // readonly
  [IPC.STATE_SNAPSHOT]: () => {
    // The key file answers "is there a wallet?" at once; balances follow from RPC.
    const owner = ownerAddress();
    if (owner && !snapshot().hasWallet) patch({ hasWallet: true, owner });
    return snapshot();
  },
  [IPC.NODES_LIST]: () => nodeViews(),
  [IPC.NODES_REFRESH]: () => refreshNodes(),
  [IPC.PLANS_LIST]: async () => (cachedPlans().length ? cachedPlans() : refreshPlans()),
  // Q0319: Plans re-reads subscriptions when it opens and on Refresh (one made in the CLI or on another
  // device showed only at the next 600 s poll).
  [IPC.SUBSCRIPTIONS_REFRESH]: () => refreshSubscriptions(),
  [IPC.PLAN_ROSTER]: (p: { provider: string; plan: string }) => roster(str(p.provider, 64), str(p.plan, 64)),
  [IPC.COST_PREVIEW]: (p: { node: string; basis: Basis; units: number }) => {
    const n = findNode(str(p.node, 64));
    if (!n) throw new ShownError('Unknown server.');
    return costPreview(n, p.basis === 'per_hour' ? 'per_hour' : 'per_gb', Math.max(1, Math.min(1000, Number(p.units) || 1)));
  },
  [IPC.RPC_STATE]: () => getRpcState(),
  [IPC.DAEMON_DOCTOR]: async () => {
    const [rows, rival] = await Promise.all([runDoctor(), rivalVpnRow()]);
    const dnsRow = await dnsDoctorRow(getDaemonSettings().settings.dnsServers ?? []);
    // Other VPN adapters are a desktop check; Android has none to compete with.
    const extra = isAndroid() ? [] : [rival];
    return dnsRow ? [...rows, dnsRow, ...extra] : [...rows, ...extra];
  },
  [IPC.DRIVERS_STATUS]: () => driversStatus(),
  // Android split (src/main/android/split-apps.ts): refused with a plain message off Android.
  [IPC.SPLIT_GET]: () => splitGet(),
  [IPC.SPLIT_APPS]: () => splitApps(),
  [IPC.SPLIT_SET]: (p: { mode?: unknown; packages?: unknown }) =>
    splitSet(str(p?.mode, 16), Array.isArray(p?.packages) ? p.packages.map((x) => str(x, 256)) : []),
  [IPC.SPLIT_ROUTES_SET]: (p: { mode?: unknown; routes?: unknown }) =>
    splitRoutesSet(str(p?.mode, 16), Array.isArray(p?.routes) ? p.routes.slice(0, 500).map((x) => str(x, 64)) : []),
  // Split tunnelling picker: installed + running apps, each with its own icon (data URL, CSP img-src data:).
  [IPC.APPS_LIST]: async (p?: { chosen?: string[] }) => {
    const chosen = Array.isArray(p?.chosen) ? p.chosen.filter((x) => typeof x === 'string').slice(0, 64).map((x) => str(x, 1024)) : [];
    const view = await listApps(chosen);
    const apps = await Promise.all(view.apps.map(async (a) => {
      try { return { ...a, icon: (await app.getFileIcon(a.path, { size: 'normal' })).toDataURL() }; } catch (err) { log.debug('app icon', { path: a.path, err: (err as Error).message }); return { ...a, icon: null }; }
    }));
    return { ...view, apps };
  },
  // A UDP query to each server, nothing changes (src/main/system/dns-probe.ts). The Settings DNS
  // picker warns before Apply when none of the chosen servers answers (Handshake preset, 2026-10-22).
  // Deposits of ANOTHER device of this wallet (gap #95). Refuses this computer's device and a
  // device that can still spend (settlement.ts otherDeviceReady); the app's own list is unchanged.
  [IPC.SETTLE_LIST]: (p: { device: string }) => {
    const device = str(p?.device, 64);
    if (!isWalletAddress(device)) return { ok: false, error: tr('That is not a device address.'), code: 'bad-device' } satisfies Result;
    return readSettlements(device).catch((err: unknown) => {
      // A lost device still holding its permission is the usual first look, not a failure.
      if ((err as { code?: unknown }).code === 'device-active') {
        return { ok: false, error: tr('That computer can still pay for sessions. Remove its spending limit first; then its deposits can be refunded here.'), code: 'device-active' } satisfies Result;
      }
      throw err;
    });
  },
  [IPC.DNS_PROBE]: async (p?: { servers?: string[] }) => {
    const servers = (Array.isArray(p?.servers) ? p!.servers : []).slice(0, 8).map((s) => str(s, 64));
    const rows = await probeDns(servers);
    return { rows, problem: dnsProbeProblem(rows) };
  },
  [IPC.HISTORY_LIST]: () => listHistory(),
  [IPC.WALLET_QR]: async () => {
    const a = ownerAddress();
    return a ? QRCode.toDataURL(a, { margin: 1, width: 220 }) : null;
  },
  // RPC URLs often carry an API key: the renderer only ever sees them redacted.
  [IPC.DAEMON_SETTINGS_GET]: () => {
    const r = getDaemonSettings();
    const s = { ...r.settings };
    if (s.rpcUrl) s.rpcUrl = redactUrls(s.rpcUrl);
    if (s.rpcWsUrl) s.rpcWsUrl = redactUrls(s.rpcWsUrl);
    return { ...r, settings: s };
  },
  [IPC.QUALITY_IP]: () => (getSettings().thirdPartyChecks ? publicIp(6000, snapshot().session?.proxyEndpoint || undefined) : { error: tr('Third-party checks are off in Settings.') }),
  [IPC.QUALITY_SPEED]: () => (getSettings().thirdPartyChecks ? speedTest(20_000, snapshot().session?.proxyEndpoint || undefined) : { error: tr('Third-party checks are off in Settings.') }),
  [IPC.LOG_TAIL]: () => tailLog(300),
  // Wrapped so a failed command is terminal output, not an app error toast.
  [IPC.CLI_RUN]: async (line: string) => ({ ok: true, data: await runCliLine(str(line, 2000)) }),
  [IPC.CLI_POWERSHELL]: () => openPowerShell(process.execPath, path.join(app.getAppPath(), 'out', 'cli', 'devnet-dvpn.cjs'), getHost().resourcesDir),
  [IPC.ACTIVITY_LISTS]: () => daemonLists(),
  [IPC.SPEND_SUMMARY]: () => spendSummary(),
  [IPC.RECENT_NODES]: () => recentNodes(),
  [IPC.NODE_TEST_PLAN]: (p: { nodes: string[]; protocols?: string[]; limit?: string }) => planNodeTest(nodeList(p?.nodes), { protocols: protoList(p?.protocols), limit: p?.limit === undefined ? undefined : amount(p.limit, 'invalid limit') }),
  [IPC.NODE_TEST_HISTORY]: (p: { id?: string } | undefined) => ({ runs: listRuns(), run: getRun(p?.id ? str(p.id, 64) : undefined), running: nodeTestRunning(), history: serverHistory() }),
  // local
  [IPC.NODE_TEST_STOP]: () => { stopNodeTest(); return true; },
  [IPC.SETTINGS_GET]: () => getSettings(),
  [IPC.SETTINGS_SET]: (patch: Record<string, unknown>) => updateSettings(patch ?? {}),
  [IPC.SETTINGS_RESET]: () => resetSettings(),
  [IPC.FAVOURITE_TOGGLE]: (address: string) => toggleFavourite(str(address, 64)),
  [IPC.HISTORY_EXPORT]: async () => {
    const win = BrowserWindow.getFocusedWindow();
    // UI test runs only (uifire export-csv): the save dialog cannot be driven under Xvfb, so the
    // test names the file. Never set outside DVPN_UI_SMOKE.
    const testPath = uiSmokeEnv(app.isPackaged) ? process.env.DVPN_UI_SAVE_PATH : undefined; // K-M4-5: a release build ignores it
    const r = testPath ? { canceled: false, filePath: testPath }
      : await (win ? dialog.showSaveDialog(win, { defaultPath: 'devnet-dvpn-history.csv' }) : dialog.showSaveDialog({ defaultPath: 'devnet-dvpn-history.csv' }));
    if (r.canceled || !r.filePath) return { ok: false, code: 'cancelled', error: 'Cancelled.' };
    fs.writeFileSync(r.filePath, historyCsv(), 'utf8');
    return ok(r.filePath);
  },
  [IPC.PROXY_SET]: async (p: { on: boolean }) => {
    if (!p?.on) { await clearSystemProxy({ orphan: true }); return ok(false); }
    const ep = snapshot().session?.proxyEndpoint;
    if (!ep) return { ok: false, error: tr('This session has no SOCKS endpoint (only V2Ray/Xray sessions do). Nothing was changed.'), code: 'no-socks' };
    await setSystemProxy(ep);
    return ok(systemProxyActive());
  },
  [IPC.PROXY_BROWSER]: async (p?: { browser?: string }) => {
    const ep = snapshot().session?.proxyEndpoint;
    if (!ep) return { ok: false, error: tr('This session has no SOCKS endpoint (only V2Ray/Xray sessions do). Nothing was opened.'), code: 'no-socks' };
    const b = p?.browser === 'edge' || p?.browser === 'chrome' ? p.browser : undefined;
    try { return ok(await launchBrowser(ep, b)); } catch (err) { return { ok: false, error: shownMessage(err), code: 'no-browser' }; }
  },
  [IPC.APPS_PICK]: async () => {
    const win = BrowserWindow.getFocusedWindow();
    // Each OS's system/apps says what to pick (Windows .exe, macOS .app in /Applications) and turns the
    // pick into the path dvpnd matches (case-sensitive; macOS: the bundle's executable).
    const opts = { title: tr('Choose an app'), properties: ['openFile' as const], ...APP_PICK_DIALOG };
    const r = await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts));
    if (r.canceled || !r.filePaths[0]) return { ok: false, code: 'cancelled', error: 'Cancelled.' };
    const picked = await resolvePickedApp(r.filePaths[0]);
    return 'path' in picked ? ok(picked.path) : { ok: false, code: picked.code, error: picked.error };
  },
  [IPC.WALLET_CREATE]: () => { const r = createWallet(); refreshNow('wallet'); return r; },
  [IPC.WALLET_IMPORT]: (input: string) => { const r = importWallet(str(input, 4096)); refreshNow(); return r; },
  // F2.11: pick a solana-keygen file; main reads it, so the secret never reaches the renderer.
  [IPC.WALLET_IMPORT_FILE]: async () => {
    const win = BrowserWindow.getFocusedWindow();
    const opts = { title: tr('Import a key file'), properties: ['openFile' as const], filters: [{ name: tr('Key file'), extensions: ['json'] }] };
    // UI test runs only (uifire signout): the open dialog cannot be driven under Xvfb, and the key
    // must not pass through the scenario text. Never set outside DVPN_UI_SMOKE.
    const testPath = uiSmokeEnv(app.isPackaged) ? process.env.DVPN_UI_OPEN_PATH : undefined; // K-M4-5: a release build ignores it
    const r = testPath ? { canceled: false, filePaths: [testPath] }
      : await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts));
    if (r.canceled || !r.filePaths[0]) return { ok: false, code: 'cancelled', error: 'Cancelled.' };
    if (fs.statSync(r.filePaths[0]).size > 4096) return { ok: false, code: 'invalid', error: tr('That file is too large to be a key file.') };
    const res = importWallet(fs.readFileSync(r.filePaths[0], 'utf8'));
    refreshNow();
    return ok(res);
  },
  [IPC.WALLET_LOGOUT]: () => { logout(); void refreshWallet(); return true; },
  // privileged
  [IPC.DAEMON_SETTINGS_APPLY]: async (s: DaemonSettings) => {
    const cur = getDaemonSettings().settings;
    const next = { ...s };
    // A redacted URL coming back unchanged means "keep the stored one".
    if (cur.rpcUrl && next.rpcUrl === redactUrls(cur.rpcUrl)) next.rpcUrl = cur.rpcUrl;
    if (cur.rpcWsUrl && next.rpcWsUrl === redactUrls(cur.rpcWsUrl)) next.rpcWsUrl = cur.rpcWsUrl;
    if ([next.rpcUrl, next.rpcWsUrl].some((u) => String(u).includes('<redacted>'))) return { ok: false, error: tr('Enter the full endpoint URL, including its API key, or leave it unchanged.'), code: 'invalid-daemon-setting' };
    // Q0508: the same path as `daemon set` (lock, checks, words, session end, proxy back).
    const r = await applyServiceSettings(next);
    if (r.ok) patch({ dns: dnsLabel(next.dnsServers) });
    return r.ok ? { ok: true, data: { sessionEnded: r.sessionEnded } } : { ok: false, error: r.error, code: r.code };
  },
  [IPC.DAEMON_INIT]: async (p: { step: 'init' | 'install' | 'adopt' | 'fix'; device?: string }) => {
    const owner = ownerAddress();
    if (!owner) return { ok: false, error: tr('Set up a wallet first.') };
    // The one service button (rows 119-142): do the action of the state the service is in now.
    if (p?.step === 'fix') {
      const action = serviceNow().action;
      if (action === 'install' || action === 'reinstall') {
        const w = await refreshWallet();
        if (!w?.ready) return { ok: false, error: tr('Finish device setup first: the service will not start without it.'), code: 'device-not-ready' };
      }
      const r = await fixService();
      refreshNow('wallet');
      return r;
    }
    // An already-installed service: read its device key, or take the address the user typed.
    if (p?.step === 'adopt') {
      let device = p.device ? str(p.device, 64).trim() : '';
      if (!device) {
        const d = await detectDevice();
        if (!d.ok || !d.device) return { ok: false, error: d.error ?? tr('Could not read the device key.'), code: 'detect-failed' };
        device = d.device;
      }
      registerDevice(device, owner);
      refreshNow('wallet');
      return ok(device);
    }
    if (p?.step === 'install') {
      const w = await refreshWallet();
      if (!w?.ready) return { ok: false, error: tr('Finish device setup first: the service will not start without it.'), code: 'device-not-ready' };
      return installService();
    }
    const r = await initDevice(owner);
    refreshNow('wallet');
    return r;
  },
  [IPC.RESTORE_NETWORK]: () => restoreNetwork(),
  // Q0313: the repair report has its own ok field, so it travels as data; returned bare, the IPC layer
  // read it as the Result: call() gave Diagnostics undefined on success (r.view threw, the message stayed
  // "Waiting for the Windows permission prompt…", Repair stayed) and threw on failure (no "Repair did not finish").
  // Progress lines (macOS Homebrew installs run for minutes) reach Diagnostics as EVENTS.DRIVERS.
  [IPC.DRIVERS_REPAIR]: async () => ok(await repairDrivers((line) => broadcast(EVENTS.DRIVERS, { line }))),
  // In-app removal (the macOS app): each OS's manager (Windows answers that the app's uninstaller does it).
  [IPC.SERVICE_UNINSTALL]: () => uninstallService(),
  // E-55: removes a waiting wallet switch or a staged install for another wallet. Nothing is paid or refunded.
  // The snapshot's halfFinishedSetup is set on refreshWallet, so refresh before answering: the button goes away.
  [IPC.DISCARD_SETUP]: async () => { const out = discardSetup(); await refreshWallet(); return ok(out); },
  // spend
  [IPC.CONNECT]: (req: ConnectRequest) => connect({ ...req, node: str(req.node, 64), units: Math.max(1, Math.min(1000, Number(req.units) || 1)), switch: req.switch === true, confirmWalletSwitch: req.confirmWalletSwitch === true }),
  [IPC.DISCONNECT]: async (p: { cancel?: boolean } | undefined) => { if (p?.cancel) { await cancelConnect(); return ok(); } return disconnect(); },
  [IPC.DEVICE_SETUP_PLAN]: (p: { allowance: string; refresh?: boolean }) => deviceSetupPlan(str(p?.allowance ?? getSettings().allowanceTdvpn, 20), p?.refresh === true),
  [IPC.DEVICE_SETUP]: async (p: { allowance: string }) => { const r = await deviceSetup(str(p.allowance, 20)); refreshNow('wallet'); return r; },
  // `device` = ANOTHER device of this wallet (gap #95); without it, this computer's own device.
  [IPC.DEVICE_REVOKE]: (p: { device?: string } | undefined) => (p?.device ? revokeOtherDevice(str(p.device, 64)) : revokeDeviceAccess()),
  // E11: the price the Plans dialog showed travels with the request; a higher price now is refused, nothing paid.
  [IPC.SUBSCRIBE]: (p: { plan: string; close?: string; shownPrice?: string }) => (p.close ? closeSub(str(p.close, 64))
    : subscribe({ plan: str(p.plan, 64), confirmed: true, ...(p.shownPrice === undefined ? {} : { shownPrice: amount(p.shownPrice, 'invalid price') }) })),
  [IPC.SETTLE_RUN]: async (p: { channels?: string[]; device?: string }) => {
    const device = p.device ? str(p.device, 64) : undefined;
    if (device && !isWalletAddress(device)) return { ok: false, error: tr('That is not a device address.'), code: 'bad-device' } satisfies Result;
    // CODE-AUDIT (UI-LEAD, C): only an array of up to 64 address-like strings reaches the settle run.
    const channels = p.channels === undefined ? undefined
      : Array.isArray(p.channels) && p.channels.length <= 64 && p.channels.every((c) => typeof c === 'string' && c.length <= 64 && isWalletAddress(c)) ? p.channels : null;
    if (channels === null) return { ok: false, error: tr('Those are not deposit addresses.'), code: 'bad-channels' } satisfies Result;
    const r = await runSettlement(channels, device);
    refreshNow('wallet', 'settlements');
    return r;
  },
  [IPC.WITHDRAW]: async () => { const r = await withdraw(); await readSettlements(); refreshNow('wallet'); return r; },
  [IPC.CHANNEL_FUND]: (p: { channel: string; tdvpn: string }) => fundChannel(str(p.channel, 64), str(p.tdvpn, 24)),
  [IPC.SEND]: (p: { to: string; tdvpn?: string; sol?: string }) => send({ to: str(p.to, 64), tdvpn: p.tdvpn, sol: p.sol, confirmed: true }),
  // Returns at once; progress and the finished run arrive as EVENTS.NODE_TEST.
  [IPC.NODE_TEST_RUN]: (p: { nodes: string[]; maxSpend: string; protocols?: string[]; resume?: boolean }) => {
    const progress = (prog: unknown): void => broadcast(EVENTS.NODE_TEST, { progress: prog });
    const finished = (r: unknown): void => broadcast(EVENTS.NODE_TEST, { finished: r });
    // Continue the run that was stopped: its own file holds the servers and the limit (UI-SCREENS rows 149-156).
    if (p?.resume === true) {
      void runNodeTest({ nodes: [], maxSpend: '0', confirmed: true, resume: true }, progress).then(finished);
      return ok(true);
    }
    const nodes = nodeList(p?.nodes);
    const maxSpend = amount(p?.maxSpend, 'invalid spend limit');
    void runNodeTest({ nodes, maxSpend, confirmed: true, protocols: protoList(p?.protocols) }, progress).then(finished);
    return ok(true);
  },
};

/** A server list from the page. No small cap (the test has none since 7eb52b9); 2000 only bounds a bad caller. */
function nodeList(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 2000) throw new Error('invalid server list'); // copy:internal
  return v.map((n) => str(n, 64));
}
const protoList = (v: unknown): string[] | undefined => (Array.isArray(v) && v.length <= 16 ? v.map((x) => str(x, 24)) : undefined);
/** A whole number of base units as text. */
function amount(v: unknown, what: string): string {
  const s = str(v, 24);
  if (!/^\d+$/.test(s)) throw new Error(what); // copy:internal
  return s;
}

export function registerIpc(): void {
  for (const [channel, fn] of Object.entries(HANDLERS) as Array<[IpcChannel, Handler]>) wrap(channel, fn);
  log.info('ipc registered', { channels: Object.keys(HANDLERS).length, daemon: daemonInfo().reachable });
}
