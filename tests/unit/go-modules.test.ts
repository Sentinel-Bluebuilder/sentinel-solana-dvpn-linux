import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { binaryModules, moduleDiff, noticeModules } from '../../scripts/go-modules.mjs';

// ─── dvpnd notices file vs the binary's embedded module list ───
const RULE = '='.repeat(80);
const binary = (deps: string[][]) => Buffer.concat([
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0xff]),
  Buffer.from('path\tgithub.com/sentinel-official/sentinel-dvpnd/cmd/sentinel-dvpnd\n'),
  Buffer.from(deps.map(([p, v]) => `dep\t${p}\t${v}\th1:x=\n`).join('')),
  Buffer.from('dep\tgithub.com/sentinel-official/sentinel-go-sdk/v3\tv3.0.0-rc.1\n=>\t../sentinel-go-sdk\t(devel)\t\n'),
  Buffer.from([0, 1, 2]),
]);
const notices = (mods: string[][]) => ['Third-party software compiled into sentinel-dvpnd', '',
  ...mods.flatMap(([p, v]) => [RULE, `${p} ${v}`, 'License: MIT', '-'.repeat(80), '', 'license text', 'inner', '=====', 'not a header v1', '']),
].join('\n');

describe('go-modules', () => {
  it('reads the binary build info, leaving Sentinel modules out', () => {
    const m = binaryModules(binary([['github.com/a/b', 'v1.2.0'], ['golang.org/x/net', 'v0.30.0']]));
    expect([...m]).toEqual([['github.com/a/b', 'v1.2.0'], ['golang.org/x/net', 'v0.30.0']]);
  });

  it('reads only the 80-= headers of a notices file', () => {
    expect([...noticeModules(notices([['github.com/a/b', 'v1.2.0']]))]).toEqual([['github.com/a/b', 'v1.2.0']]);
  });

  it('matches, and names every version or module difference', () => {
    const bin = binaryModules(binary([['github.com/a/b', 'v1.2.0'], ['github.com/gagliardetto/treeout', 'v0.1.4']]));
    expect(moduleDiff(bin, noticeModules(notices([['github.com/a/b', 'v1.2.0'], ['github.com/gagliardetto/treeout', 'v0.1.4']])))).toEqual([]);
    expect(moduleDiff(bin, noticeModules(notices([['github.com/a/b', 'v1.2.0'], ['github.com/gagliardetto/treeout', 'v0.1.5-0.20211231002423-c82a36ab197a'], ['github.com/c/d', 'v2.0.0']])))).toEqual([
      'github.com/c/d: binary none, notices v2.0.0',
      'github.com/gagliardetto/treeout: binary v0.1.4, notices v0.1.5-0.20211231002423-c82a36ab197a',
    ]);
  });

  it('parses the shipped dvpnd notices file', () => {
    const f = path.join(__dirname, '..', '..', 'build', 'licenses', 'dvpnd-THIRD-PARTY-NOTICES.txt');
    const mods = noticeModules(fs.readFileSync(f, 'utf8'));
    expect(mods.size).toBe(115);
    expect(mods.get('github.com/ncruces/go-sqlite3-wasm/v6')).toBe('v6.4.35401');
  });
});
