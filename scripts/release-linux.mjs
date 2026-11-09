// ─── release:linux — build the .deb + .rpm + AppImage from a clean, verified state ───
// 1. fetch + verify every bundled binary for the target arch (build/deps.lock.json)
// 2. typecheck + unit tests   3. app + CLI bundles   4. electron-builder --linux --<arch>
// 5. dist/SHA256SUMS.txt
// One arch per run (resources/bin holds one arch). Build arm64 natively on an arm64 machine.
// Usage: node scripts/release-linux.mjs [--arch x64|arm64] [--targets deb,rpm,AppImage,pacman] [--skip-tests] [--offline]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { addSandboxHint } from './appimage-apprun.mjs';
import { swapRuntime } from './appimage-runtime.mjs';
import { targetArch } from './build-arch.mjs';

const args = process.argv.slice(2);
const ARCH = targetArch(args, process.arch);
const run = (cmd, a) => { console.log(`\n> ${cmd} ${a.join(' ')}`); execFileSync(cmd, a, { stdio: 'inherit' }); };
const npx = (a) => run('npx', a);

run('node', ['scripts/check-release-version.mjs', ...(args.includes('--allow-same-version') ? ['--allow-same-version'] : [])]); // L3
run('node', ['scripts/fetch-deps.mjs', '--arch', ARCH, ...(args.includes('--offline') ? ['--offline'] : [])]);
for (const f of fs.readdirSync('resources/scripts')) fs.chmodSync(path.join('resources/scripts', f), 0o755);
if (!args.includes('--skip-tests')) { run('npm', ['run', 'typecheck']); run('npm', ['test']); }
npx(['electron-vite', 'build']);
run('node', ['scripts/build-cli.mjs']);
fs.chmodSync('build/cli/devnet-dvpn', 0o755);
// --targets deb,rpm,AppImage,pacman: only those (default = the list in electron-builder.yml)
const ti = args.findIndex((a) => a === '--targets' || a.startsWith('--targets='));
const targets = ti < 0 ? [] : (args[ti].includes('=') ? args[ti].slice('--targets='.length) : args[ti + 1] ?? '').split(',').filter(Boolean);
for (const t of targets) if (!['deb', 'rpm', 'AppImage', 'pacman'].includes(t)) throw new Error(`unknown target '${t}' (deb | rpm | AppImage | pacman)`);
npx(['electron-builder', '--linux', ...targets, `--${ARCH}`, '--publish', 'never']);

// Build checklist: no inline RPC api-key anywhere in the payload, binaries included (scripts/payload-secret-scan.mjs)
run('node', ['scripts/payload-secret-scan.mjs', path.join('dist', ARCH === 'x64' ? 'linux-unpacked' : `linux-${ARCH}-unpacked`), 'build/linux']);

// Every AppImage: swap in the static runtime (arm64's bundled one needs libz.so; x64's dlopens libfuse.so.2, absent on stock Ubuntu 24.04, Q0382; scripts/appimage-runtime.mjs)
const RT = JSON.parse(fs.readFileSync('build/deps.lock.json', 'utf8')).appimageRuntime?.[ARCH];
if (RT) {
  for (const f of fs.readdirSync('dist').filter((n) => n.endsWith('.AppImage'))) {
    const n = await swapRuntime(path.join('dist', f), RT, path.join('build', '.deps-cache'));
    console.log(`ok   ${f}: static AppImage runtime ${RT.version} (${n} bytes)`);
  }
}

// Every AppImage: AppRun explains --no-sandbox where Ubuntu 24.04+ blocks the sandbox (build/linux/apprun-sandbox-hint_lib.sh)
for (const f of fs.readdirSync('dist').filter((n) => n.endsWith('.AppImage'))) {
  addSandboxHint(path.join('dist', f), 'build/linux/apprun-sandbox-hint_lib.sh');
  console.log(`ok   ${f}: AppRun sandbox hint`);
}

const pkgs = fs.readdirSync('dist').filter((f) => /\.(deb|rpm|AppImage|pkg\.tar\.zst)$/.test(f));
const sums = pkgs.map((f) => `${createHash('sha256').update(fs.readFileSync(path.join('dist', f))).digest('hex')}  ${f}`);
fs.writeFileSync('dist/SHA256SUMS.txt', sums.join('\n') + '\n');
console.log(`\n${sums.join('\n')}`);
