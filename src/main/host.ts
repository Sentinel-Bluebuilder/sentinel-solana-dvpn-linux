// ─── Host: what differs between the desktop app and the CLI ───
// Services under src/main (except index/ipc/tray/electron-keystore) never import
// electron. The Electron entry and the CLI entry each call setHost() once.
import type { Keypair } from '@solana/web3.js';

export interface KeyStore {
  /** 'keyfile' = a user-supplied key file used in place (read-only); 'dpapi' (Windows) / 'keyring' (macOS Keychain, Linux) / 'keystore' (Android Keystore) = the encrypted wallet. */
  kind: 'safeStorage' | 'dpapi' | 'keyring' | 'keystore' | 'keyfile' | 'memory';
  exists(): boolean;
  load(): Keypair | null;
  save(kp: Keypair): void;
  remove(): void;
  /** Q0567: the public address without decrypting (null = not known; then load() is used). */
  address?(): string | null;
  /** rc.4 E-18: the file a 'keyfile' store reads, so a missing one can be named. */
  path?: string;
}

export interface Host {
  name: 'app' | 'cli';
  resourcesDir: string;
  dataDir: string;
  keyStore: KeyStore;
  /** Push a state/event message to the UI (no-op or stdout for the CLI). */
  emit(channel: string, payload: unknown): void;
}

let host: Host | null = null;

export function setHost(h: Host): void {
  host = h;
}

export function getHost(): Host {
  if (!host) throw new Error('host not initialised'); // copy:internal
  return host;
}
