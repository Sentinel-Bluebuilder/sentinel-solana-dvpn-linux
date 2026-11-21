// ─── rc9-f2 B41 (= rc.10 A19): docs/AGENT-COMMANDS.md's session-active row names agent-cmd's action ───
// An agent that followed the old row ("agent down --yes, then agent up --yes") ended another run's session.
import fs from 'node:fs';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/main/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const { nextFor } = await import('../../src/cli/agent-cmd');
const DOC = fs.readFileSync('docs/AGENT-COMMANDS.md', 'utf8');

describe('B41: session-active', () => {
  it('the connect() row is the code\'s action (look, never end it)', () => {
    const from = DOC.indexOf('### From connect()');
    const i = DOC.indexOf('\n| `session-active` |', from);
    expect(from).toBeGreaterThan(-1);
    expect(i).toBeGreaterThan(from);
    const row = DOC.slice(i + 1, DOC.indexOf('\n', i + 1));
    expect(nextFor('session-active')).toBe('devnet-dvpn agent status --json');
    expect(row).toContain('`<cli> agent status --json`');
    expect(row).not.toContain('agent down --yes, then');
  });
});
