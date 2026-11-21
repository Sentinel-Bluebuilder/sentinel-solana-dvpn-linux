// ─── The agent contract (the agent kit R2/R3, review): what any answer an agent can get must hold ───
// Reads src/cli as TEXT for the shape checks (it runs nothing that touches the chain, the daemon or the network), and
// imports only the pure tables (catalogue, money-note, exit-codes, session state).
//  1. No bare `throw new Error(` in the CLI outside an allowlist with one reason per entry. A bare throw reaches the
//     agent as code null, exit 1 (error-out.ts plainError recodes only service / RPC text).
//  2. Every command a next / action names (`${CLI} <cmd>` or 'devnet-dvpn <cmd>') exists in catalogue.ts.
//  3. Every failure code has a money class (never the 'unclear' fallback by accident) and an exit consistent with it.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOGUE } from '../../src/cli/catalogue';
import { moneyOf } from '../../src/cli/money-note';
import { exitCodeFor } from '../../src/cli/exit-codes';
import { CONNECT_CODES, PREFLIGHT_CODES } from '../../src/core/session/state';

const CLI_DIR = join(__dirname, '..', '..', 'src', 'cli');
const src = (f: string): string => readFileSync(join(CLI_DIR, f), 'utf8').replace(/\r/g, '');
const cliFiles = readdirSync(CLI_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));

// ─── 1. bare throws ───

/** Every `throw new Error(` site as `file|trimmed line|n` (n = its occurrence among identical lines in that file). */
function bareThrows(): string[] {
  const out: string[] = [];
  for (const f of cliFiles) {
    const seen = new Map<string, number>();
    for (const l of src(f).split('\n')) {
      const t = l.trim();
      if (t.startsWith('//') || t.startsWith('*') || !t.includes('throw new Error(')) continue;
      const n = (seen.get(t) ?? 0) + 1;
      seen.set(t, n);
      out.push(`${f}|${t}|${n}`);
    }
  }
  return out;
}

/** Off the agent path: a person types these, and the text is the whole answer. One reason each. */
const ALLOWED: Record<string, string> = {
  "info-cmd.ts|if (!sep) throw new Error('The current session has no SOCKS endpoint (only V2Ray/Xray sessions do). Nothing was opened.');|1": 'proxy browser (a person opens a browser)',
  "info-cmd.ts|if (!ep) throw new Error('The current session has no SOCKS endpoint (only V2Ray/Xray sessions do). Nothing was changed.');|1": 'proxy on (a person changes the system proxy)',
  "poll-cmd.ts|if (runs.some((r) => !r.ok)) throw new Error(`${runs.filter((r) => !r.ok).map((r) => r.name).join(', ')} failed.`);|1": 'poll run (operator diagnostics)',
  "poll-cmd.ts|if (res.some((r) => !r.ok)) throw new Error('a job broke its cadence');|1": 'poll watch (operator diagnostics)',
};
/** The long connect() error line starts with this; matched by prefix because its tail is long. */
const ALLOWED_PREFIX: Record<string, string> = {
  'commands.ts|if (rivals.length && !(err instanceof UsageError)': 'connect with another VPN on (the agent gets the rivalVpns warning on stderr from agent up)',
};

