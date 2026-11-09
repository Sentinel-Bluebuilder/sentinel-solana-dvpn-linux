// ─── build-arch — per-arch deps lock, target arch pick, ELF machine check ───
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ARCHES, ELF_MACHINE, elfArch, pickBuild, targetArch } from '../../scripts/build-arch.mjs';

const elf = (machine: number, cls = 2, data = 1): Buffer => {
  const b = Buffer.alloc(64);
  b.set([0x7f, 0x45, 0x4c, 0x46, cls, data]);
  b.writeUInt16LE(machine, 18);
  return b;
};

describe('targetArch', () => {
  it('defaults to the build machine', () => {
    expect(targetArch([], 'x64')).toBe('x64');
    expect(targetArch(['--skip-tests'], 'arm64')).toBe('arm64');
  });
  it('--arch wins in both spellings', () => {
    expect(targetArch(['--arch', 'arm64'], 'x64')).toBe('arm64');
    expect(targetArch(['--offline', '--arch=x64'], 'arm64')).toBe('x64');
  });
  it('refuses 32-bit and unknown arches with a clear message', () => {
    expect(() => targetArch([], 'arm')).toThrow(/unsupported arch 'arm'.*32-bit/);
    expect(() => targetArch(['--arch', 'armv7l'], 'x64')).toThrow(/unsupported arch 'armv7l'/);
    expect(() => targetArch(['--arch', 'ia32'], 'x64')).toThrow(/x64 \| arm64/);
    expect(() => targetArch(['--arch'], 'x64')).toThrow(/unsupported arch ''/);
  });
});

describe('elfArch', () => {
  it('reads x86-64 and AArch64', () => {
    expect(elfArch(elf(0x3e))).toBe('x64');
    expect(elfArch(elf(0xb7))).toBe('arm64');
  });
  it('rejects 32-bit, big-endian, other machines and non-ELF', () => {
    expect(elfArch(elf(0x28, 1))).toBeNull(); // 32-bit ARM
    expect(elfArch(elf(0xb7, 2, 2))).toBeNull();
    expect(elfArch(elf(0xf3))).toBeNull(); // RISC-V
    expect(elfArch(Buffer.from('#!/bin/sh\necho hi\n'))).toBeNull();
    expect(elfArch(Buffer.alloc(4))).toBeNull();
  });
});

describe('build/deps.lock.json', () => {
  const lock = JSON.parse(fs.readFileSync('build/deps.lock.json', 'utf8'));
  it('pins every dependency and dvpnd for every arch', () => {
    expect(lock.arches).toEqual(ARCHES);
    for (const e of [...lock.deps, ...lock.local]) {
      for (const a of ARCHES) {
        const b = pickBuild(e, a);
        expect(b.sha256, `${e.name} ${a}`).toMatch(/^[0-9a-f]{64}$/);
      }
      const shas = ARCHES.map((a) => pickBuild(e, a).sha256);
      expect(new Set(shas).size, `${e.name}: arches share a hash`).toBe(ARCHES.length);
    }
  });
  it('urls name the arch they are pinned for', () => {
    for (const d of lock.deps) {
      expect(pickBuild(d, 'x64').url).toMatch(/linux-(amd64|64)(\.zip)?$/);
      expect(pickBuild(d, 'arm64').url).toMatch(/linux-arm64(-v8a)?(\.zip)?$/);
      for (const a of ARCHES) expect(pickBuild(d, a).url).toContain(d.version);
    }
  });
  it('a missing arch is a clear error', () => {
    expect(() => pickBuild({ name: 'x', builds: { x64: { sha256: 'a' } } }, 'arm64')).toThrow(/has no arm64 build/);
  });
  it('ELF machine table matches the ELF spec', () => {
    expect(ELF_MACHINE).toEqual({ x64: 62, arm64: 183 });
  });
});

describe('electron-builder.yml', () => {
  const y = fs.readFileSync('electron-builder.yml', 'utf8');
  it('has no target arch list (it would override --arm64 and mix arches)', () => {
    expect(y).not.toMatch(/^\s+arch:/m);
  });
  it('every artifact name carries ${arch}', () => {
    const names = [...y.matchAll(/artifactName: (.+)/g)].map((m) => m[1]);
    expect(names.length).toBe(4);
    for (const n of names) expect(n).toContain('${arch}');
  });
  it('pacman runs the install script on upgrade too (fpm defines no post_upgrade otherwise)', () => {
    const pac = y.slice(y.indexOf('\npacman:'), y.indexOf('\nappImage:'));
    expect(pac).toContain('afterInstall: build/linux/after-install.sh');
    expect(pac).toContain('--after-upgrade=build/linux/after-install.sh');
    expect(pac).toContain('--before-remove=build/linux/before-remove.sh');
  });
});

// The remove scriptlets' first line decides "real removal" vs "upgrade" from the package
// manager's argument. Evaluate exactly that case line (never the rm commands) with bash.
describe.skipIf(process.platform === 'win32')('remove scriptlets: dpkg words, rpm counts, pacman versions', () => {
  const decide = (file: string, arg: string): 'cleanup' | 'skip' => {
    const line = fs.readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith('case "${1:-remove}"'));
    if (!line) throw new Error(`${file}: no case line`);
    const out = execFileSync('bash', ['-c', `set -- "$0"; ${line}; echo cleanup`, arg], { encoding: 'utf8' }).trim();
    return out === 'cleanup' ? 'cleanup' : 'skip';
  };
  const cases: [string, 'cleanup' | 'skip'][] = [
    ['remove', 'cleanup'], ['purge', 'cleanup'], ['upgrade', 'skip'], ['failed-upgrade', 'skip'], // dpkg
    ['0', 'cleanup'], ['1', 'skip'], ['2', 'skip'], // rpm
    ['0.1.0-1', 'cleanup'], ['1.2.0-1', 'cleanup'], ['12.0.3-2', 'cleanup'], // pacman
  ];
  it.each(cases)('before-remove %s → %s', (arg, want) => {
    // prerm on dpkg also sees words like "deconfigure": anything not a removal skips
    expect(decide('build/linux/before-remove.sh', arg)).toBe(want);
  });
  it.each(cases)('after-remove %s → %s', (arg, want) => {
    expect(decide('build/linux/after-remove.sh', arg)).toBe(want);
  });
  it('release passes the arch to fetch-deps and electron-builder, sums rpm too', () => {
    const r = fs.readFileSync('scripts/release-linux.mjs', 'utf8');
    expect(r).toContain("'--arch', ARCH");
    expect(r).toContain('`--${ARCH}`');
    expect(r).toMatch(/deb\|rpm\|AppImage\|pkg/);
    expect(r).toContain("'--targets'");
  });
});
