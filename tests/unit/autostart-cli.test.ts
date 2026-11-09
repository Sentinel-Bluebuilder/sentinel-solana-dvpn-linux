// ─── `settings set|reset startWithOs` from the CLI writes the same autostart entry as the app ───
// builder-kb (from #33's review, port of #33 a70fc91a): only main/index.ts applied startWithOs, so
// `settings set startWithOs=true` changed nothing until the app next opened.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appExecutable, applyStartWithOsFromCli, autostartPath } from '../../src/main/system/autostart';

const APP = '/opt/devnet-dvpn/devnet-dvpn-desktop';
let home: string;
let savedXdg: string | undefined;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ddv-autostart-'));
  savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = home;
});
afterEach(() => {
  if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = savedXdg;
  fs.rmSync(home, { recursive: true, force: true });
});

describe('appExecutable', () => {
  it('is the installed app binary, or the AppImage', () => {
    expect(appExecutable(APP, {})).toBe(APP);
    expect(appExecutable('/usr/bin/node', {})).toBeNull();
    expect(appExecutable('/tmp/.mount_x/devnet-dvpn-desktop', { APPIMAGE: '/home/u/Devnet.AppImage' })).toBe('/home/u/Devnet.AppImage');
  });
});

describe('applyStartWithOsFromCli', () => {
  it('on: writes the entry that starts the app hidden', () => {
    expect(applyStartWithOsFromCli(true, APP, {})).toBeNull();
    expect(fs.readFileSync(autostartPath(), 'utf8')).toContain(`Exec=${APP} --hidden`);
  });

  it('off: removes it', () => {
    applyStartWithOsFromCli(true, APP, {});
    expect(applyStartWithOsFromCli(false, APP, {})).toBeNull();
    expect(fs.existsSync(autostartPath())).toBe(false);
  });

  it('not from the installed app: changes no file and says when it takes effect', () => {
    const note = applyStartWithOsFromCli(true, '/usr/bin/node', {});
    expect(note).toMatch(/next time the app opens/);
    expect(fs.existsSync(autostartPath())).toBe(false);
  });
});
