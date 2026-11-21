// ─── P3 (the agent kit plan): the CLI entry (src/cli/index.ts) — argv → command → exit code and the one-line error ───
// index.ts runs main() on import, so each case sets process.argv, stubs process.exit and imports it fresh.
// Exit codes (index.ts header): 0 ok, 1 error, 2 needs --yes, 3 usage. Every collaborator is a stub.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => {
  class NeedsConfirm extends Error {}
  const state = {
    run: async (_a: unknown, o: { print: (human: string, data?: unknown) => void }): Promise<void> => { o.print('done', { ok: true, url: 'https://rpc.example/?api-key=SECRET' }); },
    daemonCalls: [] as string[],
    initCalls: [] as { keyfile?: string }[],
  };
  return { NeedsConfirm, state };
});

vi.mock('../../src/cli/commands', () => ({
  NeedsConfirm: h.NeedsConfirm,
  COMMANDS: {
    ok: { help: '', run: (a: unknown, o: never) => h.state.run(a, o) },
    linked: { help: '', needsDaemon: true, run: async () => { h.state.daemonCalls.push('run'); } },
  },
}));
vi.mock('../../src/cli/catalogue', () => ({
  GROUP_LABEL: { connect: 'Connect' },
  entriesFor: () => [{ group: 'connect', usage: 'ok', summary: 'a test command', cmd: 'ok' }],
  entryFor: (line: string) => ({ cmd: line, usage: `${line} [--json]` }),
  unknownFlags: (_p: string[], flags: Record<string, unknown>) => Object.keys(flags).filter((k) => k === 'bogus'),
}));
vi.mock('../../src/cli/keystore', () => ({ cliKeyStore: (_d: string, keyfile?: string) => { h.state.initCalls.push({ keyfile }); return {}; } }));
vi.mock('../../src/main/runtime', () => ({ initRuntime: () => undefined, defaultDataDir: () => '/tmp/ddv-test' }));
vi.mock('../../src/main/daemon/manager', () => ({
  startDaemonLink: () => { h.state.daemonCalls.push('start'); },
  stopDaemonLink: () => { h.state.daemonCalls.push('stop'); },
  daemonReady: async () => { h.state.daemonCalls.push('ready'); },
}));
vi.mock('../../src/main/logger', () => ({
  redactUrls: (s: string) => s.replace(/api-key=[^&\s"]+/g, 'api-key=***'),
  log: { warn: () => undefined, error: () => undefined, info: () => undefined },
}));
vi.mock('../../src/main/ks-title-wire', () => ({}));
vi.mock('../../src/cli/console-text', () => ({ consoleText: (s: string) => s }));
vi.mock('../../src/cli/error-out', () => ({
  errorOutput: (err: unknown, json: boolean, command: string) => (json
    ? { stream: 'stdout', text: JSON.stringify({ ok: false, error: (err as Error).message, code: 'test-code', action: null, command }) + '\n' }
    : { stream: 'stderr', text: `Error: ${(err as Error).message}\n` }),
  usageOutput: (message: string, json: boolean, usage: string | null) => (json
    ? { stream: 'stdout', text: JSON.stringify({ ok: false, error: message, code: 'usage', usage }) + '\n' }
    : { stream: 'stderr', text: `${message}\n` }),
}));

const DEFAULT_RUN = h.state.run;
let stdout = ''; let stderr = '';
const argv0 = process.argv;
beforeEach(() => {
  stdout = ''; stderr = '';
  h.state.daemonCalls = []; h.state.initCalls = []; h.state.run = DEFAULT_RUN;
  vi.spyOn(process.stdout, 'write').mockImplementation((c: string | Uint8Array) => { stdout += String(c); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation((c: string | Uint8Array) => { stderr += String(c); return true; });
  vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  vi.resetModules();
});
afterEach(() => { process.argv = argv0; process.exitCode = undefined; vi.restoreAllMocks(); });

/** Runs the entry with argv and resolves to the exit code main() returned. */
async function run(...args: string[]): Promise<number> {
  process.argv = ['node', 'devnet-dvpn', ...args];
  process.exitCode = undefined;
  await import('../../src/cli/index');
  for (let i = 0; i < 100 && process.exitCode === undefined; i++) await new Promise((r) => setTimeout(r, 5));
  return Number(process.exitCode);
}

describe('CLI entry (index.ts)', () => {
  it('no command, help and --help print usage, exit 0', async () => {
    for (const a of [[], ['help'], ['ok', '--help']]) {
      stdout = '';
      expect(await run(...a), a.join(' ')).toBe(0);
      expect(stdout).toContain('Usage: devnet-dvpn <command>');
      expect(stdout).toContain('a test command');
      vi.resetModules();
    }
  });

  it('an unknown command is a usage error (3) on stderr', async () => {
    expect(await run('nope')).toBe(3);
    expect(stderr).toContain('unknown command: nope');
    expect(stdout).toBe('');
  });

  it('an unknown option is a usage error (3) naming the option and the usage line', async () => {
    expect(await run('ok', '--bogus')).toBe(3);
    expect(stderr).toContain('unknown option --bogus for "ok"');
    expect(stderr).toContain('Usage: ok [--json]');
  });

  it('a command that succeeds exits 0; --json prints one line with URLs redacted', async () => {
    expect(await run('ok', '--json')).toBe(0);
    const line = stdout.trim();
    expect(line.split('\n')).toHaveLength(1);
    expect(JSON.parse(line)).toEqual({ ok: true, url: 'https://rpc.example/?api-key=***' });
    expect(stdout).not.toContain('SECRET');
  });

  it('--keyfile wins over DVPN_KEYFILE', async () => {
    process.env.DVPN_KEYFILE = '/env/key.json';
    try {
      await run('ok', '--keyfile', '/flag/key.json');
      expect(h.state.initCalls.at(-1)?.keyfile).toBe('/flag/key.json');
      vi.resetModules();
      await run('ok');
      expect(h.state.initCalls.at(-1)?.keyfile).toBe('/env/key.json');
    } finally { delete process.env.DVPN_KEYFILE; }
  });

  it('NeedsConfirm exits 2 (needs --yes)', async () => {
    h.state.run = async () => { throw new h.NeedsConfirm('confirm'); };
    expect(await run('ok')).toBe(2);
  });

  it('a UsageError exits 3 and the message is redacted', async () => {
    // Imported after beforeEach's resetModules, so it is the same args module the entry will load.
    const { UsageError } = await import('../../src/cli/args');
    h.state.run = async () => { throw new UsageError('bad value https://x/?api-key=SECRET'); };
    expect(await run('ok')).toBe(3);
    expect(stderr).toContain('api-key=***');
    expect(stderr).not.toContain('SECRET');
  });

  it('any other error exits 1 with ONE plain line (json: ok/error/code/action on stdout)', async () => {
    h.state.run = async () => { throw new Error('boom'); };
    expect(await run('ok', '--json')).toBe(1);
    const o = JSON.parse(stdout.trim());
    expect(o).toMatchObject({ ok: false, error: 'boom', code: 'test-code', action: null, command: 'ok' });
    vi.resetModules(); stdout = ''; stderr = '';
    expect(await run('ok')).toBe(1);
    expect(stderr).toBe('Error: boom\n');
    expect(stdout).toBe('');
  });

  it('a daemon command links, waits, runs, then unlinks', async () => {
    expect(await run('linked')).toBe(0);
    expect(h.state.daemonCalls).toEqual(['start', 'ready', 'run', 'stop']);
  });

  it('a command that is not a daemon command never touches the daemon link', async () => {
    expect(await run('ok')).toBe(0);
    expect(h.state.daemonCalls).toEqual([]);
  });
});
