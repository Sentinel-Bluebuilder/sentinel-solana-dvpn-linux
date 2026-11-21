// ─── Icons ───
// One stroked set (1.5 px, round caps) at 16 or 20 px, drawn here so nothing is fetched and no
// text glyph (★ ✓ ✗ ? ×) stands in for an icon (docs/DESIGN.md → System, UI-061, UI-105).
import type { ReactNode } from 'react';

export type IconName =
  | 'check' | 'x' | 'alert' | 'info' | 'help' | 'star' | 'star-filled' | 'chevron-right' | 'chevron-down'
  | 'close' | 'copy' | 'external' | 'refresh' | 'shield' | 'shield-off' | 'clock' | 'arrow-right' | 'agent' | 'power' | 'moon' | 'sun';

const PATHS: Record<IconName, ReactNode> = {
  check: <path d="M4 10.5l4 4 8-9" />,
  power: <><path d="M10 3v6.5" /><path d="M6.2 5.6a6 6 0 1 0 7.6 0" /></>,
  moon: <path d="M16 11.6A6.6 6.6 0 0 1 8.4 4a6.6 6.6 0 1 0 7.6 7.6z" />,
  sun: <><circle cx="10" cy="10" r="3.2" /><path d="M10 2.8v1.6M10 15.6v1.6M2.8 10h1.6M15.6 10h1.6M4.9 4.9l1.1 1.1M14 14l1.1 1.1M4.9 15.1L6 14M14 6l1.1-1.1" /></>,
  x: <path d="M5 5l10 10M15 5L5 15" />,
  close: <path d="M5 5l10 10M15 5L5 15" />,
  alert: <><path d="M10 3.2l7.2 12.6H2.8L10 3.2z" /><path d="M10 8.2v3.6" /><path d="M10 14.1v.1" /></>,
  info: <><circle cx="10" cy="10" r="7.2" /><path d="M10 9.2v4.4" /><path d="M10 6.5v.1" /></>,
  help: <><circle cx="10" cy="10" r="7.2" /><path d="M7.9 8a2.2 2.2 0 1 1 3.2 2c-.7.4-1.1.9-1.1 1.7" /><path d="M10 14.2v.1" /></>,
  star: <path d="M10 3l2.1 4.4 4.8.6-3.5 3.3.9 4.8L10 13.8 5.7 16.1l.9-4.8L3.1 8l4.8-.6L10 3z" />,
  'star-filled': <path fill="currentColor" d="M10 3l2.1 4.4 4.8.6-3.5 3.3.9 4.8L10 13.8 5.7 16.1l.9-4.8L3.1 8l4.8-.6L10 3z" />,
  'chevron-right': <path d="M7.5 4.5L13 10l-5.5 5.5" />,
  'chevron-down': <path d="M4.5 7.5L10 13l5.5-5.5" />,
  copy: <><rect x="7" y="7" width="9.5" height="9.5" rx="2" /><path d="M13 7V5.5a2 2 0 0 0-2-2H5.5a2 2 0 0 0-2 2V11a2 2 0 0 0 2 2H7" /></>,
  external: <><path d="M11 4h5v5" /><path d="M16 4l-7 7" /><path d="M14 11.5V15a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 15V7.5A1.5 1.5 0 0 1 5 6h3.5" /></>,
  refresh: <><path d="M16 10a6 6 0 1 1-1.8-4.3" /><path d="M16.2 3.6v3h-3" /></>,
  shield: <><path d="M10 2.8l6 2.2v4.6c0 3.6-2.4 6.3-6 7.6-3.6-1.3-6-4-6-7.6V5l6-2.2z" /><path d="M7.2 10l2 2 3.6-4" /></>,
  'shield-off': <><path d="M10 2.8l6 2.2v4.6c0 3.6-2.4 6.3-6 7.6-3.6-1.3-6-4-6-7.6V5l6-2.2z" /><path d="M7.8 7.8l4.4 4.4M12.2 7.8l-4.4 4.4" /></>,
  clock: <><circle cx="10" cy="10" r="7.2" /><path d="M10 6v4.2l2.8 1.6" /></>,
  'arrow-right': <path d="M4 10h12M11.5 5.5L16 10l-4.5 4.5" />,
  agent: <><rect x="4" y="6.5" width="12" height="9" rx="2.5" /><path d="M10 6.5V4" /><circle cx="10" cy="3.2" r=".8" /><path d="M7.6 10.6v.9M12.4 10.6v.9" /></>,
};

/** Icons that point along the reading direction: mirrored in an rtl page (B4). */
export const MIRRORED_ICONS: ReadonlySet<IconName> = new Set<IconName>(['chevron-right', 'arrow-right']);

/** `size` 16 (inline with text) or 20 (buttons, status). Decorative unless `label` is given. */
export function Icon({ name, size = 16, className = '', label }: { name: IconName; size?: 16 | 20; className?: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.5}
      strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${MIRRORED_ICONS.has(name) ? 'rtl:-scale-x-100 ' : ''}${className}`}
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} data-icon={name}
    >
      {PATHS[name]}
    </svg>
  );
}
