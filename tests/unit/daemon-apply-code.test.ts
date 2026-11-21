// ─── A16 (rc9-c2, review src/cli read): `daemon config set` keeps the apply's code ───
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.resolve('src/cli/daemon-cmd.ts'), 'utf8');
const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

describe('A16: daemon config set failure', () => {
  it('throws cliErr with r.code, never a bare Error(r.error)', () => {
    expect(code).not.toMatch(/new Error\(r\.error\)/);
    expect(code).toMatch(/cliErr\(r\.code \?\? 'apply-failed', `\$\{CLI_NAME\} agent status --json`, r\.error \?\? 'Applying the service settings failed\.'\)/);
  });
  it('every code applyServiceSettings returns is a known one', () => {
    const apply = fs.readFileSync(path.resolve('src/main/services/daemon-apply.ts'), 'utf8');
    const m = /code\?: ([^;]+);/.exec(apply);
    expect(m?.[1]).toBe("'apply-busy' | 'apply-while-connecting' | 'invalid-daemon-setting' | 'apply-failed'");
  });
});
