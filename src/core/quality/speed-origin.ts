// ─── The speed origin setting: address + key pin (pure: used by the screen, the settings file and the test service) ───
// Both values are public. Both empty = the public speed hosts are used.

import { tr } from '../../shared/i18n';
export interface SpeedOrigin { origin: string; pin: string }

const ORIGIN_RE = /^https:\/\/[^/\s]+$/;
const PIN_RE = /^sha256\/\/[A-Za-z0-9+/=]{43,44}$/;

const clean = (origin: unknown, pin: unknown): SpeedOrigin => ({ origin: String(origin ?? '').trim().replace(/\/+$/, ''), pin: String(pin ?? '').trim() });

/** Both values well-formed, or null (then the public hosts are used). */
export function parseSpeedOrigin(origin: string | undefined | null, pin: string | undefined | null): SpeedOrigin | null {
  const v = clean(origin, pin);
  return ORIGIN_RE.test(v.origin) && PIN_RE.test(v.pin) ? v : null;
}

/** What is wrong with the pair as typed, per field; no keys = it can be saved (both empty, or both well-formed). */
export function speedOriginProblems(origin: string, pin: string): { origin?: string; pin?: string } {
  const v = clean(origin, pin);
  if (!v.origin && !v.pin) return {};
  const out: { origin?: string; pin?: string } = {};
  if (!v.origin) out.origin = tr('Enter the address too, or clear the key.');
  else if (!ORIGIN_RE.test(v.origin)) out.origin = tr('Use an address like https://speed.example.com, with nothing after it.');
  if (!v.pin) out.pin = tr('Enter the key too, or clear the address.');
  else if (!PIN_RE.test(v.pin)) out.pin = tr('The key starts with sha256// and is 44 characters after that.');
  return out;
}

/** The pair as it is stored: both cleaned, or both empty. */
export function storedSpeedOrigin(origin: unknown, pin: unknown): SpeedOrigin | null {
  const v = clean(origin, pin);
  if (!v.origin && !v.pin) return { origin: '', pin: '' };
  return parseSpeedOrigin(v.origin, v.pin);
}
