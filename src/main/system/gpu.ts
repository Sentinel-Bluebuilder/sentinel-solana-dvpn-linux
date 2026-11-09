// ─── No GPU render node → software rendering from the start (Q0246) — Linux ───
// On a machine with no GPU (cloud arm64 VMs, many SBCs, xvfb), Chromium still launches the hardware
// GPU process, which exits and falls back to SwiftShader, then relaunches it. When one of those
// sandboxed launches dies, the fallback runs out and the browser stops itself:
// FATAL gpu_data_manager_impl_private.cc:415 "GPU process isn't usable. Goodbye." (SIGTRAP, exit 133;
// Debian 12 arm64, 1-3 starts in 10). With no /dev/dri render node there is no hardware GPU to try,
// so keep the GPU process out entirely (GPU_OFF_SWITCHES below; --disable-gpu alone still crashed 5/10).
// DVPN_GPU=on keeps Chromium's default.
import fs from 'node:fs';

/** Pure: should hardware acceleration be off? `dri` = names in /dev/dri, null when it does not exist. */
export function gpuOffReason(platform: string, dri: string[] | null, env: Record<string, string | undefined>): string | null {
  if (platform !== 'linux' || env.DVPN_GPU === 'on') return null;
  if (dri === null) return 'no /dev/dri';
  if (!dri.some((n) => /^renderD\d+$/.test(n))) return 'no GPU render node in /dev/dri';
  return null;
}

/**
 * Chromium switches that keep the GPU process from being launched at all. app.disableHardwareAcceleration()
 * alone still launches it (for SwiftShader), and on arm-deb12 that launch failed 3 starts in 4 with the
 * same "GPU process isn't usable. Goodbye." (TLX 10-30, lab AppImage 0dfc4da5). Measured on arm-deb12, 10 starts each
 * (FATAL line counted): none 9/10, disable-gpu 5/10, + disable-software-rasterizer 10/10, + in-process-gpu 0/10
 * (and 0/3 with --no-sandbox): the GPU thread runs inside the browser, no GPU process to launch.
 */
export const GPU_OFF_SWITCHES: readonly string[] = ['disable-gpu', 'in-process-gpu'];

/** Call before app is ready. Returns the reason when it turned hardware acceleration off. */
export function applyGpuFallback(disable: () => void): string | null {
  let dri: string[] | null = null;
  try {
    dri = fs.readdirSync('/dev/dri');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return null; // unreadable: leave Chromium's default
  }
  const reason = gpuOffReason(process.platform, dri, process.env);
  if (reason) disable();
  return reason;
}
