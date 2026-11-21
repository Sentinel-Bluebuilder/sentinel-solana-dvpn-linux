// ─── Q0569 (DVPN-WIN ksm10 r2): the Split plan card names the V2Ray/Xray proxy caveat; lane labels wrap ───
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync('src/renderer/src/screens/SplitTunnel.tsx', 'utf8');

describe('Split tunnelling plan card', () => {
  it('disconnected with apps chosen and Whole computer off: says app choices need Whole computer on V2Ray/Xray', () => {
    expect(src).toContain("{!s && !lanes.note && APPS && split.mode !== 'off' && split.apps.length > 0 && (draft.wholeDevice === false || !fullSplit(PLATFORM, snap.daemon.version)) && (");
    expect(src).toContain('data-split-plan-proxy-note');
  });
  it('lane labels wrap instead of an ellipsis', () => {
    expect(src).toContain('<span className="min-w-0 [overflow-wrap:anywhere]" title={it.label}>{it.label}</span>');
    expect(src).not.toContain('<span className="truncate">{it.label}</span>');
  });
  it('negative control: the note is for the plan card only (the live card keeps its own caveat)', () => {
    expect(src).toMatch(/\{!s && !lanes\.note && APPS/);
  });
});
