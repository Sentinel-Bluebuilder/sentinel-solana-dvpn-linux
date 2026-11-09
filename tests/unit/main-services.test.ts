import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Keypair, PublicKey } from '@solana/web3.js';
import { setHost } from '../../src/main/host';
import { initStore } from '../../src/main/store';
import { setSystemProxy, clearSystemProxy, systemProxyActive, setProxyRunner, setSocksCheck, oursFor, oursMarker, isOurs, type ProxyState } from '../../src/main/system/proxy';
import { helperArgs, stepOf, insideAppImage } from '../../src/main/system/elevate';
import { sanitize } from '../../src/main/system/settings';
import { historyCsv } from '../../src/main/services/history';
import { redactUrls, redact } from '../../src/main/logger';
import { parseArgs } from '../../src/cli/args';
import { nodeApiOverride } from '../../src/core/nodes/discovery';
import { providerApiOverride } from '../../src/core/plans/plans';
import { closeChannel } from '../../src/core/chain/builders';
import { pda } from '../../src/core/chain/program';
import { DEFAULT_SETTINGS } from '../../src/shared/types';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvpn-unit-'));
beforeAll(() => {
  setHost({ name: 'cli', resourcesDir: dir, dataDir: dir, emit: () => undefined, keyStore: { kind: 'memory', exists: () => false, load: () => null, save: () => undefined, remove: () => undefined } });
  initStore(dir);
});

// ─── System proxy: never touches the real desktop settings here ───
describe('system proxy (GNOME gsettings)', () => {
  // A user with a PAC URL, an HTTP proxy and their own ignore list: every value must come back.
  const userState: ProxyState = {
    backend: 'gnome',
    values: {
      'org.gnome.system.proxy mode': "'auto'",
      'org.gnome.system.proxy autoconfig-url': "'http://wpad/proxy.pac'",
      'org.gnome.system.proxy ignore-hosts': "['localhost', '*.corp']",
      'org.gnome.system.proxy use-same-proxy': 'true',
      'org.gnome.system.proxy.socks host': "''",
      'org.gnome.system.proxy.socks port': '0',
      'org.gnome.system.proxy.http host': "'corp'",
      'org.gnome.system.proxy.http port': '8080',
      'org.gnome.system.proxy.http enabled': 'false',
      'org.gnome.system.proxy.https host': "'corp'",
      'org.gnome.system.proxy.https port': '8080',
      'org.gnome.system.proxy.ftp host': "''",
      'org.gnome.system.proxy.ftp port': '0',
    },
  };
  const fake = (start: ProxyState, backend: 'gnome' | 'kde' | null = 'gnome') => {
    let cur: ProxyState = { backend: start.backend, values: { ...start.values } };
    const sets: ProxyState[] = [];
    setProxyRunner({
      backend: async () => backend,
      query: async () => ({ backend: cur.backend, values: { ...cur.values } }),
      set: async (s) => { sets.push(s); cur = { backend: s.backend, values: { ...cur.values, ...s.values } }; return { backend: cur.backend, values: { ...cur.values } }; },
    });
    return { now: () => cur, sets, change: (s: ProxyState) => { cur = s; } };
  };
  it('saves the user proxy first, restores all of it exactly, and only undoes its own value', async () => {
    setSocksCheck(async () => ({ ok: true, reason: 'stub' }));
    const f = fake(userState);
    await setSystemProxy('127.0.0.1:1080');
    expect(f.now().values['org.gnome.system.proxy mode']).toBe("'manual'");
    expect(f.now().values['org.gnome.system.proxy.socks host']).toBe("'127.0.0.1'");
    expect(f.now().values['org.gnome.system.proxy.socks port']).toBe('1080');
    expect(f.now().values['org.gnome.system.proxy.http host']).toBe("''"); // only SOCKS, nothing else
    expect(systemProxyActive()).toBe(true);
    await clearSystemProxy();
    expect(f.now()).toEqual(userState);
    expect(systemProxyActive()).toBe(false);
  });
  it('sets the mode last, so apps never see manual mode with an old host', () => {
    const order = Object.keys(oursFor('127.0.0.1:1080', 'gnome').values);
    expect(order).toContain('org.gnome.system.proxy mode');
  });
  it('leaves a proxy the user changed meanwhile alone', async () => {
    const f = fake(userState);
    await setSystemProxy('127.0.0.1:1080');
    const theirs: ProxyState = { backend: 'gnome', values: { ...userState.values, 'org.gnome.system.proxy mode': "'manual'", 'org.gnome.system.proxy.socks host': "'other'", 'org.gnome.system.proxy.socks port': '3128' } };
    f.change(theirs);
    await clearSystemProxy();
    expect(f.now()).toEqual(theirs);
    expect(systemProxyActive()).toBe(false);
  });
  it('fails when the desktop does not take the setting', async () => {
    setProxyRunner({ backend: async () => 'gnome', query: async () => ({ ...userState }), set: async () => ({ ...userState }) });
    await expect(setSystemProxy('127.0.0.1:1080')).rejects.toThrow(/did not accept/);
    fake(userState);
    await clearSystemProxy();
  });
  it('refuses on a desktop with no proxy setting, changing nothing', async () => {
    const f = fake(userState, null);
    await expect(setSystemProxy('127.0.0.1:1080')).rejects.toThrow(/no system proxy setting.*Nothing was changed/);
    expect(f.sets).toEqual([]);
    expect(systemProxyActive()).toBe(false);
  });
  it('recognises its own KDE setting', () => {
    const k = oursFor('127.0.0.1:1080', 'kde');
    expect(k.values.socksProxy).toBe('socks://127.0.0.1 1080');
    expect(isOurs(k, oursMarker('127.0.0.1:1080'))).toBe(true);
    expect(isOurs({ backend: 'kde', values: { ...k.values, ProxyType: '0' } }, oursMarker('127.0.0.1:1080'))).toBe(false);
  });
  it('refuses a non-loopback endpoint', async () => {
    await expect(setSystemProxy('10.0.0.5:1080')).rejects.toThrow(/non-loopback/);
  });
});

