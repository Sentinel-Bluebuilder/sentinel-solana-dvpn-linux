// ─── `test`: in-app node testing from the CLI (rows 143–156) ───
// Same service and the same server count as the app's Node test page. `run` prints one line
// per stage and a result per server; Ctrl-C stops it at the next stage (the server being
// tested is disconnected and its deposit closed first), and `test run --resume` picks the
// run up where it stopped.
import { cliErr, CLI_NAME } from './cli-fail';
import { consoleText } from './console-text';
import fs from 'node:fs';
import type { Args } from './args';
import { flag, str, whole, UsageError } from './args';
import { confirm, type Out } from './commands';
import { refreshNodes, nodeCensus } from '../main/services/nodes';
import { adoptRunningSession } from '../main/services/connection';
import { planNodeTest, runNodeTest, stopNodeTest, listRuns, getRun, serverHistory, type PlanReply } from '../main/services/node-test';
import { compareRuns, runRow, selectServers, type RunRow, type TestRun } from '../core/nodetest/plan';
import { STAGE_LABEL, resultSentence, type TestVerdict } from '../core/nodetest/stages';
import { censusLine } from '../core/nodes/census';
import { VERDICT_TEXT, stagesText, tallyText } from '../core/nodetest/text';
import { tdvpn, toBaseUnits } from '../core/chain/amounts';

const short = (s: string): string => (s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s);
const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;
const clock = (ms: number): string => new Date(ms).toISOString().slice(11, 16);

// UI-194: sentence case, the same words as the Node test page.
export const VERDICT_WORD: Record<TestVerdict, string> = VERDICT_TEXT;

const list = (a: Args, name: string): string[] => (str(a, name) ?? '').split(',').map((x) => x.trim()).filter(Boolean);

/** Servers named on the command line, or chosen from the ones that can be used right now. */
async function pickServers(a: Args): Promise<string[]> {
  const named = a._.slice(2);
  if (named.length) return named;
  const chosen = flag(a, 'online') || flag(a, 'failed-last') || flag(a, 'never-tested') || !!str(a, 'country');
  if (!chosen) throw new UsageError('test run <server…> | --online [--country C] [--protocol P] [--failed-last] [--never-tested] | --resume');
  const views = await refreshNodes({ probe: true });
  const usable = new Set(nodeCensus().entries.filter((e) => e.state === 'usable').map((e) => e.address));
  const picked = selectServers(views.filter((n) => usable.has(n.address)), {
    countries: list(a, 'country'), protocols: list(a, 'protocol'), failedLast: flag(a, 'failed-last'), neverTested: flag(a, 'never-tested'),
  }, serverHistory());
  return picked.slice(0, whole(a, 'max-nodes', 100_000, 1, 100_000)).map((n) => n.address);
}

const tallyLine = (r: Pick<RunRow, 'working' | 'slow' | 'failed' | 'notTested' | 'stoppedJobs'>): string => tallyText(r);

function runLines(run: TestRun): string {
  const row = runRow(run);
  const head = `Run ${run.id}: ${run.stopped ? `stopped after ${row.done} of ${row.total}` : `${row.done} of ${row.total} tested`}. ${tallyLine(row)}.${run.baselineMbps ? ` Without VPN ${run.baselineMbps} Mbps.` : ''}`;
  const rows = run.results.map((r) => {
    const stages = stagesText(r);
    return `${VERDICT_WORD[r.verdict].padEnd(10)} ${short(r.server)}  ${r.protocol.padEnd(10)} ${(r.country || '').padEnd(15)} ${r.code}  ${resultSentence(r)}${stages ? `\n           ${stages}` : ''}`;
  });
  const tail = row.resumable ? [`Not finished: ${plural(row.total - row.done, 'test')} left, ${plural(row.openDeposits, 'deposit')} still to close. Continue with: test run --resume --yes`] : [];
  return [head, ...rows, ...tail].join('\n');
}

function planLine(servers: number, p: PlanReply): string {
  const parts = [
    `${plural(servers, 'server')}: ${plural(p.jobs, 'test')}, at most ${tdvpn(p.peak)} tDVPN on deposit at once, ${tdvpn(p.totalDeposits)} tDVPN paid in deposits over the run.`,
    'A per-hour deposit is closed right after its server; a per-GB refund takes about 2 hours.',
    `About ${Math.max(1, Math.round(p.seconds / 60))} min of testing${p.waitSeconds ? `, plus about ${Math.round(p.waitSeconds / 3600)} h waiting for refunds between ${p.batches.length} batches (a limit of ${tdvpn(p.oneBatchLimit)} tDVPN needs no waiting)` : ''}.`,
  ];
  if (p.overLimit.length) parts.push(`${plural(p.overLimit.length, 'test')} left out: the deposit is over the limit (smallest limit that fits every server: ${tdvpn(p.smallestLimit)} tDVPN).`);
  if (p.unpriced.length) parts.push(`${plural(p.unpriced.length, 'test')} on servers that list no price: checked without paying.`);
  if (p.unknown.length) parts.push(`Not on the network: ${p.unknown.join(', ')}`);
  return parts.join('\n');
}

