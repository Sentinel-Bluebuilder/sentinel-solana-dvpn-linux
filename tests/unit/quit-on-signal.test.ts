// ─── Agent M (Mac rc.2): a plain SIGTERM quits through the same cleanup as the menu Quit ───
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync('src/main/index.ts', 'utf8');

describe('quit on signal', () => {
  it('SIGTERM and SIGHUP call app.quit(), which runs before-quit (disconnect + proxy back, 10 s cap)', () => {
    expect(main).toContain("for (const sig of ['SIGTERM', 'SIGHUP'] as const) {");
    expect(main).toContain("process.on(sig, () => { log.info('quit on signal', { sig }); app.quit(); });");
    expect(main.indexOf("app.on('before-quit'")).toBeGreaterThan(0);
  });
  it('negative control: SIGKILL is never handled (it cannot be)', () => {
    expect(main).not.toMatch(/process\.on\('SIGKILL'/);
  });
});
