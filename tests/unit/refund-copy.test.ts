// ─── Deposits say what happens next and when (owner 2026-11-12) ───
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { aboutTime, refundLine, HELP } from '../../src/core/session/refund-copy';

const NOW = 1_800_000_000_000;

describe('refund status lines', () => {
  it('every state with money coming back says when; ready and open name their button', () => {
    expect(refundLine('ready', 5n, null, NOW)).toEqual({ text: 'Refund ready. Arrives automatically within 10 min.', action: expect.objectContaining({ label: 'Refund now' }) });
    expect(refundLine('open', 5n, null, NOW).action?.label).toBe('Refund now');
    expect(refundLine('open', 5n, null, NOW, true).text).toBe('Refund starts automatically within 10 min, then takes about 2 h.');
    expect(refundLine('open', 5n, null, NOW).text).toBe('Kept for a day so you can reconnect, then refunded automatically.');
    expect(refundLine('closing', 5n, NOW / 1000 + 6000, NOW).text).toBe('Refunding. Arrives in about 1 h 40 min.');
    expect(refundLine('in-use', 5n, null, NOW).text).toMatch(/after you disconnect/);
  });
  it('nothing to refund: no button, no promise of money', () => {
    for (const st of ['open', 'closing', 'ready', 'in-use'] as const) {
      const l = refundLine(st, 0n, null, NOW);
      expect(l.action, st).toBeNull();
      expect(l.text, st).not.toMatch(/refunded after|arrives/i);
    }
  });
  it('times read like a person says them', () => {
    expect(aboutTime(30)).toBe('under a minute');
    expect(aboutTime(25 * 60)).toBe('25 min');
    expect(aboutTime(7200)).toBe('2 h');
    expect(aboutTime(6000)).toBe('1 h 40 min');
    expect(aboutTime(3599)).toBe('1 h');
  });
});

describe('help icons', () => {
  it('cards that need explaining carry a (?); plain ones do not (owner: no (?) on Wallet)', () => {
    const want: Record<string, string[]> = {
      Home: ['Refunds on the way', 'Spent'],
      Wallet: ['Fees', 'Refunds ready'],
      Activity: ['Refunds on the way'],
    };
    for (const [f, labels] of Object.entries(want)) {
      const s = readFileSync(`src/renderer/src/screens/${f}.tsx`, 'utf8');
      for (const l of labels) expect(s, `${f} ${l}`).toMatch(new RegExp(`<StatCell help=\\{HELP\\(\\)\\.\\w+\\} label=\\{tr\\('${l}'\\)\\}`));
    }
    for (const t of Object.values(HELP())) expect(t.length).toBeGreaterThan(20);
    expect(readFileSync('src/renderer/src/screens/Home.tsx', 'utf8')).toContain("<StatCell label={tr('Wallet')}");
    expect(readFileSync('src/renderer/src/screens/Wallet.tsx', 'utf8')).toContain("<StatCell label={tr('Balance')}");
  });
  it('each refund row with an action has its button and help; the section has help', () => {
    const a = readFileSync('src/renderer/src/screens/Activity.tsx', 'utf8');
    expect(a).toContain('data-refund-action={s.channel} onClick={onRefund}>{line.action.label}</button><Help text={line.action.help} />');
    expect(a).toContain("{tr('Refunds')} <Help text={HELP().refunds} />");
    expect(a).toContain('onRefund={() => setConfirm({ channels: [s.channel] })}');
  });
});

// Owner 2026-11-12: "different terminologies" for one refund made it confusing. Two words only:
// deposit (what Connect locks) and refund (getting the rest back). One button: Refund now.
describe('one refund vocabulary', () => {
  const files = ['src/renderer/src/screens/Activity.tsx', 'src/renderer/src/screens/Wallet.tsx', 'src/renderer/src/screens/Home.tsx', 'src/renderer/src/screens/Onboarding.tsx', 'src/renderer/src/screens/NodeTest.tsx', 'src/renderer/src/components/ConnectSheet.tsx', 'src/core/session/refund-copy.ts', 'src/core/session/state.ts', 'src/shared/money-toast.ts', 'src/main/services/settlement.ts', 'src/main/services/connection.ts'];
  const OLD = /\b(settle|settled|settling|settlement|withdraw|close wait|comes back|coming back|Get refund|Start refund|Get all refunds)\b/i;
  // Only text a person reads: string literals and JSX text. Identifiers (settleToast, IPC.WITHDRAW) are code.
  const shown = (line: string): string[] => [...line.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`|>([^<>{}\n]+)</g)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').filter((x) => /\s/.test(x.trim()) || /^[A-Z]/.test(x.trim()));
  it('no screen or message uses the old words', () => {
    for (const f of files) {
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        if (/^\s*(\/\/|\*|\/\*)/.test(line) || /^\s*import /.test(line) || /log\.(info|warn|error)\(/.test(line)) continue;
        for (const text of shown(line)) expect(OLD.test(text) ? `${f}: ${text}` : '', f).toBe('');
      }
    }
  });
  it('every refund action is the same button', () => {
    for (const st of ['open', 'ready'] as const) expect(refundLine(st, 5n, null, NOW).action?.label).toBe('Refund now');
  });
});
