// rc.4 E-55 screen half (UI-SCREENS): the Connect sheet asks before a wallet switch (AppSnapshot.deviceOwner) and
// Diagnostics offers "Remove half-finished setup" (AppSnapshot.halfFinishedSetup, IPC.DISCARD_SETUP).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({ dir: '' }));
vi.mock('../../src/main/host', () => ({ getHost: () => ({ name: 'cli', dataDir: st.dir, resourcesDir: st.dir, keyStore: { kind: 'dpapi' }, emit: () => undefined }) }));
vi.mock('../../src/main/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const m = await import('../../src/main/daemon/manager');
const { initStore } = await import('../../src/main/store');

const A = 'AAAAzqJ5VnSxW4wZGkdcwF5ydW3z7jRMNTgZyU2LvcFz';
const B = 'BBBBzqJ5VnSxW4wZGkdcwF5ydW3z7jRMNTgZyU2LvcFz';
const record = (owner: string): void => fs.writeFileSync(path.join(st.dir, 'device.json'), JSON.stringify({ device: 'D', home: '/c0', owner, at: 1 }));
const stage = (): void => { fs.mkdirSync(m.stagingHome(), { recursive: true }); fs.writeFileSync(path.join(m.stagingHome(), 'config.toml'), 'x = 1\n'); };

beforeEach(() => { st.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddv-ds-')); initStore(st.dir); });

describe('deviceStateFor', () => {
  it('no record: no owner, nothing half finished', () => {
    expect(m.deviceStateFor(A)).toEqual({ deviceOwner: null, halfFinishedSetup: false });
  });
  it('the rc.3 E-55 state (record rewritten to B, staging left, A loaded): owner B, half finished', () => {
    record(B); stage();
    expect(m.deviceStateFor(A)).toEqual({ deviceOwner: B, halfFinishedSetup: true });
  });
  it('negative control: a staged install for the loaded wallet is the normal pending install, not half finished', () => {
    record(A); stage();
    expect(m.deviceStateFor(A)).toEqual({ deviceOwner: A, halfFinishedSetup: false });
  });
  it('a waiting wallet switch is half finished, and the removal clears it', () => {
    record(A);
    fs.mkdirSync(m.switchHome(), { recursive: true });
    fs.writeFileSync(path.join(m.switchHome(), 'switch.json'), JSON.stringify({ device: 'N', owner: B, at: 1 }));
    expect(m.deviceStateFor(A).halfFinishedSetup).toBe(true);
    expect(m.discardHalfFinishedSetup().removed).toHaveLength(1);
    expect(m.deviceStateFor(A)).toEqual({ deviceOwner: A, halfFinishedSetup: false });
  });
});

describe('main/ipc.ts', () => {
  it('connect passes the user\'s yes to a wallet switch only when it is exactly true', () => {
    expect(readFileSync('src/main/ipc.ts', 'utf8')).toContain('confirmWalletSwitch: req.confirmWalletSwitch === true');
  });
});
