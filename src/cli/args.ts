// ─── Tiny argv parser: positionals + --flag value / --flag / --flag=value ───
export interface Args {
  _: string[];
  flags: Record<string, string | true>;
}

// On/off flags never take the next word as their value (`test plan --never-tested <server>` keeps the server).
const BOOLEAN = new Set(['json', 'yes', 'allow-remote-lockout', 'online', 'no-probe', 'follow', 'help', 'all', 'fresh', 'compare', 'failed-last', 'never-tested', 'resume', 'switch', 'force', 'allow-empty', 'hidden', 'raise-limit']); // AUD-2 M4

export function parseArgs(argv: string[]): Args {
  const out: Args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out._.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) { out.flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const name = a.slice(2);
      const next = argv[i + 1];
      if (BOOLEAN.has(name) || next === undefined || next.startsWith('--')) out.flags[name] = true;
      else { out.flags[name] = next; i++; }
    } else if (a === '-y') out.flags.yes = true;
    else out._.push(a);
  }
  return out;
}

export function str(a: Args, name: string, fallback?: string): string | undefined {
  const v = a.flags[name];
  return typeof v === 'string' ? v : fallback;
}

/**
 * E-21 (money): a value flag given with nothing after it (`--plan=`, or `--plan` last / before another flag) read as
 * "not given": `connect <node> --plan` became a PAID connect. Each named flag, when present, must carry a value.
 */
export function requireValues(a: Args, names: readonly string[]): void {
  for (const n of names) {
    if (!(n in a.flags)) continue;
    const v = a.flags[n];
    if (typeof v !== 'string' || !v.trim()) throw new UsageError(`--${n} needs a value (nothing was run)`);
  }
}

/** A whole number in [min, max]; anything else (0, -5, 1.5, 1e3, '１') is a usage error, never a fallback (linux-app 46754684). */
export function whole(a: Args, name: string, fallback: number, min: number, max: number): number {
  const v = str(a, name);
  if (v === undefined) return fallback;
  if (!/^\d{1,9}$/.test(v) || Number(v) < min || Number(v) > max) throw new UsageError(`--${name} must be a whole number from ${min} to ${max}`);
  return Number(v);
}

export const flag = (a: Args, name: string): boolean => a.flags[name] === true || a.flags[name] === 'true';

export class UsageError extends Error {}
