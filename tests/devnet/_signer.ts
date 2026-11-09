// ─── Test signer from TEST_KEYFILE ───
// Reads the #28 devnet wallet key file IN PLACE (never copied). The file has no
// mnemonic — it is the only copy besides its offline backup.
import { readFileSync } from 'node:fs';
import { Keypair, type TransactionInstruction } from '@solana/web3.js';
import { buildTx, sendSigned, type TxResult } from '../../src/core/chain/tx';

export function testKeypair(): Keypair | null {
  const p = process.env.TEST_KEYFILE;
  if (!p) return null;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf8'))));
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Simulate → sign → send → confirm, then wait 7 s (chain-test spacing rule). */
export async function land(kp: Keypair, ixs: TransactionInstruction[], label: string): Promise<TxResult> {
  const built = await buildTx(ixs, kp.publicKey, { label });
  built.tx.sign([kp]);
  const res = await sendSigned(built.tx, { lastValidBlockHeight: built.lastValidBlockHeight, label });
  console.log(`[landed] ${label} ${res.signature} slot ${res.slot} cu ${built.unitsConsumed}`);
  await sleep(7000);
  return res;
}
