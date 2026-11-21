// ─── The Linux package carries only this arch's binaries (the agent kit: rc.8 shipped 3x python3 + 8 PE/Mach-O add-ons) ───
// afterPack (scripts/after-pack-linux.cjs) prunes node_gyp_bins + foreign prebuilds; release-linux.mjs then runs
// scripts/check-payload-arch.mjs over the whole unpacked app. Port of the macOS app bea4ebaec (review).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { binaryKind, foreignBinaries } from '../../scripts/check-payload-arch.mjs';

const require = createRequire(import.meta.url);
const { pruneForeign } = require('../../scripts/after-pack-linux.cjs') as { pruneForeign: (dir: string, arch: string) => string[] };

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const ELF_X64 = Buffer.from('7f454c4602010100000000000000000003003e00', 'hex');
const ELF_ARM64 = Buffer.from('7f454c460201010000000000000000000300b700', 'hex');
const PE = Buffer.from('4d5a90000300000004000000ffff0000b8000000', 'hex');
const MACHO = Buffer.from('cffaedfe0c000001000000000600000000000000', 'hex');

/** The rc.8 Linux app.asar.unpacked/node_modules shape (verified on the published deb, 2026-11-21). */
function rc8Tree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-'));
  dirs.push(root);
  const files: Record<string, Buffer> = {
    'bigint-buffer/build/node_gyp_bins/python3': ELF_X64,
    'bigint-buffer/build/Release/bigint_buffer.node': ELF_X64,
    'bufferutil/build/node_gyp_bins/python3': ELF_X64,
    'bufferutil/build/Release/bufferutil.node': ELF_X64,
    'bufferutil/prebuilds/linux-x64/bufferutil.node': ELF_X64,
    'bufferutil/prebuilds/win32-x64/bufferutil.node': PE,
    'bufferutil/prebuilds/win32-ia32/bufferutil.node': PE,
    'bufferutil/prebuilds/darwin-x64/bufferutil.node': MACHO,
    'bufferutil/prebuilds/darwin-arm64/bufferutil.node': MACHO,
    'rpc-websockets/node_modules/utf-8-validate/build/node_gyp_bins/python3': ELF_X64,
    'rpc-websockets/node_modules/utf-8-validate/prebuilds/linux-x64/utf-8-validate.node': ELF_X64,
    'rpc-websockets/node_modules/utf-8-validate/prebuilds/win32-x64/utf-8-validate.node': PE,
    'rpc-websockets/node_modules/utf-8-validate/index.js': Buffer.from('module.exports = 1;\n'),
  };
  for (const [f, b] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), b);
  }
  return root;
}
const exists = (root: string, f: string): boolean => fs.existsSync(path.join(root, f));

describe('pruneForeign (Linux afterPack)', () => {
  it('x64: removes node_gyp_bins and every prebuild that is not linux-x64; keeps Release builds, linux-x64, JS', () => {
    const root = rc8Tree();
    const removed = pruneForeign(root, 'x64');
    expect(removed).toHaveLength(8); // 3 node_gyp_bins + 4 bufferutil + 1 utf-8-validate foreign prebuild dirs
    for (const gone of ['bigint-buffer/build/node_gyp_bins', 'bufferutil/build/node_gyp_bins', 'bufferutil/prebuilds/win32-x64', 'bufferutil/prebuilds/darwin-arm64', 'rpc-websockets/node_modules/utf-8-validate/prebuilds/win32-x64']) {
      expect(exists(root, gone)).toBe(false);
    }
    expect(exists(root, 'bufferutil/prebuilds/linux-x64/bufferutil.node')).toBe(true);
    expect(exists(root, 'bigint-buffer/build/Release/bigint_buffer.node')).toBe(true);
    expect(exists(root, 'rpc-websockets/node_modules/utf-8-validate/index.js')).toBe(true);
  });
  it('arm64 (negative control): linux-x64 prebuilds go too', () => {
    const root = rc8Tree();
    pruneForeign(root, 'arm64');
    expect(exists(root, 'bufferutil/prebuilds/linux-x64')).toBe(false);
  });
  it('a missing node_modules dir is not an error', () => {
    expect(pruneForeign(path.join(os.tmpdir(), 'no-such-dir-prune'), 'x64')).toEqual([]);
  });
});

describe('check-payload-arch', () => {
  it('reads ELF machine, PE and Mach-O from the first bytes; text is not a binary', () => {
    expect(binaryKind(ELF_X64)).toEqual({ kind: 'elf', machine: 0x3e });
    expect(binaryKind(ELF_ARM64)).toEqual({ kind: 'elf', machine: 0xb7 });
    expect(binaryKind(PE)).toEqual({ kind: 'pe' });
    expect(binaryKind(MACHO)).toEqual({ kind: 'macho' });
    expect(binaryKind(Buffer.from('#!/bin/sh\n'))).toBeNull();
  });
  it('the rc.8 shape FAILS: 3 node_gyp_bins + 4 PE + 2 Mach-O named', () => {
    const bad = foreignBinaries(rc8Tree(), 'x64');
    expect(bad.filter((b) => /node_gyp_bins/.test(b.why))).toHaveLength(3);
    expect(bad.filter((b) => b.why === 'Windows PE')).toHaveLength(3);
    expect(bad.filter((b) => b.why === 'macOS Mach-O')).toHaveLength(2);
  });
  it('after the prune the same tree is clean (x64)', () => {
    const root = rc8Tree();
    pruneForeign(root, 'x64');
    expect(foreignBinaries(root, 'x64')).toEqual([]);
  });
  it('an x64 ELF in an arm64 package is foreign (negative control)', () => {
    const root = rc8Tree();
    pruneForeign(root, 'arm64');
    expect(foreignBinaries(root, 'arm64').map((b) => b.path)).toContain(path.join('bufferutil', 'build', 'Release', 'bufferutil.node'));
  });
});