/** On the agent path and still bare on 4fbd2d3a: R2 gives each a code (docs/ERROR-MAP.md in the hub). Ratchet: never more. */
const R2_KNOWN: readonly string[] = [
  'commands.ts|throw new Error(`Could not read the balances of ${ownerAddress()} right now (network or RPC busy). Try again in a moment.`);|1',
  'commands.ts|if (gone) throw new Error(gone);|1',
  'commands.ts|if (!recorded) throw new Error(`${here(\'This\')} is not set up for any wallet yet: run "device setup --yes" instead.`);|1',
  'commands.ts|if (!plan) throw new Error(`No plan ${a._[2]} on devnet. Run "plans list" to see the plans.`);|1',
  "daemon-cmd.ts|if (!v.live) throw new Error(v.error ?? 'driver check failed');|1",
  "daemon-cmd.ts|if (!r.ok) throw new Error([r.error, ...lines].join('\\n'));|1",
  'daemon-cmd.ts|if (!r.ok) throw new Error(r.error);|1',
  'daemon-cmd.ts|if (!r.ok) throw new Error(r.error);|2',
  'daemon-cmd.ts|if (!r.ok) throw new Error(r.error);|3',
  'daemon-cmd.ts|if (cur.empty) throw new Error(EMPTY_SETTINGS_COPY);|1',
  'daemon-cmd.ts|throw new Error(cur.missing|1',
  'daemon-cmd.ts|if (problem) throw new Error(problem); // exit 1: scripts can gate on it|1',
  "info-cmd.ts|if (!getSettings().thirdPartyChecks) throw new Error('Third-party checks are turned off in settings.');|1",
  "test-cmd.ts|if (!servers.length) throw new Error('No server matches that choice.');|1",
  "test-cmd.ts|if (!p.ok || !p.data) throw new Error(p.error ?? 'Could not plan the run.');|1",
];
/** Matched by prefix (long or multi-part lines). */
const R2_KNOWN_PREFIX: readonly string[] = [
  'daemon-cmd.ts|if (r.status === \'failed\') throw new Error(`Upgrade of the VPN service home stopped at',
  'daemon-cmd.ts|if (!ownerAddress()) throw new Error(\'Create or import a wallet, then run "device setup --yes"',
  'daemon-cmd.ts|if (w && !w.ready) throw new Error(\'Run "device setup --yes" first',
  'keystore.ts|throw new Error(\'Windows cannot encrypt a wallet for this logon',
  'keystore.ts|throw new Error(`Windows wallet encryption failed:',
  "keystore.ts|save() { throw new Error('A --keyfile wallet is read-only.",
  "keystore.ts|remove() { throw new Error('A --keyfile wallet is never deleted by this CLI.');",
  'test-cmd.ts|if (!run) throw new Error(a._[2] ? `No run ${a._[2]}.`',
];
const inPrefix = (s: string, list: readonly string[]): boolean => list.some((p) => s.startsWith(p));
const allowed = (s: string): boolean => s in ALLOWED || inPrefix(s, Object.keys(ALLOWED_PREFIX));
const r2Known = (s: string): boolean => R2_KNOWN.includes(s) || inPrefix(s, R2_KNOWN_PREFIX);

describe('agent contract 1: no bare throw on the agent path', () => {
  it('the scan finds the bare throws (positive control: at least the allowlisted ones exist)', () => {
    const all = bareThrows();
    expect(all.length).toBeGreaterThan(0);
    for (const k of Object.keys(ALLOWED)) expect(all, `allowlisted site is gone, drop it from ALLOWED: ${k}`).toContain(k);
  });
  it('a planted bare throw is caught (negative control on the matcher)', () => {
    const planted = "agent-cmd.ts|if (x) throw new Error('planted');|1";
    expect(allowed(planted) || r2Known(planted)).toBe(false);
  });
  it('ratchet: no NEW bare throw beyond the allowlist and the R2 list', () => {
    const extra = bareThrows().filter((s) => !allowed(s) && !r2Known(s));
    expect(extra, 'give each a code (fail() / Object.assign(new Error, { code, action, next })), or allowlist it with a reason').toEqual([]);
  });
  it('R2: every bare throw on the agent path has a code (R2 landed in rc.7)', () => {
    expect(bareThrows().filter((s) => r2Known(s))).toEqual([]);
  });
});

// ─── 2. every command a next / action names exists ───

const CMDS = new Set(CATALOGUE.map((e) => e.cmd.split(' --')[0]));
/** `<cmd> <sub>` or `<cmd>` from the words after `${CLI} ` / `devnet-dvpn `. */
function named(text: string): Array<{ cmd: string; at: string }> {
  const out: Array<{ cmd: string; at: string }> = [];
  for (const m of text.matchAll(/(?:\$\{CLI\}|devnet-dvpn) ([a-z][a-z-]*)(?: ([a-z][a-z-]*))?/g)) {
    const two = m[2] ? `${m[1]} ${m[2]}` : '';
    out.push({ cmd: two && CMDS.has(two) ? two : m[1], at: m[0] });
  }
  return out;
}
/** Words after the CLI name that are not commands (prose: "devnet-dvpn agent status shows it" is fine; "the devnet-dvpn app" is not a command). */
const NOT_A_COMMAND = new Set(['app', 'command', 'cli', 'is', 'and', 'or']);

