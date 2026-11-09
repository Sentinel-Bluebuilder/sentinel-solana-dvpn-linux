// ─── Upgrade: a pre-cb33 daemon home -> the cb33 client instance (c0) ───
// The old build kept its device key and settings in legacyHome() (Windows: C:\ProgramData\dvpnd\client,
// config.toml + client\config.toml, key client\keys\device.json) and ran the service "dvpnd". The cb33 daemon reads
// instanceDir() (Windows: %ProgramData%\sentinel-dvpn\c0, ONE config.toml, key keys\operator.json) as the
// service sentinel-dvpnd$c0. Same pattern as #32 (FLX):
//   1. the old service goes first (Windows: the OLD binary's `service uninstall`; see legacyServiceName): that
//      releases a kill switch the old daemon still holds (gap #84) and frees the tunnel adapters;
//   2. the device key is copied to keys\operator.json, so `init` reuses it (only --new-key replaces a key): the device
//      address, and the spending grant the owner signed for it, stay the same;
//   3. `sentinel-dvpnd init --instance c0 --home <new> --owner <owner> --plain-key` writes the new config.toml;
//   4. the user's settings are carried into it (carrySettingsInto: kill switch "on" arrives as persist);
//   5. the old home stays where it is (rollback; its data.db is not copied: the new daemon reads channels from chain).
// Pure: the caller passes what is on disk and runs the steps (the elevated install step on Windows).

import { carrySettingsInto } from './config';
import { CONFIG_FILE, KEYS_DIR, LEGACY_DEVICE_KEY, OPERATOR_KEY, initArgs, instanceDir, legacyHome, type Goos } from './layout';

export interface HomeView {
  /** true when the path exists (a file or a folder) */
  exists(path: string): boolean;
  /** file text, or null when it is missing or unreadable */
  read(path: string): string | null;
}

export type MigrationStep =
  | { kind: 'uninstall-old-service'; service: string }
  | { kind: 'copy-key'; from: string; to: string }
  | { kind: 'init'; args: string[] }
  | { kind: 'carry-settings'; oldRoot: string; oldClient: string; into: string }
  | { kind: 'keep-old-home'; path: string };

export type MigrationPlan =
  | { migrate: false; reason: 'no-old-home' | 'already-migrated' | 'no-old-key' }
  | { migrate: true; from: string; to: string; steps: MigrationStep[] }
  | { migrate: false; reason: 'key-conflict'; detail: string };

const sep = (goos: Goos): string => (goos === 'win32' ? '\\' : '/');
const join = (goos: Goos, ...parts: string[]): string => parts.join(sep(goos));

/**
 * The service the pre-cb33 builds installed: #31 setup-daemon.ps1 ('dvpnd'), #32 setup-daemon.sh's systemd unit
 * ('dvpnd-client'), #33 _lib.sh's launchd label. How to remove it is each app's (Windows: the old binary's
 * `service uninstall`; Linux: systemctl stop + disable + remove the unit, the old binary has no `service` command).
 */
export function legacyServiceName(goos: Goos): string {
  if (goos === 'win32') return 'dvpnd';
  if (goos === 'darwin') return 'network.sentinel.devnet-dvpn.dvpnd';
  return 'dvpnd-client';
}

export function planHomeMigration(goos: Goos, owner: string, view: HomeView, opts: { programData?: string } = {}): MigrationPlan {
  const from = legacyHome(goos);
  const to = instanceDir(goos, undefined, opts.programData);
  const newConfig = join(goos, to, CONFIG_FILE);
  if (!view.exists(from)) return { migrate: false, reason: 'no-old-home' };
  // A config.toml in the new home means init already ran (an earlier upgrade, or a fresh cb33 setup): never redo it.
  if (view.exists(newConfig)) return { migrate: false, reason: 'already-migrated' };
  // The old daemon kept keys under its role folder: <home>\client\keys (dvpnd-port config.RoleDir + init
  // prepareKey), not <home>\keys. Same plain format in both (a solana-keygen byte array), so a copy is enough.
  const oldKey = join(goos, from, 'client', KEYS_DIR, `${LEGACY_DEVICE_KEY}.json`);
  const newKey = join(goos, to, KEYS_DIR, `${OPERATOR_KEY}.json`);
  const keyText = view.read(oldKey);
  if (keyText === null) return { migrate: false, reason: 'no-old-key' };
  // A different key already sits where the device key would go: init would sign as that one, and the owner's grant
  // (made for the old device) would not cover it. Stop and say so; never overwrite a key.
  const there = view.read(newKey);
  if (there !== null && there.trim() !== keyText.trim()) {
    return { migrate: false, reason: 'key-conflict', detail: `${newKey} holds a different key than ${oldKey}` };
  }
  const steps: MigrationStep[] = [
    { kind: 'uninstall-old-service', service: legacyServiceName(goos) },
    ...(there === null ? [{ kind: 'copy-key', from: oldKey, to: newKey } as const] : []),
    { kind: 'init', args: initArgs(to, owner) },
    { kind: 'carry-settings', oldRoot: join(goos, from, CONFIG_FILE), oldClient: join(goos, from, 'client', CONFIG_FILE), into: newConfig },
    { kind: 'keep-old-home', path: from },
  ];
  return { migrate: true, from, to, steps };
}

/** Step 4: the new config.toml text after the old home's settings are carried in. Missing old files carry nothing. */
export function migratedConfig(oldRoot: string | null, oldClient: string | null, freshConfig: string): string {
  return carrySettingsInto({ root: oldRoot ?? '', client: oldClient ?? '' }, freshConfig);
}
