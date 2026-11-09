// ─── go-modules — the Go modules compiled into a binary vs the ones its notices file covers ───
// A Go binary embeds its module list as text (what `go version -m` prints): one "dep\t<path>\t<version>"
// line per module. The dvpnd notices file has one "<path> <version>" header per module, right after a
// line of 80 '='. A release must ship a notices file for exactly the modules of the binary beside it
// (OSS gate rule), so fetch-deps compares the two and refuses a mismatch. Sentinel's own modules are
// covered by the daemon's own license, not the notices file, and are left out on both sides.
const OWN = /^github\.com\/sentinel-official\//;
const RULE = '='.repeat(80);

/** Map path → version of every non-Sentinel module in the binary's embedded build info. */
export function binaryModules(buf) {
  const text = Buffer.isBuffer(buf) ? buf.toString('latin1') : String(buf);
  const mods = new Map();
  for (const m of text.matchAll(/(?:^|[\n\t])dep\t([^\t\n]+)\t([^\t\n]+)/g)) {
    if (!OWN.test(m[1])) mods.set(m[1], m[2]);
  }
  return mods;
}

/** Map path → version of every module header in a notices file. */
export function noticeModules(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const mods = new Map();
  for (let i = 1; i < lines.length; i++) {
    const m = lines[i - 1] === RULE && /^(\S+) (v\S+)$/.exec(lines[i]);
    if (m && !OWN.test(m[1])) mods.set(m[1], m[2]);
  }
  return mods;
}

/** Every difference, as "<path>: binary <v|none>, notices <v|none>"; empty = they match. */
export function moduleDiff(binary, notices) {
  const out = [];
  for (const [p, v] of binary) if (notices.get(p) !== v) out.push(`${p}: binary ${v}, notices ${notices.get(p) ?? 'none'}`);
  for (const [p, v] of notices) if (!binary.has(p)) out.push(`${p}: binary none, notices ${v}`);
  return out.sort();
}
