// ─── Node test wording for the command line (UI-187, UI-194) ───
// The same words as the Node test page: verdicts in sentence case, counts and stages as proper
// sentences with commas, never fragments joined by a middle dot.
import { STAGE_LABEL, type ServerTestResult, type TestVerdict } from './stages';
import { tr } from '../../shared/i18n';

export const VERDICT_TEXT: Record<TestVerdict, string> = { working: 'Working', slow: 'Slow', failed: 'Failed', 'not-tested': 'Not tested', stopped: 'Stopped' };
/** The same words for the app, in the chosen language (the terminal keeps VERDICT_TEXT: src/cli stays English). */
export const verdictText = (): Record<TestVerdict, string> => ({ working: tr('Working'), slow: tr('Slow'), failed: tr('Failed'), 'not-tested': tr('Not tested'), stopped: tr('Stopped') });

/** "Working 1, slow 33, failed 2", then not tested / stopped only when there are any. */
export function tallyText(r: { working: number; slow: number; failed: number; notTested: number; stoppedJobs: number }): string {
  const parts = [`Working ${r.working}`, `slow ${r.slow}`, `failed ${r.failed}`];
  if (r.notTested) parts.push(`not tested ${r.notTested}`);
  if (r.stoppedJobs) parts.push(`stopped ${r.stoppedJobs}`);
  return parts.join(', ');
}

/** "Passed: On the network, Answers, Traffic leaves through it (203.0.113.10). Did not pass: Names resolve." */
export function stagesText(r: Pick<ServerTestResult, 'stages' | 'exitIp'>): string {
  const name = (s: ServerTestResult['stages'][number]): string => `${STAGE_LABEL[s.stage]}${s.stage === 'exit-address' && r.exitIp ? ` (${r.exitIp})` : ''}`;
  const passed = r.stages.filter((s) => s.ok).map(name);
  const failed = r.stages.filter((s) => !s.ok).map(name);
  return [passed.length ? `Passed: ${passed.join(', ')}.` : '', failed.length ? tr('Did not pass: {join}.', { join: failed.join(', ') }) : ''].filter(Boolean).join(' ');
}
