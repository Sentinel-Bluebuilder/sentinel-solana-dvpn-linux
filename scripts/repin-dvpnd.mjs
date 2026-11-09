#!/usr/bin/env node
// ─── Repin the bundled sentinel-dvpnd from a fork build's stage folder ───
// Usage: node scripts/repin-dvpnd.mjs <stage dir> [--bins <dir>] [--dry-run]
//   <stage dir> = fork-final-build.sh's stage/32-linux: MANIFEST, SHA256SUMS, linux-{amd64,arm64}/sentinel-dvpnd,
//   and dvpnd-THIRD-PARTY-NOTICES.txt (one block per Go module: version, licence, full text).
// It checks the stage (SHA256SUMS, devnet identity in MANIFEST and in each binary, the notices file against
// the binary's own module list), copies both binaries to the folder fetch-deps reads (--bins, default
// ~/work/devnet-dvpn-dvpnd-devnet/build), writes the new tag + SHA-256s into build/deps.lock.json and
// copies the notices file to build/licenses/. --dry-run writes nothing and reports.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { binaryModules, moduleDiff, noticeModules } from './go-modules.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCK_FILE = path.join(ROOT, 'build', 'deps.lock.json');
const DEVNET = {
  program_id: 'J52dyXW3a6mkatvrQct3fo6dA9vqUtcsdBt5gGqrTBXs',
  mint: 'Hen2LVP6KooGaXEvdSyCHWghsEY4gLLn7wix8z6zHFSa',
  network: 'devnet',
};
const ARCHES = { x64: 'linux-amd64', arm64: 'linux-arm64' };

// ─── Arguments ───
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const binsAt = args.indexOf('--bins');
const BINS = binsAt >= 0 ? args[binsAt + 1] : path.join(os.homedir(), 'Desktop', 'devnet-dvpn-dvpnd-devnet', 'build');
const STAGE = args.find((a, i) => !a.startsWith('--') && (binsAt < 0 || i !== binsAt + 1));
if (!STAGE) {
  console.error('usage: node scripts/repin-dvpnd.mjs <stage dir> [--bins <dir>] [--dry-run]');
  process.exit(3);
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const fail = (msg) => {
  console.error(`repin: ${msg}`);
  process.exit(1);
};

// ─── Stage: manifest, checksums, identity ───
const manifest = Object.fromEntries(
  fs.readFileSync(path.join(STAGE, 'MANIFEST'), 'utf8').split('\n')
    .map((l) => l.match(/^([a-z_]+):\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]),
);
for (const [k, v] of Object.entries(DEVNET)) {
  if (manifest[k] !== v) fail(`MANIFEST ${k} is "${manifest[k] ?? 'missing'}", want ${v}`);
}
if (!manifest.tag || !manifest.commit) fail('MANIFEST has no tag or commit');

const sums = new Map(fs.readFileSync(path.join(STAGE, 'SHA256SUMS'), 'utf8').split('\n')
  .map((l) => l.match(/^([0-9a-f]{64})\s+\.?\/?(.+)$/)).filter(Boolean).map((m) => [m[2], m[1]]));
const bins = {};
for (const [arch, dir] of Object.entries(ARCHES)) {
  const rel = `${dir}/sentinel-dvpnd`;
  const buf = fs.readFileSync(path.join(STAGE, rel));
  const got = sha256(buf);
  if (sums.get(rel) !== got) fail(`${rel}: SHA-256 ${got} does not match SHA256SUMS (${sums.get(rel) ?? 'not listed'})`);
  if (!buf.includes(Buffer.from(DEVNET.program_id))) fail(`${rel} has no devnet program id`);
  if (!buf.includes(Buffer.from(manifest.tag))) fail(`${rel} does not carry the tag ${manifest.tag}`);
  bins[arch] = { buf, sha: got, mods: binaryModules(buf) };
}
const keyOf = (m) => [...m].map(([p, v]) => `${p}@${v}`).sort().join('\n');
if (keyOf(bins.x64.mods) !== keyOf(bins.arm64.mods)) fail('the amd64 and arm64 binaries embed different module lists');

// ─── Notices: the stage's per-module file (the licence gate's format), checked against the binary ───
const STAGE_NOTICES = 'dvpnd-THIRD-PARTY-NOTICES.txt';
const noticesBuf = fs.readFileSync(path.join(STAGE, STAGE_NOTICES));
if (sums.get(STAGE_NOTICES) !== sha256(noticesBuf)) fail(`${STAGE_NOTICES}: SHA-256 does not match SHA256SUMS`);
const notices = noticesBuf.toString('utf8');
const diff = moduleDiff(bins.x64.mods, noticeModules(notices));
if (diff.length) fail(`${STAGE_NOTICES} does not match the binary's modules: ${diff.slice(0, 5).join('; ')}`);
const mods = bins.x64.mods;

// ─── Lock ───
const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
const entry = lock.local.find((l) => l.name === 'sentinel-dvpnd');
if (!entry) fail('build/deps.lock.json has no local sentinel-dvpnd entry');
const was = { version: entry.version, x64: entry.builds.x64.sha256, arm64: entry.builds.arm64.sha256 };
const noticesPath = path.join(ROOT, 'build', 'licenses', entry.noticesFile);
const oldMods = fs.existsSync(noticesPath) ? noticeModules(fs.readFileSync(noticesPath, 'utf8')) : new Map();
const changed = moduleDiff(bins.x64.mods, oldMods);
entry.version = manifest.tag;
entry.builds.x64.sha256 = bins.x64.sha;
entry.builds.arm64.sha256 = bins.arm64.sha;
entry.note = `sentinel-dvpnd from fork tag ${manifest.tag} (${manifest.commit.slice(0, 7)}), devnet ldflags (ProgramID ${DEVNET.program_id.slice(0, 8)}…, Mint ${DEVNET.mint.slice(0, 8)}…), ${manifest.toolchain ?? 'toolchain not in MANIFEST'}; repinned by scripts/repin-dvpnd.mjs from the stage MANIFEST. Was ${was.version}.`;

console.log(`stage   ${manifest.tag} ${manifest.commit.slice(0, 12)} (${manifest.network}, ${manifest.toolchain ?? '?'})`);
console.log(`dvpnd   x64 ${was.x64.slice(0, 12)}… -> ${bins.x64.sha.slice(0, 12)}…   arm64 ${was.arm64.slice(0, 12)}… -> ${bins.arm64.sha.slice(0, 12)}…`);
console.log(`notices ${STAGE_NOTICES} ${sha256(noticesBuf).slice(0, 12)}… covers the ${mods.size} modules; vs the current file: ${changed.length ? changed.join('; ') : 'same module list'}`);
if (dryRun) {
  console.log('dry run: nothing written');
  process.exit(0);
}
fs.mkdirSync(BINS, { recursive: true });
for (const [arch, dir] of Object.entries(ARCHES)) {
  const build = entry.builds[arch];
  fs.writeFileSync(path.join(BINS, build.file), bins[arch].buf, { mode: 0o755 });
  console.log(`copied  ${dir}/sentinel-dvpnd -> ${path.join(BINS, build.file)}`);
}
fs.writeFileSync(noticesPath, notices.endsWith('\n') ? notices : `${notices}\n`);
fs.writeFileSync(LOCK_FILE, `${JSON.stringify(lock, null, 2)}\n`);
console.log(`wrote   ${path.relative(ROOT, LOCK_FILE)}, ${path.relative(ROOT, noticesPath)}`);
console.log('next    node scripts/fetch-deps.mjs (checks SHA-256, ELF, devnet id and the module match), then the package build');
