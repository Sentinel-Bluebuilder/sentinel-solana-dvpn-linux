// ─── VPN drivers / tools (F1, F17) — Linux ───
// What dvpnd needs on the system: WireGuard tools, AmneziaWG tools + kernel module, OpenVPN,
// nftables (kill switch) and resolvectl/resolvconf (DNS). V2Ray, Xray and Hysteria2 ship in
// the app. The package installs the first ones as dependencies and records a report in
// /var/lib/devnet-dvpn/install-deps.json; here the app (or CLI) re-checks the live state with
// the same script (--CheckOnly: no root, installs nothing) and can repair with one prompt.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getHost } from '../host';
import { log } from '../logger';
import { runElevated } from './elevate';
import { scriptPath } from '../daemon/manager';

export type DriverStatus = 'present' | 'installed' | 'upgraded' | 'missing' | 'failed' | 'incompatible';
export interface DriverRow { name: string; wanted: string; found: string; status: DriverStatus; detail: string }
export interface DriverReport { at: string; ok: boolean; rebootRequired: boolean; deps: DriverRow[] }
export interface DriversView {
  supported: boolean;
  live: DriverReport | null;
  /** What the package install did, if it ran on this computer. */
  installer: DriverReport | null;
  error: string | null;
}

export const DRIVER_LABELS: Record<string, string> = {
  wireguard: 'WireGuard tools',
  amneziawg: 'AmneziaWG (tools + module)',
  openvpn: 'OpenVPN',
  nftables: 'nftables (kill switch)',
  resolvectl: 'DNS (systemd-resolved or resolv.conf)',
  linux: 'Linux (64-bit)',
};

const installerReportPath = (): string => '/var/lib/devnet-dvpn/install-deps.json';

/** Parse a report the script wrote. Exported for tests. */
export function parseReport(text: string): DriverReport | null {
  const raw = JSON.parse(text.replace(/^﻿/, '')) as Partial<DriverReport> & { deps?: DriverRow[] | DriverRow };
  if (typeof raw !== 'object' || raw === null) return null;
  const deps = Array.isArray(raw.deps) ? raw.deps : raw.deps ? [raw.deps] : [];
  return { at: String(raw.at ?? ''), ok: raw.ok === true, rebootRequired: raw.rebootRequired === true, deps };
}

function readInstallerReport(): DriverReport | null {
  const p = installerReportPath();
  if (!fs.existsSync(p)) return null;
  try {
    return parseReport(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    log.warn('installer driver report unreadable', { err: (err as Error).message });
    return null;
  }
}

/**
 * How long the check-only run may take. 60 s by default (about 2 s on real hardware). A test VM
 * that emulates the CPU (QEMU TCG, an arm64 guest on x86) sets
 * DVPN_DRIVER_CHECK_TIMEOUT_MS. Exported for tests.
 */
export function driverCheckTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const v = Number(env.DVPN_DRIVER_CHECK_TIMEOUT_MS);
  return Number.isFinite(v) && v >= 10_000 && v <= 900_000 ? Math.round(v) : 60_000;
}

/** Run the script in --CheckOnly mode; never installs, never prompts. */
function checkLive(): Promise<DriverReport> {
  const out = path.join(getHost().dataDir, 'drivers-check');
  fs.mkdirSync(out, { recursive: true });
  return new Promise((resolve, reject) => {
    execFile('/bin/bash', [scriptPath('install-deps.sh'), '--CheckOnly', '1', '--OutDir', out], { timeout: driverCheckTimeoutMs() }, (err) => {
      // Exit 2 = "something missing": the report is still written and is the answer.
      const file = path.join(out, 'install-deps.json');
      if (fs.existsSync(file)) {
        try {
          const r = parseReport(fs.readFileSync(file, 'utf8'));
          if (r) { resolve(r); return; }
        } catch (parseErr) {
          reject(new Error(`driver check report unreadable: ${(parseErr as Error).message}`));
          return;
        }
      }
      reject(new Error(err ? `driver check failed: ${err.message.slice(0, 200)}` : 'driver check wrote no report'));
    });
  });
}

export async function driversStatus(): Promise<DriversView> {
  const installer = readInstallerReport();
  try {
    return { supported: true, live: await checkLive(), installer, error: null };
  } catch (err) {
    log.warn('driver check', { err: (err as Error).message });
    return { supported: true, live: null, installer, error: (err as Error).message };
  }
}

/** Install or repair every missing driver (one administrator prompt). */
export async function repairDrivers(): Promise<{ ok: boolean; error?: string; view: DriversView }> {
  const r = await runElevated(scriptPath('install-deps.sh'), {}, 900_000);
  const view = await driversStatus();
  if (r.status === 'ok') return { ok: true, view };
  return { ok: false, error: r.status === 'cancelled' ? r.detail : `Some drivers could not be installed: ${r.detail}`, view };
}

/**
 * Windows-only problem (OpenVPN's Wintun adapter, UPSTREAM-GAPS #27): on Linux OpenVPN creates
 * its own tun device per session, so there is nothing to re-create. Kept so callers match.
 */
export async function recreateOpenvpnAdapter(): Promise<{ ok: boolean; detail: string }> {
  return { ok: true, detail: 'not needed on Linux (OpenVPN creates its tun device per session)' };
}

/** One line per driver, for the CLI and the in-app terminal. */
export function driverLines(r: DriverReport): string[] {
  return r.deps.map((d) => {
    const mark = d.status === 'failed' || d.status === 'incompatible' ? 'FAIL' : d.status === 'missing' ? 'miss' : 'ok  ';
    const ver = d.found ? ` ${d.found}` : '';
    return `${mark}  ${(DRIVER_LABELS[d.name] ?? d.name).padEnd(28)} ${d.status}${ver}${d.detail ? `  (${d.detail})` : ''}`;
  });
}

/**
 * AmneziaWG is the one protocol whose tools + kernel module the package does not pull in (no distro
 * ships a current amneziawg-tools; "Repair drivers" installs them). Without them cb33's daemon fails the
 * session at `awg-quick` after the deposit was paid (TLX, Ubuntu 22.04 fresh install, 0.1.11). The
 * reason to stop BEFORE paying, or null when AmneziaWG is ready or the check itself could not run
 * (a failed check never blocks a connect). Pure part exported for tests.
 */
export function amneziawgBlockerFrom(live: DriverReport | null): string | null {
  const row = live?.deps.find((d) => d.name === 'amneziawg');
  if (!row || row.status === 'present' || row.status === 'installed' || row.status === 'upgraded') return null;
  return `This server uses AmneziaWG, and its driver is not ready on this computer${row.detail ? ` (${row.detail})` : ''}. Repair drivers (one administrator prompt), then connect again. Nothing was paid.`;
}

export async function amneziawgBlocker(): Promise<string | null> {
  return amneziawgBlockerFrom((await driversStatus()).live);
}

/** Linux: OpenVPN has no shared adapter to lose (see recreateOpenvpnAdapter). */
export function openvpnAdapterMissing(): Promise<boolean> {
  return Promise.resolve(false);
}
