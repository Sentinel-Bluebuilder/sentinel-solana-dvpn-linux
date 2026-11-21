// ─── K-M4-5 release check: out/main carries no UI test hooks ───
// Run after `electron-vite build` with DVPN_DEV_HOOKS unset (every release build), before electron-builder.
// Exit 0 = clean; exit 1 = a ui-smoke / ui-scenario marker is in the bundle (the release would ship the hooks);
// exit 2 = nothing to check (out/main missing, or no .js/.cjs/.mjs file in it: S8, a gate that passed on nothing).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] ?? 'out/main');
const MARKERS = [/runScenario/, /DVPN_UI_SCENARIO/, /DVPN_UI_AUDIT_DIR/, /CalculateNativeWinOcclusion/, /ui-smoke/, /ui-scenario/, /const DEV_HOOKS_BUILD = "(1|packaged)"/];

if (!fs.existsSync(ROOT)) {
  console.error(`check-dev-hooks-payload: ${ROOT} does not exist; build first`);
  process.exit(2);
}
const hits = [];
let scanned = 0;
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (/ui-(smoke|scenario)/.test(e.name)) hits.push(`${p}: file name`);
    if (!/\.(c|m)?js$/.test(e.name)) continue;
    scanned += 1;
    const s = fs.readFileSync(p, 'utf8');
    for (const m of MARKERS) if (m.test(s)) hits.push(`${p}: ${m.source}`);
  }
};
walk(ROOT);
if (scanned === 0) {
  console.error(`check-dev-hooks-payload: no .js/.cjs/.mjs file in ${ROOT}; build first (nothing was checked)`);
  process.exit(2);
}
if (hits.length) {
  console.error(`check-dev-hooks-payload: ${scanned} files scanned; the bundle carries the UI test hooks (built with DVPN_DEV_HOOKS?):\n  ${hits.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-dev-hooks-payload: ${scanned} files scanned in ${ROOT}; no UI test hooks`);
