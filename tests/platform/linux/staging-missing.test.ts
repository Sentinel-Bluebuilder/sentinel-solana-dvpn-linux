// ─── STAGING-MISSING (rc9-d, review live on lnx5 rc.9) ───
// With the service installed and nothing staged, `daemon install --yes` ran setup-daemon.sh, which can only die
// "staging folder not found: <data>/daemon-staging" (install-failed, next daemon doctor). Now installService answers
// service-installed before any root step, and the CLI's next is agent status (which names the real way on).
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stagingMissingAnswer } from '../../../src/main/daemon/manager';

describe('STAGING-MISSING', () => {
  it('installed service + nothing staged (no switch, no upgrade): a coded answer, not the root step', () => {
    const a = stagingMissingAnswer({ staged: false, switching: false, migrating: false, installed: true });
    expect(a?.code).toBe('service-installed');
    expect(a?.error).toMatch(/already installed/);
    expect(a?.error).toMatch(/Nothing was paid/);
    expect(a?.error).not.toMatch(/staging folder/);
  });
  it('anything staged, a switch, an upgrade or no service: the root step runs as before', () => {
    for (const x of [
      { staged: true, switching: false, migrating: false, installed: true },
      { staged: false, switching: true, migrating: false, installed: true },
      { staged: false, switching: false, migrating: true, installed: true },
      { staged: false, switching: false, migrating: false, installed: false },
    ]) expect(stagingMissingAnswer(x)).toBeNull();
  });
  it('installService asks before runElevated(setup-daemon.sh)', () => {
    const src = fs.readFileSync('src/main/daemon/manager.ts', 'utf8');
    const fn = src.slice(src.indexOf('export async function installService('));
    const at = fn.indexOf('stagingMissingAnswer({');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(fn.indexOf("runElevated(scriptPath('setup-daemon.sh')"));
  });
  it('daemon install maps it to service-installed with next agent status, never daemon doctor', () => {
    const cli = fs.readFileSync('src/cli/daemon-cmd.ts', 'utf8');
    expect(cli).toMatch(/r\.code === 'service-installed'\) throw cliErr\('service-installed', `\$\{CLI_NAME\} agent status --json`/);
    expect(cli.indexOf("r.code === 'service-installed'")).toBeLessThan(cli.indexOf("throw cliErr('install-failed'"));
  });
});
