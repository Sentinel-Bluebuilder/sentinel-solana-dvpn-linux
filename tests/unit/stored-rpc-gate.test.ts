// Q0478 (Linux port of Mac Q0468): the config writers re-checked https on the RPC already stored in the service config.
// With an http:// gate stored (a lab box, or one set by hand) every `daemon set` failed with "RPC url must use https://",
// so the kill switch never persisted. A typed --rpc must still be https; the stored one is kept, still character-checked.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readToml, renderConfig, renderConfigs, validateForApply, validateSettings, type DaemonSettings } from '../../src/core/daemon/config';

const ROOT = fs.readFileSync('tests/fixtures/dvpnd-root.v2.config.toml', 'utf8');
const CLIENT = fs.readFileSync('tests/fixtures/dvpnd-client.v2.config.toml', 'utf8');
const BASE: DaemonSettings = {
  killSwitch: 'on', allowLan: false, dnsServers: ['1.1.1.1'], basis: 'per_gb', escrow: '100000',
  prepayBytes: '0', prepaySeconds: '0', rpcUrl: 'https://api.devnet.solana.com', rpcWsUrl: 'wss://api.devnet.solana.com',
} as DaemonSettings;
const GATE = { ...BASE, rpcUrl: 'http://127.0.0.1:8899/tok', rpcWsUrl: 'ws://127.0.0.1:8899/tok' };

describe('a stored http RPC gate does not block daemon set', () => {
  it('both writers render a kill-switch change with the stored http gate', () => {
    expect(() => renderConfigs(ROOT, CLIENT, GATE)).not.toThrow();
    expect(readToml(renderConfigs(ROOT, CLIENT, GATE).client, 'network', 'kill_switch')).toBeTruthy();
    const one = renderConfig(`${ROOT}\n${CLIENT}`, GATE);
    expect(readToml(one, 'rpc', 'url')).toBe('http://127.0.0.1:8899/tok');
  });
  it('a typed RPC still has to be https/wss (control)', () => {
    expect(() => validateSettings(GATE)).toThrow(/https/);
    expect(() => validateSettings({ ...BASE, rpcWsUrl: 'ws://x.example' })).toThrow(/wss/);
    expect(() => validateSettings(GATE, { allowInsecureRpc: true })).not.toThrow();
  });
  it('a stored value with a quote or a bad scheme is still refused', () => {
    expect(() => validateSettings({ ...GATE, rpcUrl: 'http://x.example/"\nkill_switch = "off' }, { allowInsecureRpc: true })).toThrow();
    expect(() => validateSettings({ ...GATE, rpcUrl: 'ftp://x.example' }, { allowInsecureRpc: true })).toThrow(/https/);
  });
  // the Windows app's apply check (validateForApply) replaces Linux's storedRpc flag: lax only for an unchanged stored RPC.
  it('apply is strict only when the RPC changes', () => {
    expect(() => validateForApply(GATE, GATE)).not.toThrow();
    expect(() => validateForApply(GATE, BASE)).toThrow(/https/);
    expect(() => validateForApply({ ...BASE, killSwitch: 'off' } as DaemonSettings, BASE)).not.toThrow();
  });
});
