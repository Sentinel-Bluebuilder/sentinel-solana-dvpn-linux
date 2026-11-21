// ─── Audit U-5: the Node test page is busy before it asks for a run, never after ───
// The service answers the run request at once and works in the background; a run it refuses at once can send
// its "finished" event before the request returns. Setting busy after the call then left Stop on screen.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync('src/renderer/src/screens/NodeTest.tsx', 'utf8');

describe('Node test: starting a run', () => {
  it('sets busy first, and clears it when the request itself fails', () => {
    const body = src.slice(src.indexOf('const startRun = async'), src.indexOf('const toggle = '));
    expect(body.indexOf('setBusy(true)')).toBeGreaterThan(-1);
    expect(body.indexOf('setBusy(true)')).toBeLessThan(body.indexOf('await call(window.api.IPC.NODE_TEST_RUN'));
    expect(body).toContain('setBusy(false);');
  });

  it('both buttons (Run test, Continue the run) go through it', () => {
    expect(src.match(/onConfirm=\{\(\) => startRun\(/g)?.length).toBe(2);
    expect(src).not.toMatch(/NODE_TEST_RUN[^\n]*\); setBusy\(true\)/);
  });
});
