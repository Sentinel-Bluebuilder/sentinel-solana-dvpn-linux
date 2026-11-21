// ─── safeStorage KeyStore (desktop app) — Linux ───
// Ported from sentinel-node-manager-solana services/wallet.ts: refuse to store the key when
// the OS cannot encrypt it. On Linux, safeStorage uses the desktop keyring (GNOME libsecret or
// KWallet). With no keyring it falls back to 'basic_text' — a fixed, public key, i.e. not
// encrypted at all — and still reports encryption as available. That backend is refused.
import { safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { Keypair } from '@solana/web3.js';
import { keypairFromInput, keypairToJson } from '../../core/wallet/keys';
import type { KeyStore } from '../host';
import { log } from '../logger';

/** Backends that really encrypt with a per-user secret (exported for tests). */
export const STRONG_BACKENDS = ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'];

export function backendIsStrong(backend: string): boolean {
  return STRONG_BACKENDS.includes(backend);
}

export function safeStorageKeyStore(dataDir: string): KeyStore {
  const file = path.join(dataDir, 'wallet.secret');
  // Q0567 (the Windows app 80a9033, Agent M Mac): the public address beside the secret, so start-up and the blocked view never
  // decrypt (on Linux a locked keyring would otherwise be asked at start). Not a secret.
  const addrFile = path.join(dataDir, 'wallet.address');
  const writeAddr = (kp: Keypair): void => {
    try { fs.writeFileSync(addrFile, kp.publicKey.toBase58()); }
    catch (err) { log.warn('wallet: could not store the public address', { err: (err as Error).message }); }
  };
  const requireEncryption = (): void => {
    const backend = typeof safeStorage.getSelectedStorageBackend === 'function' ? safeStorage.getSelectedStorageBackend() : 'unknown';
    if (!safeStorage.isEncryptionAvailable() || !backendIsStrong(backend)) {
      log.warn('wallet: no strong key storage', { backend });
      throw new Error('This computer has no unlocked keyring to protect your wallet key (GNOME Keyring or KWallet). Sign in to your desktop session so the keyring unlocks, then try again.');
    }
  };
  return {
    kind: 'safeStorage',
    exists: () => fs.existsSync(file),
    load(): Keypair | null {
      if (!fs.existsSync(file)) return null;
      requireEncryption();
      try {
        const kp = keypairFromInput(safeStorage.decryptString(fs.readFileSync(file)));
        if (!fs.existsSync(addrFile)) writeAddr(kp); // a wallet saved by an older version
        return kp;
      } catch (err) {
        log.error('wallet: stored key could not be decrypted', err);
        throw new Error('Your stored wallet could not be unlocked with this account\'s keyring.');
      }
    },
    save(kp) {
      requireEncryption();
      // Whole file or nothing (the Windows app L-25): a crash or full disk mid-write left a cut wallet.secret that
      // could never be unlocked again. Written beside it (0600 from the start), then renamed over it.
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, safeStorage.encryptString(keypairToJson(kp)), { mode: 0o600 });
      fs.renameSync(tmp, file);
      writeAddr(kp);
    },
    address(): string | null {
      if (!fs.existsSync(file) || !fs.existsSync(addrFile)) return null;
      const a = fs.readFileSync(addrFile, 'utf8').trim();
      return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) ? a : null;
    },
    remove() {
      if (fs.existsSync(file)) fs.unlinkSync(file);
      if (fs.existsSync(addrFile)) fs.unlinkSync(addrFile);
    },
  };
}
