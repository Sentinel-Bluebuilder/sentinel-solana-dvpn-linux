// ─── Linux screens use Linux words (builder-kb C12) ───
// Ports of #31 screens replace whole lines; the design pass 691cd42b brought back
// "Start with Windows", DPAPI and a 'netsh' DNS mode the Linux config check refuses.
// Any user-facing "Windows" in the renderer must be on this allow list.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DNS_MODES } from '../../src/core/daemon/config';

const ROOT = path.resolve(__dirname, '../..');
const RENDERER = path.join(ROOT, 'src/renderer/src');

// file (relative to src/renderer/src) → lines that may say "Windows" on purpose
const ALLOWED: Record<string, RegExp[]> = {
  'screens/KillSwitch.tsx': [/navigator\.userAgent/],
  'screens/SplitTunnel.tsx': [/navigator\.userAgent/, /^\s*\/\/ Linux build/, /works on Windows only/, /Choosing apps is in the Windows app/],
  'screens/Settings.tsx': [/^\s*\{\/\* Linux modes/],
  'styles/index.css': [/Windows Settings do the same/],
};

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.(tsx?|css)$/.test(e.name) ? [p] : [];
  });
}

describe('Linux copy', () => {
  it('renderer says "Windows" only on allow-listed lines', () => {
    const hits: string[] = [];
    for (const file of walk(RENDERER)) {
      const rel = path.relative(RENDERER, file).split(path.sep).join('/');
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (!/Windows|DPAPI|PowerShell/.test(line)) return;
        if ((ALLOWED[rel] ?? []).some((re) => re.test(line))) return;
        hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('shared lane labels name the system proxy, not the Windows one', () => {
    const s = fs.readFileSync(path.join(ROOT, 'src/core/split/lanes.ts'), 'utf8');
    expect(s).not.toMatch(/Windows proxy/);
  });

  it('the Settings DNS switch writes a Linux DNS mode', () => {
    const s = fs.readFileSync(path.join(RENDERER, 'screens/Settings.tsx'), 'utf8');
    const m = s.match(/dnsMode: on \? '([a-z]+)' : 'none'/);
    expect(m).not.toBeNull();
    expect(DNS_MODES).toContain(m![1]);
  });
});
