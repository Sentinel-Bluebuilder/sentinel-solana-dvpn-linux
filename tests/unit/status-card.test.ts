// Rows UI-040 to UI-043: one view for the status card in every place it shows.
import { describe, expect, it } from 'vitest';
import { statusCard, type CardInput } from '../../src/core/session/status-card';

const base: CardInput = { stage: { phase: 'idle', covered: null }, title: 'Not connected', place: '', protocol: '', time: '', data: '', service: null, test: null, agent: false };
const card = (over: Partial<CardInput>): ReturnType<typeof statusCard> => statusCard({ ...base, ...over });

describe('status card', () => {
  it('not connected: a hint, no numbers', () => {
    expect(card({})).toMatchObject({ title: 'Not connected', line1: 'Pick a server', line2: '', progress: null, action: null });
  });

  it('connecting: the place, the step and a progress fraction', () => {
    const v = card({ stage: { phase: 'paying', covered: null }, title: 'Paying deposit…', place: 'Frankfurt' });
    expect(v).toMatchObject({ line1: 'Frankfurt', line2: 'Step 2 of 5', progress: 0.4 });
  });

  it('connected: place and protocol, then time and data', () => {
    const v = card({ stage: { phase: 'connected', covered: true }, title: 'Protected', place: 'Frankfurt', protocol: 'WireGuard', time: '12:04', data: '1.2 GB' });
    expect(v).toMatchObject({ title: 'Protected', line1: 'Frankfurt over WireGuard', line2: '1.2 GB in 12:04', progress: null });
    expect(v.stage.tone).toBe('ok');
  });

  it('a blocked internet comes first and offers Restore network', () => {
    const v = card({ stage: { phase: 'error', covered: null, blocked: true }, title: 'Session ended', service: { title: 'The VPN service is off', action: 'start' } });
    expect(v).toMatchObject({ line1: 'Your internet may be blocked.', action: 'restore' });
  });

  it('a VPN service that is not ready replaces "Not connected", never while connected', () => {
    const service = { title: 'The VPN service is off', action: 'start' };
    expect(card({ service })).toMatchObject({ title: 'The VPN service is off', line1: 'Start the VPN service on the Connect page.' });
    expect(card({ service: { title: 'The VPN service is starting', action: null } }).line1).toBe('One moment.');
    expect(card({ service, stage: { phase: 'connected', covered: true }, title: 'Protected' }).title).toBe('Protected');
  });

  it('a background server test shows its tally only while you are not connected', () => {
    expect(card({ test: { done: 12, total: 78 } })).toMatchObject({ title: 'Testing servers', line1: '12 of 78' });
    expect(card({ test: { done: 12, total: 78 }, stage: { phase: 'connected', covered: true }, title: 'Protected' }).title).toBe('Protected');
  });

  it('always a title and two lines, whatever the state (the card keeps one height)', () => {
    for (const phase of ['idle', 'preflight', 'paying', 'connecting', 'checking', 'connected', 'reconnecting', 'disconnecting', 'error'] as const) {
      const v = card({ stage: { phase, covered: phase === 'connected' ? true : null }, title: 'x' });
      expect(typeof v.line1).toBe('string');
      expect(typeof v.line2).toBe('string');
    }
  });

  it('carries the agent mark', () => {
    expect(card({ agent: true }).agent).toBe(true);
  });
});
