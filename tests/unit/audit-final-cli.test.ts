// ─── AUD-2 (the agent kit rc.9 final audit of src/cli): the M rows, one test each (docs/AUDIT-FINAL-CLI.md) ───
import { describe, it, expect } from 'vitest';
import { commandNext, cliMessage } from '../../src/cli/action-hint';
import { exitCodeFor } from '../../src/cli/exit-codes';
import { parseArgs, UsageError } from '../../src/cli/args';
import { moneyOf } from '../../src/cli/money-note';
import { blockedAdvice } from '../../src/cli/status-cmd';
import { cliKeyStore } from '../../src/cli/keystore';
import { errorOutput } from '../../src/cli/error-out';

describe('AUD-2: final audit M rows', () => {
  it('M1: --json next is a command, never a button label', () => {
    expect(commandNext('Retry', 'x')).toBe('devnet-dvpn agent status --json');
    expect(commandNext('Open Diagnostics', 'x')).toBe('devnet-dvpn daemon doctor');
    const j = JSON.parse(errorOutput(Object.assign(new Error('Could not start.'), { code: 'service-down', action: 'Open diagnostics' }), true, 'status').text);
    expect(j.next).toBe('devnet-dvpn daemon doctor');
    expect(j.action).toBe('Open diagnostics');
  });
  it('M1 negative control: a command stays itself', () => expect(commandNext('devnet-dvpn agent down --yes', 'x')).toBe('devnet-dvpn agent down --yes'));
  it('M2: a DNS server stays a DNS server; a VPN server is a node', () => {
    expect(cliMessage('The DNS server 9.9.9.9 is not valid.')).toBe('The DNS server 9.9.9.9 is not valid.');
    expect(cliMessage('The server refused.')).toBe('The node refused.');
  });
  it('M3: an unclear rpc code on a paying command is exit 1; elsewhere 6', () => {
    expect(exitCodeFor('rpc-busy', true)).toBe(1);
    expect(exitCodeFor('rpc-busy', false)).toBe(6);
    expect(exitCodeFor('rpc-busy')).toBe(6);
  });
  it('M4: on/off flags never take the next word', () => {
    const a = parseArgs(['connect', '--switch', 'NodeA', '--yes']);
    expect(a.flags.switch).toBe(true);
    expect(a._).toEqual(['connect', 'NodeA']);
  });
  it('M9: the blocked advice names restore-network in both kill-switch modes', () => {
    for (const ks of ['persist', 'on', undefined]) expect(blockedAdvice(ks)).toMatch(/daemon restore-network/);
    expect(blockedAdvice('on')).not.toMatch(/"disconnect"/);
  });
  it('M11: a read-only key file names both ways it was set, and a Windows command', () => {
    let e: (Error & { action?: string }) | null = null;
    try { cliKeyStore('/tmp', '/tmp/k.json').save({} as never); } catch (err) { e = err as Error & { action?: string }; }
    expect(e?.action).toMatch(/drop --keyfile and unset DVPN_KEYFILE \(PowerShell: Remove-Item Env:DVPN_KEYFILE\)/);
  });
  it('M12: local refusals say nothing was sent', () => {
    expect(moneyOf('device-key-unreadable')).toBe('none');
    expect(moneyOf('setting-rejected')).toBe('none');
  });
  it('M7: a bad rpc set URL is a usage error, nothing changed', async () => {
    const { rpcCmd } = await import('../../src/cli/info-cmd');
    await expect(rpcCmd(parseArgs(['rpc', 'set', 'http://example.com']), { json: true, print: () => undefined })).rejects.toBeInstanceOf(UsageError);
  });
});