describe('agent contract 2: every named command exists in catalogue.ts', () => {
  const files = ['agent-cmd.ts', 'server-stopped.ts', 'status-cmd.ts', 'error-out.ts', 'action-hint.ts'].filter((f) => cliFiles.includes(f));
  it('the scan reads commands (positive control)', () => {
    expect(named(src('agent-cmd.ts')).length).toBeGreaterThan(20);
  });
  it('a planted unknown command is caught (negative control)', () => {
    const bad2 = named('`${CLI} teleport --yes`').filter((x) => !CMDS.has(x.cmd) && ![...CMDS].some((c) => c.startsWith(`${x.cmd} `)));
    expect(bad2.map((x) => x.cmd)).toEqual(['teleport']);
  });
  for (const f of files) {
    it(`${f}: every \`devnet-dvpn <cmd>\` is a catalogue command`, () => {
      const code = src(f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n'); // comments are prose
      const unknown = named(code)
        .filter((x) => !NOT_A_COMMAND.has(x.cmd))
        .filter((x) => !CMDS.has(x.cmd) && ![...CMDS].some((c) => c.startsWith(`${x.cmd} `)))
        .map((x) => x.at);
      expect(unknown).toEqual([]);
    });
  }
});

// ─── 3. every code has a money class and a consistent exit ───

/** The codes agent-cmd.ts raises itself (fail(…, 'code', …)) and the keys of its SWEEP1_NEXT table. */
function agentCodes(): string[] {
  const t = src('agent-cmd.ts');
  // Every code-shaped literal on a fail( line (a ternary such as `open && generic ? 'node-refused' : …` names two).
  const own = t.split('\n').filter((l) => /(^|[^.\w])fail\(/.test(l) && !/function fail\(/.test(l))
    .flatMap((l) => [...l.slice(l.indexOf('fail(')).matchAll(/'([a-z][a-z0-9]*(?:-[a-z0-9]+)+)'/g)].map((m) => m[1]));
  const block = /export const SWEEP1_NEXT[^=]*= \{([\s\S]*?)\n\};/.exec(t)?.[1] ?? '';
  const keys = [...block.matchAll(/(?:^|[,{]\s*|\n\s*)'?([a-z][a-z0-9_ -]*[a-z0-9_])'?:/g)].map((m) => m[1]);
  return [...new Set([...own, ...keys])];
}
/** money-note.ts's explicit UNCLEAR list: an 'unclear' code must be named there, never the fallback. */
const UNCLEAR = [...(/const UNCLEAR: readonly string\[\] = \[([^\]]*)\]/.exec(src('money-note.ts'))?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);

describe('agent contract 3: every code has a money class and an exit', () => {
  const codes = [...new Set([...agentCodes(), ...(CONNECT_CODES as readonly string[]), ...(PREFLIGHT_CODES as readonly string[])])].sort();
  it('the code list is read (positive control)', () => {
    expect(codes.length).toBeGreaterThan(60);
    expect(codes).toEqual(expect.arrayContaining(['not-funded', 'price-cap', 'spending-limit', 'no-nodes', 'node-refused']));
    expect(UNCLEAR.length).toBeGreaterThan(0);
  });
  it('a planted unclassified code is caught (negative control)', () => {
    expect(moneyOf('planted-unclassified')).toBe('unclear');
    expect(UNCLEAR).not.toContain('planted-unclassified');
  });
  it('every code is classified: none / open / refund, or named in UNCLEAR', () => {
    const fallback = codes.filter((c) => moneyOf(c) === 'unclear' && !UNCLEAR.includes(c));
    expect(fallback, 'add each to NONE / OPEN / REFUND / UNCLEAR in money-note.ts').toEqual([]);
  });
  it('exit 6 (retry later) never follows a possibly open deposit', () => {
    expect(codes.filter((c) => exitCodeFor(c) === 6 && moneyOf(c) === 'open')).toEqual([]);
  });
  it('exit 4 (needs a person) is only for refusals that paid nothing', () => {
    expect(codes.filter((c) => exitCodeFor(c) === 4 && moneyOf(c) !== 'none')).toEqual([]);
  });
  it('a failure never exits 0, 2 or 3', () => {
    expect(codes.filter((c) => [0, 2, 3].includes(exitCodeFor(c)))).toEqual([]);
  });
});
