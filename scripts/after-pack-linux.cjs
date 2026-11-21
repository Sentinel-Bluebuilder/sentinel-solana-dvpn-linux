// ─── electron-builder afterPack (Linux): drop build leftovers that are not this arch's code ───
// The rc.8 Linux packages shipped, in resources/app.asar.unpacked/node_modules:
//   - node_gyp_bins/python3 x3: node-gyp's link to the BUILD machine's python3, copied in as a 7.6 MB ELF each;
//   - prebuilds/{win32-ia32,win32-x64,darwin-x64,darwin-arm64}: Windows DLLs and macOS bundles nobody here loads.
// (port of the macOS app bea4ebaec, review; found by the the agent kit verify-release check on macOS rc.8.) node-gyp-build loads
// build/Release first, then prebuilds/linux-<arch>: both stay. afterPack runs before the deb / rpm / AppImage are made.
const fs = require('node:fs');
const path = require('node:path');

// electron-builder's Arch enum (builder-util): the Linux arches we package
const ARCH_NAME = { 1: 'x64', 3: 'arm64' };

/** Remove node_gyp_bins/ and every prebuilds/<os-arch>/ that is not linux-<arch>. Returns the removed paths. */
function pruneForeign(unpackedNodeModules, arch) {
  const keep = `linux-${arch}`;
  const removed = [];
  if (!fs.existsSync(unpackedNodeModules)) return removed;
  const visit = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = path.join(dir, e.name);
      if (e.name === 'node_gyp_bins') { fs.rmSync(p, { recursive: true, force: true }); removed.push(p); continue; }
      if (e.name === 'prebuilds') {
        for (const pb of fs.readdirSync(p, { withFileTypes: true })) {
          if (pb.isDirectory() && pb.name !== keep) {
            const q = path.join(p, pb.name);
            fs.rmSync(q, { recursive: true, force: true });
            removed.push(q);
          }
        }
        continue;
      }
      visit(p);
    }
  };
  visit(unpackedNodeModules);
  return removed;
}

exports.default = async function afterPack(context) {
  const arch = ARCH_NAME[context.arch];
  if (!arch) throw new Error(`unexpected electron-builder arch ${context.arch} (want x64 or arm64)`);
  const pruned = pruneForeign(path.join(context.appOutDir, 'resources', 'app.asar.unpacked', 'node_modules'), arch);
  console.log(`  • pruned ${pruned.length} non-linux-${arch} leftovers (node_gyp_bins, foreign prebuilds)`);
};
exports.pruneForeign = pruneForeign;
