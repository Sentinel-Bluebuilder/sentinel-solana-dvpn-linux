// ─── K-WIN2 (the agent kit rc.9): wallet show WARNS about an open key file (keyfileMode + next), never refuses ───
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../src/main/wallet/vault', async (orig) => ({ ...(await orig<object>()), ownerAddress: () => 'Owner1' }));
vi.mock('../../src/main/services/wallet', async (orig) => ({
  ...(await orig<object>()),
  refreshWallet: async () => ({ owner: 'Owner1', ownerLamports: 1, ownerTdvpn: '0', userBalance: '0', delegated: '0' }),
}));

const { COMMANDS } = await import('../../src/cli/commands');
const { parseArgs } = await import('../../src/cli/args');

const run = async (line: string): Promise<{ human: string; data: Record<string, unknown> }> => {
  let out = { human: '', data: {} as Record<string, unknown> };
  await COMMANDS.wallet.run(parseArgs(line.split(' ')), { json: true, print: (human: string, data?: unknown) => { out = { human, data: data as Record<string, unknown> }; } });
  return out;
};
const file = (mode: number): string => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-')), 'k.json');
  fs.writeFileSync(f, '[]');
  fs.chmodSync(f, mode);
  return f;
};

beforeEach(() => { delete process.env.DVPN_KEYFILE; });

describe.skipIf(process.platform === 'win32')('K-WIN2: wallet show and an open key file', () => {
  it('a key file other users can read: answered (ok), keyfileMode + the fix as next', async () => {
    const f = file(0o644);
    const r = await run(`wallet show --keyfile ${f}`);
    expect(r.data.keyfileMode).toBe(`The key file ${f} can be read by other users (mode 644).`);
    expect(r.data.next).toBe(`chmod 600 ${f}, then devnet-dvpn agent up --yes`);
    expect(r.human).toMatch(/\nWarning: The key file .* Fix: chmod 600 /);
  });
  it('negative control: a 600 key file: no warning, next = agent status', async () => {
    const r = await run(`wallet show --keyfile ${file(0o600)}`);
    expect(r.data.keyfileMode).toBeUndefined();
    expect(r.data.next).toBe('devnet-dvpn agent status --json');
  });
});
