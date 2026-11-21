// ─── App settings (F18) — allow-listed keys, clamped values ───
// Pattern from sentinel-node-manager-solana services/settings.ts: unknown keys
// are dropped, every value is validated, nulls fall back to defaults.
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/types';
import { isValidRpcUrl, setRpcUrls } from '../../core/chain/rpc';
import { GB_OPTIONS, HOUR_OPTIONS } from '../../core/pricing/cost';
import { readJson, writeJson } from '../store';
import { sanitizePoll } from '../../shared/poll';
import { storedSpeedOrigin } from '../../core/quality/speed-origin';
import { findLanguage, LONG_TEXT_CODE } from '../../shared/i18n';

const FILE = 'settings.json';
let current: AppSettings = { ...DEFAULT_SETTINGS };
const listeners = new Set<(s: AppSettings) => void>();

export function sanitize(input: Partial<Record<keyof AppSettings, unknown>>, base: AppSettings = DEFAULT_SETTINGS): AppSettings {
  const out: AppSettings = { ...base };
  const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
  if (Array.isArray(input.rpcUrls)) {
    const urls = input.rpcUrls.map((u) => String(u).trim()).filter(isValidRpcUrl);
    out.rpcUrls = urls.length ? [...new Set(urls)].slice(0, 8) : DEFAULT_SETTINGS.rpcUrls;
  }
  if (input.defaultBasis === 'per_gb' || input.defaultBasis === 'per_hour') out.defaultBasis = input.defaultBasis;
  if (GB_OPTIONS.includes(Number(input.defaultGb))) out.defaultGb = Number(input.defaultGb);
  if (HOUR_OPTIONS.includes(Number(input.defaultHours))) out.defaultHours = Number(input.defaultHours);
  if (input.preferredCountry === null || (typeof input.preferredCountry === 'string' && /^[A-Z]{2}$/.test(input.preferredCountry))) out.preferredCountry = input.preferredCountry as string | null;
  out.autoConnect = bool(input.autoConnect, out.autoConnect);
  out.autoTopUpDevice = bool(input.autoTopUpDevice, out.autoTopUpDevice);
  out.autoDevicePermission = bool(input.autoDevicePermission, out.autoDevicePermission);
  out.startWithOs = bool(input.startWithOs, out.startWithOs);
  out.closeToTray = bool(input.closeToTray, out.closeToTray);
  out.thirdPartyChecks = bool(input.thirdPartyChecks, out.thirdPartyChecks);
  out.notifications = bool(input.notifications, out.notifications);
  out.proxyOnConnect = bool(input.proxyOnConnect, out.proxyOnConnect);
  // '' = follow the system; a known code (even a switched-off one: it still loads) or the long-text test language
  if (input.language === '' || input.language === LONG_TEXT_CODE) out.language = input.language;
  else if (typeof input.language === 'string' && findLanguage(input.language)) out.language = findLanguage(input.language)!.code;
  if (input.theme === 'system' || input.theme === 'dark' || input.theme === 'light') out.theme = input.theme;
  if (Array.isArray(input.favourites)) out.favourites = [...new Set(input.favourites.map(String).filter((a) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)))].slice(0, 500);
  if (typeof input.allowanceTdvpn === 'string' && /^\d{1,9}(\.\d{1,6})?$/.test(input.allowanceTdvpn) && Number(input.allowanceTdvpn) > 0) out.allowanceTdvpn = input.allowanceTdvpn;
  if (input.poll !== undefined) out.poll = sanitizePoll(input.poll, out.poll);
  // The speed origin is a pair: both well-formed or both empty; anything else keeps what was stored.
  if (input.speedOrigin !== undefined || input.speedPin !== undefined) {
    const pair = storedSpeedOrigin(input.speedOrigin ?? out.speedOrigin, input.speedPin ?? out.speedPin);
    if (pair) { out.speedOrigin = pair.origin; out.speedPin = pair.pin; }
  }
  return out;
}

export function loadSettings(): AppSettings {
  current = sanitize(readJson<Partial<AppSettings>>(FILE, {}));
  setRpcUrls(current.rpcUrls);
  return current;
}

export function getSettings(): AppSettings {
  return current;
}

export function updateSettings(patch: Partial<Record<keyof AppSettings, unknown>>): AppSettings {
  current = sanitize({ ...current, ...patch }, current);
  writeJson(FILE, current);
  setRpcUrls(current.rpcUrls);
  for (const l of listeners) l(current);
  return current;
}

/** What "Restore default settings" resets: preferences only. Favourites and RPC endpoints are the
 *  user's data (a private RPC key would be lost), so they stay. */
export const RESET_KEYS = (Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>).filter((k) => k !== 'favourites' && k !== 'rpcUrls');

export function resetSettings(): AppSettings {
  const patch: Partial<Record<keyof AppSettings, unknown>> = {};
  for (const k of RESET_KEYS) patch[k] = DEFAULT_SETTINGS[k];
  return updateSettings(patch);
}

export function onSettingsChanged(fn: (s: AppSettings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
