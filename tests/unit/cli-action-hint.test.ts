// TLX (Q0430 proof, 0.1.12 CLI): the refusal ended with "→ Open diagnostics", a screen the command
// line does not have. The text output now names the command to type.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cliActionHint, cliMessage } from '../../src/cli/action-hint';

describe('CLI next-step hint', () => {
  // The driver-report case (a real Linux AWG blocker message) is in tests/platform/linux/ (the Linux app).
  it('a message that names Repair drivers points at repair-drivers, not a screen', () => {
    expect(cliActionHint('Open diagnostics', 'AmneziaWG is not installed. Repair drivers in Diagnostics.')).toBe('devnet-dvpn daemon repair-drivers --yes');
  });
  it('screen-only labels become commands; everything else is unchanged', () => {
    expect(cliActionHint('Open diagnostics', 'The VPN service is not running.')).toBe('devnet-dvpn daemon doctor');
    expect(cliActionHint('Open settings', 'x')).toBe('devnet-dvpn daemon settings');
    expect(cliActionHint('Open Wallet', 'x')).toBe('devnet-dvpn wallet show');
    expect(cliActionHint('Pick another server', 'x')).toBe('Pick another server');
    expect(cliActionHint(null, 'x')).toBeNull();
  });
  it('DVPN-WIN q0563f: "press Restore network" in the text names the CLI command; other text unchanged', () => {
    expect(cliMessage('The VPN service stopped while connecting. If the kill switch is on, it is still blocking the internet: connect again, or press Restore network.'))
      .toContain('or run devnet-dvpn daemon restore-network.');
    expect(cliActionHint('Restore network', 'x')).toBe('devnet-dvpn daemon restore-network');
    expect(cliMessage('Nothing to restore here.')).toBe('Nothing to restore here.');
    expect(fs.readFileSync('src/cli/error-out.ts', 'utf8')).toContain('redact(cliMessage(e.message))');
  });
  it('E-4: the capital form ("Press Restore network, then connect", kill-switch-held) is rewritten too', () => {
    expect(cliMessage('The kill switch is still blocking the internet and lets through only the server you were on, so this server cannot be reached. Press Restore network, then connect. Nothing was paid.'))
      .toContain('reached. Run devnet-dvpn daemon restore-network, then connect.');
  });
  it('every hint command exists in the CLI catalogue', () => {
    const cat = fs.readFileSync('src/cli/catalogue.ts', 'utf8');
    for (const c of ['daemon repair-drivers', 'daemon doctor', 'daemon settings', 'wallet show', 'daemon restore-network']) expect(cat).toContain(`cmd: '${c}'`);
  });
  it('text output uses the hint; JSON keeps the raw action', () => {
    const src = fs.readFileSync('src/cli/error-out.ts', 'utf8');
    expect(src).toContain('const hint = cliActionHint(e.action, e.message);');
    expect(src).toContain('action: e.action ?? null');
    expect(src).not.toContain('`\\n→ ${e.action}`');
  });
});
