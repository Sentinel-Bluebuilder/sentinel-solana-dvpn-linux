// rc.4 E-18 (FINDINGS-FOR-RC4, was M9): DVPN_KEYFILE / --keyfile naming a file that is gone read as
// "no wallet", and the next step offered was `wallet create`: a new, empty wallet, while the funds stay
// with the lost key. A missing key file is its own answer, `keyfile-missing`, naming the path.
import { describe, expect, it, beforeEach } from 'vitest';
import { setHost, type KeyStore } from '../../src/main/host';
import { noWallet } from '../../src/main/wallet/vault';
import { CONNECT_CODES } from '../../src/core/session/state';
import { CONNECT_CODE_TO_RESULT } from '../../src/core/nodetest/connect-codes';

function useStore(ks: Partial<KeyStore>): void {
  const store: KeyStore = { kind: 'dpapi', exists: () => false, load: () => null, save: () => undefined, remove: () => undefined, ...ks };
  setHost({ name: 'cli', resourcesDir: '', dataDir: '', keyStore: store, emit: () => undefined });
}

describe('noWallet: a missing key file is not "no wallet"', () => {
  beforeEach(() => useStore({}));

  it('a key file wallet whose file is gone: keyfile-missing, names the path, never offers a new wallet', () => {
    useStore({ kind: 'keyfile', path: '/home/u/dvpn.json', exists: () => false });
    const r = noWallet();
    expect(r.code).toBe('keyfile-missing');
    expect(r.error).toBe('The key file /home/u/dvpn.json is missing: restore it from your backup. Nothing was paid.');
    expect(r.error).not.toMatch(/Set up a wallet/);
  });

  it('without a known path it still says key file, not wallet setup', () => {
    useStore({ kind: 'keyfile', exists: () => false });
    expect(noWallet()).toEqual({ error: 'The key file named by --keyfile or DVPN_KEYFILE is missing: restore it from your backup. Nothing was paid.', code: 'keyfile-missing' });
  });

  it('negative control: an encrypted wallet store with no wallet is still no-wallet', () => {
    useStore({ kind: 'dpapi', exists: () => false });
    expect(noWallet()).toEqual({ error: 'Set up a wallet first.', code: 'no-wallet' });
  });

  it('is a connect code, and the server test counts it as this computer\'s fault', () => {
    expect(CONNECT_CODES).toContain('keyfile-missing');
    expect(CONNECT_CODE_TO_RESULT['keyfile-missing']).toBe('SERVICE_NOT_READY');
  });
});

describe('every "no owner" answer in the services goes through noWallet', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const files = ['connection', 'settlement', 'activity', 'node-test'].map((f) => `src/main/services/${f}.ts`);
  it.each(files)('%s has no hand-written no-wallet answer left', (f) => {
    const src = fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
    expect(src).not.toMatch(/'Set up a wallet first\.'/);
    expect(src).toMatch(/noWallet\(\)/);
  });
});
