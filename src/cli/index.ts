// ─── devnet-dvpn CLI ───
// Same services as the desktop app (src/main, Electron-free), different host.
//   node out/cli/devnet-dvpn.cjs <command> [...] [--json] [--yes]
// Exit codes: 0 ok, 1 error, 2 needs --yes, 3 usage.
import path from 'node:path';
import fs from 'node:fs';
import { parseArgs, UsageError, requireValues } from './args';
import { COMMANDS, NeedsConfirm, type Out } from './commands';
import { GROUP_LABEL, entriesFor, entryFor, unknownFlags } from './catalogue';
import { isAndroid } from '../shared/is-android';
import { cliKeyStore } from './keystore';
import { initRuntime, defaultDataDir } from '../main/runtime';
import { startDaemonLink, stopDaemonLink, daemonReady } from '../main/daemon/manager';
import { redactUrls, log } from '../main/logger';
import '../main/ks-title-wire';
import { consoleText } from './console-text';
import { errorOutput, usageOutput } from './error-out';

/** Exit 3: text to stderr as before; with --json one { ok:false, code:'usage' } line on stdout (rc.8). */
function writeUsage(message: string, json: boolean, usageLine: string | null): void {
  const o = usageOutput(message, json, usageLine);
  if (o.stream === 'stdout') process.stdout.write(o.text);
  else process.stderr.write(consoleText(o.text, process.stderr));
}
import { exitCodeFor, PAYING_COMMANDS } from './exit-codes';

function resourcesDir(): string {
  if (process.env.DVPN_RESOURCES) return process.env.DVPN_RESOURCES;
  // out/cli/devnet-dvpn.cjs → <repo>/resources ; packaged: <install>/resources
  const candidates = [
    path.resolve(__dirname, '..', '..', 'resources'),
    // packaged macOS bundle: the app runs from Contents/MacOS, extraResources are in Contents/Resources
    path.resolve(path.dirname(process.execPath), '..', 'Resources', 'resources'),
    path.join(path.dirname(process.execPath), 'resources', 'resources'), // packaged: extraResources
    path.resolve(path.dirname(process.execPath), 'resources'),
  ];
  return candidates.find((c) => fs.existsSync(path.join(c, 'daemon.proto'))) ?? candidates[0];
}

function usage(): string {
  const rows: string[] = [];
  for (const [g, label] of Object.entries(GROUP_LABEL)) {
    rows.push(label);
    // Q0497: Android leaves out the desktop-only commands and uses its own wording.
    for (const e of entriesFor(isAndroid()).filter((x) => x.group === g)) rows.push(`  ${e.usage}
      ${e.summary}`);
  }
  return [
    'devnet-dvpn — pure-P2P dVPN on the Sentinel Solana devnet',
    '',
    'Usage: devnet-dvpn <command> [args] [--json] [--yes] [--verbose]',
    '',
    ...rows,
    '',
    'Env: DVPN_KEYFILE (use a key file in place), DVPN_DATA_DIR, DVPN_DAEMON_PIPE (Windows) or DVPN_DAEMON_SOCKET (macOS, Linux), DVPN_DAEMON_HOME, DVPN_NO_BRIDGE=1, DVPN_DAEMON_TARGET=host:port (Linux test rigs)',
  ].join('\n');
}

