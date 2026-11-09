// ─── Start with the desktop session (F18 startWithOs) — Linux ───
// Electron's setLoginItemSettings does nothing on Linux. The XDG way is a .desktop file in
// ~/.config/autostart (GNOME, KDE, Xfce, Cinnamon, MATE all read it).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { log } from '../logger';

export const AUTOSTART_NAME = 'devnet-dvpn.desktop';

export function autostartPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'autostart', AUTOSTART_NAME);
}

/** The .desktop entry text (exported for tests). `exec` is the app binary (AppImage path when run as one). */
export function autostartEntry(exec: string): string {
  // Desktop Entry spec: quote the path when it has spaces; escape the characters it reserves.
  // Spec: inside a quoted argument, " ` $ \ take a backslash; then the whole value is a string
  // where a backslash is itself written as \\. So a " in the path becomes \\" in the file.
  const q = /[\s"'\\$`]/.test(exec) ? `"${exec.replace(/(["`$\\])/g, '\\\\$1')}"` : exec;
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Devnet dVPN',
    'Comment=Peer-to-peer dVPN on the Sentinel Solana devnet',
    `Exec=${q} --hidden`,
    'Icon=devnet-dvpn',
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

/** Write or remove the autostart entry so it matches `on`. */
export function setStartWithOs(on: boolean, exec: string): void {
  const p = autostartPath();
  try {
    if (on) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, autostartEntry(exec), 'utf8');
    } else if (fs.existsSync(p)) {
      fs.rmSync(p, { force: true });
    }
  } catch (err) {
    log.warn('autostart entry not updated', { on, err: (err as Error).message });
  }
}

/** The app binary when this process runs from the installed app: the AppImage ($APPIMAGE, its
 *  stable path), or devnet-dvpn-desktop (the app itself, or the CLI: build/cli/devnet-dvpn runs it
 *  with ELECTRON_RUN_AS_NODE). null from a dev tree or plain node. */
export function appExecutable(execPath = process.execPath, env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.APPIMAGE) return env.APPIMAGE;
  return path.basename(execPath) === 'devnet-dvpn-desktop' ? execPath : null;
}

/** CLI side of `settings set|reset startWithOs`: write or remove the same autostart entry the app
 *  does (it applied only in main/index.ts before, so the CLI change waited for the app; builder-kb,
 *  port of #33 a70fc91a). Returns a note when it can't (not run from the installed app). */
export function applyStartWithOsFromCli(on: boolean, execPath = process.execPath, env: NodeJS.ProcessEnv = process.env): string | null {
  const exe = appExecutable(execPath, env);
  if (exe) {
    setStartWithOs(on, exe);
    return null;
  }
  return 'Start when I log in takes effect the next time the app opens (this command line is not running from the installed app).';
}

export function startWithOsActive(): boolean {
  return fs.existsSync(autostartPath());
}
