// ─── One administrator prompt per privileged step (D4, F1.5) — Linux ───
// Every privileged step goes through ONE bundled entry point, resources/scripts/dvpn-helper,
// which runs only our own whitelisted scripts. The installer registers a polkit action for
// exactly that path (network.sentinel.devnet-dvpn.helper), so the desktop asks once with our
// own message. Only file paths and validated tokens go on the command line, never config text
// (M5.3 #8), and there is no shell: execFile with an argument array. The step reports through
// a JSON result file in a folder this user created.
//   already root            → run the helper directly
//   `sudo -n` allowed        → sudo -n (SSH sessions, CI, the test VM)
//   otherwise               → pkexec (the desktop's polkit agent shows the prompt)
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { log } from '../logger';

const SAFE_ARG = /^[A-Za-z0-9 _.:/,@+-]+$/;
export const HELPER_STEPS = ['setup-daemon', 'apply-daemon-config', 'remove-tunnels', 'install-deps', 'uninstall-cleanup', 'service-ctl'] as const;
export type HelperStep = typeof HELPER_STEPS[number];

export interface ElevatedResult { status: 'ok' | 'error' | 'cancelled'; detail: string; [k: string]: unknown }

/** The helper's arguments: step name, then --Key value pairs (exported for tests). */
export function helperArgs(step: string, args: Record<string, string>): string[] {
  if (!(HELPER_STEPS as readonly string[]).includes(step)) throw new Error(`unknown elevated step ${step}`); // copy:internal
  const out: string[] = [step];
  for (const [k, v] of Object.entries(args)) {
    if (!/^[A-Za-z]+$/.test(k)) throw new Error(`bad parameter name ${k}`); // copy:internal
    if (!SAFE_ARG.test(v) || v.startsWith('-')) throw new Error(`refusing unsafe argument for elevated step: ${v}`); // copy:internal
    out.push(`--${k}`, v);
  }
  return out;
}

export type Elevator = 'root' | 'sudo' | 'pkexec';

let cached: Elevator | null = null;
/** How this process gets root for a step. Exported for tests (`setElevator`). */
export function elevator(): Promise<Elevator> {
  if (cached) return Promise.resolve(cached);
  if (typeof process.getuid === 'function' && process.getuid() === 0) return Promise.resolve((cached = 'root'));
  return new Promise((resolve) => {
    execFile('sudo', ['-n', 'true'], { timeout: SUDO_PROBE_MS }, (err) => resolve((cached = sudoProbeVerdict(err))));
  });
}
/** sudo looks up this machine's own name first. During a kill-switch session on a cloud VM whose
 *  resolver sits on the NIC with a search domain (Azure 168.63.129.16), that lookup stalls ~10 s,
 *  so a 5 s probe called a working `sudo -n` "refused" and every step fell to pkexec, which has no
 *  agent over SSH ("prompt declined", Azure u2404 2026-10-28). A refusal comes back at once
 *  ("a password is required"); only a refusal means pkexec. A probe still running at the limit
 *  did not refuse, so it stays sudo (the step itself has its own, longer limit). */
export const SUDO_PROBE_MS = 20_000;
export function sudoProbeVerdict(err: (Error & { killed?: boolean; signal?: string | null }) | null): 'sudo' | 'pkexec' {
  if (!err) return 'sudo';
  if (err.killed || err.signal === 'SIGTERM') {
    log.warn('sudo -n probe hit its limit without refusing: using sudo', { limitMs: SUDO_PROBE_MS });
    return 'sudo';
  }
  return 'pkexec';
}
export function setElevator(e: Elevator | null): void {
  cached = e;
}

/** The step name for a script path (scripts are <step>.sh next to dvpn-helper). */
export function stepOf(script: string): string {
  return path.basename(script).replace(/\.sh$/, '');
}

/**
 * An AppImage runs from a FUSE mount ($APPDIR) that root cannot read and that disappears when
 * the app quits. Anything root must read or keep is copied out first (exported for tests).
 */
