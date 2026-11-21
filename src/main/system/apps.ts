// ─── Installed + running apps for the split-tunnelling picker (Windows) ───
// resources/scripts/list-apps.ps1 reads the Start Menu and running windowed programs (no admin);
// core/split/apps.ts merges and cleans the list. The app adds icons (Electron); the CLI does not.
import { execFile } from 'node:child_process';
import { log } from '../logger';
import { scriptPath } from '../daemon/manager';
import { mergeApps, type AppEntry, type RawProcess, type RawShortcut } from '../../core/split/apps';

export interface AppsView { supported: boolean; apps: AppEntry[]; error: string | null }

/** ConvertTo-Json writes a one-element array as a bare object; normalise both. */
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v ? [v] : []) as T[];

export function parseAppsJson(text: string): { shortcuts: RawShortcut[]; procs: RawProcess[] } {
  const raw = JSON.parse(text.replace(/^﻿/, '').trim() || '{}') as { shortcuts?: unknown; procs?: unknown };
  return {
    shortcuts: list<RawShortcut>(raw.shortcuts).filter((s) => typeof s?.target === 'string').map((s) => ({ name: String(s.name ?? ''), target: s.target })),
    procs: list<RawProcess>(raw.procs).filter((p) => typeof p?.path === 'string').map((p) => ({ name: String(p.name ?? ''), path: p.path })),
  };
}

function runScript(): Promise<string> {
  const env = { ...process.env };
  delete env.PSModulePath; // a PowerShell 7 parent breaks 5.1's module autoload (elevate.ts)
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath('list-apps.ps1')],
      { timeout: 45_000, windowsHide: true, env, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
        if (err && !stdout) reject(new Error(`app list failed: ${err.message.slice(0, 200)}`));
        else resolve(String(stdout));
      });
  });
}

/** Apps to choose from; `chosen` (paths already in [split]) are always listed, even if gone from the Start Menu. */
export async function listApps(chosen: string[] = []): Promise<AppsView> {
  if (process.platform !== 'win32') return { supported: false, apps: [], error: null };
  try {
    const { shortcuts, procs } = parseAppsJson(await runScript());
    return { supported: true, apps: mergeApps(shortcuts, procs, chosen), error: null };
  } catch (err) {
    log.warn('app list', { err: (err as Error).message });
    return { supported: true, apps: mergeApps([], [], chosen), error: (err as Error).message };
  }
}

// ─── App picker (shared ipc.ts SPLIT_APP_PICK, the Windows app Mac b2) ───
// dvpnd has no per-app split on Linux (the Split screen offers addresses only), so a pick is refused in plain words.
export const APP_PICK_DIALOG = {};
export async function resolvePickedApp(_p: string): Promise<{ path: string } | { code: string; error: string }> {
  return { code: 'unsupported', error: 'Choosing apps does not work on Linux. Split by address range instead.' };
}
