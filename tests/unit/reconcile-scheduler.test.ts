// Q0361 / Q0366: the scheduler's session job is what runs the reconcile while a session is shown;
// without it an app that missed the stream's end stays on Connected / Reconnecting.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, '..', '..', 'src', 'main', 'scheduler.ts'), 'utf8');

describe('session job reconciles a shown session', () => {
  it('a shown session is checked against dvpnd on every session poll', () => {
    expect(src).toMatch(/if \(s\.session\) return daemonInfo\(\)\.reachable && await reconcileShownSession\(\) \? undefined : SKIPPED;/);
  });
  it('a shown blocked view (no session) is checked again on every session poll (AND-34 KSM13 blk × ks-off, CLI arm)', () => {
    const job = src.slice(src.indexOf("name: 'session'"), src.indexOf("name: 'rpc'"));
    expect(job).toMatch(/if \(!after\.session && after\.conn\.phase === 'error' && after\.conn\.restoreNetwork\) await checkLeftoverBlock\(\);/);
    // it runs after the adopt (a session found first wins) and only in the idle/error branch
    expect(job.indexOf('await checkLeftoverBlock()')).toBeGreaterThan(job.indexOf('await adoptRunningSession('));
  });
});
