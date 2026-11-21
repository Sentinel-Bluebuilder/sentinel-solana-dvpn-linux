// ─── the Windows app 470bac7 on Linux: which service copies are older than this app ───
// deb / rpm / pacman refresh the service's copies in their postinst (after-install.sh), so nothing is stale there.
// An AppImage has no postinst: a new AppImage updates only the app and the service keeps the dvpnd, protocol
// programs and host-firewall.sh of its last "Install service" (the Mac dmg drag-over case).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serviceStaleNames } from '../../../src/main/daemon/manager';
import { daemonBinaryName } from '../../../src/core/daemon/layout';

let root = '';
let bin = '';
let scripts = '';
let lib = '';
const put = (file: string, text: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
// the service's copies made the way setup-daemon.sh / after-install.sh make them: same bytes
const install = (): void => {
  put(path.join(lib, 'sentinel-dvpnd'), fs.readFileSync(path.join(bin, daemonBinaryName('linux')), 'utf8'));
  put(path.join(lib, 'host-firewall.sh'), fs.readFileSync(path.join(scripts, 'host-firewall.sh'), 'utf8'));
  fs.cpSync(path.join(bin, 'v2ray'), path.join(lib, 'v2ray'), { recursive: true });
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ddv-stale-'));
  bin = path.join(root, 'app', 'bin');
  scripts = path.join(root, 'app', 'scripts');
  lib = path.join(root, 'lib');
  put(path.join(bin, daemonBinaryName('linux')), 'dvpnd 6.11');
  put(path.join(scripts, 'host-firewall.sh'), '#!/bin/bash\n# v2\n');
  put(path.join(bin, 'v2ray', 'v2ray'), 'v2ray 5.1');
  put(path.join(bin, 'v2ray', 'geoip.dat'), 'geo-A');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('serviceStaleNames (Linux)', () => {
  it('no service installed: nothing to update (the Install service banner covers it)', () => {
    expect(serviceStaleNames(bin, scripts, lib)).toEqual([]);
  });
  it('package install / after Update the VPN service: the copies match, so no banner', () => {
    install();
    expect(serviceStaleNames(bin, scripts, lib)).toEqual([]);
  });
  it('a newer AppImage over an older service: names the old dvpnd, script and protocol program', () => {
    install();
    put(path.join(bin, daemonBinaryName('linux')), 'dvpnd 6.12');
    put(path.join(scripts, 'host-firewall.sh'), '#!/bin/bash\n# v3\n');
    put(path.join(bin, 'v2ray', 'v2ray'), 'v2ray 5.2');
    expect(serviceStaleNames(bin, scripts, lib)).toEqual(['sentinel-dvpnd', 'host-firewall.sh', 'v2ray/v2ray']);
  });
  it('same size, different bytes is still stale (programs are hashed)', () => {
    install();
    put(path.join(bin, daemonBinaryName('linux')), 'dvpnd 6.99');
    expect(serviceStaleNames(bin, scripts, lib)).toEqual(['sentinel-dvpnd']);
  });
  it('a protocol this app ships but the service lacks is stale; one only the service has is ignored', () => {
    install();
    put(path.join(bin, 'xray', 'xray'), 'xray 1');
    put(path.join(lib, 'hysteria2', 'hysteria2'), 'old');
    expect(serviceStaleNames(bin, scripts, lib)).toEqual(['xray/xray']);
  });
  it('protocol data files compare by size only', () => {
    install();
    put(path.join(bin, 'v2ray', 'geoip.dat'), 'geo-B');
    expect(serviceStaleNames(bin, scripts, lib)).toEqual([]);
    put(path.join(bin, 'v2ray', 'geoip.dat'), 'geo-BIGGER');
    expect(serviceStaleNames(bin, scripts, lib)).toEqual(['v2ray/geoip.dat']);
  });
});
