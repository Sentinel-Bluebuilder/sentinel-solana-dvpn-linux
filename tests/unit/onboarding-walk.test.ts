// ─── AUD-1 (the agent kit rc.9 final audit): the onboarding contract. An agent that only follows `next` must get from an
// empty computer (a funded wallet; no device key, no permission, no service) to connected, in <= 6 steps, never
// repeating a step. Each command's effect is modelled; its `next` is the real function the command uses. `agent
// status` (reached after daemon install) is modelled as "agent up when the service runs" until O3 gives it its own next.
import { describe, it, expect } from 'vitest';
import { noDeviceKeyNext, installNotReadyNext, deviceNext, INIT_NEXT, CLI_NAME } from '../../src/cli/cli-fail';
import { entryFor, unknownFlags } from '../../src/cli/catalogue';
import { parseArgs } from '../../src/cli/args';
import { nextFor } from '../../src/cli/agent-cmd';

interface World { key: boolean; ready: boolean; service: boolean; connected: boolean }
const STATUS_NEXT = `${CLI_NAME} agent status --json`;

/** One command on the modelled computer: its next, or null once connected. */
function run(cmd: string, w: World): string | null {
  switch (cmd) {
    case 'daemon init': w.key = true; return INIT_NEXT;
    case 'device plan': return w.key ? `${CLI_NAME} device setup --allowance 50 --yes` : noDeviceKeyNext(w.service);
    case 'device setup':
      if (!w.key) return noDeviceKeyNext(w.service);
      w.ready = true;
      return deviceNext(w.service ? 'running' : 'no-service');
    case 'daemon install':
      if (!w.ready) return installNotReadyNext(w.key);
      w.service = true;
      return STATUS_NEXT;
    case 'agent status': return w.connected ? null : w.service ? `${CLI_NAME} agent up --yes` : `${CLI_NAME} daemon install --yes`;
    case 'agent up':
      w.key = true; // agent-cmd upOnce: daemon init runs first (local, no service needed)
      if (!w.service) return nextFor('daemon-missing', 'linux');
      w.ready = true; w.connected = true; // first connect: init + permission + deposit (wallet.ts)
      return null;
    default: throw new Error(`unmodelled command: ${cmd}`);
  }
}

/** Each clause of a next ("A, then B") as the command it names; every clause must parse against the catalogue. */
function clauses(next: string): string[] {
  return next.split(/, then /).map((c) => {
    const line = c.replace(/ \(.*$/, '').trim();
    expect(line.startsWith(`${CLI_NAME} `), `not a command: ${line}`).toBe(true);
    const a = parseArgs(line.slice(CLI_NAME.length + 1).split(/\s+/));
    const e = entryFor(a._.join(' '));
    expect(e, `no catalogue entry: ${line}`).not.toBeNull();
    expect(unknownFlags(a._, a.flags), `unknown flags in: ${line}`).toEqual([]);
    return e!.cmd;
  });
}

function walk(start: string): string[] {
  const w: World = { key: false, ready: false, service: false, connected: false };
  const path: string[] = [];
  const seen = new Set<string>();
  let cmd: string | null = start;
  while (cmd) {
    const at = `${cmd}|${JSON.stringify(w)}`;
    if (seen.has(at)) throw new Error(`loop: ${[...path, cmd].join(' -> ')}`);
    seen.add(at);
    path.push(cmd);
    if (path.length > 6) throw new Error(`over 6 steps: ${path.join(' -> ')}`);
    const next = run(cmd, w);
    cmd = next === null ? null : clauses(next)[0];
  }
  expect(w.connected).toBe(true);
  return path;
}

describe('AUD-1: onboarding by next alone, from the empty state', () => {
  for (const start of ['device setup', 'device plan', 'daemon install', 'daemon init', 'agent up']) {
    it(`${start}: reaches connected in <= 6 steps, no repeat`, () => expect(walk(start).length).toBeLessThanOrEqual(6));
  }
  it('the fresh-computer shape: device setup -> daemon init -> device setup -> daemon install -> agent status -> agent up', () => {
    expect(walk('device setup')).toEqual(['device setup', 'daemon init', 'device setup', 'daemon install', 'agent status', 'agent up']);
  });
  it('negative control: a service already running keeps the one-step next (agent up)', () => {
    expect(noDeviceKeyNext(true)).toBe(`${CLI_NAME} agent up --yes`);
    expect(installNotReadyNext(true)).toBe(`${CLI_NAME} device setup --yes, then ${CLI_NAME} daemon install --yes`);
  });
});
