// ─── Open a terminal with the CLI ready — Linux (platform row, lead decision (a) 2026-11-12) ───
// Shared cli-exec.ts writes the bash rc file (cliShellRc: `devnet-dvpn` bound to this app's data folder) and
// calls openTerminal(rc). Each OS has this file with the same export. Linux: the first terminal program found
// on the PATH runs `bash --rcfile <rc> -i`.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { log } from '../logger';

/** Terminal programs to try, with the flag each uses to run a command (exported for tests). */
export const TERMINALS: Array<[string, string[]]> = [
  ['x-terminal-emulator', ['-e']],
  ['gnome-terminal', ['--']],
  ['konsole', ['-e']],
  ['xfce4-terminal', ['-x']],
  ['mate-terminal', ['-x']],
  ['tilix', ['-e']],
  ['xterm', ['-e']],
];

/** A terminal window running bash with `rcFile`. */
export function openTerminal(rcFile: string): { ok: boolean; error?: string } {
  const dirs = (process.env.PATH ?? '/usr/bin:/bin').split(':');
  for (const [term, flag] of TERMINALS) {
    const exe = dirs.map((d) => path.join(d, term)).find((p) => fs.existsSync(p));
    if (!exe) continue;
    try {
      // Home folder, never the CLI's own folder: inside an AppImage/asar that is not a real directory and the
      // spawn fails with ENOENT after this already said ok (the Windows app Q0295).
      const p = spawn(exe, [...flag, 'bash', '--rcfile', rcFile, '-i'], { detached: true, stdio: 'ignore', cwd: os.homedir() });
      p.on('error', (err) => log.warn('terminal failed to start', { term, err: err.message }));
      p.unref();
      return { ok: true };
    } catch (err) {
      log.warn('terminal failed to start', { term, err: (err as Error).message });
    }
  }
  return { ok: false, error: 'No terminal program was found. Run devnet-dvpn from your own terminal.' };
}
