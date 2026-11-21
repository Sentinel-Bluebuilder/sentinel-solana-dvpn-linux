// ─── Where the button under a failed or stopped connect goes ───
// Each connect error carries an action (core/session/state.ts connectErrorCopy). Home turns it into
// one button that does what the words say: retry the same server, or go to the screen that fixes it.

import { tr } from './i18n';
export type ConnectActionTarget = 'same-node' | 'nodes' | 'wallet' | 'plans' | 'settings' | 'diagnostics' | 'restore' | 'disconnect';

export interface ConnectActionButton { target: ConnectActionTarget; label: string }

/** The advice an action gives, as a sentence to show after the message (Home's "session ended" banner). The action
 *  itself stays English (it is the routing key above), so each one known is written out here as a whole sentence.
 *  An action not listed shows as it is: English, the same as before. */
export function actionSentence(action: string | null | undefined): string | null {
  const a = String(action ?? '').trim();
  if (!a || a === 'adopt' || a === 'unknown') return null;
  return Object.hasOwn(ACTION_SENTENCES, a) ? ACTION_SENTENCES[a]() : `${a}.`;
}

/** Every action the app gives, with its sentence. tests/unit/i18n-action-sentences.test.ts fails on one missing. */
export const ACTION_SENTENCES: Readonly<Record<string, () => string>> = {
    'Add funds': () => tr('Add funds.'),
    'Add funds and reconnect': () => tr('Add funds and reconnect.'),
    'Connect again': () => tr('Connect again.'),
    'Connect with a new deposit': () => tr('Connect with a new deposit.'),
    'Disconnect': () => tr('Disconnect.'),
    'Fix the clock': () => tr('Fix the clock.'),
    'Increase deposit': () => tr('Increase deposit.'),
    'Open diagnostics': () => tr('Open diagnostics.'),
    'Open Diagnostics': () => tr('Open Diagnostics.'),
    'Open settings': () => tr('Open settings.'),
    'Open Settings': () => tr('Open Settings.'),
    'Open Wallet': () => tr('Open Wallet.'),
    'Or use your own endpoint: devnet-dvpn rpc set <url>': () => tr('Or use your own endpoint: {command}.', { command: 'devnet-dvpn rpc set <url>' }),
    'Refund now': () => tr('Refund now.'),
    'Pick a server you already use': () => tr('Pick a server you already use.'),
    'Pick another server': () => tr('Pick another server.'),
    'Reconnect': () => tr('Reconnect.'),
    'Reconnect with a new deposit': () => tr('Reconnect with a new deposit.'),
    'Report': () => tr('Report.'),
    'Restore network': () => tr('Restore network.'),
    'Retry': () => tr('Retry.'),
    'Retry in a moment': () => tr('Retry in a moment.'),
    'Retry later': () => tr('Retry later.'),
    'Set up device': () => tr('Set up device.'),
    'Top up': () => tr('Top up.'),
    'Top up device': () => tr('Top up device.'),
    'Try again': () => tr('Try again.'),
    'Try another protocol': () => tr('Try another protocol.'),
    'Try another server or protocol': () => tr('Try another server or protocol.'),
    'Try stream payment': () => tr('Try stream payment.'),
    'View plans': () => tr('View plans.'),
};

/** null = no button (internal codes, or no action). */
export function connectActionButton(action: string | null | undefined): ConnectActionButton | null {
  const a = String(action ?? '').trim();
  if (!a || a === 'adopt' || a === 'unknown') return null;
  if (/restore.network/i.test(a)) return { target: 'restore', label: tr('Restore network') };
  // A session is already running (session-active): end it. Before the /connect/ rule below.
  if (/^disconnect/i.test(a)) return { target: 'disconnect', label: tr('Disconnect') };
  if (/fund|top up|wallet|set up device/i.test(a)) return { target: 'wallet', label: tr('Open Wallet') };
  if (/plan/i.test(a)) return { target: 'plans', label: tr('Plans') };
  if (/settings/i.test(a)) return { target: 'settings', label: tr('Settings') };
  if (/diagnostics|report/i.test(a)) return { target: 'diagnostics', label: tr('Diagnostics') };
  // Another server or protocol, or one you already use: the server list.
  if (/another|pick a server/i.test(a)) return { target: 'nodes', label: tr('Servers') };
  // Connect again, Reconnect, Retry, a new or larger deposit, stream payment: the same server again.
  if (/connect|retry|deposit|stream/i.test(a)) return { target: 'same-node', label: /connect again/i.test(a) ? tr('Connect again') : tr('Try again') };
  return { target: 'nodes', label: tr('Servers') };
}
