// FMC-M6 (ported to Linux): `daemon set` printed the settings JSON with the RPC gate token in its confirm prompt.
// Only scheme + host is shown now, in the prompt and in `daemon settings`, wherever the token sits in the URL.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rpcShown, settingsShown } from '../../src/core/daemon/rpc-shown';

const TOKEN = 'tok3nSECRETabcdef0123456789';

describe('RPC URLs shown to the user', () => {
  it('never shows a token in the path, query or login part', () => {
    for (const u of [`https://gate.example/${TOKEN}`, `https://rpc.example/?api-key=${TOKEN}`, `https://u:${TOKEN}@rpc.example/`, `wss://gate.example/v1/${TOKEN}`, `http://127.0.0.1:8899/${TOKEN}`]) {
      const s = rpcShown(u);
      expect(s).not.toContain(TOKEN);
      expect(s).toContain('/<hidden>');
    }
    expect(rpcShown(`http://127.0.0.1:8899/${TOKEN}`)).toBe('http://127.0.0.1:8899/<hidden>');
  });
  it('negative control: a plain public endpoint reads as itself', () => {
    expect(rpcShown('https://api.devnet.solana.com')).toBe('https://api.devnet.solana.com');
    expect(rpcShown('not a url')).toBe('<hidden>');
  });
  it('settingsShown touches only the RPC fields', () => {
    const s = settingsShown({ rpcUrl: `https://gate.example/${TOKEN}`, rpcWsUrl: `wss://gate.example/${TOKEN}`, killSwitch: 'on' });
    expect(JSON.stringify(s)).not.toContain(TOKEN);
    expect(s.killSwitch).toBe('on');
  });
  it('daemon set prompts and daemon settings prints through it', () => {
    const src = fs.readFileSync('src/cli/daemon-cmd.ts', 'utf8');
    expect(src).toContain('JSON.stringify(settingsShown(next), null, 2)');
    expect(src).not.toMatch(/JSON\.stringify\(next\b/);
    expect(src).toContain("if (k === 'rpcUrl' || k === 'rpcWsUrl') return rpcShown(v);");
    expect(src).toContain('settings: settingsShown(s.settings)');
  });
});
