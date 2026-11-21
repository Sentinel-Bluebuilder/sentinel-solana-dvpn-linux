// ─── platform-cells — every cell a platform must prove, built from the sources of truth ───
// A new CLI command, UI control, setting, matrix row or safety test appears here on its own,
// so nothing can be left out of a platform proof (owner 2026-10-22: "dont leave out anything").
// Phases without a machine-readable source (installer, health, visual, edge) are listed below,
// copied from docs/RELEASE-TEST-PLAN.md; change them there and here together.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const PROTOCOLS = ['wireguard', 'amneziawg', 'openvpn', 'hysteria2', 'v2ray', 'xray'];
const MATRIX_COLS = PROTOCOLS; // column order of docs/PROTOCOL-MATRIX.md section A

export const PLATFORMS = [
  { id: 'win11-x64', title: 'Windows 11 x64 (VM)' },
  { id: 'win11-arm64', title: 'Windows 11 ARM64 (VM, emulated)' },
  { id: 'laptop-win11-home', title: 'Laptop, Windows 11 Home' },
];

const PHASE2 = ['typecheck', 'unit-tests', 'cli-map', 'cli-e2e-local', 'settings-e2e', 'ui-smoke-dark', 'ui-smoke-light', 'mojibake-grep'];
const INSTALL = [
  ['I1', 'Silent install on a clean machine'],
  ['I2', 'Interactive install, one UAC, first run'],
  ['I3', 'Offline install'],
  ['I4', 'Install on a dirty machine touches nothing of the user'],
  ['I5', 'Repair + upgrade keep settings, wallet, device key'],
  ['I6', 'Driver removed -> daemon drivers -> repair-drivers'],
  ['I7', 'Uninstall: clean, with live session, with persist armed'],
  ['I8', 'Reinstall after uninstall picks up the device key'],
  ['I9', 'Path with spaces, non-admin user'],
  ['W1', 'Windows 11: SmartScreen verdict recorded'],
  ['W2', 'Windows 11: Smart App Control blocks none of our programs'],
  ['W3', 'Windows 11: Defender detects nothing in the bundle'],
  ['W4', 'Windows 11: HVCI on, every driver loaded'],
  ['W5', 'Windows 11: exactly one UAC'],
  ['W6', 'Wrong-CPU installer refused (exit 3)'],
];
const REAL_APPS = ['edge-proxy-on', 'browser-through-vpn', 'browser-proxy-off', 'firefox-socks', 'powershell-iwr', 'curl', 'dotnet-winhttp-ping', 'proxy-and-direct-at-once'];
const PROXY_RESTORE = ['disconnect', 'app-crash', 'dvpnd-death', 'switch', 'uninstall'];
const HEALTH = ['log-scan', 'crash-events', 'soak-2h', 'fault-rpc-bad', 'fault-node-offline', 'fault-daemon-killed', 'fault-wallet-empty', 'fault-device-no-sol', 'fault-allowance-exhausted'];
const SIZES = ['1024x700', '1280x800', '1920x1080'];
const EDGE_PER_PROTOCOL = [
  'nic-flap', 'ip-change', 'second-nic', 'route-flap', 'suspend-resume', 'reboot-off', 'reboot-persist', 'shutdown-during-settle',
  'loss-1', 'loss-5', 'loss-20', 'lag-300-jitter', 'reorder', 'duplicate', 'throttle-1mbps', 'udp-blocked', 'tcp443-only', 'mtu-1280', 'mtu-1460',
  'ipv6-leak', 'dns-aaaa-split', 'ipv6-dns-preset',
  'node-stopped', 'node-restarted', 'node-slow', 'node-max-peers', 'node-listing-expired', 'node-price-changed', 'node-clock-skew',
  'rpc-down', 'rpc-429', 'rpc-garbage', 'tx-dropped', 'settle-grace-boundary', 'device-no-sol-at-settle', 'allowance-exact', 'allowance-short',
  'escrow-exhausted', 'hour-expiry', 'billing-1gb',
  'cancel-each-step', 'disconnect-while-connecting', 'switch-while-coming-up', 'service-restart-mid', 'installer-repair-mid',
];
const EDGE_ONCE = ['app-and-cli-at-once', 'rapid-connect-20', 'double-settle', 'non-ascii-user', 'long-path', 'low-disk', 'clock-change', 'defender-firewall-toggle', 'own-vpn-running', 'pac-proxy', 'allow-lan-true', 'allow-lan-false', 'cli-fuzz'];

