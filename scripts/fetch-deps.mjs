// ─── fetch-deps — every third-party program the Linux packages ship, pinned, per arch ───
// Reads build/deps.lock.json and takes the build for the target arch (--arch x64|arm64, default =
// this machine's). For each dependency: download into build/.deps-cache (or reuse a cached
// copy), refuse on any SHA-256 mismatch, then:
//   exe → its `dest`, made executable     (protocol binaries the service finds on its PATH)
//   zip → only the listed `files` into `dest` (`exec` ones made executable)
// Every executable must be an ELF for the target arch (a wrong-arch binary only fails at connect).
// Local binaries (dvpnd) are copied from DVPND_SRC (default: work/devnet-dvpn-dvpnd-devnet/build/
// <file of that arch>, see build/deps.lock.json) and must match their pinned SHA-256.
// Also writes THIRD-PARTY-NOTICES.txt and the package license text.
// Usage: node scripts/fetch-deps.mjs [--arch x64|arm64] [--offline]   (offline = cache only)
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { elfArch, pickBuild, targetArch } from './build-arch.mjs';
import { binaryModules, moduleDiff, noticeModules } from './go-modules.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const LOCK = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'deps.lock.json'), 'utf8'));
const CACHE = path.join(ROOT, 'build', '.deps-cache');
const offline = process.argv.includes('--offline');
const ARCH = targetArch(process.argv.slice(2), process.arch);
const DVPND_DIR = path.join(os.homedir(), 'Desktop', 'devnet-dvpn-dvpnd-devnet', 'build');

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
/** Copy unless the destination already has the same bytes (a running tunnel locks its exe). */
function copyIfChanged(src, dst) {
  if (fs.existsSync(dst) && sha256(dst) === sha256(src)) return;
  fs.copyFileSync(src, dst);
}
/** Refuse an executable built for another CPU. */
function checkElf(name, file) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(20);
  try { fs.readSync(fd, head, 0, 20, 0); } finally { fs.closeSync(fd); }
  const got = elfArch(head);
  if (got !== ARCH) throw new Error(`${name}: ${path.basename(file)} is ${got ?? 'not a 64-bit ELF'}, the target arch is ${ARCH}`);
}

