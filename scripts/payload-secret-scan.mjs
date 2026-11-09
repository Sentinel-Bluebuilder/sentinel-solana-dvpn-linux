// ─── payload-secret-scan — fail a release whose payload carries an inline RPC api-key ───
// Build checklist (same rule as the Mac release, FMC): a shipped RPC endpoint must never carry an
// inline api-key. The installer writes no key (the default is the public devnet RPC,
// src/core/chain/rpc.ts DEFAULT_RPC_URLS); test rigs inject their lane URL only at setup time.
// Scans every file as bytes (binaries too: the bundled dvpnd, the CLI bundle, app.asar), so a key
// baked into a config default or a binary is caught. Output is redacted: the key never prints.
// The .deb, .rpm and AppImage are all packed from dist/linux*-unpacked, so scanning that tree (plus
// the package scripts in build/linux) covers all three; the packages themselves are compressed.
// Usage: node scripts/payload-secret-scan.mjs <dir>...     exit 0 clean, 1 hit, 2 nothing to scan
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Scan ───
const KEY = /api[_-]?key[=:][^"'\s&<>]*/gi;

function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (e.isFile()) yield p;
  }
}

export function redact(text) {
  return text.replace(/(api[_-]?key[=:])[^"'\s&<>]*/gi, '$1<REDACTED>');
}

/** Every inline api-key under the given dirs: [{ file, hit }] with the key value redacted. */
export function scanPayload(dirs) {
  const hits = [];
  for (const dir of dirs) {
    for (const file of files(dir)) {
      const text = fs.readFileSync(file).toString('latin1');
      for (const m of text.matchAll(KEY)) {
        // A bare "api_key=" with no value (a doc or a placeholder) is not a key.
        if (m[0].replace(/^api[_-]?key[=:]/i, '').length === 0) continue;
        hits.push({ file, hit: redact(m[0]).slice(0, 80) });
      }
    }
  }
  return hits;
}

// ─── CLI ───
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dirs = process.argv.slice(2).filter((d) => fs.existsSync(d));
  if (dirs.length === 0) {
    console.error('payload-secret-scan: nothing to scan (no unpacked app dir?)');
    process.exit(2);
  }
  const hits = scanPayload(dirs);
  if (hits.length > 0) {
    console.error(`SECRET LEAK: inline api-key in the release payload (the installer must ship no RPC key):`);
    for (const h of hits.slice(0, 10)) console.error(`  ${h.file}: ${h.hit}`);
    process.exit(1);
  }
  console.log(`ok   release payload carries no inline api-key (${dirs.join(', ')})`);
}
