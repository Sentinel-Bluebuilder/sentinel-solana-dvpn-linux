// ─── check-payload-arch: every binary in the unpacked Linux app is an ELF for THIS arch ───
// Usage: node scripts/check-payload-arch.mjs <dist/linux-unpacked> <x64|arm64>     exit 0 clean, 1 a foreign binary.
// Scans the whole app (not only resources/bin): the rc.8 packages shipped Windows PE DLLs, macOS Mach-O bundles and
// three copies of the build box's python3 under app.asar.unpacked (port of the macOS app bea4ebaec's checkArch, review).
// Foreign = a PE (MZ) or Mach-O file, an ELF whose e_machine is not this arch, or any file under node_gyp_bins/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const E_MACHINE = { x64: 0x3e, arm64: 0xb7 };
const MACHO = new Set(['feedfacf', 'cffaedfe', 'feedface', 'cefaedfe', 'cafebabe', 'bebafeca']);

/** What kind of binary the first bytes say: 'elf' (with machine), 'pe', 'macho', or null (not a binary). Pure. */
export function binaryKind(head) {
  if (head.length >= 20 && head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) {
    const le = head[5] === 1;
    return { kind: 'elf', machine: le ? head.readUInt16LE(18) : head.readUInt16BE(18) };
  }
  if (head.length >= 2 && head[0] === 0x4d && head[1] === 0x5a) return { kind: 'pe' };
  if (head.length >= 4 && MACHO.has(head.subarray(0, 4).toString('hex'))) return { kind: 'macho' };
  return null;
}

/** Every foreign binary under root, as { path, why }. */
export function foreignBinaries(root, arch) {
  const want = E_MACHINE[arch];
  if (!want) throw new Error(`unknown arch ${arch} (x64 | arm64)`);
  const bad = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.isFile()) continue;
      const rel = path.relative(root, p);
      if (rel.split(path.sep).includes('node_gyp_bins')) { bad.push({ path: rel, why: 'node_gyp_bins (the build machine\'s tool)' }); continue; }
      const fd = fs.openSync(p, 'r');
      let head;
      try { head = Buffer.alloc(20); head = head.subarray(0, fs.readSync(fd, head, 0, 20, 0)); } finally { fs.closeSync(fd); }
      const k = binaryKind(head);
      if (!k) continue;
      if (k.kind === 'pe') bad.push({ path: rel, why: 'Windows PE' });
      else if (k.kind === 'macho') bad.push({ path: rel, why: 'macOS Mach-O' });
      else if (k.machine !== want) bad.push({ path: rel, why: `ELF e_machine 0x${k.machine.toString(16)}, want 0x${want.toString(16)} (${arch})` });
    }
  };
  walk(root);
  return bad;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [root, arch] = process.argv.slice(2);
  if (!root || !arch) { console.error('usage: node scripts/check-payload-arch.mjs <unpacked app dir> <x64|arm64>'); process.exit(2); }
  const bad = foreignBinaries(root, arch);
  for (const b of bad) console.error(`FOREIGN  ${b.path}: ${b.why}`);
  if (bad.length) { console.error(`check-payload-arch: ${bad.length} foreign binar${bad.length === 1 ? 'y' : 'ies'} in ${root}`); process.exit(1); }
  console.log(`ok   every binary in ${root} is a ${arch} ELF`);
}
