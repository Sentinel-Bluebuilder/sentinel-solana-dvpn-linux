// ─── Audit U-4: a server's answer is capped, so no server can fill the app's memory ───
// Every listed server is asked for its signed details; before the cap a body without end grew without end.
import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_BODY_BYTES, collectBody } from '../../src/core/nodes/nodeapi';

describe('collectBody', () => {
  it('returns a normal answer whole (positive control)', async () => {
    const s = new PassThrough();
    const p = collectBody(s, 100, () => undefined);
    s.end(Buffer.from('{"payload":{}}'));
    expect((await p).toString()).toBe('{"payload":{}}');
  });

  it('stops past the cap, tears the request down and keeps nothing more', async () => {
    const s = new PassThrough();
    let torn: Error | null = null;
    const p = collectBody(s, 10, (err) => { torn = err; });
    s.write(Buffer.alloc(8));
    s.write(Buffer.alloc(8));
    await expect(p).rejects.toThrow('answer larger than 10 bytes');
    expect(torn).not.toBeNull();
  });

  it('the HTTPS helper uses it, at 1 MB', () => {
    expect(MAX_BODY_BYTES).toBe(1_000_000);
    expect(readFileSync('src/core/nodes/nodeapi.ts', 'utf8')).toContain('collectBody(res, MAX_BODY_BYTES, (err) => req.destroy(err))');
  });
});
