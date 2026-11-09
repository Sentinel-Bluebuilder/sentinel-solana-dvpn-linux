// ─── appimage-runtime — arm64 AppImage gets the static runtime (no libz.so need) ───
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { elfLength, payloadAt } from '../../scripts/appimage-runtime.mjs';

/** A minimal ELF64 LE header whose section header table ends at `end`. */
const fakeElf = (shoff: number, shnum: number, shentsize = 64, size = shoff + shnum * shentsize): Buffer => {
  const b = Buffer.alloc(Math.max(size, 64));
  b.writeUInt32BE(0x7f454c46, 0); b[4] = 2; b[5] = 1;
  b.writeBigUInt64LE(BigInt(shoff), 0x28);
  b.writeUInt16LE(shentsize, 0x3a);
  b.writeUInt16LE(shnum, 0x3c);
  return b;
};

describe('elfLength', () => {
  it('is the end of the section header table', () => {
    expect(elfLength(fakeElf(1000, 10))).toBe(1640);
  });
  it('refuses non-ELF, 32-bit, missing or truncated section tables', () => {
    expect(() => elfLength(Buffer.from('hsqs'.padEnd(80, 'x')))).toThrow(/not a 64-bit/);
    const e32 = fakeElf(1000, 10); e32[4] = 1;
    expect(() => elfLength(e32)).toThrow(/not a 64-bit/);
    expect(() => elfLength(fakeElf(0, 0, 64, 200))).toThrow(/no usable section header/);
    expect(() => elfLength(fakeElf(1000, 10).subarray(0, 1200))).toThrow(/no usable section header/);
  });
});

describe('payloadAt', () => {
  it('finds the squashfs magic right after the runtime', () => {
    const img = Buffer.concat([fakeElf(1000, 10), Buffer.from('hsqs....')]);
    expect(payloadAt(img, elfLength(img))).toBe(true);
    expect(payloadAt(img, 100)).toBe(false);
  });
});

describe('build/deps.lock.json appimageRuntime', () => {
  const lock = JSON.parse(fs.readFileSync('build/deps.lock.json', 'utf8'));
  it('pins the arm64 static runtime by a dated tag and sha256', () => {
    const r = lock.appimageRuntime.arm64;
    expect(r.url).toMatch(/^https:\/\/github\.com\/AppImage\/type2-runtime\/releases\/download\/\d{8}\/runtime-aarch64$/);
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.url).not.toContain('continuous');
  });
  // Q0382 (TLX ddv2-u24, 10-31): electron-builder's x64 runtime dlopens libfuse.so.2; stock Ubuntu 24.04 has none, so
  // the AppImage died 'AppImages require FUSE' before AppRun (no app code, no --no-sandbox hint). x64 gets the static one too.
  it('pins the x64 static runtime by the same dated tag and sha256 (Q0382)', () => {
    const r = lock.appimageRuntime.x64;
    expect(r.url).toMatch(/^https:\/\/github\.com\/AppImage\/type2-runtime\/releases\/download\/\d{8}\/runtime-x86_64$/);
    expect(r.sha256).toBe('2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d');
    expect(r.version).toBe(lock.appimageRuntime.arm64.version);
  });
  it('release-linux swaps it after electron-builder, before the sums', () => {
    const r = fs.readFileSync('scripts/release-linux.mjs', 'utf8');
    const swap = r.indexOf('swapRuntime(');
    expect(swap).toBeGreaterThan(r.indexOf("npx(['electron-builder'"));
    expect(swap).toBeLessThan(r.lastIndexOf('SHA256SUMS.txt'));
  });
});
