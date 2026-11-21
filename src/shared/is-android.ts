// ─── Which OS build the main process runs in (all-OS port 2026-11-12, lead decision 1) ───
// The one main-side platform reader for shared code: false on Windows, macOS and Linux, true inside the
// Android app's Node. It reads `process` through globalThis because src/core and src/shared are also
// bundled into the renderer, where `process` may be absent. The renderer's reader is
// src/renderer/src/lib/platform.ts (onAndroid/byPlatform/thisDevice); OS words live in os-words.ts.

type ProcLike = { platform?: string; env?: Record<string, string | undefined> };

/** True inside the Android app (Node reports 'android'; DVPN_PLATFORM=android forces it in tests). */
export function isAndroid(): boolean {
  const p = (globalThis as { process?: ProcLike }).process;
  return p?.platform === 'android' || p?.env?.DVPN_PLATFORM === 'android';
}
