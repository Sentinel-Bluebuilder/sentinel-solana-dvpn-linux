// ─── Owner 2026-11-13: kill switch on + a restart while connected keeps the block, and the app says so ───
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BLOCKED_AT_START_NOTICE, LOGIN_ITEM_TICK_MS, loginItemWanted } from '../../src/shared/kill-switch-start';

describe('kill switch across a restart', () => {
  it('the app starts at log-in while the kill switch is on, or when asked', () => {
    expect(loginItemWanted(false, 'persist')).toBe(true);
    expect(loginItemWanted(false, 'on')).toBe(true);
    expect(loginItemWanted(true, 'off')).toBe(true);
  });
  it('negative control: kill switch off and not asked: no log-in item', () => {
    expect(loginItemWanted(false, 'off')).toBe(false);
    expect(loginItemWanted(false, undefined)).toBe(false);
  });
  it('a block found at start shows the window and a notice, once, only when settled', () => {
    const main = readFileSync('src/main/index.ts', 'utf8');
    expect(main).toContain('const openAtLogin = loginItemWanted(startWithOs, killSwitch);');
    expect(main).toContain("onDaemonChange(() => loginItem('daemon change'));");
    expect(main).toContain('if (blockAtStartChecked || !daemonInfo().reachable || serviceInTransition() || process.uptime() > 180) return;');
    expect(main).toContain("notifyIfHidden({ kind: 'warn', message: BLOCKED_AT_START_NOTICE() }, win);");
    expect(BLOCKED_AT_START_NOTICE()).toMatch(/kill switch is blocking.*restart.*reconnect or restore/);
  });
  it('the words say restarts and log-in; Settings shows Start at log-in held on', () => {
    expect(readFileSync('src/renderer/src/screens/KillSwitch.tsx', 'utf8')).toContain('also across a restart of the computer or of the VPN service. While it is on, the app starts when you log in');
    // UI-196: the On sentence itself names Restore network as a way out, not only the text under the list.
    expect(readFileSync('src/renderer/src/screens/KillSwitch.tsx', 'utf8')).toContain("copy: tr('If the VPN drops, internet is blocked until it reconnects, you disconnect or you press Restore network. Recommended.')");
    expect(readFileSync('src/renderer/src/screens/Settings.tsx', 'utf8')).toContain('checked={settings.startWithOs || ksOn} disabled={ksOn}');
  });
  it('DVPN-WIN t-ksrun: a kill switch changed while the app runs (CLI) reaches the log-in item on a tick', () => {
    const main = readFileSync('src/main/index.ts', 'utf8');
    expect(main).toContain("setInterval(() => loginItem('tick'), LOGIN_ITEM_TICK_MS).unref();");
    expect(LOGIN_ITEM_TICK_MS).toBeGreaterThanOrEqual(5_000);
    expect(LOGIN_ITEM_TICK_MS).toBeLessThanOrEqual(30_000);
  });
  it('the OS is asked only when the decision changes, and a moment unreadable (mid-Apply) is not read as off', () => {
    const main = readFileSync('src/main/index.ts', 'utf8');
    const at = main.indexOf('const loginItem = (why: string): void => {');
    const body = main.slice(at, at + 1200);
    expect(at).toBeGreaterThan(0);
    expect(body).toContain('if (!daemonSettings.readable && loginItemLast !== null) return;');
    const osCall = body.search(/app\.setLoginItemSettings\(|setStartWithOs\(/); // Windows/Linux | Mac LaunchAgent
    expect(osCall).toBeGreaterThan(0);
    expect(body.indexOf('if (key === loginItemLast) return;')).toBeLessThan(osCall);
  });
});

describe('the CLI follows the same log-in rule (DVPN-LINUX rc.2)', () => {
  const cli = readFileSync('src/cli/info-cmd.ts', 'utf8');
  it('settings set/reset write the log-in item through loginItemWanted, and say why it stays', () => {
    expect(cli).toContain("applyStartWithOsFromCli(loginItemWanted(next.startWithOs, getDaemonSettings().settings.killSwitch))");
    expect(cli).toContain('The app still starts when you log in while the kill switch is on');
  });
});
