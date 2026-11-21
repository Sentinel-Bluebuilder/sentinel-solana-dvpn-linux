// ─── docs/AGENT-COMMANDS.md names every failure code agent up / down / status can return (as cli-map guards CLI.md) ───
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as state from '../../src/core/session/state';

// Ports (the Linux app/#33/#34) get CONNECT_CODES and the rpc-unavailable rewrite with a later sync: those checks skip until then.
const CONNECT_CODES: readonly string[] | undefined = (state as { CONNECT_CODES?: readonly string[] }).CONNECT_CODES;

const root = path.resolve(__dirname, '../..');
const read = (p: string): string => fs.readFileSync(path.join(root, p), 'utf8');
const doc = read('docs/AGENT-COMMANDS.md');
const all = (src: string, re: RegExp): string[] => [...src.matchAll(re)].map((m) => m[1]);
const documented = (code: string): boolean => doc.includes(`\`${code}\``);

const agent = read('src/cli/agent-cmd.ts');
// fail(message, 'code', next) and `r.code ?? 'connect-failed', nextFor(…)`: a code literal followed by its next step.
const raised = all(agent, /'([a-z][a-z-]+)',\s*(?:nextFor\(|`)/g);
const mapped = all(agent, /code === '([a-z][a-z-]+)'/g);
const linkCopy = read('src/core/daemon/link-copy.ts');
const copyFn = linkCopy.slice(linkCopy.indexOf('export function daemonErrorCopy'));
const replaced = all(copyFn.slice(0, copyFn.indexOf('\n}\n')), /code: '([a-z][a-z-]+)'/g);
const index = all(read('src/cli/error-out.ts'), /code: '([a-z][a-z-]+)'/g);

describe('docs/AGENT-COMMANDS.md', () => {
  it('found the codes in the code (positive control)', () => {
    expect(raised).toEqual(expect.arrayContaining(['no-wallet', 'no-nodes', 'not-funded', 'connect-failed', 'settle-failed']));
    expect(mapped).toEqual(expect.arrayContaining(['daemon-missing', 'protocol-missing', 'test-running']));
    expect(replaced).toEqual(expect.arrayContaining(['service-down', 'approval-revoked']));
  });
  it.skipIf(!CONNECT_CODES)('found CONNECT_CODES (positive control)', () => {
    expect(CONNECT_CODES!.length).toBeGreaterThan(40);
  });
  it.skipIf(!index.length)('found the rpc-unavailable rewrite in index.ts (positive control)', () => {
    expect(index).toContain('rpc-unavailable');
  });
  it('lists every code agent-cmd raises or maps', () => {
    expect([...raised, ...mapped].filter((c) => !documented(c))).toEqual([]);
  });
  it.skipIf(!CONNECT_CODES)('lists every code connect() can answer (CONNECT_CODES)', () => {
    expect(CONNECT_CODES!.filter((c) => !documented(c))).toEqual([]);
  });
  it('lists every code the error line can be rewritten to (daemonErrorCopy, rpc-unavailable)', () => {
    expect([...replaced, ...index].filter((c) => !documented(c))).toEqual([]);
  });
  it('negative control: an unknown code is not found', () => {
    expect(documented('no-such-code-xyz')).toBe(false);
  });
});
