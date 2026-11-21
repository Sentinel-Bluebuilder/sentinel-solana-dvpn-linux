// ─── Rows UI-100, 101, 102, 105, 114: the Kill switch page ───
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync('src/renderer/src/screens/KillSwitch.tsx', 'utf8');
const modeCopy = (id: string): string => new RegExp(`id: '${id}', name: tr\\('[^']+'\\), what: tr\\('[^']+'\\), copy: tr\\('([^']+)'\\)`).exec(src)?.[1] ?? '';

describe('Kill switch page', () => {
  it('UI-100: each mode is described in at most two sentences; the section is not called "Check it"', () => {
    for (const id of ['off', 'persist']) {
      const copy = modeCopy(id);
      expect(copy.length, id).toBeGreaterThan(20); // positive control: the text was found
      expect(copy.split(/\.\s|\.$/).filter(Boolean).length, id).toBeLessThanOrEqual(2);
    }
    expect(src).toContain('data-ks-mode-more');
    expect(src).not.toContain('title="Check it"');
  });

  it('UI-101: the command lines are in a closed block after the two columns', () => {
    expect(src).toContain('<details className="card mb-6" data-cli-card>');
    expect(src).not.toContain('<Section title="Command line">');
    expect(src.indexOf('data-cli-card')).toBeGreaterThan(src.indexOf('data-ks-support'));
  });

  it('UI-102: a connection type the kill switch cannot cover is said in plain words', () => {
    expect(src).not.toContain('Not on this service version');
    expect(src).not.toContain('Not supported with this protocol');
    expect(src).toContain('Needs a newer VPN service. Nothing is paid.');
  });

  it('UI-105: check results are icons with a spoken word, not text glyphs', () => {
    expect(src).not.toContain('checkMark(r.level).symbol');
    expect(src).toContain('<Icon name={LEVEL_ICON[r.level]}');
    expect(src).not.toMatch(/[✓✗]/);
  });

  it('UI-114: a failed read, check or Restore network is shown on the page', () => {
    for (const hook of ['<RestoreNetworkButton />', 'data-ks-check-error', 'lanFailed ?']) expect(src, hook).toContain(hook);
    expect(src).not.toContain('IPC.RESTORE_NETWORK'); // the shared button owns the call and says its own failure
    // every catch that logs also sets something the page shows
    const catches = [...src.matchAll(/\.catch\(\(err\) => (\{[^}]*\}|[^)]*\))|catch \(err\) \{[^}]*\}/g)].map((m) => m[0]);
    expect(catches.length).toBeGreaterThanOrEqual(2);
    for (const c of catches) expect(c).toMatch(/set\w+\(/);
  });
});
