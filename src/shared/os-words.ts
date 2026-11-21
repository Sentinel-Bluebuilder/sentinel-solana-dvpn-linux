// ─── OS words for shared copy (all-OS port 2026-11-12) ───
// One shared file for every OS build: user-facing words that must name the OS switch on the platform
// string here instead of forking a shared screen or service. Prefer neutral words; add a key only when
// neutral reads wrong.

import { tr } from './i18n';
export type OsPlatform = 'win32' | 'darwin' | 'linux' | 'android' | string;

const WORDS = () => ({
  osName: { win32: 'Windows', darwin: 'macOS', linux: 'Linux', android: 'Android' },
  restart: { win32: tr('Restart Windows'), darwin: tr('Restart the Mac'), linux: tr('Restart the computer'), android: tr('Restart the phone') },
  // Restore network when the VPN service does not answer: on Linux the user can restart just the service (the Linux app u2404 killdaemon 10-22).
  restartService: { win32: tr('Restart Windows'), darwin: tr('Restart the Mac'), linux: tr('Restart it with "sudo systemctl restart sentinel-dvpnd@c0" (or restart the computer)'), android: tr('Restart the phone') },
} as const);

export type OsWordKey = keyof ReturnType<typeof WORDS>;

/** The word for this OS, or a neutral fallback for an unknown platform. */
export function osWord(key: OsWordKey, platform: OsPlatform): string {
  const row = WORDS()[key] as Record<string, string>;
  return row[platform] ?? (key === 'restart' || key === 'restartService' ? tr('Restart the computer') : 'this computer');
}
