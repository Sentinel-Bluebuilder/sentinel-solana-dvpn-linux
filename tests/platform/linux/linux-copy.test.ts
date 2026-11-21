// ─── Linux screens use Linux words (builder-kb C12) ───
// Before the 2026-11-12 port the screens were Linux copies and any "Windows" was a leak ("Start with Windows", DPAPI,
// a 'netsh' DNS mode the Linux config check refuses). The renderer is now shared with the Windows app: Windows words are allowed
// in OS-keyed lines (osPick({ win32: … }), process.platform === 'win32') and comments, which never render here.
// Every other "Windows" must be on this reviewed allow list, with the reason it never shows on Linux.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dnsModesFor } from '../../../src/core/daemon/config';

const ROOT = path.resolve(__dirname, '../../..');
const RENDERER = path.join(ROOT, 'src/renderer/src');

// file (relative to src/renderer/src) → lines that may say "Windows" on purpose
const ALLOWED: Record<string, RegExp[]> = {
  // the relogin panel: only a Windows install returns relogin (Linux installService says relogin: false)
  'components/InstallServiceButton.tsx': [/sign out of Windows and sign back in/, /Windows lets this account use it from your next sign-in/],
  // label of the Windows driver row; Linux's driver report has no 'windows' row
  'screens/Diagnostics.tsx': [/windows: (tr\()?'Windows \(64-bit\)'/],
  // entries of CREDITS_WIN32, picked by osPick
  'screens/Settings.tsx': [/wireguard-windows/, /amneziawg-windows-client/],
  // the Linux note says where choosing apps works
  'screens/SplitTunnel.tsx': [/data-split-linux-note/],
};
const OS_KEYED = /win32|^\s*(\/\/|\*|\/\*|\{\/\*)/;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.(tsx?)$/.test(e.name) ? [p] : [];
  });
}

describe('Linux copy', () => {
  it('renderer says "Windows" only in OS-keyed lines, comments or allow-listed lines', () => {
    const hits: string[] = [];
    for (const file of walk(RENDERER)) {
      const rel = path.relative(RENDERER, file).split(path.sep).join('/');
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (!/Windows|DPAPI|PowerShell/.test(line) || OS_KEYED.test(line)) return;
        if ((ALLOWED[rel] ?? []).some((re) => re.test(line))) return;
        hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(hits).toEqual([]);
  });

  // Negative control: the scan does catch an unkeyed Windows word.
  it('the scan flags an unkeyed "Windows" line', () => {
    const line = '<p>Restart Windows to finish.</p>';
    expect(/Windows/.test(line) && !OS_KEYED.test(line)).toBe(true);
  });

  it('the split screen names the Linux desktop proxy, not the Windows one', () => {
    const s = fs.readFileSync(path.join(RENDERER, 'screens/SplitTunnel.tsx'), 'utf8');
    // the Windows app i18n (B): the proxy name is inline in each osPick, linux: tr('… (GNOME/KDE) …'), no PROXY_NAME const
    expect(s).toMatch(/linux: tr\('[^']*GNOME/);
    expect(s).not.toMatch(/linux: tr\('[^']*Windows proxy/);
  });

  it('the Settings DNS switch writes a Linux DNS mode', () => {
    const s = fs.readFileSync(path.join(RENDERER, 'screens/Settings.tsx'), 'utf8');
    const m = s.match(/dnsMode: on \? osPick\(\{[^}]*linux: '([a-z]+)'/);
    expect(m).not.toBeNull();
    expect(dnsModesFor('linux')).toContain(m![1]);
  });
});
