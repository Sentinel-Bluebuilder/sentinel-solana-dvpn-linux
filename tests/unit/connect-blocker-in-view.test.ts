// The reason Connect is off must be in view when the dialog opens. At 1180x780 the red callout sat
// at the end of the scrolling part, below the fold: a new user saw a greyed button and no reason.
// It now sits between the scrolling part and the footer, which never scrolls.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(__dirname, '../../src/renderer/src/components/ConnectSheet.tsx'), 'utf8');

describe('Connect dialog: the blocking reason is always in view', () => {
  const scrollStart = src.indexOf('overflow-y-auto');
  const marker = src.indexOf('data-connect-blocker');
  const footer = src.indexOf('<footer');

  it('has the scrolling part, the blocker and the footer in that order', () => {
    expect(scrollStart).toBeGreaterThan(-1);
    expect(marker).toBeGreaterThan(scrollStart);
    expect(footer).toBeGreaterThan(marker);
  });

  it('does not render the blocker inside the scrolling part', () => {
    const scrolling = src.slice(scrollStart, marker);
    expect(scrolling).not.toContain('Add funds to connect');
    expect(scrolling).not.toContain('{blocker}');
    // The scrolling part is closed before the blocker opens.
    expect(scrolling.trimEnd().endsWith('{blocker && (\n          <div className="shrink-0 border-t border-line px-6 py-3"')).toBe(true);
    expect(scrolling).toContain('</div>\n\n        {/* Why the button is off.');
  });

  it('renders the blocker, with its title and the wallet address, just above the footer', () => {
    const fixed = src.slice(marker, footer);
    expect(fixed).toContain('Add funds to connect');
    expect(fixed).toContain('{blocker}');
    expect(fixed).toContain('role="alert"');
    expect(fixed).toContain('CopyAddr');
  });
});