export async function testCmd(a: Args, o: Out): Promise<void> {
  const sub = a._[1] ?? 'history';
  if (sub === 'servers') {
    await refreshNodes({ probe: true });
    const c = nodeCensus();
    o.print([
      censusLine(c, clock),
      `On the network ${c.onNetwork}: can be used ${c.usable}, not answering ${c.notAnswering}, not verified ${c.unverified}, not checked ${c.notChecked}. Listing expired: ${c.listingExpired}.`,
    ].join('\n'), c);
    return;
  }
  if (sub === 'plan' || sub === 'run') {
    const resume = sub === 'run' && flag(a, 'resume');
    const limitText = str(a, 'limit') ?? str(a, 'max-spend');
    const limit = limitText ? toBaseUnits(limitText) : undefined;
    let servers: string[] = [];
    let plan: PlanReply | null = null;
    if (!resume) {
      servers = await pickServers(a);
      if (!servers.length) throw cliErr('no-nodes', `${CLI_NAME} test servers`, 'No server matches that choice.');
      const p = await planNodeTest(servers, { protocols: list(a, 'protocol'), limit });
      if (!p.ok || !p.data) throw cliErr('test-plan-failed', `${CLI_NAME} test servers`, p.error ?? 'Could not plan the run.');
      plan = p.data;
      if (sub === 'plan') { o.print(planLine(servers.length, plan), plan); return; }
      confirm(a, o, `Test ${plural(servers.length, 'server')}, one real session each: at most ${tdvpn(plan.peak)} tDVPN on deposit at once; the unused part of every deposit is refunded.`, plan);
    } else {
      const last = getRun();
      confirm(a, o, `Continue the last test run${last ? ` (${last.id})` : ''}: close its open deposits, then test the servers it has not reached.`, last ? runRow(last) : null);
    }
    await adoptRunningSession();
    const onStop = (): void => { stopNodeTest(); process.stderr.write(consoleText('\nStopping at the next stage…\n', process.stderr)); };
    process.once('SIGINT', onStop);
    try {
      const r = await runNodeTest({ nodes: servers, maxSpend: plan?.limit ?? '0', confirmed: true, protocols: list(a, 'protocol'), resume }, (p) => {
        if (o.json) return;
        const where = p.server ? `${short(p.server)} ${p.protocol} ` : '';
        const what = p.result ? `${VERDICT_WORD[p.result.verdict]}: ${resultSentence(p.result)}`
          : p.step === 'baseline' ? 'Measuring your speed without VPN…'
            : p.step === 'closing-deposits' ? 'Closing the test deposits…'
              : p.step === 'waiting-for-refunds' ? 'Waiting for refunds before the next batch…'
                : `${STAGE_LABEL[p.step]}…`;
        process.stdout.write(consoleText(`[${p.done}/${p.total}] ${where}${what}\n`));
      });
      if (!r.ok || !r.data) throw Object.assign(new Error(r.error ?? 'Test run failed.'), { code: r.code });
      o.print(runLines(r.data), r.data);
    } finally {
      process.removeListener('SIGINT', onStop);
    }
    return;
  }
  if (sub === 'stop') {
    const here = stopNodeTest();
    o.print(here ? 'Stopping at the next stage.' : 'Asked any running test to stop at its next stage.', { stopping: true });
    return;
  }
  if (sub === 'history') {
    const runs = listRuns();
    o.print(runs.length ? runs.map((r) => `${r.id}: ${r.stopped ? `stopped after ${r.done} of ${r.total}` : `${r.done} of ${r.total} tested`}. ${tallyLine(r)}.${r.resumable ? ' Can be continued.' : ''}`).join('\n') : 'No test runs yet.', runs);
    return;
  }
  if (sub === 'show' || sub === 'export') {
    const run = getRun(a._[2]);
    if (!run) throw cliErr('no-test-run', `${CLI_NAME} test history`, a._[2] ? `No run ${a._[2]}.` : 'No test runs yet.');
    if (sub === 'export') {
      const out = str(a, 'out');
      const body = JSON.stringify(run, null, 2) + '\n';
      if (out) { fs.writeFileSync(out, body, 'utf8'); o.print(`Wrote ${out}`, { file: out }); } else o.print(body.trimEnd(), run);
      return;
    }
    let text = runLines(run);
    if (flag(a, 'compare')) {
      const prevId = listRuns().map((r) => r.id).find((id) => id < run.id);
      const prev = prevId ? getRun(prevId) : null;
      const diff = prev ? compareRuns(prev, run) : [];
      text += prev ? `\nSince ${prev.id}: ${diff.length ? diff.map((d) => `${short(d.server)} ${d.protocol} ${VERDICT_WORD[d.before]} → ${VERDICT_WORD[d.after]}`).join(', ') : 'no result changed'}` : '\nNo earlier run to compare with.';
    }
    o.print(text, run);
    return;
  }
  throw new UsageError(`unknown: test ${sub}`);
}
