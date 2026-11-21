// ─── B-UP lock (the agent kit rc.8): the cross-process lock itself ───
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { takeUpLock, UP_LOCK } from '../../src/cli/up-lock';

const dir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'up-lock-'));

describe('takeUpLock', () => {
  it('free: taken at once, released by its owner', async () => {
    const d = dir();
    const l = await takeUpLock({ dir: d, pid: 11 });
    expect(l!.waitedMs).toBeLessThan(400); // no poll: taken at once
    expect(JSON.parse(fs.readFileSync(path.join(d, UP_LOCK), 'utf8')).pid).toBe(11);
    l!.release();
    expect(fs.existsSync(path.join(d, UP_LOCK))).toBe(false);
  });
  it('held by a live run: waits, and takes it once released', async () => {
    const d = dir();
    fs.writeFileSync(path.join(d, UP_LOCK), JSON.stringify({ pid: 22, at: Date.now() }));
    let t = 0;
    const l = await takeUpLock({ dir: d, pid: 11, alive: () => true, now: () => Date.now() + t, sleep: async () => { t += 500; if (t >= 1500) fs.rmSync(path.join(d, UP_LOCK)); } });
    expect(l).not.toBeNull();
    expect(l!.waitedMs).toBeGreaterThanOrEqual(1500);
  });
  it('held by a live run past the wait: null (the caller answers busy, nothing paid)', async () => {
    const d = dir();
    fs.writeFileSync(path.join(d, UP_LOCK), JSON.stringify({ pid: 22, at: Date.now() }));
    let t = 0;
    expect(await takeUpLock({ dir: d, pid: 11, waitMs: 2000, alive: () => true, now: () => Date.now() + t, sleep: async () => { t += 500; } })).toBeNull();
    expect(JSON.parse(fs.readFileSync(path.join(d, UP_LOCK), 'utf8')).pid).toBe(22); // never taken from a live holder
  });
  it('negative controls: a dead holder or a stale lock is taken over at once', async () => {
    const d = dir();
    fs.writeFileSync(path.join(d, UP_LOCK), JSON.stringify({ pid: 22, at: Date.now() }));
    expect((await takeUpLock({ dir: d, pid: 11, alive: () => false }))!.waitedMs).toBeLessThan(400);
    const e = dir();
    fs.writeFileSync(path.join(e, UP_LOCK), JSON.stringify({ pid: 22, at: Date.now() - 10 * 60_000 }));
    expect((await takeUpLock({ dir: e, pid: 11, alive: () => true }))!.waitedMs).toBeLessThan(400);
  });
  it('release leaves a lock another run took over', async () => {
    const d = dir();
    const l = await takeUpLock({ dir: d, pid: 11 });
    fs.writeFileSync(path.join(d, UP_LOCK), JSON.stringify({ pid: 33, at: Date.now() }));
    l!.release();
    expect(JSON.parse(fs.readFileSync(path.join(d, UP_LOCK), 'utf8')).pid).toBe(33);
  });
});
