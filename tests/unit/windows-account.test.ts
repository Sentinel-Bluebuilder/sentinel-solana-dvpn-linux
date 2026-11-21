// ─── KWIN-USER (the agent kit rc.9, review): the icacls account is written in, never %USERNAME% (PowerShell does not expand it) ───
import { describe, it, expect } from 'vitest';
import { windowsAccount, keyfileModeNext } from '../../src/cli/keystore';

describe('windowsAccount', () => {
  it('a domain account: DOMAIN\\user', () => expect(windowsAccount({ USERNAME: 'alice', USERDOMAIN: 'PC' })).toBe('PC\\alice'));
  it('no domain: the user alone', () => expect(windowsAccount({ USERNAME: 'alice' })).toBe('alice'));
  it('the Windows next never carries %USERNAME%', () => expect(keyfileModeNext('C:\\k.json', 'win32')).not.toMatch(/%USERNAME%/));
  it('negative control: the POSIX next is unchanged', () => expect(keyfileModeNext('/k.json', 'linux')).toBe('chmod 600 /k.json, then devnet-dvpn agent up --yes'));
});
