// ─── K13 (rc9-c2, review): session-active never tells an agent to end another run's session ───
import { describe, it, expect } from 'vitest';
import { daemonErrorCopy } from '../../src/core/daemon/link-copy';
import { SWEEP1_NEXT } from '../../src/cli/agent-cmd';

describe('K13: one next for session-active', () => {
  it("link-copy's session-active action equals agent-cmd's next", () => {
    const c = daemonErrorCopy('rpc error: code = FailedPrecondition desc = a session is already active');
    expect(c?.code).toBe('session-active');
    expect(c?.action).toBe(SWEEP1_NEXT['session-active']);
    expect(c?.action).toBe('devnet-dvpn agent status --json');
  });
  it('never a disconnect / down command', () => {
    expect(daemonErrorCopy('a session is already active')?.action).not.toMatch(/disconnect|agent down/);
  });
});
