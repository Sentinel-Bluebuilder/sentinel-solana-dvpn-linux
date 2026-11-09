// TLX (Q0430 proof, 0.1.12 CLI): the refusal ended with "→ Open diagnostics", a screen the command
// line does not have. The text output now names the command to type.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cliActionHint } from '../../src/cli/action-hint';
import { amneziawgBlockerFrom, parseReport } from '../../src/main/system/drivers';

describe('CLI next-step hint', () => {
  it('a missing driver points at repair-drivers, not a screen', () => {
    const msg = amneziawgBlockerFrom(parseReport('{"ok":false,"deps":[{"name":"amneziawg","wanted":"any","found":"","status":"missing","detail":"awg / awg-quick not found"}]}'))!;
    expect(cliActionHint('Open diagnostics', msg)).toBe('devnet-dvpn daemon repair-drivers --yes');
  });
  it('screen-only labels become commands; everything else is unchanged', () => {
    expect(cliActionHint('Open diagnostics', 'The VPN service is not running.')).toBe('devnet-dvpn daemon doctor');
    expect(cliActionHint('Open settings', 'x')).toBe('devnet-dvpn daemon settings');
    expect(cliActionHint('Open Wallet', 'x')).toBe('devnet-dvpn wallet show');
    expect(cliActionHint('Pick another server', 'x')).toBe('Pick another server');
    expect(cliActionHint(null, 'x')).toBeNull();
  });
  it('every hint command exists in the CLI catalogue', () => {
    const cat = fs.readFileSync('src/cli/catalogue.ts', 'utf8');
    for (const c of ['daemon repair-drivers', 'daemon doctor', 'daemon settings', 'wallet show']) expect(cat).toContain(`cmd: '${c}'`);
  });
  it('text output uses the hint; JSON keeps the raw action', () => {
    const src = fs.readFileSync('src/cli/index.ts', 'utf8');
    expect(src).toContain('const hint = cliActionHint(e.action, e.message);');
    expect(src).toContain('action: e.action ?? null');
    expect(src).not.toContain('`\\n→ ${e.action}`');
  });
});
