// ─── Q0567 (Agent M, Mac): showing the address never decrypts the wallet; only signing does ───
// On macOS every update makes the Keychain ask for the login password on the first decrypt; at log-in under a
// kept kill switch block that prompt stood in front of the blocked view.
import { describe, expect, it, vi } from 'vitest';
import { Keypair } from '@solana/web3.js';
import type { KeyStore } from '../../src/main/host';

const kp = Keypair.generate();
const store = { loads: 0, addr: kp.publicKey.toBase58() as string | null };
const keyStore: KeyStore = {
  kind: 'safeStorage',
  exists: () => true,
  load: () => { store.loads += 1; return kp; },
  save: () => undefined,
  remove: () => undefined,
  address: () => store.addr,
};
vi.mock('../../src/main/host', () => ({ getHost: () => ({ keyStore }) }));
vi.mock('../../src/main/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const vault = await import('../../src/main/wallet/vault');

describe('owner address without decrypt', () => {
  it('ownerAddress reads the stored address and never calls load()', () => {
    expect(vault.ownerAddress()).toBe(kp.publicKey.toBase58());
    expect(store.loads).toBe(0);
  });
  it('negative control: with no stored address (older version) it falls back to load()', () => {
    store.addr = null;
    expect(vault.ownerAddress()).toBe(kp.publicKey.toBase58());
    expect(store.loads).toBe(1);
  });
  it('signing still decrypts', () => {
    expect(vault.ownerSigner()).toBeTruthy();
    expect(store.loads).toBeGreaterThanOrEqual(1);
  });
});

describe('the safeStorage store keeps the address beside the secret', () => {
  it('written on save and backfilled on load; removed with the wallet', async () => {
    const src = (await import('node:fs')).readFileSync('src/main/wallet/electron-keystore.ts', 'utf8');
    expect(src).toContain("const addrFile = path.join(dataDir, 'wallet.address');");
    // L-25: the secret is written beside the file and renamed over it, never written in place.
    expect(src).toMatch(/writeFileSync\(tmp, safeStorage\.encryptString\(keypairToJson\(kp\)\)(, \{ mode: 0o600 \})?\);\n\s+fs\.renameSync\(tmp, file\);\n\s+writeAddr\(kp\);/); // Linux writes 0600
    expect(src).not.toMatch(/writeFileSync\(file,/);
    expect(src).toContain('if (!fs.existsSync(addrFile)) writeAddr(kp); // a wallet saved by an older version');
    expect(src).toContain('if (fs.existsSync(addrFile)) fs.unlinkSync(addrFile);');
  });
  it('the auto device-permission check asks whether a wallet exists, not for the key', async () => {
    const src = (await import('node:fs')).readFileSync('src/main/services/wallet.ts', 'utf8');
    expect(src).toContain('hasKey: hasWallet() }');
    expect(src).not.toContain('hasKey: !!ownerKeypair()');
  });
});
