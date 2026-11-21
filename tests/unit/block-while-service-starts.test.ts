// ─── Q0575 (DVPN-WIN upgboot): a held block is shown while the VPN service is still starting after log-in ───
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SERVICE_START_GRACE_MS } from '../../src/shared/kill-switch-start';

const conn = readFileSync('src/main/services/connection.ts', 'utf8');
const main = readFileSync('src/main/index.ts', 'utf8');

describe('block shown while the service starts', () => {
  const at = conn.indexOf('export async function showBlockWhileServiceStarts');
  const body = conn.slice(at, at + 900);
  it('only with the kill switch on, no session, idle view, service not answering, and nothing reachable', () => {
    expect(at).toBeGreaterThan(0);
    expect(body).toContain("if (daemonRunning() || s.session || s.conn.phase !== 'idle') return false;");
    expect(body).toContain("if ((getDaemonSettings().settings.killSwitch ?? 'off') === 'off') return false;");
    expect(body).toContain('if (await internetReachable(getRpcUrls())) return false;');
  });
  it('titles it "Internet blocked by the kill switch", and offers no Restore network until the service answers', () => {
    expect(body).toContain("patch({ conn: { ...viewFor('error', BLOCKED_WAITING_DETAIL()), title: BLOCKED_TITLE(), restoreNetwork: false } });");
  });
  it('once the service answers, the waiting view goes and the normal leftover check decides', () => {
    expect(conn).toContain("if (waitingShown && daemonRunning()) { waitingShown = false; if (snapshot().conn.phase === 'error' && !snapshot().session) patch({ conn: viewFor('idle') }); }");
  });
  it('the app looks for it a few seconds after start and brings the window up', () => {
    expect(SERVICE_START_GRACE_MS).toBeGreaterThanOrEqual(5_000);
    expect(main).toContain('void showBlockWhileServiceStarts().then((shown) => {');
    expect(main).toContain('}, SERVICE_START_GRACE_MS).unref();');
  });
  it('negative control: with the kill switch off nothing is shown (the off branch returns first)', () => {
    expect(body.indexOf("=== 'off') return false;")).toBeLessThan(body.indexOf('internetReachable'));
  });
});
