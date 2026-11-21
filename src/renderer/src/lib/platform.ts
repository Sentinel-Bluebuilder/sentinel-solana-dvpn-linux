// ─── Which OS the renderer runs on (shared by all four apps; all-OS port 2026-11-12) ───
// The Android WebView preload sets window.api.platform = 'android'; the Electron preloads do not, so the
// desktop OS comes from the user agent. Screens use this only for wording and for controls that exist on
// one platform; prefer neutral words first (src/shared/os-words.ts for words that must name the OS).
// Superset of the Android app's lib/platform.ts: byPlatform / onAndroid / thisDevice keep their exact behaviour.

export type RendererPlatform = 'win32' | 'darwin' | 'linux' | 'android' | 'other';

// Read through a narrow type: only the Android app's preload declares `platform`, and this file is shared by all four.
export const onAndroid = (): boolean => typeof window !== 'undefined' && (window as unknown as { api?: { platform?: string } }).api?.platform === 'android';

/** The OS this screen runs on. */
export function rendererPlatform(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): RendererPlatform {
  if (onAndroid()) return 'android';
  if (/Windows/i.test(ua)) return 'win32';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'darwin';
  if (/Linux|X11/i.test(ua)) return 'linux';
  return 'other';
}

/** One value per OS, with a fallback for an OS the map leaves out. */
export function osPick<T>(values: Partial<Record<RendererPlatform, T>>, fallback: T, platform: RendererPlatform = rendererPlatform()): T {
  return values[platform] ?? fallback;
}

/** Picks the desktop or the Android text. */
export const byPlatform = <T,>(desktop: T, android: T): T => (onAndroid() ? android : desktop);

/** "this computer" on the desktop, "this phone" on Android. */
export const thisDevice = (): string => byPlatform('this computer', 'this phone');