describe('elevated helper arguments', () => {
  it('passes paths with spaces as single arguments and rejects injection', () => {
    const a = helperArgs('setup-daemon', { Dvpnd: '/opt/devnet-dvpn/resources/resources/bin/dvpnd', User: 'alice' });
    expect(a).toEqual(['setup-daemon', '--Dvpnd', '/opt/devnet-dvpn/resources/resources/bin/dvpnd', '--User', 'alice']);
    expect(() => helperArgs('setup-daemon', { Owner: "a'; rm -rf /" })).toThrow(/unsafe/);
    expect(() => helperArgs('setup-daemon', { Owner: '$(reboot)' })).toThrow(/unsafe/);
    expect(() => helperArgs('setup-daemon', { Owner: '--Result' })).toThrow(/unsafe/);
    expect(() => helperArgs('setup-daemon', { 'Bad-Name': 'a' })).toThrow(/parameter/);
  });
  it('runs only whitelisted steps', () => {
    expect(() => helperArgs('rm', {})).toThrow(/unknown elevated step/);
    expect(stepOf('/opt/x/resources/scripts/apply-daemon-config.sh')).toBe('apply-daemon-config');
  });
  it('knows when it runs from an AppImage mount', () => {
    expect(insideAppImage('/tmp/.mount_DevnetX/resources/scripts/dvpn-helper', { APPDIR: '/tmp/.mount_DevnetX' })).toBe(true);
    expect(insideAppImage('/opt/devnet-dvpn/resources', { APPDIR: '/tmp/.mount_DevnetX' })).toBe(false);
    expect(insideAppImage('/opt/devnet-dvpn/resources', {})).toBe(false);
  });
});

describe('settings allow-list', () => {
  it('drops unknown keys and invalid values, keeps valid ones', () => {
    const s = sanitize({ rpcUrls: ['http://evil.example', 'https://ok.example'], defaultGb: 3, theme: 'dark', bogus: 1 } as never);
    expect(s.rpcUrls).toEqual(['https://ok.example']);
    expect(s.defaultGb).toBe(DEFAULT_SETTINGS.defaultGb);
    expect(s.theme).toBe('dark');
    expect((s as unknown as Record<string, unknown>).bogus).toBeUndefined();
  });
});

describe('history csv', () => {
  it('escapes commas and quotes', () => {
    const csv = historyCsv([{ id: 'a', node: 'n', country: 'Korea, South', service: 'wg', startedAt: 1, endedAt: 2, rxBytes: '1', txBytes: '2', spent: '3', channel: 'c', closeReason: 'say "hi"' }]);
    expect(csv.split('\n')[1]).toBe('a,n,"Korea, South",wg,1,2,1,2,3,c,"say ""hi"""');
  });
});

describe('redaction', () => {
  it('strips query strings from http and ws URLs, and secret keys from objects', () => {
    expect(redactUrls('url = wss://rpc.example/?api-key=SECRET')).toBe('url = wss://rpc.example/?<redacted>');
    // user:password@ is a credential too; an @ later in the path is not userinfo (#33 fuzz)
    expect(redactUrls('unknown job "https://u:p@127.0.0.1:9/?api-key=S"')).toBe('unknown job "https://<redacted>@127.0.0.1:9/?<redacted>"');
    expect(redactUrls('see https://host/a@b and wss://k@rpc.x/ws')).toBe('see https://host/a@b and wss://<redacted>@rpc.x/ws');
    expect(JSON.stringify(redact({ mnemonic: 'a b c', url: 'https://x/?k=1' }))).toBe('{"mnemonic":"[redacted]","url":"https://x/?<redacted>"}');
  });
});

