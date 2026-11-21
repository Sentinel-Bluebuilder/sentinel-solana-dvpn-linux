// ─── U1-O (the agent kit rc.9, review rc.8 edge check): daemon install checks the administrator FIRST ───
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({ admin: false as boolean | null, walletReads: 0 }));
vi.mock('../../src/main/system/admin-check', () => ({ isAdminAccount: () => st.admin }));
vi.mock('../../src/main/wallet/vault', async (orig) => ({ ...(await orig<object>()), ownerAddress: () => null }));
vi.mock('../../src/main/services/wallet', async (orig) => ({ ...(await orig<object>()), refreshWallet: async () => { st.walletReads += 1; return null; } }));

const { COMMANDS } = await import('../../src/cli/commands');
const { parseArgs } = await import('../../src/cli/args');
const { exitCodeFor } = await import('../../src/cli/exit-codes');
const { moneyOf } = await import('../../src/cli/money-note');

const run = (line: string): Promise<void> => COMMANDS.daemon.run(parseArgs(line.split(' ')), { json: true, print: () => undefined });

beforeEach(() => { st.walletReads = 0; });

describe('U1-O: daemon install from a standard account', () => {
  it('review shape: a standard user gets needs-admin first (not device-not-ready), one elevated command, exit 4, nothing paid', async () => {
    st.admin = false;
    await expect(run('daemon install --yes')).rejects.toMatchObject({ code: 'needs-admin', action: "Start-Process devnet-dvpn -Verb RunAs -ArgumentList 'daemon install --yes'" });
    expect(st.walletReads).toBe(0); // before the wallet and device checks
    expect(exitCodeFor('needs-admin')).toBe(4);
    expect(moneyOf('needs-admin')).toBe('none');
  });
  it('negative controls: an administrator, or a system where it is not checked (null), goes on to the old checks', async () => {
    for (const admin of [true, null]) {
      st.admin = admin;
      await expect(run('daemon install --yes')).rejects.toMatchObject({ code: 'no-wallet' });
    }
  });
});

describe('isAdminAccount', () => {
  it('reads S-1-5-32-544 from whoami /groups on Windows; null elsewhere or on a failed read', async () => {
    const { isAdminAccount } = await vi.importActual<typeof import('../../src/main/system/admin-check')>('../../src/main/system/admin-check');
    expect(isAdminAccount('win32', () => '"BUILTIN\\Administrators","Alias","S-1-5-32-544","Group used for deny only"')).toBe(true);
    expect(isAdminAccount('win32', () => '"BUILTIN\\Users","Alias","S-1-5-32-545","Mandatory group"')).toBe(false);
    expect(isAdminAccount('win32', () => { throw new Error('whoami missing'); })).toBeNull();
    expect(isAdminAccount('linux', () => 'x')).toBeNull();
  });
});
