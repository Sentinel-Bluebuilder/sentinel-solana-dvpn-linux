// ─── `daemon migrate` — Linux (platform row; Windows runs the installer's home move here) ───
// On Linux a pre-cb33 home (/var/lib/dvpnd/client) moves to the c0 instance at the next `daemon install` (same device
// key; stageMigration + setup-daemon.sh --Config), so there is nothing for this command to do.
export interface MigrateOptions {
  dvpnd: string;
  legacyDvpnd?: string;
  programData?: string;
}

export type MigrateResult =
  | { status: 'skipped'; reason: string }
  | { status: 'migrated'; from: string; to: string; device?: string; log: string[] }
  | { status: 'failed'; step: string; error: string; log: string[] };

export async function runHomeMigration(_opts: MigrateOptions): Promise<MigrateResult> {
  return { status: 'skipped', reason: 'on Linux an older service home moves at `devnet-dvpn daemon install` (same device key)' };
}
