// ─── Runtime bootstrap shared by the desktop app and the CLI ───
import { installDnsPin, setPinFile } from '../core/net/dns-pin';
import path from 'node:path';
import os from 'node:os';
import { setHost, type Host } from './host';
import { initLogger } from './logger';
import { initStore } from './store';
import { loadSettings } from './system/settings';
import { loadNodeCache } from './services/nodes';
import { setHistoryOwner, stampLegacyHistory } from './services/history';
import { deviceRecord } from './daemon/manager';
import { ownerAddress } from './wallet/vault';
import { log } from './logger';
import { setProbeEndpoint } from '../core/quality/quality';
import { isAndroid } from '../shared/is-android';

export const APP_DIR_NAME = 'Devnet dVPN';

/**
 * Where the app keeps its data, the same folder as Electron's userData on each desktop OS, unless
 * DVPN_DATA_DIR says otherwise (tests; Android's host sets it). One shared file for every OS (all-OS
 * port 2026-11-12): Windows %APPDATA%, macOS ~/Library/Application Support, Linux $XDG_CONFIG_HOME
 * or ~/.config. `platform`/`env` are injectable for tests.
 */
export function defaultDataDir(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  if (env.DVPN_DATA_DIR) return env.DVPN_DATA_DIR;
  if (platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', APP_DIR_NAME);
  if (platform === 'linux') return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), APP_DIR_NAME);
  return path.join(env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), APP_DIR_NAME);
}

export function initRuntime(host: Host): void {
  setHost(host);
  installDnsPin(); // RPC hosts answer from their last addresses while a held kill switch blocks DNS (gap #67)
  setPinFile(path.join(host.dataDir, 'rpc-pin.json')); // post-release F-C4-1: the pin outlives the process, so the CLI works under a held kill switch
  initStore(host.dataDir);
  initLogger(path.join(host.dataDir, 'logs'));
  loadSettings();
  loadNodeCache();
  // History is per wallet. Old entries belong to the wallet that set this computer up; stamp them
  // before a wallet switch rewrites device.json (2026-11-11).
  try {
    const n = stampLegacyHistory(deviceRecord()?.owner ?? null);
    if (n) log.info('history: old entries given their wallet', { entries: n });
  } catch (err) {
    log.warn('history: could not stamp old entries', { err: (err as Error).message });
  }
  setHistoryOwner(() => ownerAddress());
  // Android: exit-IP and speed checks go through the tunnel on purpose (D-A2, dvpnd tunprobe).
  if (isAndroid() && process.env.DVPN_PROBE_SOCKET) setProbeEndpoint(`unix:@${process.env.DVPN_PROBE_SOCKET}`);
}
