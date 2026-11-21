// ─── Plan cards: one clear structure (owner 2026-11-12) ───
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planLength } from '../../src/shared/format';

describe('plan length', () => {
  it('reads the way people say it', () => {
    expect(planLength(3650 * 86_400)).toBe('10 years');
    expect(planLength(86_400)).toBe('1 day');
    expect(planLength(7 * 86_400)).toBe('1 week');
    expect(planLength(30 * 86_400)).toBe('1 month');
    expect(planLength(3 * 86_400)).toBe('3 days');
    expect(planLength(12 * 3600)).toBe('12 hours');
  });
});

describe('plan card', () => {
  const s = readFileSync('src/renderer/src/screens/Plans.tsx', 'utf8');
  it('original layout: length + price on top, data and servers line, provider and Subscribe at the foot', () => {
    expect(s).toContain('data-plan-card={p.address}');
    expect(s).toContain("=== 0n ? tr('Free') : <>{formatTdvpnShort(p.price)}");
    expect(s).toContain("{p.dataCapGb ? `${p.dataCapGb} GB` : tr('Unlimited data')}");
    expect(s).toContain("{p.maxConnections ? trPlural({ one: '{count} server', other: '{count} servers' }, p.maxConnections, { count: p.maxConnections }) : tr('Any number of servers')}");
    expect(s).toContain('border-t border-line pt-3');
    expect(s).toContain('<button className="btn-primary btn-sm shrink-0" disabled={!p.providerListed} onClick={() => setConfirm(p)}>{tr(\'Subscribe\')}</button>');
    expect(s).not.toContain('text-hero');
  });
});
