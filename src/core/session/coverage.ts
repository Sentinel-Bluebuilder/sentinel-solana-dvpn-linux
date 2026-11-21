// ─── What a connected session really covers (owner 2026-10-21: "it says connected, IP not changed") ───
// "Protected" is shown ONLY when the IP that apps use is the node's. V2Ray/Xray sessions are a
// SOCKS proxy: without the system proxy nothing but proxy-configured apps uses them.
// A full tunnel whose direct exit IP is still the user's own IP is not protecting anything.

import { tr, trPlural } from '../../shared/i18n';
export type Coverage =
  | 'device'      // full tunnel, exit IP checked and not the user's own
  | 'proxy-apps'  // V2Ray/Xray + system proxy: browsers and proxy-aware apps
  | 'proxy-only'  // V2Ray/Xray, system proxy off: only apps pointed at the SOCKS port
  | 'leaking'     // connected, but traffic still leaves with the user's own IP
  | 'unchecked'   // full tunnel, IP not measured yet (or IP checks turned off)
  | 'split-include' // split tunnelling: only the chosen apps/addresses use the VPN (by design)
  | 'split-exclude' // split tunnelling: everything but the left-out apps/addresses, exit checked
  | 'split-exclude-unconfirmed'; // exclude split, but this app's own IP check went direct (it may be left out)

export interface CoverageInput {
  proxyEndpoint: string;     // '' for full-tunnel protocols
  proxyActive: boolean;      // the system proxy points at our SOCKS endpoint
  directIp: string | null;   // exit IP of a normal (non-proxy) request, measured while connected
  proxyIp?: string | null;   // exit IP through the session's SOCKS proxy (V2Ray/Xray)
  homeIp: string | null;     // the user's own IP, measured while not connected
  nodeIp?: string | null;    // the node's own address: an exit IP equal to it is the VPN for sure
  /** Split tunnelling dvpnd applies to this session (splitNotApplied() === null), else null. */
  split?: 'include' | 'exclude' | null;
  /** V2Ray/Xray in whole-device mode (TUN): judged like a full tunnel, the system proxy is not set (the macOS app). */
  wholeDevice?: boolean;
}

export function coverageOf(i: CoverageInput): Coverage {
  // Include: this app's own IP check is not a chosen app, so it SHOULD see the user's own IP.
  if (i.split === 'include') return 'split-include';
  const c = coverageWhole(i);
  if (i.split !== 'exclude') return c;
  // The IP check itself may be what was left out (its addresses or this app), so a home-IP
  // reading cannot tell a leak from the user's own choice: never "Protected", never "leaking".
  return c === 'device' ? 'split-exclude' : c === 'leaking' ? 'split-exclude-unconfirmed' : c;
}

function coverageWhole(i: CoverageInput): Coverage {
  if (i.proxyEndpoint && !i.wholeDevice) {
    // Xray whole-device mode (dvpnd ddv7, TUN adapter): a normal, non-proxy request already
    // leaves through the node, so every app is covered whatever the system proxy says.
    if (i.directIp && i.directIp === i.nodeIp) return 'device';
    if (i.directIp && i.homeIp && i.directIp !== i.homeIp && i.proxyIp && i.directIp === i.proxyIp) return 'device';
    if (!i.proxyActive) return 'proxy-only';
    // Browsers follow the system proxy; a direct request still exits by the user's own IP,
    // which is expected here (apps that ignore the proxy) and said in the copy. The proxy
    // itself must be proven to exit elsewhere first.
    if (i.proxyIp && i.proxyIp === i.nodeIp) return 'proxy-apps';
    if (!i.proxyIp || !i.homeIp) return 'unchecked';
    return i.proxyIp === i.homeIp ? 'leaking' : 'proxy-apps';
  }
  if (i.directIp && i.directIp === i.nodeIp) return 'device';
  if (!i.directIp || !i.homeIp) return 'unchecked';
  return i.directIp === i.homeIp ? 'leaking' : 'device';
}

