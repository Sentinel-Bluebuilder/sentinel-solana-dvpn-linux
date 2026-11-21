// ─── CODE-AUDIT L-36: the Reconnecting screen never says "daemon" ───
// connection.ts passed 'The daemon is retrying the connection.' as the view's detail in five places; the
// app's word for it is "the VPN service" (copy glossary). A view text is the second argument of viewFor().
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const src = fs.readFileSync('src/main/services/connection.ts', 'utf8');

describe('connection view texts', () => {
  it('no viewFor() detail holds the word daemon', () => {
    const details = [...src.matchAll(/viewFor\([^,()]+,\s*([^)]*)\)/g)].map((m) => m[1]);
    expect(details.length).toBeGreaterThan(5); // positive control: the pattern finds the calls
    expect(details.filter((d) => /daemon/i.test(d))).toEqual([]);
  });
  it('the reconnecting detail is one sentence, in the app\'s words', () => {
    expect(src).toContain("export const RETRYING_DETAIL = (): string => tr('The VPN service is reconnecting to the server.');");
    expect((src.match(/RETRYING_DETAIL/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });
});
