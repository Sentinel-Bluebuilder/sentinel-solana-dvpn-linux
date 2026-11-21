// ─── The status card's view (UI-040 to UI-043) ───
// One view model for the sidebar card, the phone header and the More list, so the three say the
// same thing. Always a title and two lines: the card has one height in every state and never
// grows when a session starts (UI-016). Pure.
import { STEPS, connectStage, type StageInput, type StageView } from './connect-stage';
import { tr } from '../../shared/i18n';

export interface CardInput {
  stage: StageInput;
  /** The connection title as the Connect screen shows it. */
  title: string;
  /** Country or city of the server in use or being connected to; '' when unknown. */
  place: string;
  /** Protocol label of the session ('WireGuard'); '' when there is none. */
  protocol: string;
  /** Formatted session time ('12:04') and data ('1.2 GB'); '' when there is no session. */
  time: string;
  data: string;
  /** The VPN service is not ready: its short title and its one fix (service-state.ts action), if any. */
  service: { title: string; action: string | null } | null;
  /** A server test is running in the background. */
  test: { done: number; total: number } | null;
  /** An AI agent is using the app. */
  agent: boolean;
}

export interface CardView {
  stage: StageView;
  title: string;
  /** Second and third line; '' keeps the row empty at its height. */
  line1: string;
  line2: string;
  /** 0–1 while connecting, null otherwise. */
  progress: number | null;
  /** What a click on the card's button does; null = no button (the card itself opens Connect). */
  action: 'restore' | null;
  agent: boolean;
}

/** The plain "not connected" line; the card draws its calm idle look only for this one. */
export const IDLE_LINE = (): string => tr('Pick a server');

/** "Frankfurt over WireGuard", or whichever of the two is known. */
const where = (place: string, protocol: string): string => (place && protocol ? tr('{place} over {protocol}', { place, protocol }) : place || protocol);
/** "1.2 GB in 12:04": data moved in the time connected. */
const used = (time: string, data: string): string => (time && data ? tr('{data} in {time}', { data, time }) : time || data);

/** The service fix as one sentence (service-state.ts actions; the button label is not dropped into a sentence). */
function serviceLine(action: string | null): string {
  if (action === 'install') return tr('Install the VPN service on the Connect page.');
  if (action === 'start') return tr('Start the VPN service on the Connect page.');
  if (action === 'finish-setup') return tr('Finish setup on the Connect page.');
  if (action === 'reinstall') return tr('Reinstall the VPN service on the Connect page.');
  if (action === 'repair') return tr('Repair on the Connect page.');
  return tr('One moment.');
}

export function statusCard(i: CardInput): CardView {
  const stage = connectStage(i.stage);
  const base = { stage, agent: i.agent, progress: null, action: null } as const;
  const quiet = stage.stage === 'idle' || stage.stage === 'problem';

  // The internet may be blocked: that, and its one fix, before anything else.
  if (i.stage.blocked) return { ...base, title: i.title, line1: tr('Your internet may be blocked.'), line2: '', action: 'restore' };
  // The VPN service is not ready and nothing is connected: say that instead of "Not connected".
  if (i.service && quiet) return { ...base, title: i.service.title, line1: serviceLine(i.service.action), line2: '' };
  // A background server test, while you are not connected yourself.
  if (i.test && stage.stage === 'idle') return { ...base, title: tr('Testing servers'), line1: tr('{done} of {total}', { done: i.test.done, total: i.test.total }), line2: '', progress: i.test.total ? i.test.done / i.test.total : null };

  switch (stage.stage) {
    case 'idle': return { ...base, title: i.title, line1: IDLE_LINE(), line2: '' };
    case 'problem': return { ...base, title: i.title, line1: tr('Open Connect to see what to do.'), line2: '' };
    case 'ready': case 'deposit': case 'connecting': case 'checking':
      return { ...base, title: i.title, line1: i.place, line2: stage.step ? tr('Step {step} of {STEPS}', { step: stage.step, STEPS }) : '', progress: stage.step ? stage.step / STEPS : null };
    case 'reconnecting': case 'ending':
      return { ...base, title: i.title, line1: i.place, line2: i.protocol };
    default: // protected, unprotected, unconfirmed
      return { ...base, title: i.title, line1: where(i.place, i.protocol), line2: used(i.time, i.data) };
  }
}