export interface CoverageCopy {
  title: string;
  detail: string;
  /** True only when the user's traffic is covered as the title says. */
  ok: boolean;
}

// Short and plain (owner 2026-11-12: "user friendly minimalistic"). No IP in the text: the chips under
// the status show them, hidden until clicked.
/**
 * Where a whole-device session applies (Android): the device's name, and the per-app / per-address
 * choice the VPN service applied at connect. Absent on the desktop.
 */
export interface CoverageScope {
  place?: string;
  split?: { mode: 'all' | 'include' | 'exclude'; count: number; routeMode?: 'all' | 'include' | 'exclude'; routeCount?: number } | null;
}

function deviceDetail(scope: CoverageScope): string {
  // place is 'this phone' (main/app-state.ts, Android) or absent (a computer): one whole sentence per device, never the word dropped in
  const phone = scope.place === 'this phone';
  const n = scope.split?.count ?? 0;
  const r = scope.split?.routeCount ?? 0;
  const apps = scope.split?.mode === 'include' && n > 0 ? trPlural({ one: 'Only the app you chose uses the VPN.', other: 'Only the {n} apps you chose use the VPN.' }, n)
    : scope.split?.mode === 'exclude' && n > 0 ? (phone
      ? trPlural({ one: 'Every app on this phone uses the VPN except the one you chose.', other: 'Every app on this phone uses the VPN except the {n} you chose.' }, n)
      : trPlural({ one: 'Every app on this computer uses the VPN except the one you chose.', other: 'Every app on this computer uses the VPN except the {n} you chose.' }, n))
      : phone ? tr('Every app on this phone uses the VPN.') : tr('Every app on this computer uses the VPN.');
  const routes = scope.split?.routeMode === 'include' && r > 0 ? trPlural({ one: 'Only the address you chose goes through it.', other: 'Only the {n} addresses you chose go through it.' }, r)
    : scope.split?.routeMode === 'exclude' && r > 0 ? trPlural({ one: 'The address you chose goes direct.', other: 'The {n} addresses you chose go direct.' }, r)
      : '';
  return routes ? `${apps} ${routes}` : apps; // two whole sentences side by side
}

export function coverageCopy(c: Coverage, ip: { vpnIp?: string | null; homeIp?: string | null; checksOff?: boolean; scope?: CoverageScope } = {}): CoverageCopy {
  switch (c) {
    case 'device':
      return { title: tr('Protected'), detail: deviceDetail(ip.scope ?? {}), ok: true };
    case 'proxy-apps':
      return { title: tr('Protected in browsers'), detail: tr('Your browsers use the VPN. Games and some other apps go direct.'), ok: true };
    case 'proxy-only':
      return { title: tr('Connected, not protecting this computer'), detail: tr('Only apps set to use the VPN proxy are covered. Turn on "Send apps through the VPN" to cover your browsers.'), ok: false };
    case 'leaking':
      return { title: tr('Not going through the VPN'), detail: tr('Sites still see your own address. Try another server, or open Diagnostics.'), ok: false };
    case 'split-include':
      return { title: tr('Protected for the apps you chose'), detail: tr('Only the apps and sites you chose use the VPN.'), ok: true };
    case 'split-exclude':
      return { title: tr('Protected, except what you left out'), detail: tr('Everything uses the VPN except what you left out.'), ok: true };
    case 'split-exclude-unconfirmed':
      return { title: tr('Connected, split tunnelling on'), detail: tr('This app\'s own check went around the VPN, so it can\'t confirm it. Open Diagnostics to check.'), ok: false };
    default:
      return ip.checksOff
        ? { title: tr('Connected'), detail: tr('IP checks are off in Settings, so the app cannot confirm the VPN.'), ok: false }
        : { title: tr('Checking the connection…'), detail: tr('Making sure sites see the server, not you.'), ok: false };
  }
}
