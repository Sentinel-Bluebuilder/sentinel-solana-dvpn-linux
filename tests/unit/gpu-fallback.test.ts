// ─── Q0246: no GPU render node → hardware acceleration off before Chromium starts ───
import { describe, it, expect } from 'vitest';
import { gpuOffReason } from '../../src/main/system/gpu';

describe('gpuOffReason (Q0246)', () => {
  it('no /dev/dri (cloud arm64 VM, xvfb): off', () => {
    expect(gpuOffReason('linux', null, {})).toBe('no /dev/dri');
  });
  it('/dev/dri without a render node (card only, KMS display): off', () => {
    expect(gpuOffReason('linux', ['card0', 'by-path'], {})).toMatch(/render node/);
  });
  it('a render node: Chromium decides, as before', () => {
    expect(gpuOffReason('linux', ['card0', 'renderD128', 'by-path'], {})).toBeNull();
  });
  it('DVPN_GPU=on keeps the default even with no GPU', () => {
    expect(gpuOffReason('linux', null, { DVPN_GPU: 'on' })).toBeNull();
  });
  it('never on another OS', () => {
    expect(gpuOffReason('win32', null, {})).toBeNull();
  });
});

// Q0246 pass 2 (TLX arm-deb12, lab AppImage 0dfc4da5): app.disableHardwareAcceleration() alone still launched
// the GPU process (for SwiftShader) and Chromium quit "GPU process isn't usable. Goodbye." 3 starts in 4.
// The fallback must also pass the switches that keep the GPU process out.
describe('GPU fallback keeps the GPU process out (Q0246 pass 2)', () => {
  it('the switch list is the measured set: disable-gpu + in-process-gpu (TLX arm-deb12 0/10)', async () => {
    const { GPU_OFF_SWITCHES } = await import('../../src/main/system/gpu');
    expect([...GPU_OFF_SWITCHES]).toEqual(['disable-gpu', 'in-process-gpu']);
  });

  it('call site: the fallback appends every switch before ready, not only disableHardwareAcceleration', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/main/index.ts', 'utf8');
    const call = src.slice(src.indexOf('applyGpuFallback(() =>'), src.indexOf('applyGpuFallback(() =>') + 400);
    expect(call).toMatch(/for \(const s of GPU_OFF_SWITCHES\) app\.commandLine\.appendSwitch\(s\)/);
    expect(src.indexOf('applyGpuFallback(() =>')).toBeLessThan(src.indexOf('app.whenReady'));
  });
});
