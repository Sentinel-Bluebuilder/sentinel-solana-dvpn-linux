// ─── Settings draft: user edits made before the first read keep over the loaded settings ───
// The Split tunnelling / Kill switch pages read the VPN-service settings once on open. An edit made
// before that read answered was overwritten by it, and with no Apply bar until then the user's
// change was dropped silently (deba splitui 2026-10-29: include + 3 ranges, Apply showed "nothing
// changed", the session connected full tunnel).

import { tr } from '../../shared/i18n';
type Settings = Record<string, unknown>;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Top-level keys whose value differs between two drafts (what one edit touched). */
export function changedKeys(before: Settings, after: Settings): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}

/** Keys the user changed after `sent` went to the service (DVPN-WIN KSM12 k12a: Kill switch On + Apply, then Off
 *  clicked while that Apply ran; the reload after it replaced the draft and the Off choice vanished, no Apply bar). */
export function editedSince(sent: Settings, draftNow: Settings): string[] {
  return changedKeys(sent, { ...sent, ...draftNow });
}

/** Loaded settings with the touched keys taken from the draft (objects one level deep, so a
 *  changed split mode keeps the loaded split routes it did not touch). */
export function mergeLoaded<T extends Settings>(loaded: T, draft: Settings, touched: Iterable<string>): T {
  const out: Settings = { ...loaded };
  for (const k of touched) {
    if (!(k in draft)) continue;
    out[k] = isObj(loaded[k]) && isObj(draft[k]) ? { ...(loaded[k] as Settings), ...(draft[k] as Settings) } : draft[k];
  }
  return out as T;
}

// Q0508 F3: one draft serves Settings, Kill switch and Split tunnelling, so an Apply on one screen also
// sends edits made on another. Every Apply bar names what is unapplied, in the screens' own words.
const AREA = (): Record<string, string> => ({
  killSwitch: tr('Kill switch'), allowLan: tr('Local network (kill switch)'), split: tr('Split tunnelling'), wholeDevice: tr('Whole computer'),
  dnsServers: 'DNS', dnsMode: 'DNS', basis: tr('Defaults for the command line'), escrow: tr('Defaults for the command line'), prepayBytes: tr('Smallest deposit'), prepaySeconds: tr('Smallest deposit'),
  rpcUrl: tr('Solana connection for the VPN service'), rpcWsUrl: tr('Solana connection for the VPN service'),
});

/** Screen names of the unapplied changes, each once. */
export function pendingAreas(saved: Settings, draft: Settings): string[] {
  return [...new Set(changedKeys(saved, { ...saved, ...draft }).map((k) => AREA()[k] ?? k))];
}
