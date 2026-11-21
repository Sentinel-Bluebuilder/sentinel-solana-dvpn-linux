// ─── Electron entry (F21, F24) ───
// Order: single-instance lock → host/runtime → crash-safe cleanup (system proxy
// left behind by a crash) → IPC → window → daemon link → scheduler.
// A running daemon session is adopted, never auto-started after a crash.
import { app, BrowserWindow, session, shell } from 'electron';
import path from 'node:path';
import { initRuntime, APP_DIR_NAME } from './runtime';
import { safeStorageKeyStore } from './wallet/electron-keystore';
import { attachGlobalHandlers, log } from './logger';
import { registerIpc } from './ipc';
import { startDaemonLink, stopDaemonLink, onDaemonChange, serviceStaleNames, daemonInfo } from './daemon/manager';
import { startScheduler, stopScheduler, setHidden } from './scheduler';
import { adoptRunningSession, checkLeftoverBlock, disconnect, showBlockWhileServiceStarts } from './services/connection';
import { patch, snapshot } from './app-state';
import './ks-title-wire';
import { restoreProxyOnStartup, clearSystemProxy } from './system/proxy';
import { getSettings, onSettingsChanged } from './system/settings';
import { maybeAutoConnect } from './services/auto-connect';
import { createTray, updateTray, isQuitting, markQuitting, trayActive, destroyTray } from './system/tray';
import { notifyIfHidden } from './system/notify';
import { setStartWithOs, startWithOsActive } from './system/autostart';
import { EVENTS } from '../shared/ipc';
import { BLOCKED_AT_START_NOTICE, LOGIN_ITEM_TICK_MS, SERVICE_START_GRACE_MS, loginItemWanted } from '../shared/kill-switch-start';
import { getDaemonSettings } from './daemon/settings';
import { serviceInTransition } from './services/service-transition';
import { cliKeyStore } from '../cli/keystore';
import { devHooksArmed, uiSmokeEnv } from './dev/hooks';

declare const __DVPN_DEV_HOOKS__: string;
import { startLanguage } from './language';
import { GPU_OFF_SWITCHES, applyGpuFallback } from './system/gpu';

// Test-only overrides (same names as the CLI): a scratch data dir and a read-only
// key file let e2e runs drive the real app without touching the user's profile.
const TEST_DATA_DIR = process.env.DVPN_DATA_DIR || '';
const TEST_KEYFILE = process.env.DVPN_KEYFILE || '';

// K-M4-5: the UI test hooks load only in a build made with them (dev/hooks.ts). The literal test lets a release
// bundle drop the import and its chunk; the switches are appended before 'ready' (the import resolves first).
const uiSmoke = __DVPN_DEV_HOOKS__ && devHooksArmed(app.isPackaged) && process.env.DVPN_UI_SMOKE
  ? import('./dev/ui-smoke').then((m) => { m.prepareUiSmoke(); return m; })
  : null;
app.setName(APP_DIR_NAME);
app.setPath('userData', TEST_DATA_DIR || path.join(app.getPath('appData'), APP_DIR_NAME));
// No GPU on this machine: software rendering from the start, or Chromium may quit at start (Q0246).
const gpuOff = applyGpuFallback(() => {
  app.disableHardwareAcceleration();
  for (const s of GPU_OFF_SWITCHES) app.commandLine.appendSwitch(s); // no GPU process at all (Q0246 pass 2)
});
if (gpuOff) log.info('hardware acceleration off', { reason: gpuOff });

let win: BrowserWindow | null = null;

