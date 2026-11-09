// ─── appimage-runtime — put the static AppImage runtime in front of an arm64 AppImage ───
// electron-builder 25's arm64 AppImage runtime (app-builder's appimage-12.0.1) links the
// UNVERSIONED libz.so, which only a zlib -dev package provides: on a stock Debian 12 / Ubuntu
// 24.04 arm64 the AppImage died at once ("libz.so: cannot open shared object file",
// ddv-plat-arm-deb12 + -u2404, 2026-10-22). The official static type2 runtime (pinned in
// build/deps.lock.json `appimageRuntime`) has no shared-library needs at all. An AppImage is
// runtime ELF + squashfs; the squashfs starts where the runtime's ELF ends (section headers).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Bytes of the ELF64 image at the start of `buf` (= end of its section header table). */
export function elfLength(buf) {
  if (buf.length < 64 || buf.readUInt32BE(0) !== 0x7f454c46 || buf[4] !== 2 || buf[5] !== 1) throw new Error('not a 64-bit little-endian ELF');
  const shoff = Number(buf.readBigUInt64LE(0x28));
  const shentsize = buf.readUInt16LE(0x3a);
  const shnum = buf.readUInt16LE(0x3c);
  const end = shoff + shentsize * shnum;
  if (!shoff || !shnum || end > buf.length) throw new Error('ELF has no usable section header table');
  return end;
}

/** True when the squashfs magic ("hsqs") sits right after the runtime. */
export function payloadAt(buf, off) {
  return buf.length >= off + 4 && buf.toString('latin1', off, off + 4) === 'hsqs';
}

const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/**
 * Replace the runtime of `appimage` with the pinned one (downloaded into `cacheDir`, sha checked).
 * Returns the new runtime size. Refuses anything that does not look like runtime + squashfs.
 */
export async function swapRuntime(appimage, pin, cacheDir) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const rtFile = path.join(cacheDir, `${path.basename(new URL(pin.url).pathname)}-${pin.sha256.slice(0, 12)}`);
  if (!fs.existsSync(rtFile) || sha256(fs.readFileSync(rtFile)) !== pin.sha256) {
    const res = await fetch(pin.url, { redirect: 'follow', headers: { 'User-Agent': 'devnet-dvpn-build' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${pin.url}`);
    fs.writeFileSync(rtFile, Buffer.from(await res.arrayBuffer()));
  }
  const rt = fs.readFileSync(rtFile);
  if (sha256(rt) !== pin.sha256) throw new Error(`AppImage runtime: SHA-256 mismatch (want ${pin.sha256})`);
  const img = fs.readFileSync(appimage);
  const off = elfLength(img);
  if (!payloadAt(img, off)) throw new Error(`${path.basename(appimage)}: no squashfs right after the runtime (offset ${off})`);
  const rtLen = elfLength(rt);
  if (rtLen !== rt.length) throw new Error('pinned runtime has trailing data');
  const out = Buffer.concat([rt, img.subarray(off)]);
  if (!payloadAt(out, rt.length)) throw new Error('swap produced no squashfs after the new runtime');
  fs.writeFileSync(`${appimage}.part`, out, { mode: 0o755 });
  fs.renameSync(`${appimage}.part`, appimage);
  return rt.length;
}
