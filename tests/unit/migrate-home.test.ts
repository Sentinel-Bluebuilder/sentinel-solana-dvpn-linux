// ─── Upgrade from a pre-cb33 home to the cb33 client instance (migrate-home.ts) ───
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readToml, patchToml } from '../../src/core/daemon/config';
import { legacyServiceName, migratedConfig, planHomeMigration, type HomeView } from '../../src/core/daemon/migrate-home';

const fx = (n: string): string => readFileSync(join(__dirname, '..', 'fixtures', n), 'utf8');
const OLD = 'C:\\ProgramData\\dvpnd\\client';
const NEW = 'C:\\ProgramData\\sentinel-dvpn\\c0';
const OWNER = 'CWT5iHdi76j2wGkfWcs8NXAUyPwJ44A7ZGAdGoYFRaf9';
const KEY = '[1,2,3]'; // a plain key file is a solana-keygen byte array (redacted stand-in)

function view(files: Record<string, string>): HomeView {
  return {
    exists: (p) => p in files || Object.keys(files).some((f) => f.startsWith(p + '\\')),
    read: (p) => (p in files ? files[p] : null),
  };
}
const oldHome = (): Record<string, string> => ({
  [`${OLD}\\config.toml`]: fx('dvpnd-root.v2.config.toml'),
  [`${OLD}\\client\\config.toml`]: fx('dvpnd-client.v2.config.toml'),
  [`${OLD}\\client\\keys\\device.json`]: KEY,
});

describe('planHomeMigration (Windows)', () => {
  it('moves an old home: old service out first, key copied as operator, init on top, settings carried, old home kept', () => {
    const plan = planHomeMigration('win32', OWNER, view(oldHome()));
    expect(plan.migrate).toBe(true);
    if (!plan.migrate) return;
    expect(plan.from).toBe(OLD);
    expect(plan.to).toBe(NEW);
    expect(plan.steps.map((s) => s.kind)).toEqual(['uninstall-old-service', 'copy-key', 'init', 'carry-settings', 'keep-old-home']);
    expect(plan.steps[0]).toEqual({ kind: 'uninstall-old-service', service: 'dvpnd' });
    expect(plan.steps[1]).toEqual({ kind: 'copy-key', from: `${OLD}\\client\\keys\\device.json`, to: `${NEW}\\keys\\operator.json` });
    expect(plan.steps[2]).toEqual({ kind: 'init', args: ['init', '--instance', 'c0', '--home', NEW, '--owner', OWNER, '--plain-key'] });
    expect(plan.steps[3]).toEqual({ kind: 'carry-settings', oldRoot: `${OLD}\\config.toml`, oldClient: `${OLD}\\client\\config.toml`, into: `${NEW}\\config.toml` });
  });

  it('honours a non-default ProgramData', () => {
    const plan = planHomeMigration('win32', OWNER, view(oldHome()), { programData: 'D:\\PD' });
    expect(plan.migrate && plan.to).toBe('D:\\PD\\sentinel-dvpn\\c0');
  });

  it('does nothing without an old home, or once the new home has a config (never runs init twice)', () => {
    expect(planHomeMigration('win32', OWNER, view({}))).toEqual({ migrate: false, reason: 'no-old-home' });
    expect(planHomeMigration('win32', OWNER, view({ ...oldHome(), [`${NEW}\\config.toml`]: fx('cb33-c0-config.toml') }))).toEqual({ migrate: false, reason: 'already-migrated' });
  });

  it('an old home without its device key is not migrated (no key = a fresh device, not an upgrade)', () => {
    const files = oldHome(); delete files[`${OLD}\\client\\keys\\device.json`];
    expect(planHomeMigration('win32', OWNER, view(files))).toEqual({ migrate: false, reason: 'no-old-key' });
  });

  it('never overwrites a different key already in the new home; the same key is not copied again', () => {
    const clash = planHomeMigration('win32', OWNER, view({ ...oldHome(), [`${NEW}\\keys\\operator.json`]: '{"name":"operator","secret":"other"}' }));
    expect(clash.migrate).toBe(false);
    expect(!clash.migrate && clash.reason).toBe('key-conflict');
    const same = planHomeMigration('win32', OWNER, view({ ...oldHome(), [`${NEW}\\keys\\operator.json`]: KEY + '\n' }));
    expect(same.migrate && same.steps.map((s) => s.kind)).toEqual(['uninstall-old-service', 'init', 'carry-settings', 'keep-old-home']);
  });
});

describe('legacyServiceName', () => {
  it('names the service each pre-cb33 app installed (#31 setup-daemon.ps1, #32 setup-daemon.sh unit, #33 _lib.sh label)', () => {
    expect(legacyServiceName('win32')).toBe('dvpnd');
    expect(legacyServiceName('linux')).toBe('dvpnd-client');
    expect(legacyServiceName('darwin')).toBe('network.sentinel.devnet-dvpn.dvpnd');
  });
});

describe('migratedConfig', () => {
  it("carries the user's settings into the fresh cb33 config: KS on -> persist, LAN, DNS backend, RPC; drops socket_group", () => {
    let root = fx('dvpnd-root.v2.config.toml');
    root = patchToml(root, 'rpc', 'url', 'https://rpc.example.test');
    let client = fx('dvpnd-client.v2.config.toml');
    client = patchToml(client, 'network', 'allow_lan', true);
    client = patchToml(client, 'network', 'dns_backend', 'none');
    const out = migratedConfig(root, client, fx('cb33-c0-config.toml'));
    expect(readToml(out, 'network', 'kill_switch')).toBe('persist');
    expect(readToml(out, 'network', 'allow_lan')).toBe(true);
    expect(readToml(out, 'network', 'dns_backend')).toBe('none');
    expect(readToml(out, 'rpc', 'url')).toBe('https://rpc.example.test');
    expect(readToml(out, 'daemon', 'socket_group')).toBeNull();
    // What init wrote for the new instance stays: its key name, role and owner.
    expect(readToml(out, 'key', 'name')).toBe('operator');
    expect(readToml(out, 'daemon', 'role')).toBe('client');
    expect(readToml(out, '', 'owner')).toBe('11111111111111111111111111111111');
  });

  it('kill switch off stays off; missing old files carry nothing', () => {
    const client = patchToml(fx('dvpnd-client.v2.config.toml'), 'network', 'kill_switch', 'off');
    expect(readToml(migratedConfig(null, client, fx('cb33-c0-config.toml')), 'network', 'kill_switch')).toBe('off');
    // Nothing to carry: init's own default kill_switch 'on' still becomes persist, and nothing else changes.
    const fresh = fx('cb33-c0-config.toml');
    expect(migratedConfig(null, null, fresh)).toBe(patchToml(fresh, 'network', 'kill_switch', 'persist'));
  });
});
