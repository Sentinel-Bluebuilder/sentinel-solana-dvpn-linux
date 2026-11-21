// ─── In-app CLI (the CLI screen) ───
// Runs a command line through the SAME command table as the standalone CLI,
// inside the running app (its wallet, service link and state). Rules:
//   · secrets never reach the renderer: wallet create/import are CLI-only (F2.5)
//   · a spend or system change still prints what it would do until --yes is typed
//   · one command at a time; output is redacted like the CLI's
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, UsageError } from '../../cli/args';
import { COMMANDS, NeedsConfirm, type Out } from '../../cli/commands';
import { CATALOGUE, entryFor, GROUP_LABEL } from '../../cli/catalogue';
import { redact, redactUrls, log } from '../logger';
import { getHost } from '../host';
import { openTerminal } from '../system/cli-shell';
import { tr } from '../../shared/i18n';

export interface CliRun { ok: boolean; text: string; needsConfirm?: boolean; code?: number }

let busy = false;

/** Split a command line into words; "double" and 'single' quotes group. */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

export function helpText(): string {
  const rows: string[] = [];
  for (const [g, label] of Object.entries(GROUP_LABEL)) {
    const cmds = CATALOGUE.filter((e) => e.group === g && !e.appBlocked);
    if (!cmds.length) continue;
    rows.push(label);
    for (const c of cmds) rows.push(`  ${c.usage}\n      ${c.summary}`);
  }
  return [...rows, '', tr('Built in: help and clear.'), tr('Add --json for machine output. Spending asks for --yes.')].join('\n');
}

export async function runCliLine(line: string): Promise<CliRun> {
  const words = tokenize(line.trim());
  if (!words.length) return { ok: true, text: '' };
  if (words[0] === 'devnet-dvpn') words.shift();
  if (!words.length || words[0] === 'help') return { ok: true, text: helpText() };
  const cmd = COMMANDS[words[0]];
  if (!cmd) return { ok: false, text: tr('Unknown command "{words}". Type help.', { words: words[0] }), code: 3 };
  const args = parseArgs(words);
  const entry = entryFor(words.join(' '));
  if (entry?.appBlocked) return { ok: false, text: tr('Not available in the app terminal: {appBlocked}', { appBlocked: entry.appBlocked }), code: 3 };
  if (args.flags.follow) return { ok: false, text: tr('Not available in the app terminal: --follow (the Connect screen shows live usage).'), code: 3 };
  if (busy) return { ok: false, text: tr('Another command is still running.'), code: 1 };
  busy = true;
  const lines: string[] = [];
  const json = args.flags.json === true;
  const out: Out = {
    json,
    print(human, data) {
      if (json) { if (data !== undefined) lines.push(JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : typeof v === 'string' ? redactUrls(v) : v), 2)); }
      else lines.push(redactUrls(human));
    },
  };
  try {
    await cmd.run(args, out);
    return { ok: true, text: lines.join('\n'), code: 0 };
  } catch (err) {
    if (err instanceof NeedsConfirm) return { ok: true, needsConfirm: true, text: lines.join('\n'), code: 2 };
    if (err instanceof UsageError) return { ok: false, text: `${err.message}${entry ? `\nUsage: ${entry.usage}` : ''}`, code: 3 };
    const e = err as Error & { action?: string | null };
    log.warn('cli line failed', { cmd: words[0], err: redact(e.message) });
    return { ok: false, text: [...lines, `Error: ${redact(e.message)}${e.action ? `\n→ ${e.action}` : ''}`].join('\n'), code: 1 };
  } finally {
    busy = false;
  }
}

/**
 * How the window is started (Q0295). `start` gives PowerShell a console window of its own (a detached
 * child gets none). The old `spawn('cmd.exe', ['/c', 'start', '"Devnet dVPN CLI"', ..., '-Command', script])` opened
 * nothing (wx1/wa1): Node quoted the title again and cmd read the script's | and & as its own operators.
 * Now the command line goes to cmd verbatim and the script travels base64 (-EncodedCommand), so cmd sees
 * no metacharacters at all.
 */
export function powerShellLaunch(script: string): { file: string; args: string[]; options: { detached: true; stdio: 'ignore'; windowsHide: false; windowsVerbatimArguments: true } } {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return {
    file: 'cmd.exe',
    args: ['/d', '/s', '/c', `start "Devnet dVPN CLI" powershell.exe -NoExit -NoProfile -EncodedCommand ${encoded}`],
    options: { detached: true, stdio: 'ignore', windowsHide: false, windowsVerbatimArguments: true },
  };
}