async function main(): Promise<number> {
  process.env.NODE_ENV ??= 'production';
  const args = parseArgs(process.argv.slice(2));
  const json = args.flags.json === true;
  const out: Out = {
    json,
    print(human, data) {
      // RPC URLs carry provider API keys in their query string: never print them.
      if (json) {
        if (data !== undefined) process.stdout.write(JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : typeof v === 'string' ? redactUrls(v) : v)) + '\n');
      } else process.stdout.write(consoleText(redactUrls(human)) + '\n');
    },
  };
  const name = args._[0];
  if (!name || args.flags.help === true || name === 'help') { process.stdout.write(consoleText(usage()) + '\n'); return 0; }
  const cmd = COMMANDS[name];
  if (!cmd) {
    if (json) { writeUsage(`unknown command: ${name}`, true, null); return 3; }
    process.stderr.write(consoleText(`unknown command: ${name}\n\n${usage()}\n`, process.stderr)); return 3;
  }
  const unknown = unknownFlags(args._, args.flags);
  if (unknown.length) {
    const e = entryFor(args._.join(' '));
    writeUsage(redactUrls(`unknown option ${unknown.map((k) => `--${k}`).join(', ')} for "${e?.cmd}". Usage: ${e?.usage}`), json, e?.usage ?? null);
    return 3;
  }

  // AUD-2 M5: `--keyfile` with no path must not sign with another wallet (DVPN_KEYFILE or the stored one).
  try { requireValues(args, ['keyfile']); } catch (err) { if (err instanceof UsageError) { writeUsage(err.message, json, null); return 3; } throw err; }
  const dataDir = defaultDataDir();
  const keyfile = typeof args.flags.keyfile === 'string' ? args.flags.keyfile : process.env.DVPN_KEYFILE;
  initRuntime({ name: 'cli', resourcesDir: resourcesDir(), dataDir, keyStore: cliKeyStore(dataDir, keyfile), emit: () => undefined });
  // Internal diagnostics ("[rpc] benched … fetch failed") go to the log, not the terminal: the user
  // gets one plain "Error: …" line. --verbose shows them too (vm-installer-test offline, 2026-10-22).
  if (args.flags.verbose !== true) {
    console.warn = (...a: unknown[]): void => log.warn(a.map(String).join(' '));
    console.error = (...a: unknown[]): void => log.error(a.map(String).join(' '));
  }
  // E-66: a key store that throws while the link starts (macOS Keychain locked over SSH) gets the plain line too.
  stray = { json, command: name };
  let linked = false;
  try {
    if (cmd.needsDaemon) {
      startDaemonLink();
      linked = true;
      await daemonReady();
    }
    await cmd.run(args, out);
    return 0;
  } catch (err) {
    if (err instanceof NeedsConfirm) return 2;
    // Usage errors echo what was typed: a URL there can carry an API key (the macOS app fuzz: poll reset <url>).
    if (err instanceof UsageError) { writeUsage(redactUrls(err.message), json, entryFor(args._.join(' '))?.usage ?? null); return 3; }
    // Q0433/Q0453 (the Linux app): a daemon call's raw gRPC text becomes one plain line (the raw goes to the log).
    // S4: the class of the failure is the exit code (exit-codes.ts); the precise reason stays in `code`.
    return exitCodeFor(writeError(err, json, name), PAYING_COMMANDS.includes(name));
  } finally {
    if (linked) stopDaemonLink();
  }
}

/** The command being run, so a rejection nobody awaited is printed the same way (E-66). */
let stray: { json: boolean; command: string } | null = null;
function writeError(err: unknown, json: boolean, command: string): string | null {
  const o = errorOutput(err, json, command);
  if (o.stream === 'stdout') process.stdout.write(o.text);
  else process.stderr.write(consoleText(o.text, process.stderr));
  return o.code;
}
process.on('unhandledRejection', (err) => {
  log.error('cli: a promise nobody awaited failed', { err: (err as Error)?.stack ?? String(err) });
  writeError(err, stray?.json ?? false, stray?.command ?? 'cli');
  process.exit(1);
});

// Let grpc-js finish closing its handles first; exiting mid-close trips a libuv assertion on Windows.
main().then((code) => { process.exitCode = code; setTimeout(() => process.exit(code), 400).unref(); }, (err) => {
  // E-66: a throw before or around the command (the key store at start-up) is one plain line, never a stack; the stack goes to the log.
  log.error('cli: failed outside the command', { err: (err as Error)?.stack ?? String(err) });
  writeError(err, stray?.json ?? process.argv.includes('--json'), stray?.command ?? 'cli');
  process.exit(1);
});
