// ─── CODE-AUDIT L-26: the window only ever navigates to the app's own page ───
// The guard used a prefix test on 'http://localhost', which also matched 'http://localhost.example.com'
// and allowed localhost in the installed app (it loads from a file).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const src = fs.readFileSync('src/main/index.ts', 'utf8');

/** The same rule as index.ts, so the cases below are checked against real URLs. */
function allowed(url: string, dev?: string): boolean {
  return url.startsWith('file://') || !!(dev && url.startsWith(dev.endsWith('/') ? dev : `${dev}/`));
}

describe('window navigation guard', () => {
  it('index.ts holds this rule and no bare localhost prefix', () => {
    expect(src).toContain("if (!url.startsWith('file://') && !(dev && url.startsWith(dev.endsWith('/') ? dev : `${dev}/`))) e.preventDefault();");
    expect(src).not.toContain("url.startsWith('http://localhost')");
  });
  it('installed app: its own file only', () => {
    expect(allowed('file:///C:/app/out/renderer/index.html')).toBe(true);
    expect(allowed('http://localhost:5173/')).toBe(false);
    expect(allowed('http://localhost.example.com/')).toBe(false);
    expect(allowed('https://example.com/')).toBe(false);
  });
  it('from source: the dev server too, and nothing that only starts like it', () => {
    expect(allowed('http://localhost:5173/#nodes', 'http://localhost:5173')).toBe(true);
    expect(allowed('http://localhost:51730/', 'http://localhost:5173')).toBe(false);
    expect(allowed('http://localhost.example.com/', 'http://localhost:5173')).toBe(false);
  });
});
