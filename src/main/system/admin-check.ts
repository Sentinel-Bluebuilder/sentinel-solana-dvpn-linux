// ─── Is this account an administrator? (U1-O, the agent kit rc.9) ───
// A standard Windows user can only install the service with an administrator's name and password; the CLI says so
// before anything else. `whoami /groups` lists the Administrators group (S-1-5-32-544) for an administrator even
// while the token is filtered by UAC, and not at all for a standard user. Other systems: null (not checked here).
import { execFileSync } from 'node:child_process';
import { log } from '../logger';

export type GroupsRunner = () => string;
const whoamiGroups: GroupsRunner = () => execFileSync('whoami', ['/groups', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });

/** true / false on Windows; null when not Windows or when it could not be read (the caller goes on: fail-open). */
export function isAdminAccount(platform: string = process.platform, run: GroupsRunner = whoamiGroups): boolean | null {
  if (platform !== 'win32') return null;
  try {
    return /S-1-5-32-544/i.test(run());
  } catch (err) {
    log.warn('admin check: whoami /groups failed; not checked', { err: (err as Error).message });
    return null;
  }
}