// ─── macOS: a Terminal.app window (the macOS app) ───
/** Single-quote for bash (exported for tests). */
export const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** The bash rc file that binds `devnet-dvpn` to this app's data folder (exported for tests). */
export function cliShellRc(execPath: string, cliPath: string, resourcesDir: string, dataDir: string): string {
  return [
    '[ -f ~/.bashrc ] && . ~/.bashrc',
    `export DVPN_DATA_DIR=${shq(dataDir)}`,
    `export DVPN_RESOURCES=${shq(resourcesDir)}`,
    // The app binary runs the CLI bundle as plain Node.
    `devnet-dvpn() { ELECTRON_RUN_AS_NODE=1 NODE_NO_WARNINGS=1 ${shq(execPath)} ${shq(cliPath)} "$@"; }`,
    "printf '\\033[32mdevnet-dvpn is ready. Try: devnet-dvpn help\\033[0m\\n'",
    '',
  ].join('\n');
}

/** The .command file Terminal.app runs: Apple's bash with our rc file (exported for tests). */
export function commandFile(rc: string, cwd: string): string {
  return ['#!/bin/bash', `cd ${shq(cwd)} || exit 1`, `exec /bin/bash --rcfile ${shq(rc)} -i`, ''].join('\n');
}

function openMacTerminal(execPath: string, cliPath: string, resourcesDir: string): { ok: boolean; error?: string } {
  const rc = path.join(getHost().dataDir, 'cli-shell.rc');
  const cmd = path.join(getHost().dataDir, 'Devnet dVPN CLI.command');
  try {
    fs.writeFileSync(rc, cliShellRc(execPath, cliPath, resourcesDir, getHost().dataDir), { encoding: 'utf8', mode: 0o600 });
    // Starts in the home folder: cliPath can sit inside app.asar, a file, not a folder (Q0295).
    fs.writeFileSync(cmd, commandFile(rc, os.homedir()), { encoding: 'utf8', mode: 0o700 });
  } catch (err) {
    return { ok: false, error: tr('Could not prepare the terminal: {message}', { message: (err as Error).message }) };
  }
  try {
    const p = spawn('/usr/bin/open', ['-a', 'Terminal', cmd], { detached: true, stdio: 'ignore' });
    p.once('error', (err) => log.error('Open in terminal: Terminal did not start', { err: err.message }));
    p.unref();
    return { ok: true };
  } catch (err) {
    log.warn('Terminal failed to start', { err: (err as Error).message });
    return { ok: false, error: tr('Terminal could not be opened. Run devnet-dvpn from your own terminal.') };
  }
}

/**
 * A shell window with `devnet-dvpn` bound to this app's data folder: PowerShell on Windows, Terminal.app
 * on macOS. Name kept (IPC CLI_POWERSHELL); other OSes add their branch here.
 */
export function openPowerShell(execPath: string, cliPath: string, resourcesDir: string): { ok: boolean; error?: string } {
  if (process.platform === 'darwin') return openMacTerminal(execPath, cliPath, resourcesDir);
  if (process.platform === 'linux') {
    // Linux (the Linux app): bash with this rc in the first terminal program found (platform system/cli-shell.ts).
    const rc = path.join(getHost().dataDir, 'cli-shell.rc');
    try {
      fs.writeFileSync(rc, cliShellRc(execPath, cliPath, resourcesDir, getHost().dataDir), { encoding: 'utf8', mode: 0o600 });
    } catch (err) {
      return { ok: false, error: tr('Could not prepare the terminal: {message}', { message: (err as Error).message }) };
    }
    return openTerminal(rc);
  }
  if (process.platform !== 'win32') return { ok: false, error: tr('PowerShell is Windows-only; run the CLI from your terminal.') };
  const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;
  const script = [
    `$env:DVPN_DATA_DIR = ${q(getHost().dataDir)}`,
    `$env:DVPN_RESOURCES = ${q(resourcesDir)}`,
    // electron.exe is a GUI-subsystem binary: its output shows only when piped.
    `function global:devnet-dvpn { $env:ELECTRON_RUN_AS_NODE = '1'; $env:NODE_NO_WARNINGS = '1'; & ${q(execPath)} ${q(cliPath)} @args 2>&1 | ForEach-Object { "$_" }; $global:LASTEXITCODE = $LASTEXITCODE; Remove-Item Env:ELECTRON_RUN_AS_NODE, Env:NODE_NO_WARNINGS }`,
    "$Host.UI.RawUI.WindowTitle = 'Devnet dVPN CLI'",
    "Write-Host 'devnet-dvpn is ready. Try: devnet-dvpn help' -ForegroundColor Green",
  ].join('; ');
  try {
    const l = powerShellLaunch(script);
    // Q0295 (ddv2-wx1, installed app): cliPath is inside app.asar, which is a file, not a folder. A cwd there
    // made the spawn fail (ENOENT, after this returned ok) and nothing started at all. The shell starts in the
    // user's home folder, and a failed spawn is logged.
    const p = spawn(l.file, l.args, { ...l.options, cwd: os.homedir() });
    p.once('error', (err) => log.error('Open in PowerShell: the shell did not start', { err: err.message }));
    p.unref();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