// A second launch must do nothing but hand over: app.quit() is async, and its startup
// would otherwise still run (restoreProxyOnStartup could clear the first copy's live proxy).
const primary = app.requestSingleInstanceLock();
if (!primary) {
  app.exit(0);
} else {
  app.on('second-instance', () => {
    log.info('second launch: showing the running window instead');
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}

attachGlobalHandlers();

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    title: 'Devnet dVPN',
    backgroundColor: '#060608',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  // A UI smoke run never takes focus or appears on screen: it opens off-screen, without a
  // taskbar button, and shows inactive (owner 2026-10-22: test windows popped up over a game).
  // Started by the session autostart entry (--hidden) with close-to-tray on: stay in the tray (Linux).
  const hidden = process.argv.includes('--hidden') && getSettings().closeToTray;
  if (process.env.DVPN_UI_SMOKE) {
    w.setSkipTaskbar(true);
    w.setFocusable(false);
    w.setPosition(-32000, -32000);
    w.on('ready-to-show', () => w.showInactive());
  } else {
    w.on('ready-to-show', () => { if (!hidden) w.show(); });
  }
  // ─── Crash visibility (RELEASE-TEST-PLAN Phase 6): every renderer death or hang is logged,
  // and a crashed screen reloads once instead of staying blank. The VPN session lives in the
  // service, so a reload never drops it.
  let reloads = 0;
  w.webContents.on('render-process-gone', (_e, d) => {
    log.error('renderer gone', { reason: d.reason, exitCode: d.exitCode });
    if (d.reason !== 'clean-exit' && reloads++ < 1 && !w.isDestroyed()) w.webContents.reload();
  });
  w.on('unresponsive', () => log.warn('window unresponsive'));
  w.on('responsive', () => log.info('window responsive again'));
  w.webContents.on('preload-error', (_e, p, err) => log.error('preload error', { path: p, err: err.message }));
  w.on('close', (e) => {
    if (isQuitting() || !getSettings().closeToTray || !trayActive()) return;
    e.preventDefault();
    w.hide();
  });
  w.on('hide', () => setHidden(true));
  w.on('show', () => setHidden(false));
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => {
    // L-26 (the Windows app ec4dbe6): only the app's own page. The old prefix test let 'http://localhost.example.com' through, and
    // allowed localhost in the installed app, which never loads from it.
    const dev = process.env.ELECTRON_RENDERER_URL;
    if (!url.startsWith('file://') && !(dev && url.startsWith(dev.endsWith('/') ? dev : `${dev}/`))) e.preventDefault();
  });
  if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void w.loadFile(path.join(__dirname, '../renderer/index.html'));
  return w;
}

app.on('child-process-gone', (_e, d) => {
  if (d.reason !== 'clean-exit') log.error('child process gone', { type: d.type, reason: d.reason, exitCode: d.exitCode, name: d.name });
});