export function insideAppImage(p: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.APPDIR && (p === env.APPDIR || p.startsWith(env.APPDIR + path.posix.sep));
}

/** Copy `src` (file or folder) to a fresh folder root can read; returns the copy's path. */
export function stageForRoot(src: string, name = path.basename(src)): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devnet-dvpn-stage-'));
  fs.chmodSync(dir, 0o755);
  const out = path.join(dir, name);
  fs.cpSync(src, out, { recursive: true });
  return out;
}

/** Run a helper step as root with named args; resolves with its result JSON. */
/**
 * What to report when the step wrote no result file (#31 54b8ca4). pkexec 126/127 = the prompt was
 * dismissed or not authorised. A step cut off by our time limit is not a declined prompt: saying
 * so sends a person hunting for a prompt that never existed. Exported for tests.
 */
export function noResultOutcome(o: { how: string; exitCode: number | null; timedOut: boolean; timeoutMs: number; stderr: string }): ElevatedResult {
  if (o.timedOut) return { status: 'error', detail: `The administrator step did not finish within ${Math.round(o.timeoutMs / 1000)} s. Try again; a first-time driver setup can be slow.` };
  if (o.how === 'pkexec' && (o.exitCode === 126 || o.exitCode === 127)) return { status: 'cancelled', detail: 'The administrator permission prompt was declined or closed.' };
  const last = o.stderr.trim().split('\n').pop();
  return { status: 'error', detail: `The administrator step did not finish${last ? `: ${last}` : '.'}` };
}

/**
 * L6: a step cut off by our time limit may still have finished its work (the helper keeps running
 * as root after we kill pkexec/sudo). `verify` checks the real outcome; when it returns a result,
 * that replaces the timeout error. Exported for tests.
 */
export async function settleTimedOut(r: ElevatedResult, timedOut: boolean, verify?: () => Promise<ElevatedResult | null>): Promise<ElevatedResult> {
  if (!timedOut || r.status !== 'error' || !verify) return r;
  try {
    return (await verify()) ?? r;
  } catch (err) {
    log.warn('post-timeout verification failed', { err: String(err) });
    return r;
  }
}

export async function runElevated(script: string, args: Record<string, string>, timeoutMs = 120_000, verify?: () => Promise<ElevatedResult | null>): Promise<ElevatedResult> {
  const scriptsDir = insideAppImage(script) ? stageForRoot(path.dirname(script), 'scripts') : path.dirname(script);
  const helper = path.join(scriptsDir, 'dvpn-helper');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devnet-dvpn-'));
  const result = path.join(dir, 'result.json');
  const argv = helperArgs(stepOf(script), { ...args, Result: result });
  const how = await elevator();
  const [cmd, cmdArgs] = how === 'root' ? ['/bin/bash', [helper, ...argv]]
    : how === 'sudo' ? ['sudo', ['-n', '/bin/bash', helper, ...argv]]
      : ['pkexec', [helper, ...argv]];
  log.info('elevated step', { step: argv[0], via: how });
  let exitCode: number | null = 0;
  let stderrText = '';
  let timedOut = false;
  await new Promise<void>((resolve) => {
    execFile(cmd, cmdArgs, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, _stdout, stderr) => {
      stderrText = String(stderr);
      if (err) {
        timedOut = Boolean((err as { killed?: boolean }).killed);
        exitCode = typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : null;
        log.warn('elevated step returned an error', { timedOut, timeoutMs, code: (err as NodeJS.ErrnoException).code, stderr: stderrText.slice(0, 400) });
      }
      resolve();
    });
  });
  try {
    if (!fs.existsSync(result)) return await settleTimedOut(noResultOutcome({ how, exitCode, timedOut, timeoutMs, stderr: stderrText }), timedOut, verify);
    return JSON.parse(fs.readFileSync(result, 'utf8')) as ElevatedResult;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