async function download(url, to) {
  if (offline) throw new Error(`offline and not cached: ${url}`);
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'devnet-dvpn-build' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  fs.writeFileSync(`${to}.part`, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(`${to}.part`, to);
}

async function cached(dep, build) {
  const file = path.join(CACHE, path.basename(new URL(build.url).pathname));
  if (!fs.existsSync(file) || sha256(file) !== build.sha256) await download(build.url, file);
  const got = sha256(file);
  if (got !== build.sha256) {
    fs.rmSync(file, { force: true });
    throw new Error(`${dep.name} (${ARCH}): SHA-256 mismatch (want ${build.sha256}, got ${got})`);
  }
  return file;
}

function extractZip(name, zip, dest, files, exec = []) {
  const tmp = fs.mkdtempSync(path.join(CACHE, 'unzip-'));
  try {
    // bsdtar reads zip (Linux: libarchive-tools; Windows 10+: System32\tar.exe).
    const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : (fs.existsSync('/usr/bin/bsdtar') ? 'bsdtar' : 'unzip');
    if (tar === 'unzip') execFileSync('unzip', ['-q', '-o', zip, '-d', tmp], { stdio: 'inherit' });
    else execFileSync(tar, ['-xf', zip, '-C', tmp], { stdio: 'inherit' });
    fs.mkdirSync(dest, { recursive: true });
    for (const f of files) {
      const src = path.join(tmp, f);
      if (!fs.existsSync(src)) throw new Error(`${path.basename(zip)} has no ${f}`);
      if (exec.includes(f)) checkElf(name, src);
      copyIfChanged(src, path.join(dest, f));
      fs.chmodSync(path.join(dest, f), exec.includes(f) ? 0o755 : 0o644);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

fs.mkdirSync(CACHE, { recursive: true });
console.log(`arch ${ARCH}`);
for (const dep of LOCK.deps) {
  const build = pickBuild(dep, ARCH);
  const file = await cached(dep, build);
  if (dep.kind === 'exe') {
    checkElf(dep.name, file);
    const out = path.join(ROOT, dep.dest);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    copyIfChanged(file, out);
    fs.chmodSync(out, 0o755);
  } else if (dep.kind === 'zip') {
    extractZip(dep.name, file, path.join(ROOT, dep.dest), dep.files, dep.exec ?? []);
  } else {
    throw new Error(`${dep.name}: unknown kind ${dep.kind}`);
  }
  console.log(`ok   ${dep.name} ${dep.version} (${ARCH})`);
}

for (const l of LOCK.local) {
  const build = pickBuild(l, ARCH);
  const out = path.join(ROOT, l.path);
  const src = process.env.DVPND_SRC || path.join(DVPND_DIR, build.file);
  if (l.name === 'sentinel-dvpnd' && fs.existsSync(src) && (!fs.existsSync(out) || sha256(out) !== build.sha256)) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(src, out);
  }
  if (!fs.existsSync(out)) throw new Error(`missing local binary ${l.path} for ${ARCH} (${build.file}; ${l.note})`);
  const got = sha256(out);
  if (got !== build.sha256) throw new Error(`${l.name} (${ARCH}): SHA-256 mismatch (want ${build.sha256}, got ${got})`);
  checkElf(l.name, out);
  // A dvpnd built from a Windows (CRLF) checkout embeds CRLF OpenVPN/WireGuard templates.
  if (l.name === 'sentinel-dvpnd' && fs.readFileSync(out).includes(Buffer.from('persist-tun\r\n'))) {
    throw new Error('dvpnd embeds CRLF config templates: rebuild it from an LF checkout (git clone -c core.autocrlf=false)');
  }
  // The devnet identity is link-time (-X github.com/sentinel-official/sentinel-go-sdk/v3/version.ProgramID=…);
  // without it the service exits "build identity is not set" on every start (ddv16 first build, 2026-10-22).
  if (l.name === 'sentinel-dvpnd' && !fs.readFileSync(out).includes(Buffer.from('J52dyXW3a6mkatvrQct3fo6dA9vqUtcsdBt5gGqrTBXs'))) {
    throw new Error('dvpnd has no devnet program id: rebuild with -X github.com/sentinel-official/sentinel-go-sdk/v3/version.{ProgramID,Mint,Network,Tag,Commit}');
  }
  fs.chmodSync(out, 0o755);
  console.log(`ok   ${l.name} (local, ${ARCH}, ${got.slice(0, 12)}…)`);
}

// The Sentinel daemon is built from source (LOCK.local), the rest are libraries inside the app bundle
// (LOCK.bundled: fonts, LGPL code). Each names its license; a bundled entry's own license file from
// node_modules is appended in full (OFL-1.1 needs its text, LGPL-3.0 its notice).
// An entry that is not an npm package (a Go library compiled into sentinel-dvpnd) carries its own
// version and a license file kept in the repo (licenseFile), and says where it ships (where).
const bundledText = (b) => {
  if (b.licenseFile) return fs.readFileSync(path.join(ROOT, b.licenseFile), 'utf8').replace(/\r\n/g, '\n').trimEnd();
  const dir = path.join(ROOT, 'node_modules', b.package);
  const file = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
  if (!file) throw new Error(`no license file for bundled ${b.package} in node_modules (run npm ci first)`);
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trimEnd();
};
for (const l of LOCK.local) {
  const f = l.noticesFile && path.join(ROOT, 'build', 'licenses', l.noticesFile);
  if (!f) continue;
  if (!(fs.existsSync(f) && fs.statSync(f).size > 0)) throw new Error(`${l.name}: notices file ${f} missing or empty (it ships next to THIRD-PARTY-NOTICES.txt)`);
  // The notices file must cover exactly the modules compiled into the binary it ships beside.
  const inBinary = binaryModules(fs.readFileSync(path.join(ROOT, l.path)));
  const diff = moduleDiff(inBinary, noticeModules(fs.readFileSync(f, 'utf8')));
  if (diff.length > 0) {
    throw new Error(`${l.name}: ${l.noticesFile} does not match the bundled binary's modules (regenerate it from this binary, go version -m):\n  ${diff.slice(0, 10).join('\n  ')}${diff.length > 10 ? `\n  … ${diff.length - 10} more` : ''}`);
  }
  console.log(`ok   ${l.noticesFile} covers the ${inBinary.size} modules compiled into ${l.name}`);
}
const bundledVersion = (b) => b.version ?? JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', b.package, 'package.json'), 'utf8')).version;
const notices = [
  'Devnet dVPN bundles the following third-party software, unmodified.',
  'Each is distributed under its own license; source code is available at the links below.',
  '',
  ...LOCK.deps.flatMap((d) => [
    `${d.title} ${d.version} (linux ${ARCH})`,
    `  License: ${d.license} (${d.licenseUrl})`,
    `  Source:  ${d.sourceUrl}`,
    `  SHA-256: ${pickBuild(d, ARCH).sha256}`,
    '',
  ]),
  ...LOCK.local.flatMap((l) => [
    `${l.title} (${l.version}, linux ${ARCH})`,
    `  License: ${l.license} (${l.licenseUrl})`,
    `  Source:  ${l.sourceUrl}`,
    `  SHA-256: ${pickBuild(l, ARCH).sha256}`,
    ...(l.noticesFile ? [`  Third-party code compiled into it, each with its license: ${l.noticesFile} (next to this file)`] : []),
    '',
  ]),
  ...LOCK.bundled.flatMap((b) => [
    `${b.title} ${bundledVersion(b)} (${b.package}, ${b.where ?? 'inside the app'})`,
    `  License: ${b.license}`,
    `  Source:  ${b.sourceUrl}`,
    '',
    ...bundledText(b).split('\n').map((line) => (line ? `    ${line}` : '')),
    '',
  ]),
];
fs.writeFileSync(path.join(ROOT, 'build', 'THIRD-PARTY-NOTICES.txt'), notices.join('\n'));
console.log('ok   build/THIRD-PARTY-NOTICES.txt');
const own = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8').replace(/\r\n/g, '\n');
fs.writeFileSync(path.join(ROOT, 'build', 'license.txt'), ['Devnet dVPN', '', own, '', '-'.repeat(72), '', ...notices].join('\n'));
console.log('ok   build/license.txt');
