// ─── DVPND-BIN-PACKAGED (the agent kit rc.9, port of the macOS app 14691cfd1): DVPND_BIN never picks the root service binary in an installed build ───
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dvpndPathFor, packagedBuild } from '../../../src/main/daemon/manager';

const DEB = '/opt/Devnet dVPN/resources';
const APPIMAGE = '/tmp/.mount_DevnetX1y2Z3/resources';
const DEV = '/home/u/devnet-dvpn-linux/resources';
const yes = (): boolean => true;

describe('packagedBuild (Linux)', () => {
  it('deb/rpm (/opt) and the AppImage mount are installed builds; a source checkout is not', () => {
    expect(packagedBuild(DEB)).toBe(true);
    expect(packagedBuild(APPIMAGE)).toBe(true);
    expect(packagedBuild(DEV)).toBe(false);
  });
});

describe('dvpndPathFor', () => {
  it('an installed build ignores DVPND_BIN (deb and AppImage)', () => {
    for (const res of [DEB, APPIMAGE]) {
      expect(dvpndPathFor({ DVPND_BIN: '/tmp/evil/sentinel-dvpnd' }, res, yes)).toBe(path.join(res, 'bin', 'sentinel-dvpnd'));
    }
  });
  it('a source checkout still honours DVPND_BIN when the file exists (dev/test override)', () => {
    expect(dvpndPathFor({ DVPND_BIN: '/tmp/dev/sentinel-dvpnd' }, DEV, yes)).toBe('/tmp/dev/sentinel-dvpnd');
    expect(dvpndPathFor({ DVPND_BIN: '/tmp/dev/sentinel-dvpnd' }, DEV, () => false)).toBe(path.join(DEV, 'bin', 'sentinel-dvpnd'));
  });
  it('no DVPND_BIN: the bundled binary', () => {
    expect(dvpndPathFor({}, DEB, yes)).toBe(path.join(DEB, 'bin', 'sentinel-dvpnd'));
  });
});
