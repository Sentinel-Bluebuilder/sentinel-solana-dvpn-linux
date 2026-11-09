// ─── Q0289: a service stop signals dvpnd only ───
// With the default KillMode (control-group) systemd sent SIGTERM to dvpnd and its wg/openvpn/hysteria
// tools at once: a voucher round's "wg show" died before dvpnd knew it was stopping, so every service
// restart logged "issuing voucher failed ... signal: terminated" (arm-u2404 adopt-wireguard, RC3).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// cb33: `sentinel-dvpnd service install` writes the unit, and its template already has KillMode=mixed
// (sentinel-dvpnd/cmd/sentinel-dvpnd/systemd.go on fork-cb33-1-ddv19). Our drop-in must not undo it.

describe('sentinel-dvpnd@c0 unit KillMode', () => {
  const setup = fs.readFileSync('resources/scripts/setup-daemon.sh', 'utf8');
  it('a new install uses cb33\'s own unit and never sets another KillMode', () => {
    expect(setup).toContain('"$DVPND" service install --instance c0');
    expect(setup).not.toMatch(/KillMode=(control-group|process|none)/);
    expect(setup).not.toContain('cat > "/etc/systemd/system/$SERVICE.service"');
  });
  it('uninstall removes our drop-in folders (cb33 and pre-cb33)', () => {
    const un = fs.readFileSync('resources/scripts/uninstall-cleanup.sh', 'utf8');
    expect(un).toContain('rm -rf /etc/systemd/system/sentinel-dvpnd@c0.service.d /etc/systemd/system/sentinel-dvpnd@c0.socket.d /etc/sentinel-dvpn/c0.env');
    expect(un).toContain('rm -rf /etc/systemd/system/dvpnd-client.service.d');
  });
});
