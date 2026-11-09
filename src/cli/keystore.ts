// ─── CLI key store — Linux ───
// DVPN_KEYFILE (or --keyfile) points at a solana-keygen JSON that is used in place and never
// copied — how tests use the devnet wallet. Otherwise the key is kept in the desktop keyring
// (Secret Service: GNOME Keyring / KWallet) through `secret-tool`, so a CLI-imported key is not
// left in plain text. <data>/wallet.cli.keyring is only a marker (no secret in it) so `exists`
// needs no keyring round trip.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Keypair } from '@solana/web3.js';
import { keypairFromInput, keypairToJson } from '../core/wallet/keys';
import type { KeyStore } from '../main/host';

const LABEL = 'Devnet dVPN CLI wallet';

/** secret-tool attributes that name this data folder's wallet (exported for tests). */
export function keyringAttrs(dataDir: string): string[] {
  return ['application', 'devnet-dvpn', 'kind', 'cli-wallet', 'data-dir', path.resolve(dataDir)];
}

/** Map a secret-tool failure to something a person can act on (exported for tests). */
export function keyringError(raw: string): Error {
  if (/ENOENT|not found|No such file/i.test(raw)) {
    return new Error('The keyring tool secret-tool is not installed (package libsecret-tools). Install it, or use a key file: --keyfile <path> or DVPN_KEYFILE.');
  }
  if (/org\.freedesktop\.secrets|DBus|D-Bus|dbus|was not provided by any \.service|Cannot autolaunch|locked|prompt/i.test(raw)) {
    return new Error('No unlocked keyring is available in this session (for example an SSH login without a desktop). Unlock your keyring, or use a key file: --keyfile <path> or DVPN_KEYFILE.');
  }
  return new Error(`The keyring could not store or read the wallet: ${raw.split('\n')[0]}`);
}

function secretTool(args: string[], input?: string): string {
  try {
    return execFileSync('secret-tool', args, { input, encoding: 'utf8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    const e = err as { stderr?: unknown; code?: string; status?: number; message: string };
    // lookup of a missing item exits 1 with empty output: not an error for the caller.
    if (args[0] === 'lookup' && e.status === 1 && !String(e.stderr ?? '').trim()) return '';
    throw keyringError(e.code === 'ENOENT' ? 'ENOENT' : String(e.stderr ?? '') || e.message);
  }
}

export function cliKeyStore(dataDir: string, keyfile?: string): KeyStore {
  if (keyfile) {
    return {
      kind: 'keyfile',
      exists: () => fs.existsSync(keyfile),
      load: (): Keypair | null => (fs.existsSync(keyfile) ? keypairFromInput(fs.readFileSync(keyfile, 'utf8')) : null),
      save() { throw new Error('A --keyfile wallet is read-only. Unset DVPN_KEYFILE to import or create a wallet.'); },
      remove() { throw new Error('A --keyfile wallet is never deleted by this CLI.'); },
    };
  }
  const marker = path.join(dataDir, 'wallet.cli.keyring');
  const attrs = keyringAttrs(dataDir);
  return {
    // Not 'keyfile': vault.ts skips its "never replace a wallet" check only for a read-only key
    // file, and this store CAN be overwritten (Windows VM sweep 2026-10-21).
    kind: 'keyring',
    exists: () => fs.existsSync(marker),
    load(): Keypair | null {
      if (!fs.existsSync(marker)) return null;
      const json = secretTool(['lookup', ...attrs]).trim();
      if (!json) throw new Error('The wallet is missing from the keyring (it was removed outside this app). Import it again, or use a key file.');
      return keypairFromInput(json);
    },
    save(kp) {
      secretTool(['store', '--label', LABEL, ...attrs], keypairToJson(kp));
      // Read it back before saying it is saved: a keyring that silently drops items is caught here.
      if (secretTool(['lookup', ...attrs]).trim() !== keypairToJson(kp).trim()) throw new Error('The keyring did not keep the wallet. Nothing was saved.');
      fs.writeFileSync(marker, JSON.stringify({ store: 'secret-service', label: LABEL, at: new Date().toISOString() }) + '\n', { encoding: 'utf8', mode: 0o600 });
    },
    remove() {
      if (fs.existsSync(marker)) secretTool(['clear', ...attrs]);
      fs.rmSync(marker, { force: true });
    },
  };
}
