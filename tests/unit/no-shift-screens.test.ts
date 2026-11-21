// UI-185 (owner 2026-11-15: "the whole page shouldn't expand when you load it"): Node test, Settings,
// Kill switch, Split tunnelling and Onboarding open at their full size and nothing below moves when
// their data arrives. Source-text checks, the convention for screens.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (name: string): string => readFileSync(resolve(__dirname, `../../src/renderer/src/screens/${name}.tsx`), 'utf8');

describe('the VPN service settings: real size under a placeholder on the first visit', () => {
  for (const name of ['Settings', 'KillSwitch', 'SplitTunnel']) {
    it(`${name} keeps its cards at their size while the service answers`, () => {
      const src = read(name);
      expect(src).toContain('<KeepsHeight loading={!daemon}');
      expect(src).toMatch(/import \{[^}]*\bKeepsHeight\b[^}]*\} from '..\/components\/ui'/);
      expect(src).not.toContain('{!daemon ? null');
    });
  }
});

it('KeepsHeight lays the block out invisibly at its real size (components/ui.tsx)', () => {
  expect(readFileSync(resolve(__dirname, '../../src/renderer/src/components/ui.tsx'), 'utf8')).toMatch(/export function KeepsHeight[\s\S]{0,300}<div className="invisible" aria-hidden>\{children\}<\/div>/);
});

describe('Settings', () => {
  it('the DNS answer keeps two lines whatever it says, and a revisit shows the last one', () => {
    const src = read('Settings');
    expect((src.match(/data-dns-check="(checking|dead|ok)"/g) ?? []).length).toBe(3);
    expect((src.match(/block min-h-\[2lh\][^"]*" (role="alert" )?data-dns-check/g) ?? []).length).toBe(3);
    expect(src).toContain('useState<{ key: string; problem: string | null; ok: number } | null>(DNS_LAST.get(key) ?? null)');
  });
});

describe('Kill switch', () => {
  it('the local network and the last check are kept for the app run; the check button keeps its width', () => {
    const src = read('KillSwitch');
    expect(src).toContain('useState<string[] | null>(LAST.lan)');
    expect(src).toContain('| null>(LAST.checks)');
    expect(src).toMatch(/btn-ghost min-w-\[7\.5rem\][^"]*" disabled=\{busy\}/);
  });
});

describe('Split tunnelling', () => {
  it('the app list has a fixed height, placeholder rows the first time, and the last list after', () => {
    const src = read('SplitTunnel');
    expect(src).toContain('<div className="h-80 overflow-y-auto" data-app-list>');
    expect(src).toContain('{apps === null ? <AppRowsLoading /> :');
    expect(src).toContain('useState<PickerApp[] | null>(LAST.apps)');
  });
});

describe('Node test', () => {
  it('the last runs are kept; the first visit shows past-run rows of the real height', () => {
    const src = read('NodeTest');
    expect(src).toContain('useState<HistoryReply | null>(preview?.hist ?? LAST.hist)');
    expect(src).toContain('{!hist ? <RunRowsLoading /> :');
  });
  it('the server list keeps its header and height whatever it holds', () => {
    const src = read('NodeTest');
    expect(src).toContain('<div className="h-72 overflow-y-auto">');
    expect(src).not.toContain('{shown.length > 0 && (');
  });
  it('the plan line is always there before a run, and a running run shows its card at once', () => {
    const src = read('NodeTest');
    expect(src).toContain("data-test-plan={plan ? 'ready' : 'none'}");
    expect(src).toContain('<div className="min-h-[2lh]">{plan ?');
    expect(src).toContain('{busy && !progress && <div');
  });
});

describe('Onboarding', () => {
  it('the welcome balances are there at once with a dash, and the refunds line keeps its height', () => {
    const src = read('Onboarding');
    expect(src).toContain("data-welcome-balances={w ? 'ready' : 'reading'}");
    expect(src).toContain("{w ? formatTdvpnShort(w.ownerTdvpn) : '—'}");
    expect(src).toContain('<p className="mt-3 min-h-[1lh] text-meta text-fg-muted">');
  });
});