app.whenReady().then(async () => {
  if (!primary) return;
  process.env.DVPN_APP_VERSION ??= app.getVersion(); // read by the in-app CLI `version`
  initRuntime({
    name: 'app',
    // electron-builder extraResources copies resources/ to <resourcesPath>/resources.
    resourcesDir: app.isPackaged ? path.join(process.resourcesPath, 'resources') : path.join(app.getAppPath(), 'resources'),
    dataDir: app.getPath('userData'),
    keyStore: TEST_KEYFILE ? cliKeyStore(app.getPath('userData'), TEST_KEYFILE) : safeStorageKeyStore(app.getPath('userData')),
    emit: (channel, payload) => {
      for (const b of BrowserWindow.getAllWindows()) if (!b.isDestroyed()) b.webContents.send(channel, payload);
      if (channel === EVENTS.STATE) updateTray();
      if (channel === EVENTS.TOAST) notifyIfHidden(payload as { kind: string; message: string }, win);
    },
  });
  log.info('app start', { version: app.getVersion(), packaged: app.isPackaged });
  // B5: main writes sentences too; the screens follow snapshot().language.
  await startLanguage(app.getPreferredSystemLanguages(), () => { patch({}); updateTray(); })
    .catch((err) => log.error('language start failed; English', err));
  // No remote content, no permission prompts.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  await restoreProxyOnStartup().catch((err) => log.error('proxy restore on start failed', err));
  registerIpc();
  win = createWindow();
  if (uiSmoke) {
    const smokeWin = win;
    uiSmoke.then((m) => m.runUiSmoke(smokeWin, uiSmokeEnv(app.isPackaged))).catch((err) => log.error('ui smoke failed to start', err));
  }
  createTray(() => win);
  if (!TEST_DATA_DIR) {
    // Electron's login items do nothing on Linux: XDG autostart entry instead. An AppImage
    // runs from a temporary mount, so its stable path is $APPIMAGE.
    const exe = process.env.APPIMAGE || process.execPath;
    // Owner 2026-11-13 (the Windows app edc3751, 610aa31, a8a5076): while the kill switch is on the app starts at log-in, so a
    // block kept across a restart is explained. A kill switch turned on by the CLI (or an Apply whose daemon-change
    // event came before the new setting was readable) is caught by a LOGIN_ITEM_TICK_MS tick; the autostart entry
    // is written only when the decision changes (one log line each time).
    let loginItemLast: string | null = null;
    const loginItem = (why: string): void => {
      const startWithOs = getSettings().startWithOs;
      const daemonSettings = getDaemonSettings();
      if (!daemonSettings.readable && loginItemLast !== null) return; // a moment unreadable (mid-Apply) is not 'off'
      const killSwitch = daemonSettings.settings.killSwitch;
      const openAtLogin = loginItemWanted(startWithOs, killSwitch);
      const key = `${openAtLogin}|${killSwitch}|${startWithOs}|${daemonSettings.readable}`;
      if (key === loginItemLast) return;
      setStartWithOs(openAtLogin, exe); // logs and carries on when the entry can't be written
      loginItemLast = key;
      log.info('log-in item', { why, openAtLogin, killSwitch, startWithOs, readable: daemonSettings.readable, osSays: startWithOsActive() });
    };
    loginItem('start');
    onSettingsChanged(() => loginItem('settings'));
    onDaemonChange(() => loginItem('daemon change')); // the kill switch changes by an Apply, which restarts the service
    setInterval(() => loginItem('tick'), LOGIN_ITEM_TICK_MS).unref();
  }
  startDaemonLink();
  // After the daemon link settles: adopt its session, else look for a leftover block (F14.3).
  // Owner 2026-11-13: a block found while the app starts (a restart while connected) brings the window up and says why.
  let blockAtStartChecked = false;
  // Q0575 (the Windows app 0e68fe5): the service may start well after log-in; a block it keeps is shown meanwhile.
  setTimeout(() => {
    void showBlockWhileServiceStarts().then((shown) => {
      if (!shown || blockAtStartChecked) return;
      notifyIfHidden({ kind: 'warn', message: BLOCKED_AT_START_NOTICE() }, win);
      if (win && !win.isDestroyed() && !win.isVisible()) win.show();
    }).catch((err: unknown) => log.warn('the block check while the service starts failed', { err: (err as Error).message }));
  }, SERVICE_START_GRACE_MS).unref();
  onDaemonChange(() => {
    void adoptRunningSession({ applyProxy: true, startedElsewhere: true }).then(() => checkLeftoverBlock()).then((blocked) => {
      // Only the first settled answer within 3 min of start counts (a restart in progress answers 'no' for now).
      if (blockAtStartChecked || !daemonInfo().reachable || serviceInTransition() || process.uptime() > 180) return;
      blockAtStartChecked = true;
      if (!blocked) return;
      log.info('the kill switch blocks the internet at app start; showing the window');
      notifyIfHidden({ kind: 'warn', message: BLOCKED_AT_START_NOTICE() }, win);
      if (win && !win.isDestroyed() && !win.isVisible()) win.show();
    }).catch((err: unknown) => log.warn('the block check at start failed', { err: (err as Error).message }));
  });
  // Agent M (Mac): an app update that left the service on its old copies says so on Connect, once per start and
  // again each time the service comes back (after Update the VPN service it is current and the banner goes).
  const checkServiceCopies = (): void => {
    try {
      const stale = serviceStaleNames();
      const was = snapshot().serviceOutdated ?? [];
      if (stale.join('|') !== was.join('|')) {
        if (stale.length) log.info('the VPN service runs older copies than this app', { stale });
        patch({ serviceOutdated: stale });
      }
    } catch (err) { log.warn('could not compare the service copies with this app', { err: (err as Error).message }); }
  };
  checkServiceCopies();
  let lastReachable = false;
  onDaemonChange(() => { const up = daemonInfo().reachable; if (up && !lastReachable) checkServiceCopies(); lastReachable = up; });
  startScheduler(); // its first tick reads the wallet; a second read here doubled every startup call (T5)
  if (!process.env.DVPN_UI_SMOKE) void maybeAutoConnect();
}).catch((err) => log.error('startup failed', err));

// Quit = stop the session and put the system proxy back first (F12). Nothing may be
// left steering or blocking traffic with no app watching it. Capped at 10 s so a
// stuck daemon can never stop the app from closing.
let cleanedUp = false;
app.on('before-quit', (e) => {
  markQuitting();
  if (cleanedUp) return;
  e.preventDefault();
  cleanedUp = true;
  stopScheduler();
  const cleanup = (async () => {
    if (snapshot().session) await disconnect();
    await clearSystemProxy();
  })().catch((err) => log.error('quit cleanup failed', err));
  void Promise.race([cleanup, new Promise((r) => setTimeout(r, 10_000))]).finally(() => {
    stopDaemonLink();
    destroyTray();
    app.quit();
  });
});

// Agent M (Mac, rc.2 B pid 3601): a plain SIGTERM (pkill, scripts, launchd/systemd teardown) left the app running,
// with no cleanup. Electron does not map it to a quit; this runs the same before-quit cleanup (10 s cap).
for (const sig of ['SIGTERM', 'SIGHUP'] as const) {
  process.on(sig, () => { log.info('quit on signal', { sig }); app.quit(); });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
