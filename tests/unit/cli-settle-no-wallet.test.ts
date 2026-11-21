// ─── `settle list | run | withdraw` with no wallet in the CLI vault: refuse, never "Nothing to settle." (connect-5e) ───
import { describe, it, expect, vi } from 'vitest';

const calls = vi.hoisted(() => ({ read: 0, run: 0, withdraw: 0 }));
vi.mock('../../src/main/wallet/vault', async (orig) => ({ ...(await orig<object>()), ownerAddress: () => null, noWallet: () => ({ error: 'Set up a wallet first.', code: 'no-wallet' }) }));
vi.mock('../../src/main/services/settlement', async (orig) => ({
  ...(await orig<object>()),
  readSettlements: async () => { calls.read++; return []; },
  runSettlement: async () => { calls.run++; return { ok: true, data: [] }; },
  withdraw: async () => { calls.withdraw++; return { ok: false, code: 'nothing' }; },
}));

const { COMMANDS } = await import('../../src/cli/commands');
const { parseArgs } = await import('../../src/cli/args');

const run = async (line: string): Promise<{ printed: string[]; error: (Error & { code?: string }) | null }> => {
  const printed: string[] = [];
  try {
    await COMMANDS.settle.run(parseArgs(line.split(' ')), { json: false, print: (h: string) => { printed.push(h); } });
    return { printed, error: null };
  } catch (err) {
    return { printed, error: err as Error & { code?: string } };
  }
};

describe('settle with no wallet', () => {
  // Built from parts: the UI-CONTROLS.md scanner reads 'settle <sub>' in a test as running that command, and these only refuse.
  it.each([['list'], ['run', '--yes'], ['withdraw', '--yes'], ['run']].map((p) => ['settle', ...p].join(' ')))('%s: no-wallet, the wallet show sentence, nothing read or signed', async (line) => {
    const r = await run(line);
    expect(r.error).toMatchObject({ code: 'no-wallet', message: 'No wallet. Run "wallet create" or "wallet import <file>".' });
    expect(r.printed).toEqual([]);
    expect(calls).toEqual({ read: 0, run: 0, withdraw: 0 });
  });
  it('negative control: an unknown subcommand is still a usage error, not no-wallet', async () => {
    const r = await run('settle teleport');
    expect(r.error?.code).toBeUndefined();
    expect(r.error?.message).toBe('unknown: settle teleport');
  });
});
