// ─── build-arch — which CPU architecture a Linux build targets, and ELF checks ───
// Shared by fetch-deps.mjs and release-linux.mjs. A package carries the binaries of ONE arch
// (resources/bin is per arch), so a release builds the target arch only.

export const ARCHES = ['x64', 'arm64'];

/** ELF e_machine values (little-endian u16 at offset 18). */
export const ELF_MACHINE = { x64: 0x3e, arm64: 0xb7 };

/** `--arch <a>` / `--arch=<a>` wins, else the build machine's arch. Throws on anything else. */
export function targetArch(argv, hostArch) {
  let want = hostArch;
  const i = argv.findIndex((a) => a === '--arch' || a.startsWith('--arch='));
  if (i >= 0) want = argv[i].includes('=') ? argv[i].slice('--arch='.length) : argv[i + 1];
  if (!ARCHES.includes(want)) {
    throw new Error(`unsupported arch '${want ?? ''}': Linux builds are ${ARCHES.join(' | ')} (32-bit ARM / x86 are not supported)`);
  }
  return want;
}

/** Arch of a 64-bit little-endian ELF image, or null when it is not one we know. */
export function elfArch(buf) {
  if (buf.length < 20 || buf[0] !== 0x7f || buf[1] !== 0x45 || buf[2] !== 0x4c || buf[3] !== 0x46) return null;
  if (buf[4] !== 2 || buf[5] !== 1) return null;
  const machine = buf[18] | (buf[19] << 8);
  return ARCHES.find((a) => ELF_MACHINE[a] === machine) ?? null;
}

/** The lock entry's build for this arch, or a clear error naming what is missing. */
export function pickBuild(entry, arch) {
  const b = entry.builds?.[arch];
  if (!b || !b.sha256) throw new Error(`${entry.name}: build/deps.lock.json has no ${arch} build`);
  return b;
}