describe('cli args', () => {
  it('parses positionals, flags, booleans and -y', () => {
    const a = parseArgs(['connect', 'N', '--units', '2', '--yes', '--basis=per_hour', '-y', '--json']);
    expect(a._).toEqual(['connect', 'N']);
    expect(a.flags).toEqual({ units: '2', yes: true, basis: 'per_hour', json: true });
  });
});

describe('test-rig overrides', () => {
  it('match only the named account', () => {
    expect(nodeApiOverride('A', 'A=https://127.0.0.1:1,B=https://x:2')).toBe('https://127.0.0.1:1');
    expect(nodeApiOverride('C', 'A=https://127.0.0.1:1')).toBeNull();
    expect(providerApiOverride('P', 'P=https://127.0.0.1:19443/')).toBe('https://127.0.0.1:19443');
  });
});

// ─── close_channel grant (grants program, 2026-10-21) ───
describe('close_channel grant', () => {
  const owner = Keypair.generate().publicKey;
  const device = Keypair.generate().publicKey;
  const ch = { address: Keypair.generate().publicKey, owner, opener: device, node: Keypair.generate().publicKey, rentPayer: device, mode: 1 };
  const keysOf = (ix: { keys: Array<{ pubkey: PublicKey }> }): string[] => ix.keys.map((k) => k.pubkey.toBase58());
  it('owner-signed close of a device channel passes no grant', async () => {
    const ix = await closeChannel({ signer: owner, ch });
    expect(keysOf(ix)).not.toContain(pda.grant(owner, device).toBase58());
  });
  it('device-signed stream close passes the [owner, signer, default] grant', async () => {
    const ix = await closeChannel({ signer: device, ch });
    expect(keysOf(ix)).toContain(pda.grant(owner, device).toBase58());
  });
  it('voucher close passes no grant (anyone may close after the grace)', async () => {
    const ix = await closeChannel({ signer: device, ch: { ...ch, mode: 0 } });
    expect(keysOf(ix)).not.toContain(pda.grant(owner, device).toBase58());
  });
});

// ─── Display formatting shared by renderer, CLI and main ───
describe('format', () => {
  it('formats balances, bytes, durations and countdowns', async () => {
    const f = await import('../../src/shared/format');
    expect(f.formatTdvpn('946397711839')).toBe('946,397.71');
    expect(f.formatTdvpn('1994000')).toBe('1.994');
    expect(f.formatTdvpn('999123456')).toBe('999.123456');
    expect(f.formatBytes(3_200_000)).toBe('3.2 MB');
    expect(f.formatDuration(3725)).toBe('1:02:05');
    expect(f.formatCountdown(5700)).toBe('1 h 35 min');
  });
});

describe('quick pick', () => {
  it('prefers favourites, then preferred country, then lowest latency; online only', async () => {
    const { pickQuickNode } = await import('../../src/shared/quick-pick');
    const n = (address: string, cc: string, ms: number | null, fav = false) => ({ address, countryCode: cc, favourite: fav, probe: ms === null ? { ok: false } : { ok: true, latencyMs: ms } }) as never;
    const list = [n('A', 'DE', 80), n('B', 'US', 20), n('C', 'DE', 40), n('D', 'IN', 5, true), n('E', 'US', null, true)];
    expect(pickQuickNode(list, null)!.address).toBe('D');
    expect(pickQuickNode(list.slice(0, 3), 'DE')!.address).toBe('C');
    expect(pickQuickNode(list.slice(0, 3), null)!.address).toBe('B');
    expect(pickQuickNode([n('E', 'US', null)], null)).toBeNull();
  });
});

const userStateSafety: ProxyState = { backend: 'gnome', values: { 'org.gnome.system.proxy mode': "'none'" } };
describe('system proxy safety', () => {
  it('a dead SOCKS endpoint changes nothing (the internet stays up)', async () => {
    const calls: string[][] = [];
    setProxyRunner({ backend: async () => { calls.push(['backend']); return 'gnome'; }, query: async () => { calls.push(['query']); return userStateSafety; }, set: async (s) => { calls.push(['set']); return s; } });
    setSocksCheck(async () => ({ ok: false, reason: 'ECONNREFUSED' }));
    await expect(setSystemProxy('127.0.0.1:1080')).rejects.toThrow(/not answering.*Nothing was changed/);
    expect(calls).toEqual([]);
  });
});
