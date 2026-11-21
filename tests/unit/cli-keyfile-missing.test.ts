// ─── E-18 / M9, CLI half: a --keyfile wallet whose file is gone is restored, never replaced ───
// The engine half (vault noWallet(), KeyStore.path, CONNECT_CODES) is connect-5e's a64b3a1e. Here: the CLI key store
// names its path, agent up / down / status and `wallet show` answer keyfile-missing (exit 1 for wallet show), and no
// next step for it says `wallet create`. With no key file named but a device record, the next names that owner.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({ kind: 'keyfile' as string, path: '/gone/devnet.json' as string | undefined, exists: false, rec: null as null | { owner: string } }));
vi.mock('../../src/main/host', async (orig) => {
  const real = await orig<typeof import('../../src/main/host')>();
  return { ...real, getHost: () => ({ keyStore: { kind: st.kind, path: st.path, exists: () => st.exists, load: () => null } }) };
});
vi.mock('../../src/main/daemon/manager', async (orig) => {
  const real = await orig<typeof import('../../src/main/daemon/manager')>();
  return { ...real, deviceRecord: () => st.rec };
});
vi.mock('../../src/main/app-state', () => ({ snapshot: () => ({}), patch: () => undefined }));

const { walletMissing, nextFor, statusNext, statusAlso } = await import('../../src/cli/agent-cmd');
const { walletMissingError } = await import('../../src/cli/commands');
const { cliKeyStore } = await import('../../src/cli/keystore');

beforeEach(() => { st.kind = 'keyfile'; st.path = '/gone/devnet.json'; st.exists = false; st.rec = null; });

describe('E-18 CLI half: keyfile-missing', () => {
  it('cliKeyStore names the key file it was given (and only then)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-'));
    expect(cliKeyStore(dir, path.join(dir, 'k.json')).path).toBe(path.join(dir, 'k.json'));
    expect(cliKeyStore(dir).path).toBeUndefined();
  });
  it('agent up: keyfile-missing names the file, says restore, never wallet create', () => {
    const m = walletMissing();
    expect(m.code).toBe('keyfile-missing');
    expect(m.message).toContain('/gone/devnet.json');
    expect(m.message).toContain('Nothing was paid');
    expect(m.next).toMatch(/^restore the key file named in "error" from your backup/);
    expect(m.next).not.toMatch(/wallet create/);
  });
  it('agent down: the restore step names agent down, not agent up', () => {
    expect(walletMissing('agent down').next).toMatch(/then devnet-dvpn agent down --yes$/);
  });
  it('wallet show / reads: an error with code keyfile-missing (exit 1), the file named', () => {
    const e = walletMissingError();
    expect(e.code).toBe('keyfile-missing');
    expect(e.message).toBe('The key file /gone/devnet.json is missing: restore it from your backup. Nothing was paid.');
  });
  it('no key file named, but a device record: import that owner, not create', () => {
    st.kind = 'dpapi'; st.path = undefined; st.rec = { owner: 'Own3rAddr' };
    const m = walletMissing();
    expect(m.code).toBe('no-wallet');
    expect(m.next).toContain('wallet import <the key file of Own3rAddr');
    expect(m.next).not.toMatch(/wallet create/);
  });
  it('negative control: no key file, no device record keeps the plain create step', () => {
    st.kind = 'dpapi'; st.path = undefined;
    expect(walletMissing()).toEqual({ message: 'No wallet.', code: 'no-wallet', next: nextFor('no-wallet') });
    expect(walletMissingError().code).toBe('no-wallet');
    expect(nextFor('no-wallet')).toMatch(/wallet create/);
  });
  it('E-63 (macOS rc.3): agent status next restores / imports, never wallet create, blocked or not', () => {
    const base = { owner: null, wallet: null, live: false, reachable: true, device: null };
    const keyNext = statusNext({ ...base, noWalletNext: walletMissing().next }); // as status() passes it
    expect(keyNext).toMatch(/^restore the key file/);
    // R3 gap 3: ONE runnable next (restore-network), the restore of the key file in alsoNext.
    expect(statusNext({ ...base, blocked: true, noWalletNext: walletMissing().next })).toBe('devnet-dvpn daemon restore-network');
    expect(statusAlso({ ...base, blocked: true, noWalletNext: walletMissing().next })).toMatch(/^then restore the key file/);
    st.kind = 'dpapi'; st.path = undefined; st.rec = { owner: 'Own3rAddr' };
    const recNext = statusNext({ ...base, noWalletNext: walletMissing().next });
    expect(recNext).toContain('wallet import');
    for (const n of [keyNext, recNext]) expect(n).not.toMatch(/wallet create/);
  });
  it('the key file being there is not keyfile-missing', () => {
    st.exists = true;
    expect(walletMissing().code).toBe('no-wallet');
  });
});
