// ─── L4 (rc9-c2, review w11 rc9-c L4): the Windows keyfile-mode next removes EXPLICIT group ACEs too ───
import { describe, it, expect } from 'vitest';
import { keyfileModeNext, keyfileModeProblem, WIN_OPEN_GROUP_SIDS } from '../../src/cli/keystore';

const F = 'C:\\rc9\\l4c\\owner.json';
const SID = '*S-1-5-21-1505977726-3525998583-16231140-500';
// The names icacls prints for the groups, by SID.
const NAME: Record<string, string> = { '*S-1-1-0': 'Everyone', '*S-1-5-11': 'NT AUTHORITY\\Authenticated Users', '*S-1-5-32-545': 'BUILTIN\\Users', '*S-1-5-18': 'NT AUTHORITY\\SYSTEM', '*S-1-5-32-544': 'BUILTIN\\Administrators' };
type Ace = { who: string; perm: string; inherited: boolean };

/** What icacls does with the printed line, as far as this check needs: /inheritance:r drops inherited ACEs,
 *  /remove:g drops every grant for each SID named, /grant:r replaces the account's grant. */
function runIcacls(line: string, acl: Ace[]): Ace[] {
  const cmd = line.split(', then ')[0];
  const args = cmd.match(/"[^"]*"|\S+/g)!.slice(2).map((a) => a.replace(/^"|"$/g, ''));
  let out = [...acl];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '/inheritance:r') out = out.filter((a) => !a.inherited);
    else if (args[i] === '/remove:g') { while (args[i + 1] && !args[i + 1].startsWith('/')) { const s = args[++i]; out = out.filter((a) => a.who !== s && a.who !== NAME[s]); } }
    else if (args[i] === '/grant:r') { while (args[i + 1] && !args[i + 1].startsWith('/')) { const [who, perm] = args[++i].split(/:(?=[^:]*$)/); out = out.filter((a) => a.who !== who); out.push({ who, perm, inherited: false }); } }
    else throw new Error(`unexpected icacls argument ${args[i]}`);
  }
  return out;
}
const print = (acl: Ace[]): string => `${F} ${acl.map((a) => `${NAME[a.who] ?? a.who}:${a.inherited ? '(I)' : ''}(${a.perm})`).join('\n            ')}\n\nSuccessfully processed 1 files; Failed processing 0 files\n`;

// review's w11 copy, after the rc9-c next: explicit Users:RX and Authenticated Users:M were still there.
const W11: Ace[] = [
  { who: '*S-1-5-11', perm: 'M', inherited: false },
  { who: '*S-1-5-18', perm: 'F', inherited: true },
  { who: '*S-1-5-32-544', perm: 'F', inherited: true },
  { who: '*S-1-5-32-545', perm: 'RX', inherited: false },
  { who: SID, perm: 'F', inherited: false },
];

describe('L4: the next ends the loop', () => {
  it('the w11 ACL is keyfile-mode before the next', () => {
    expect(keyfileModeProblem(F, 'win32', undefined, () => print(W11))).not.toBeNull();
  });
  it('after the printed line, only this account is left and keyfileModeProblem is satisfied', () => {
    const line = keyfileModeNext(F, 'win32', SID);
    const after = runIcacls(line, W11);
    expect(after).toEqual([{ who: SID, perm: 'F', inherited: false }]);
    expect(keyfileModeProblem(F, 'win32', undefined, () => print(after))).toBeNull();
  });
  it('explicit Everyone too; a control: the old line leaves the explicit ACEs', () => {
    const withEveryone = [...W11, { who: '*S-1-1-0', perm: 'R', inherited: false }];
    expect(keyfileModeProblem(F, 'win32', undefined, () => print(runIcacls(keyfileModeNext(F, 'win32', SID), withEveryone)))).toBeNull();
    const old = `icacls "${F}" /inheritance:r /grant:r "${SID}:F", then devnet-dvpn agent up --yes`;
    expect(keyfileModeProblem(F, 'win32', undefined, () => print(runIcacls(old, W11)))).not.toBeNull();
  });
  it('the line removes every group keyfileModeProblem refuses, by SID, in one command', () => {
    const line = keyfileModeNext(F, 'win32', SID);
    expect(line.split(', then ')).toHaveLength(2);
    expect(WIN_OPEN_GROUP_SIDS).toEqual(['*S-1-1-0', '*S-1-5-11', '*S-1-5-32-545']);
    expect(line).toContain('/remove:g *S-1-1-0 *S-1-5-11 *S-1-5-32-545 /grant:r');
    for (const s of WIN_OPEN_GROUP_SIDS) expect(keyfileModeProblem(F, 'win32', undefined, () => print([{ who: SID, perm: 'F', inherited: false }, { who: s, perm: 'R', inherited: false }]))).not.toBeNull();
  });
});
