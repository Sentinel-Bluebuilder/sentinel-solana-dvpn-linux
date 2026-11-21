// ─── Split tunnelling picture: which apps go which way (pure, unit-tested) ───
// Two lanes: through the VPN, and the normal connection. Built from the saved [split] setting,
// what dvpnd really applies to this protocol (splitNotApplied), and the live coverage check
// (measured exit IPs), never from the setting alone.
import type { SplitSettings } from '../daemon/config';
import type { Coverage } from '../session/coverage';
import { tr, trPlural } from '../../shared/i18n';

/** The proxy lane, one whole label per OS (the proxy's name is part of the sentence, not dropped in). */
function proxyAppsLabel(platform: string): string {
  if (platform === 'win32') return tr('Browsers and apps that use the Windows proxy');
  if (platform === 'darwin') return tr('Browsers and apps that use the macOS system proxy');
  if (platform === 'linux') return tr('Browsers and apps that use the desktop proxy (GNOME/KDE)');
  return tr('Browsers and apps that use the system proxy');
}

export interface LaneItem { kind: 'app' | 'rest' | 'routes' | 'proxy-apps'; label: string; path?: string }
export interface LaneModel {
  live: boolean;                 // a session is running (else: the plan for the next one)
  applied: boolean;              // dvpnd applies the split to this protocol
  vpn: LaneItem[];
  direct: LaneItem[];
  note: string | null;           // why the picture differs from the setting
}

export function laneModel(o: {
  split: SplitSettings | undefined;
  liveService: string | null;     // null when not connected
  coverage: Coverage | null;
  notApplied: string | null;      // splitNotApplied() for the live (or chosen) protocol
  appName: (path: string) => string;
  /** The OS (process.platform) whose proxy the V2Ray/Xray proxy mode sets; Windows by default. */
  platform?: string;
}): LaneModel {
  const s = o.split ?? { mode: 'off', apps: [], routes: [] };
  const live = !!o.liveService;
  const apps = s.apps.map((p) => ({ kind: 'app' as const, label: o.appName(p), path: p }));
  const routes: LaneItem[] = s.routes.length ? [{ kind: 'routes', label: trPlural({ one: '{n} address range', other: '{n} address ranges' }, s.routes.length) }] : [];

  // V2Ray/Xray without whole-device mode: only apps that use the proxy go through.
  if (live && (o.coverage === 'proxy-only' || o.coverage === 'proxy-apps')) {
    return {
      live, applied: false,
      vpn: [{ kind: 'proxy-apps', label: o.coverage === 'proxy-apps' ? proxyAppsLabel(o.platform ?? 'win32') : tr('Apps you pointed at the VPN proxy') }],
      direct: [{ kind: 'rest', label: o.coverage === 'proxy-apps' ? tr('Apps that ignore the proxy') : tr('Every other app') }],
      note: tr('This session is a proxy, so your app choices are not used. Turn on "Whole computer" to use them.'),
    };
  }
  if (s.mode === 'off' || o.notApplied) {
    return { live, applied: s.mode === 'off', vpn: [{ kind: 'rest', label: tr('Every app') }], direct: [], note: s.mode === 'off' ? null : o.notApplied };
  }
  if (s.mode === 'include') {
    return { live, applied: true, vpn: [...apps, ...routes], direct: [{ kind: 'rest', label: tr('Every other app') }], note: null };
  }
  return { live, applied: true, vpn: [{ kind: 'rest', label: tr('Every other app') }], direct: [...apps, ...routes], note: null };
}
