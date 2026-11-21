// ─── Kill switch page model (pure, unit-tested) ───
// Live state + the three-step picture "connected → VPN drops → what happens" for each mode.
// Standards: docs/UI-STANDARDS-RESEARCH.md § Kill switch (Mullvad "Blocking internet" state,
// Proton Standard/Advanced, NordVPN "only on an unexpected drop" vs "also when you disconnect").
import type { ConnPhase } from './state';
import { tr } from '../../shared/i18n';

export type KsMode = 'off' | 'on' | 'persist';
export type KsState = 'blocking' | 'armed' | 'standby' | 'off';

export function ksState(o: { phase: ConnPhase; restoreNetwork: boolean; connected: boolean; saved: KsMode }): KsState {
  // Reconnecting blocks only with the kill switch on (off: dvpnd final3 routes go direct, DIR 11-08).
  if (o.restoreNetwork || (o.phase === 'reconnecting' && o.saved !== 'off')) return 'blocking';
  if (o.saved === 'off') return 'off';
  return o.connected ? 'armed' : 'standby';
}

export const KS_STATE_COPY = (): Record<KsState, { title: string; detail: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }> => ({
  blocking: { title: tr('Blocking internet'), detail: tr('The kill switch is holding your traffic so nothing leaks. Connect again, or press Restore network to get your normal connection back.'), tone: 'bad' },
  armed: { title: tr('On and watching'), detail: tr('If the VPN drops, your internet is blocked until it comes back.'), tone: 'ok' },
  standby: { title: tr('Ready'), detail: tr('Nothing is blocked while you are not connected. It turns on with your next session.'), tone: 'muted' },
  off: { title: tr('Off'), detail: tr('If the VPN drops, your traffic uses your normal connection and sites can see your IP address.'), tone: 'warn' },
});

export interface KsStep { label: string; text: string; tone: 'ok' | 'warn' | 'bad' }

export function ksSteps(mode: KsMode): KsStep[] {
  const drop: KsStep = { label: tr('The VPN drops'), text: tr('Network change, server gone, sleep or a crash.'), tone: 'warn' };
  const result: Record<KsMode, KsStep> = {
    off: { label: tr('Then'), text: tr('Your apps carry on over your normal connection. Sites see your IP.'), tone: 'warn' },
    // UI-196 (owner): the way out was missing from this sentence.
    on: { label: tr('Then'), text: tr('Internet is blocked until the VPN reconnects, you disconnect, or you press Restore network.'), tone: 'ok' },
    persist: { label: tr('Then'), text: tr('Internet stays blocked, even after a restart, until you reconnect or press Restore network.'), tone: 'ok' },
  };
  return [{ label: tr('Connected'), text: tr('Your traffic goes through the VPN.'), tone: 'ok' }, drop, result[mode]];
}

/** Which step of the picture is happening now (-1 = none: not connected, not blocking). */
export function ksActiveStep(state: KsState, connected: boolean): number {
  if (state === 'blocking') return 2;
  return connected ? 0 : -1;
}