// The laptop is the owner's machine: tiers 1-2 only (CLAUDE.md), kill switch never on (tier 3 paused).
const LAPTOP_GATED = /^(matrix:A1[1-4]|matrix:A17|matrix:A22|safety:(killswitch|kssplit|killdaemon|persist|armed)|edge:reboot-persist)/;
const LAPTOP_SCOPE = /^(phase2:|cli:|setting:|ui:|matrix:|safety:(protocols|dns|split|splitroutes|splitcli|splitapps|doctor|wholedevice)|install:(I5|W1|W2|W3|W5)|health:(log-scan|crash-events)|visual:)/;

const read = (root, f) => fs.readFileSync(path.join(root, f), 'utf8');

function cliCells(root) {
  const src = read(root, 'src/cli/catalogue.ts');
  const body = src.slice(src.indexOf('export const CATALOGUE'));
  return [...body.matchAll(/\{\s*cmd:\s*'([^']+)'/g)].map((m) => ({ id: `cli:${m[1]}`, section: 'B. Every CLI command', title: m[1] }));
}

function uiCells(root) {
  const out = execFileSync(process.execPath, [path.join(root, 'scripts', 'ui-controls-inventory.mjs')], { cwd: root, encoding: 'utf8', maxBuffer: 32 << 20 });
  const list = JSON.parse(out.slice(out.indexOf('[')));
  const seen = new Map();
  return list.map((c) => {
    const key = `${c.file}|${c.label || c.tag}|${c.event}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    const id = `ui:${key}${n > 1 ? `#${n}` : ''}`;
    return { id, section: 'B2. Every app control', title: `${c.file}: ${c.label || c.tag} (${c.event})` };
  });
}

function settingCells(root) {
  const src = read(root, 'docs/SETTINGS-MAP.md');
  const stop = src.indexOf('## 4.');
  const body = stop > 0 ? src.slice(0, stop) : src;
  const keys = [...body.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
  return [...new Set(keys)].map((k) => ({ id: `setting:${k}`, section: 'C. Every setting', title: k }));
}

function matrixCells(root) {
  const src = read(root, 'docs/PROTOCOL-MATRIX.md');
  const a = src.slice(src.indexOf('## A.'), src.indexOf('## B.'));
  const cells = [];
  for (const m of a.matchAll(/^\| (A\d+) \| ([^|]+) \|(.+)$/gm)) {
    const cols = m[3].split('|').map((s) => s.trim());
    MATRIX_COLS.forEach((p, i) => {
      const src0 = cols[i] ?? '';
      cells.push({ id: `matrix:${m[1]}:${p}`, section: 'A. Every function x protocol', title: `${m[1]} ${m[2].trim()} - ${p}`, na: /^n\/a/i.test(src0) });
    });
  }
  return cells;
}

function safetyCells(root) {
  const src = read(root, 'scripts/e2e/vm-safety-test.ps1');
  return [...src.matchAll(/^#\s+-Test (\w+)\s*:/gm)].map((m) => ({ id: `safety:${m[1]}`, section: 'S. Safety tests (vm-safety-test.ps1)', title: m[1] }));
}

/** Every required cell, in report order. `na` = cannot apply by design (from the matrix source). */
export function buildCells(root) {
  const list = [
    ...PHASE2.map((x) => ({ id: `phase2:${x}`, section: '0. Build gate inside the machine', title: x })),
    ...INSTALL.map(([id, t]) => ({ id: `install:${id}`, section: 'D. Install + Windows 11', title: `${id} ${t}` })),
    ...cliCells(root),
    ...uiCells(root),
    ...settingCells(root),
    ...matrixCells(root),
    ...safetyCells(root),
    ...['v2ray', 'xray'].flatMap((p) => REAL_APPS.map((r) => ({ id: `split5b:${r}:${p}`, section: '5b. Split with real apps', title: `${r} - ${p}` }))),
    ...PROXY_RESTORE.map((x) => ({ id: `split5b:proxy-restore-${x}`, section: '5b. Split with real apps', title: `proxy restored on ${x}` })),
    { id: 'split5b:socks-port-collision', section: '5b. Split with real apps', title: 'SOCKS port already taken' },
    { id: 'split5b:howto-followed-literally', section: '5b. Split with real apps', title: 'in-app how-to followed step by step' },
    ...HEALTH.map((x) => ({ id: `health:${x}`, section: '6. No crashes, no errors', title: x })),
    ...SIZES.flatMap((s) => ['dark', 'light'].flatMap((t) => ['100', '150'].map((d) => ({ id: `visual:${s}:${t}:${d}`, section: '7. Visual', title: `${s} ${t} ${d}%` })))),
    { id: 'visual:all-states', section: '7. Visual', title: 'every state (onboarding, empty, connecting, connected x6, errors, modals)' },
    ...EDGE_PER_PROTOCOL.flatMap((e) => PROTOCOLS.map((p) => ({ id: `edge:${e}:${p}`, section: '9. Edge cases', title: `${e} - ${p}` }))),
    ...EDGE_ONCE.map((e) => ({ id: `edge:${e}`, section: '9. Edge cases', title: e })),
  ];
  const ids = new Set();
  for (const c of list) {
    if (ids.has(c.id)) throw new Error(`duplicate cell id ${c.id}`);
    ids.add(c.id);
  }
  return list;
}

/** What a platform must show for a cell: 'pass', 'n/a' (by design), 'gated' (owner rule) or 'vm-only'. */
export function requirement(cell, platform) {
  if (cell.na) return 'n/a';
  if (platform === 'laptop-win11-home') {
    if (LAPTOP_GATED.test(cell.id)) return 'gated';
    if (!LAPTOP_SCOPE.test(cell.id)) return 'vm-only';
  }
  return 'pass';
}

/** BUILD file: first non-empty line = current build; `carry <build> <reason>` lines. Used by platform-coverage.mjs. */
export function parseBuildFile(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const build = lines[0] && !/^(carry|cover) /.test(lines[0]) ? lines[0] : '';
  const carry = lines.filter((l) => l.startsWith('carry ')).map((l) => {
    const [, b, ...rest] = l.split(/\s+/);
    // optional `except=<cell prefix>,<cell prefix>`: those cells do not carry (the diff touches them)
    const except = rest[0]?.startsWith('except=') ? rest.shift().slice(7).split(',').filter(Boolean) : [];
    if (!b || !rest.length) throw new Error(`BUILD: carry ${b ?? ''} needs a reason`);
    return { build: b, except, reason: rest.join(' ') };
  });
  // `cover <platform> <cell prefix>,<cell prefix> <reason>`: these cells are the same code on both
  // CPUs, so a PASS on <platform>'s CURRENT build stands in for them here (shown "via <platform>").
  const cover = lines.filter((l) => l.startsWith('cover ')).map((l) => {
    const [, platform, list, ...rest] = l.split(/\s+/);
    const prefixes = (list ?? '').split(',').filter(Boolean);
    if (!platform || !prefixes.length || !rest.length) throw new Error(`BUILD: cover ${platform ?? ''} needs cell prefixes and a reason`);
    return { platform, prefixes, reason: rest.join(' ') };
  });
  return { build, carry, cover };
}

/** Does a cover line apply to this cell? Prefix match on whole id segments, as for carry except=. */
export function coverFor(parsed, cell) {
  return (parsed.cover ?? []).find((c) => c.prefixes.some((p) => cell === p || cell.startsWith(`${p}:`) || cell.startsWith(`${p} `)));
}

/** Does an entry proven on `build` count for `cell` under this parsed BUILD file? */
export function buildCounts(parsed, build, cell) {
  if (!parsed.build) return false;
  if (build === parsed.build) return true;
  const c = parsed.carry.find((x) => x.build === build);
  return Boolean(c) && !c.except.some((p) => cell === p || cell.startsWith(`${p}:`) || cell.startsWith(`${p} `));
}
