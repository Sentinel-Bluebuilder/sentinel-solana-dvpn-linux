// ─── Agent M (Mac): an app update that left the VPN service on its old copies says so on Connect ───
// A dmg drag-over replaces only the app; the root-owned service kept its old dvpnd, protocol programs and scripts
// (so none of the service fixes) and only Diagnostics' "service_update" row said so.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('the outdated-service banner', () => {
  const app = readFileSync('src/renderer/src/App.tsx', 'utf8');
  const main = readFileSync('src/main/index.ts', 'utf8');
  it('shows on every screen while the service runs older copies, with the one-prompt update', () => {
    expect(app).toContain('{!!snap.serviceOutdated?.length && snap.daemon.reachable && !onAndroid() && (');
    expect(app).toContain("<InstallServiceButton label={tr('Update the VPN service')} />");
  });
  it('is checked at start and each time the service comes back (so an update clears it)', () => {
    expect(main).toMatch(/checkServiceCopies\(\);\n/);
    expect(main).toContain('if (up && !lastReachable) checkServiceCopies();');
  });
});
