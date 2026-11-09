// ─── Q0281: our own SOCKS left on with no backup is never saved or restored as the user's ───
// A crash or failed restore left GNOME/KDE on socks 127.0.0.1:1080 with no backup; the next
// `proxy on` saved that as "what the user had" and every `proxy off` put the dead proxy back.
import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setHost } from '../../src/main/host';
import { initStore, readJson } from '../../src/main/store';
import { setSystemProxy, clearSystemProxy, systemProxyActive, setProxyRunner, setSocksCheck, oursFor, looksOurs, type ProxyState } from '../../src/main/system/proxy';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvpn-proxy-'));
beforeAll(() => {
  setHost({ name: 'cli', resourcesDir: dir, dataDir: dir, emit: () => undefined, keyStore: { kind: 'memory', exists: () => false, load: () => null, save: () => undefined, remove: () => undefined } });
  initStore(dir);
  setSocksCheck(async () => ({ ok: true, reason: 'stub' }));
});

const fake = (start: ProxyState) => {
  let cur: ProxyState = { backend: start.backend, values: { ...start.values } };
  setProxyRunner({
    backend: async () => start.backend,
    query: async () => ({ backend: cur.backend, values: { ...cur.values } }),
    set: async (s) => { cur = { backend: s.backend, values: { ...cur.values, ...s.values } }; return { backend: cur.backend, values: { ...cur.values } }; },
  });
  return { now: () => cur, change: (s: ProxyState) => { cur = { backend: s.backend, values: { ...s.values } }; } };
};
const MODE = 'org.gnome.system.proxy mode';
const leftover = (port: string): ProxyState => oursFor(`127.0.0.1:${port}`, 'gnome');
const corpOff: ProxyState = { backend: 'gnome', values: { ...oursFor('127.0.0.1:1080', 'gnome').values, 'org.gnome.system.proxy mode': "'auto'", 'org.gnome.system.proxy.socks host': "''" } };
const corp: ProxyState = { backend: 'gnome', values: { ...oursFor('127.0.0.1:1080', 'gnome').values, 'org.gnome.system.proxy.http host': "'corp'", 'org.gnome.system.proxy.http port': '8080' } };

describe('system proxy leftover of ours (Q0281)', () => {
  it('a leftover at proxy on is saved as no proxy, so proxy off gives direct, not our proxy', async () => {
    const f = fake(leftover('1080'));
    await setSystemProxy('127.0.0.1:1080');
    await clearSystemProxy();
    expect(f.now().values[MODE]).toBe("'none'");
    expect(systemProxyActive()).toBe(false);
  });
  it('the backup itself records no proxy, not our leftover', async () => {
    fake(leftover('1080'));
    await setSystemProxy('127.0.0.1:1080');
    const saved = readJson<{ state: ProxyState } | null>('proxy-backup.json', null);
    expect(saved?.state.values[MODE]).toBe("'none'");
    await clearSystemProxy();
  });
  it('restore undoes our proxy even after it moved to another port', async () => {
    const f = fake(corpOff);
    await setSystemProxy('127.0.0.1:1080');
    f.change(leftover('19080')); // dvpnd came back on another port
    await clearSystemProxy();
    expect(f.now().values[MODE]).toBe("'auto'");
  });
  it('a leftover on another port counts as ours too', async () => {
    const f = fake(leftover('19080'));
    await setSystemProxy('127.0.0.1:1080');
    await clearSystemProxy();
    expect(f.now().values[MODE]).toBe("'none'");
  });
  it('proxy off with no backup clears a leftover of ours only when asked (orphan)', async () => {
    const f = fake(leftover('1080'));
    await clearSystemProxy();
    expect(f.now().values[MODE]).toBe("'manual'"); // app start / session end: untouched
    await clearSystemProxy({ orphan: true });
    expect(f.now().values[MODE]).toBe("'none'");
  });
  it("someone else's proxy (an HTTP proxy beside the SOCKS) is never touched", async () => {
    expect(looksOurs(corp)).toBe(false);
    const f = fake(corp);
    await clearSystemProxy({ orphan: true });
    expect(f.now()).toEqual(corp);
  });
  it('KDE: a leftover of ours becomes ProxyType 0', async () => {
    const k = oursFor('127.0.0.1:1080', 'kde');
    expect(looksOurs(k)).toBe(true);
    expect(looksOurs({ backend: 'kde', values: { ...k.values, socksProxy: 'socks://10.0.0.5 1080' } })).toBe(false);
    const f = fake(k);
    await clearSystemProxy({ orphan: true });
    expect(f.now().values.ProxyType).toBe('0');
  });
});
