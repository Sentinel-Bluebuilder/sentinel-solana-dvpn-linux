// ─── Q0295: "Open in PowerShell" opens a window ───
// wx1/wa1: the click started nothing. spawn('cmd.exe', ['/c','start','"Devnet dVPN CLI"', ..., '-Command', script])
// broke twice: Node re-quoted the title, and cmd read the script's | and & as its own operators.
// Proven on wx1: the old shape writes nothing; this one runs the script (same | & " content).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { powerShellLaunch } from '../../src/main/services/cli-exec';

describe('Open in PowerShell launch (Q0295)', () => {
  const script = `$env:DVPN_DATA_DIR = 'C:\Users\a b\data'; function global:x { a @args 2>&1 | ForEach-Object { "$_" } }`;
  const l = powerShellLaunch(script);

  it('cmd gets the command line verbatim, start with an explicit title', () => {
    expect(l.file).toBe('cmd.exe');
    expect(l.options).toEqual({ detached: true, stdio: 'ignore', windowsHide: false, windowsVerbatimArguments: true });
    expect(l.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(l.args[3]).toMatch(/^start "Devnet dVPN CLI" powershell\.exe -NoExit -NoProfile -EncodedCommand [A-Za-z0-9+/=]+$/);
  });

  it('the script reaches PowerShell intact and cmd sees none of its characters', () => {
    const b64 = l.args[3].split(' ').pop() as string;
    expect(Buffer.from(b64, 'base64').toString('utf16le')).toBe(script);
    expect(l.args[3]).not.toMatch(/[|&<>^]/);
  });

  it('openPowerShell uses it', () => {
    const src = readFileSync(join(__dirname, '../../src/main/services/cli-exec.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export function openPowerShell'));
    expect(fn).toMatch(/const l = powerShellLaunch\(script\);[\s\S]{0,400}?const p = spawn\(l\.file, l\.args, \{ \.\.\.l\.options/);
    expect(fn).toMatch(/WindowTitle = 'Devnet dVPN CLI'/);
  });
});
