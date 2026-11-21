// ─── Q0527 (Agent M, Mac KSM13): a proxy session's IP check must not wait on the direct probe ───
// With the kill switch on, the direct probe waits out its 6 s timeout (dropped). `status` gives the IP
// check 2.5 s, so awaiting it before the patch left every proxy session on "Checking the connection…" (then titled "Connected, checking…").
// Wiring guard in the style of reconcile-scheduler.test.ts (the scheduler is not loaded in unit tests).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(__dirname, '..', '..', 'src', 'main', 'scheduler.ts'), 'utf8');
const job = src.slice(src.indexOf("name: 'ip'"), src.indexOf("name: 'ip'") + 6000);

describe('ip job: proxy answer first, direct exit later (Q0527)', () => {
  it('the direct probe starts before the proxy check and is awaited only after the first patch', () => {
    const start = job.indexOf('const directRead = socks');
    const proxy = job.indexOf('const r = await publicIp(');
    const firstPatch = job.indexOf('patch({ publicIp:', proxy); // the job also clears publicIp earlier
    const waitDirect = job.indexOf('await directRead');
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThan(proxy);
    expect(firstPatch).toBeGreaterThan(proxy);
    expect(waitDirect).toBeGreaterThan(firstPatch);
  });
  it('negative control: the old serial direct probe (await before the patch) is gone', () => {
    expect(job).not.toMatch(/const d = socks \? await publicIp\(6000\) : null;/);
  });
  it('the late direct IP lands only on the same reading', () => {
    expect(job).toMatch(/now\.sid === sid && now\.ip === r\.ip/);
  });
});
