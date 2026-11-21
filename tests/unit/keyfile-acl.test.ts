// ─── K-WIN (the agent kit rc.9, review rc.8 edge check): on Windows the key-file check reads the ACL ───
import { describe, it, expect } from 'vitest';
import { keyfileModeProblem } from '../../src/cli/keystore';
import { keyfileModeNext } from '../../src/cli/agent-cmd';

const F = 'C:\\Users\\me\\k.json';
const out = (...aces: string[]): string => `${F} ${aces.join('\n            ')}\n\nSuccessfully processed 1 files; Failed processing 0 files\n`;
const OWNER = ['DESKTOP-1\\me:(F)', 'NT AUTHORITY\\SYSTEM:(I)(F)', 'BUILTIN\\Administrators:(I)(F)'];

describe('K-WIN: the key file ACL on win32', () => {
  it('review shape: a copy with BUILTIN\\Users:R (inherited) is keyfile-mode', () => {
    expect(keyfileModeProblem(F, 'win32', undefined, () => out(...OWNER, 'BUILTIN\\Users:(I)(RX)'))).toEqual({ path: F, mode: 'BUILTIN\\Users:(I)(RX)' });
  });
  it('Everyone, Authenticated Users and the bare SIDs are keyfile-mode too', () => {
    for (const ace of ['Everyone:(R)', 'NT AUTHORITY\\Authenticated Users:(I)(M)', '*S-1-5-32-545:(R)', '*S-1-1-0:(F)', '*S-1-5-11:(RX)']) {
      expect(keyfileModeProblem(F, 'win32', undefined, () => out(...OWNER, ace))?.mode).toBe(ace);
    }
  });
  it('the group as the first ACE (on the line with the path) is found', () => {
    expect(keyfileModeProblem(F, 'win32', undefined, () => out('BUILTIN\\Users:(R)', ...OWNER))?.mode).toBe('BUILTIN\\Users:(R)');
  });
  it('negative controls: only the owner, SYSTEM and Administrators; or a DENY ACE: no problem', () => {
    expect(keyfileModeProblem(F, 'win32', undefined, () => out(...OWNER))).toBeNull();
    expect(keyfileModeProblem(F, 'win32', undefined, () => out(...OWNER, 'Everyone:(DENY)(R)'))).toBeNull();
  });
  it('icacls fails: fail-open (null), never a refusal', () => {
    expect(keyfileModeProblem(F, 'win32', undefined, () => { throw new Error('spawn icacls ENOENT'); })).toBeNull();
  });
  it('next: only you on Windows, chmod elsewhere', () => {
    expect(keyfileModeNext(F, 'win32', 'PC\\alice')).toBe(`icacls "${F}" /inheritance:r /remove:g *S-1-1-0 *S-1-5-11 *S-1-5-32-545 /grant:r "PC\\alice:F", then devnet-dvpn agent up --yes`); // KWIN-USER, L4
    expect(keyfileModeNext('/k.json', 'linux')).toBe('chmod 600 /k.json, then devnet-dvpn agent up --yes');
  });
});
