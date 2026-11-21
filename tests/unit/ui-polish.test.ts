// ─── UI polish (owner 2026-11-12) ───
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatTdvpnShort } from '../../src/shared/format';

const read = (p: string): string => readFileSync(p, 'utf8');

describe('summary card amounts', () => {
  it('rounds down to 2 decimals from 1 up, 4 below 1, never shows more than is there', () => {
    expect(formatTdvpnShort('56496683')).toBe('56.49');
    expect(formatTdvpnShort('8294')).toBe('0.0082');
    expect(formatTdvpnShort('1000000000')).toBe('1,000');
    expect(formatTdvpnShort('940000000')).toBe('940');
    expect(formatTdvpnShort('0')).toBe('0');
    expect(formatTdvpnShort('5')).toBe('<0.0001');
    expect(formatTdvpnShort('1234567890123')).toBe('1,234,567.89');
  });
  it('every summary card uses it and carries its unit', () => {
    for (const f of ['Home', 'Wallet', 'Activity']) {
      const lines = read(`src/renderer/src/screens/${f}.tsx`).split('\n').filter((l) => l.includes('<StatCell'));
      for (const l of lines) expect(l, f).not.toMatch(/[^t]formatTdvpn\(/);
    }
    const w = read('src/renderer/src/screens/Wallet.tsx');
    expect(w).toContain('<StatCell label={tr(\'Balance\')} value={`${formatTdvpnShort(w?.ownerTdvpn ?? \'0\')} tDVPN`}');
    expect(w).toContain('<StatCell help={HELP().fees} label={tr(\'Fees\')} value={`${sol(w?.ownerLamports ?? 0)} SOL`}');
  });
  it('cards are centered', () => {
    expect(read('src/renderer/src/styles/index.css')).toContain('.stat-cell { @apply flex min-w-0 flex-col items-center justify-start');
    // Fixed rows: the label row has one height with or without (?), the note row is always there.
    expect(read('src/renderer/src/styles/index.css')).toContain('.stat-label { @apply flex h-5 items-center justify-center');
    expect(read('src/renderer/src/components/ui.tsx')).toContain('{hint && <div className="stat-note">{hint}</div>}');
    // A popup must never be clipped by its card row.
    expect(read('src/renderer/src/styles/index.css')).not.toMatch(/.stat-strip {[^}]*overflow-hidden/);
  });
});

describe('IP addresses are hidden until clicked', () => {
  it('no screen prints a raw IP', () => {
    const home = read('src/renderer/src/screens/Home.tsx');
    const split = read('src/renderer/src/screens/SplitTunnel.tsx');
    expect(home).not.toMatch(/[^=]\{ip\.ip\}|\{ip\.directIp \?\?|[^=]\{snap\.homeIp\}|\{ip\?\.nodeIp \?\?|\{ip\?\.ip \?\?/);
    expect(split).not.toMatch(/\{vpnIp \?\?|\{snap\.homeIp \?\?|\$\{snap\.homeIp\}/);
    expect((home.match(/<HiddenIp /g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(home).not.toContain("'Browsers' : 'Proxy apps'");
    expect(home).toContain('<HiddenIp ip={ip.directIp} defaultShown />');
    // 3 since the Normal connection lane says "Your own IP address" in words (UI-187 pictures, UI-LEAD's order).
    expect((split.match(/<HiddenIp /g) ?? []).length).toBe(3);
  });
  it('starts hidden', () => {
    const ui = read('src/renderer/src/components/ui.tsx');
    expect(ui).toContain('defaultShown = false');
    expect(ui).toContain('const [shown, setShown] = useState(defaultShown);');
    expect(ui).toContain("{shown ? ip : '••••'}");
  });
});

describe('no bar after a plain disconnect', () => {
  it('"Disconnected." with no next step shows no banner', () => {
    expect(read('src/renderer/src/screens/Home.tsx')).toContain("!(snap.lastCloseMessage.message === tr('Disconnected.') && !snap.lastCloseMessage.action)"); // the message is translated (B3), so the compare is too
  });
});

describe('server list', () => {
  it('headers and cells share the same centered columns; address shortened', () => {
    const n = read('src/renderer/src/screens/Nodes.tsx');
    expect(n).toContain("<span className=\"text-center\">{tr('Price')}</span><span className=\"flex justify-center\"><Term k=\"responseTime\">{tr('Response')}</Term></span>");
    expect(n).toContain('{short(n.address, 6)}');
    expect(n).not.toContain('num text-right');
  });
});

describe('session facts grid', () => {
  it('location, IPs, protocol and DNS sit in one aligned grid of equal cells; Sites see is shown', () => {
    const h = read('src/renderer/src/screens/Home.tsx');
    expect(h).toContain('<div className="info-grid" data-session-info>');
    expect(h).toContain("<span className=\"text-fg-muted\">{tr('Location')}</span>");
    expect(h).not.toMatch(/className="chip"><span className="text-fg-muted">(Protocol|DNS|Your own IP)/);
    expect(h).toContain("{tr('Sites see')}</Term></span> {ip?.ip ? <HiddenIp ip={ip.ip} defaultShown />");
    const css = read('src/renderer/src/styles/index.css');
    expect(css).toMatch(/\.info-grid \{ @apply [^}]*grid gap-px/);
  });
});

describe('sidebar connection block', () => {
  it('status, country and protocol each start in one fixed 16 px icon column (owner 2026-11-12)', () => {
    const a = read('src/renderer/src/App.tsx');
    const c = read('src/renderer/src/components/SessionCard.tsx');
    // The shell renders the one card, in the sidebar and in the More list (UI-042).
    expect(a.match(/<SessionCard snap=\{snap\}/g)?.length).toBe(2);
    expect(c).toContain("const ICON_COL = 'flex w-4 shrink-0 items-center justify-center';");
    expect(c.match(/className=\{ICON_COL\}/g)?.length).toBe(3);
    expect(c).toContain('data-sidebar-session');
    expect(c).toContain('<ProtocolMark protocol={v.service} size={14} />');
    expect(a).not.toContain('ml-auto shrink-0"><ProtocolTag');
  });
});
