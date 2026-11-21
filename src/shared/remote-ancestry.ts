// ─── Is this process inside a remote login when the SSH_* variables are gone? (rc.10 KS-SUDO, review H) ───
// sudo's env_reset, `sudo -i` and `su -` drop SSH_CONNECTION / SSH_CLIENT / SSH_TTY, so
// `sudo devnet-dvpn daemon set --kill-switch on --yes` over SSH looked local and was not refused (ctl: `sudo -n env`
// has no SSH variable). Two checks that survive them:
//   logind (Linux): this process's login session (/proc/self/sessionid: kept across sudo and su, and inside tmux)
//     says Remote=yes.
//   the parent chain: an sshd (OpenSSH 9.8+: sshd-session) or mosh-server ancestor. Linux /proc, macOS ps,
//     Windows Win32_Process (sshd.exe).
// A read that fails says nothing (null): it is never taken as "remote" or as "local" on its own.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type ProcInfo = { ppid: number; name: string };
export interface AncestryDeps {
  pid?: number;
  /** A process's parent and executable name; null when it cannot be read. */
  proc?: (pid: number) => ProcInfo | null;
  /** logind: is this process's login session remote? null = unknown (no logind, no session). */
  loginRemote?: () => boolean | null;
}

const REMOTE_PARENT = /^(sshd|sshd-session|sshd-auth|mosh-server)(\.exe)?$/i;
const MAX_HOPS = 64;
const NO_SESSION = '4294967295'; // (u32)-1: the kernel's "no audit session"

function linuxProc(pid: number): ProcInfo | null {
  let s: string;
  try { s = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); } catch (err) {
    return null; // the process ended, or no /proc: the walk stops here
  }
  // "pid (comm) state ppid ...": comm may hold spaces and parentheses, so cut at the LAST ')'.
  const close = s.lastIndexOf(')');
  const ppid = Number(s.slice(close + 2).split(' ')[1]);
  return close > 0 && Number.isInteger(ppid) ? { ppid, name: s.slice(s.indexOf('(') + 1, close) } : null;
}

function darwinProc(pid: number): ProcInfo | null {
  let out: string;
  try {
    out = execFileSync('ps', ['-o', 'ppid=,comm=', '-p', String(pid)], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (err) {
    return null; // ps failed or the process ended: the walk stops here
  }
  const m = /^(\d+)\s+(.+)$/.exec(out);
  return m ? { ppid: Number(m[1]), name: path.basename(m[2]) } : null;
}

function win32Table(): ((pid: number) => ProcInfo | null) | null {
  let out: string;
  try {
    out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.Name)" }'],
    { encoding: 'utf8', timeout: 15_000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) {
    return null; // no process table: this check says nothing
  }
  const t = new Map<number, ProcInfo>();
  for (const line of out.split(/\r?\n/)) {
    const [p, pp, name] = line.split('\t');
    if (name) t.set(Number(p), { ppid: Number(pp), name: name.trim() });
  }
  return (pid) => t.get(pid) ?? null;
}

function logindRemote(): boolean | null {
  let id: string;
  try { id = fs.readFileSync('/proc/self/sessionid', 'utf8').trim(); } catch (err) {
    return null; // no audit session id
  }
  if (!/^\d+$/.test(id) || id === NO_SESSION) return null;
  let v: string;
  try {
    v = execFileSync('loginctl', ['show-session', id, '-p', 'Remote', '--value'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (err) {
    return null; // no logind, or not a logind session
  }
  return v === 'yes' ? true : v === 'no' ? false : null;
}

/** 'ssh' when this process is inside a remote login by logind or by its parent chain; null otherwise or unknown. */
export function remoteAncestry(platform: string = process.platform, deps: AncestryDeps = {}): 'ssh' | null {
  if (platform === 'linux' && (deps.loginRemote ?? logindRemote)() === true) return 'ssh';
  let proc = deps.proc;
  if (!proc) {
    if (platform === 'linux') proc = linuxProc;
    else if (platform === 'darwin') proc = darwinProc;
    else if (platform === 'win32') proc = win32Table() ?? undefined;
    if (!proc) return null;
  }
  const seen = new Set<number>();
  let pid = deps.pid ?? process.pid;
  for (let hop = 0; hop < MAX_HOPS && pid > 1 && !seen.has(pid); hop++) {
    seen.add(pid);
    const p = proc(pid);
    if (!p) return null;
    if (REMOTE_PARENT.test(p.name)) return 'ssh';
    pid = p.ppid;
  }
  return null;
}
