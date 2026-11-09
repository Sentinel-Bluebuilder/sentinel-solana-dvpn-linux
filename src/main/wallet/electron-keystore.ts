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
        return keypairFromInput(safeStorage.decryptString(fs.readFileSync(file)));
      } catch (err) {
        log.error('wallet: stored key could not be decrypted', err);
        throw new Error('Your stored wallet could not be unlocked with this account\'s keyring.');
      }
    },
    save(kp) {
      requireEncryption();
      fs.writeFileSync(file, safeStorage.encryptString(keypairToJson(kp)), { mode: 0o600 });
    },
    remove() {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    },
  };
}
