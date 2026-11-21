// ─── Small shared UI pieces ───
import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type InputHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { clickCloses, placeTip, TIP_W, type TipPlace } from '../../../core/app/tip-place';
import { useApp } from '../lib/store';
import { short } from '../../../shared/format';
import { Icon, type IconName } from './Icon';
import { lifeMs, visibleNotes } from '../../../core/app/notify-rules';
import { tr } from '../../../shared/i18n';

/** Country flag, 4:3, `size` = height in px (24 x 18 by default, like the flags in leading VPN apps). */
export function Flag({ code, size = 18, className = '' }: { code: string; size?: number; className?: string }) {
  const c = (code || '').toLowerCase();
  const box = { width: Math.round(size * 4 / 3), height: size };
  if (!/^[a-z]{2}$/.test(c)) return <span className={`inline-block shrink-0 rounded-[3px] bg-bg-hover ${className}`} style={box} role="img" aria-label="unknown country" />;
  return <span className={`fi fi-${c} shrink-0 rounded-[3px] bg-cover shadow-[0_0_0_1px_rgba(127,127,127,0.25)] ${className}`} style={{ ...box, backgroundSize: 'cover' }} role="img" aria-label={c.toUpperCase()} />;
}

/** Solana mark (three slanted bars), drawn here so nothing is fetched. */
export function SolanaMark({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  // One gradient id per instance: a shared id breaks every mark once the first one unmounts.
  const id = `solg${useId().replace(/:/g, '')}`;
  return (
    <svg viewBox="0 0 397 311" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="360" y1="-37" x2="141" y2="383" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#14F195" /><stop offset="1" stopColor="#9945FF" />
        </linearGradient>
      </defs>
      <path fill={`url(#${id})`} d="M64.6 237.9a13 13 0 0 1 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7a13 13 0 0 1-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7zM64.6 3.8A13.4 13.4 0 0 1 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7a13 13 0 0 1-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8zM333.1 120.1a13 13 0 0 0-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7a13 13 0 0 0 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" />
    </svg>
  );
}

/** App mark: the Solana mark on a dark tile (owner 2026-10-22, confirmed 2026-11-15: the Sentinel shield is only for "Built on Sentinel" and the tDVPN button), same in both themes, like the app icon. */
export function AppMark({ size = 40 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center bg-sol-ink shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14),0_4px_14px_rgb(var(--sol-purple)/0.28)]"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.26) }}
      aria-hidden
    >
      <span style={{ width: size * 0.56, height: size * 0.44 }} className="inline-flex"><SolanaMark className="h-full w-full" /></span>
    </span>
  );
}

/**
 * "Devnet, test tokens only": a soft amber strip with a flask (owner picked this from a preview,
 * 2026-11-15). `wide` fills the row (sidebar); `compact` keeps only the flask and the name (phone header).
 */
export function DevnetBadge({ wide = false, compact = false }: { wide?: boolean; compact?: boolean }) {
  return (
    <span className={`devnet-badge ${wide ? 'flex-1' : ''}`} title={tr('This app runs on Solana devnet. The tokens are for testing and have no real value.')}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
        <path d="M9 3h6M10 3v6.5L4.6 18.2A1.8 1.8 0 0 0 6.1 21h11.8a1.8 1.8 0 0 0 1.5-2.8L14 9.5V3M7.5 15h9" />
      </svg>
      <span className="font-semibold">Devnet</span>
      {!compact && <span className="truncate font-normal text-fg-dim">{tr('Test tokens only')}</span>}
    </span>
  );
}

/** Page head: title + one short line on the left, page actions on the right, one row. */
export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-title">{title}</h1>
        {subtitle && <p className="prose-cap mt-1 text-sm text-fg-dim">{subtitle}</p>}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  );
}

/** A section: quiet title left, its actions right. */
export function Section({ title, right, children, className = '' }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`section ${className}`}>
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
        {right && <div className="flex items-center gap-2">{right}</div>}
      </div>
      {children}
    </section>
  );
}

/** Numbers that belong together sit in one strip, split by hairlines (not one card each). */
export function StatStrip({ children }: { children: ReactNode }) {
  return <div className="stat-strip">{children}</div>;
}

/** One cell of a StatStrip; also usable alone as a card (Stat). */
/**
 * A (?) that explains the thing next to it (owner 2026-11-12: tooltips end to end). Shows on hover and
 * on keyboard focus; the text is also the accessible name, so screen readers read it.
 */
export function Help({ text }: { text: string }) {
  // Hover and keyboard focus show it; a tap (phone layout, no hover) toggles it; Esc or leaving closes it.
  // The tooltip is drawn on top of the whole window (a portal into <body>, fixed position), so no
  // card, list or scroll area around the (?) can cut it off, and it is kept inside the window.
  const [open, setOpen] = useState(false);
  const openedAt = useRef(0);
  const show = (): void => { setOpen((v) => { if (!v) openedAt.current = Date.now(); return true; }); };
  const [pos, setPos] = useState<TipPlace | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const place = (): void => {
      const b = btnRef.current?.getBoundingClientRect();
      if (!b) return;
      const h = tipRef.current?.scrollHeight ?? 80;
      setPos(placeTip(b, h, { width: window.innerWidth, height: window.innerHeight }));
    };
    place();
    const close = (): void => setOpen(false);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', close, true); };
  }, [open, text]);
  return (
    <span className="relative inline-flex align-middle" data-help onMouseEnter={show} onMouseLeave={() => setOpen(false)}>
      <button
        ref={btnRef}
        type="button" aria-label={text} aria-expanded={open}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-fg-muted transition-colors duration-press hover:text-fg focus-visible:text-fg"
        onClick={(e) => { e.stopPropagation(); if (!open) show(); else if (clickCloses(openedAt.current, Date.now())) setOpen(false); }}
        onFocus={show}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
      >
        <Icon name="help" />
      </button>
      {open && createPortal(
        <span
          ref={tipRef} role="tooltip" data-tooltip
          className="pointer-events-none fixed z-[1000] block overflow-y-auto rounded-lg border border-line-strong bg-bg-raised px-3 py-2 text-start font-sans text-meta font-normal normal-case leading-snug tracking-normal text-fg shadow-card"
          style={{ width: TIP_W, left: pos?.left ?? -9999, top: pos?.top ?? -9999, maxHeight: pos?.maxHeight, visibility: pos ? 'visible' : 'hidden' }}
        >{text}</span>,
        document.body,
      )}
    </span>
  );
}

export function StatCell({ label, value, hint, help }: { label: string; value: ReactNode; hint?: ReactNode; help?: string }) {
  return (
    <div className="stat-cell">
      <div className="stat-label">{label}{help && <Help text={help} />}</div>
      {/* An amount is never cut short: on a narrow tile the unit wraps to the next line. */}
      <div className="num stat-value">{value}</div>
      {hint && <div className="stat-note">{hint}</div>}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="num font-display text-value">{value}</div>
      {hint && <div className="mt-1 text-meta text-fg-muted">{hint}</div>}
    </div>
  );
}

/** On/off switch. A real checkbox underneath, so labels, keyboard, tests and hooks keep working. */
export function Switch({ checked, onChange, disabled, label, ...rest }: {
  checked: boolean; onChange: (on: boolean) => void; disabled?: boolean; label?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'checked' | 'type'>) {
  return (
    <span className="relative inline-flex h-6 w-10 shrink-0 items-center">
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        {...rest}
      />
      <span className="absolute inset-0 rounded-full border border-line-strong bg-bg-hover transition-colors peer-checked:border-transparent peer-checked:bg-sol peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[rgb(var(--sol-purple))] peer-disabled:opacity-45" aria-hidden />
      <span className="pointer-events-none absolute start-1 h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.35)] transition-transform peer-checked:translate-x-4 rtl:peer-checked:-translate-x-4" aria-hidden />
    </span>
  );
}

/** A shortened address that copies the FULL address on click (lists and tables, where a Copy button per row is noise). */
export function CopyAddr({ text, chars }: { text: string; chars?: number }) {
  const [done, setDone] = useState(false);
  if (!text) return <span className="mono">—</span>;
  return (
    <button
      type="button"
      className="mono rounded px-0.5 hover:bg-bg-hover hover:text-fg focus-visible:outline"
      title={done ? tr('Copied') : tr('Copy full address {text}', { text })}
      aria-label={tr('Copy address {text}', { text })}
      data-copy-addr={text}
      onClick={async (e) => {
        e.stopPropagation();
        await window.api.invoke(window.api.IPC.COPY, text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? tr('Copied') : short(text, chars)}
    </button>
  );
}

export function Copy({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn-ghost btn-sm"
      onClick={async () => {
        await window.api.invoke(window.api.IPC.COPY, text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? tr('Copied') : label ?? tr('Copy')}
    </button>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="h-14 animate-pulse rounded-lg border border-line bg-bg-card" style={{ animationDelay: `${i * 90}ms` }} />)}
    </div>
  );
}

/** Tone → icon and colour, shared by Banner, notifications and inline notes: tone is never colour alone (UI-038). */
export const TONE: Record<'info' | 'success' | 'warn' | 'error', { icon: IconName; ink: string; box: string }> = {
  info: { icon: 'info', ink: 'text-accent-ink', box: 'border-accent/35 bg-accent-soft' },
  success: { icon: 'check', ink: 'text-ok', box: 'border-ok/40 bg-ok-soft' },
  warn: { icon: 'alert', ink: 'text-warn', box: 'border-warn/35 bg-warn-soft' },
  error: { icon: 'alert', ink: 'text-bad', box: 'border-bad/40 bg-bad-soft' },
};

export function Banner({ kind, children, action }: { kind: 'info' | 'warn' | 'error'; children: ReactNode; action?: ReactNode }) {
  const t = TONE[kind];
  return (
    <div className={`mb-4 flex items-center justify-between gap-4 rounded-lg border px-4 py-3 text-sm ${t.box}`} role={kind === 'error' ? 'alert' : 'status'} data-banner={kind}>
      <div className="flex min-w-0 items-start gap-2"><Icon name={t.icon} className={`mt-0.5 ${t.ink}`} /><div className="min-w-0">{children}</div></div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

const BANNER_RANK: Record<string, number> = { error: 0, warn: 1, info: 2 };
const BANNER_MS = 180;

/**
 * The one place banners appear above a page (UI-010, UI-037). Give it `<Banner key=…>` children: it shows
 * the most serious first and `max` at most, and a banner opens and closes its own height in 180 ms so the
 * page below slides instead of jumping. A banner that goes away stays for that long while it closes.
 */
export function BannerStack({ children, max = 2 }: { children: ReactNode; max?: number }) {
  const want = Children.toArray(children)
    .filter((c): c is ReactElement<{ kind: string }> => isValidElement(c))
    .map((el, i) => ({ el, i }))
    .sort((a, b) => (BANNER_RANK[a.el.props.kind] ?? 3) - (BANNER_RANK[b.el.props.kind] ?? 3) || a.i - b.i)
    .slice(0, max)
    .map((x) => x.el);
  const ids = want.map((el) => String(el.key)).join('|');
  const last = useRef<ReactElement[]>(want);
  const [leaving, setLeaving] = useState<ReactElement[]>([]);
  useEffect(() => {
    const now = new Set(want.map((el) => String(el.key)));
    const gone = last.current.filter((el) => !now.has(String(el.key)));
    last.current = want;
    if (!gone.length) return undefined;
    setLeaving(gone);
    const t = setTimeout(() => setLeaving([]), BANNER_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);
  last.current = want;
  const shown = new Set(want.map((el) => String(el.key)));
  return (
    <div data-banner-stack={want.length}>
      {want.map((el) => <div key={String(el.key)} className="banner-slot"><div>{el}</div></div>)}
      {leaving.filter((el) => !shown.has(String(el.key))).map((el) => <div key={`out-${String(el.key)}`} className="banner-slot" data-leaving aria-hidden><div>{el}</div></div>)}
    </div>
  );
}

/**
 * The one Apply bar (UI-098): sticks to the bottom of the page while there are changes to apply.
 * `note` says what applying does ("Disconnects you first.", "Asks for administrator once."); the label is
 * always a plain verb. Give the wrapper its own data-* hook through `hook`.
 */
/**
 * UI-185: while a block's first answer is on its way, it is laid out invisibly at its real size with a
 * placeholder over it, so nothing below moves when the answer arrives. Render it with the values it
 * would show by default; `loading` false renders the children as they are.
 */
export function KeepsHeight({ loading, label, children }: { loading: boolean; label: string; children: ReactNode }) {
  if (!loading) return <>{children}</>;
  return (
    <div className="relative" aria-busy="true" aria-label={label} data-keeps-height>
      <div className="invisible" aria-hidden>{children}</div>
      <div className="absolute inset-0 animate-pulse rounded-lg bg-bg-hover" aria-hidden />
    </div>
  );
}

export function ApplyBar({ label = 'Apply', note, busy, disabled, reason, onApply, onDiscard, hook, children }: {
  label?: string; note?: ReactNode; busy?: boolean; disabled?: boolean; reason?: string;
  onApply: () => void; onDiscard?: () => void; hook?: Record<string, string>; children?: ReactNode;
}) {
  return (
    <div className="sticky bottom-0 z-30 mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-[var(--glass)] px-4 py-3 shadow-card backdrop-blur" data-apply-bar {...hook}>
      <div className="me-auto min-w-0 text-sm text-fg-dim">{note}</div>
      {children}
      {onDiscard && <button className="btn-ghost" disabled={busy} onClick={onDiscard}>{tr('Discard')}</button>}
      <button className="btn-primary" disabled={disabled || busy} aria-busy={busy} title={disabled ? reason : undefined} onClick={onApply}>{busy ? tr('Applying…') : label}</button>
    </div>
  );
}

export interface RadioCard<T extends string> { id: T; title: ReactNode; text?: ReactNode; disabled?: boolean; reason?: string; hook?: Record<string, string> }

/**
 * The one radio group (UI-116): a column of cards, the chosen one outlined. Arrow keys move the choice
 * (native radio inputs), each card is one click target, a disabled card says why on hover.
 */
export function RadioCards<T extends string>({ name, label, value, options, onChange, columns = 1 }: {
  name: string; label: string; value: T; options: Array<RadioCard<T>>; onChange: (id: T) => void; columns?: 1 | 2 | 3;
}) {
  const grid = columns === 3 ? 'sm:grid-cols-3' : columns === 2 ? 'sm:grid-cols-2' : '';
  return (
    <div role="radiogroup" aria-label={label} className={`grid gap-2 ${grid}`} data-radio-cards={name}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <label key={o.id} title={o.disabled ? o.reason : undefined} data-radio-card={o.id} {...o.hook}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors duration-press ${on ? 'border-accent bg-accent-soft' : 'border-line bg-bg-card hover:bg-bg-hover'} ${o.disabled ? 'cursor-not-allowed opacity-45' : ''}`}>
            <input type="radio" name={name} className="mt-1" checked={on} disabled={o.disabled} onChange={() => onChange(o.id)} />
            <span className="min-w-0"><span className="block text-sm font-semibold">{o.title}</span>{o.text && <span className="mt-0.5 block text-meta text-fg-dim">{o.text}</span>}</span>
          </label>
        );
      })}
    </div>
  );
}

/** A problem said in place, under the thing it belongs to (dialogs, forms): what happened, in one line. */
export function InlineError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="flex items-start gap-2 text-sm text-bad" role="alert" data-inline-error><Icon name="alert" className="mt-0.5" /><span className="min-w-0">{children}</span></p>;
}

// ─── Sheet: the one dialog shell (UI-025, UI-026) ───
// Every dialog in the app is a Sheet: same scrim, same enter motion, Esc closes, a click outside closes
// (unless `locked`, e.g. while its action runs), focus moves in and returns to where it was, the page
// behind does not scroll, Tab stays inside.
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let openSheets = 0;
/** The page's own scroll setting, taken when the FIRST sheet opens (audit L-10: a second sheet took
 *  'hidden' as the value to restore, and the page could stay unscrollable when sheets closed out of order). */
let pageOverflow = '';

/** `bare`: no padding and no scroll of its own, for a sheet that lays out its own header, scrolling body and footer. */
export function Sheet({ title, onClose, locked = false, width = 'max-w-md', bare = false, children, ...rest }: {
  title: string; onClose: () => void; locked?: boolean; width?: string; bare?: boolean; children: ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  const box = useRef<HTMLDivElement>(null);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const scroller = document.querySelector('main');
    if (openSheets === 0) pageOverflow = scroller instanceof HTMLElement ? scroller.style.overflow : '';
    openSheets += 1;
    if (scroller instanceof HTMLElement) scroller.style.overflow = 'hidden';
    // First control that is not the dismiss button gets focus; the box itself if there is none.
    const first = box.current?.querySelector<HTMLElement>('[data-autofocus]') ?? box.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? box.current)?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !lockedRef.current) { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== 'Tab' || !box.current) return;
      const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) { e.preventDefault(); return; }
      const head = items[0];
      const tail = items[items.length - 1];
      if (e.shiftKey && document.activeElement === head) { e.preventDefault(); tail.focus(); }
      else if (!e.shiftKey && document.activeElement === tail) { e.preventDefault(); head.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      openSheets -= 1;
      if (openSheets === 0 && scroller instanceof HTMLElement) scroller.style.overflow = pageOverflow;
      if (before && document.contains(before)) before.focus();
    };
  }, []);

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-label={title} data-sheet {...rest} onMouseDown={(e) => { if (e.target === e.currentTarget && !locked) onClose(); }}>
      <div ref={box} tabIndex={-1} className={`sheet ${width} max-h-[calc(100vh-2rem)] outline-none ${bare ? 'flex flex-col overflow-hidden p-0' : 'overflow-y-auto'}`}>
        {children}
      </div>
    </div>
  );
}

/** Confirmation sheet for every spend action: shows exactly what will happen first. */
export function ConfirmModal({ title, lines, confirmLabel, danger, onConfirm, onClose }: {
  title: string; lines: ReactNode[]; confirmLabel: string; danger?: boolean; onConfirm: () => Promise<void> | void; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // A failed action is said inside the dialog, next to the button that failed (UI-115).
  const [error, setError] = useState('');
  return (
    <Sheet title={title} onClose={onClose} locked={busy} data-confirm-modal="">
      <h2 className="mb-3 font-display text-section">{title}</h2>
      <ul className="mb-5 space-y-2 text-sm text-fg-dim">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
      {error && <div className="mb-4"><InlineError>{error}</InlineError></div>}
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose} disabled={busy}>{tr('Cancel')}</button>
        <button
          className={danger ? 'btn-danger' : 'btn-primary'}
          disabled={busy}
          data-autofocus
          aria-busy={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try { await onConfirm(); onClose(); } catch (err) {
              console.warn('confirm action failed', err);
              setError((err as Error)?.message || 'That did not work. Try again.');
              setBusy(false);
            }
          }}
        >
          {busy ? tr('Working…') : error ? tr('Try again') : confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}

/**
 * Notifications (UI-030 to UI-035): tone icon, optional title, one message, one action, a close button.
 * Bottom right on a computer, above the tab bar on a phone. Errors stay until closed; the others leave
 * by themselves, and wait while the pointer is over them. Rules: core/app/notify-rules.
 */
export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismiss);
  const expire = useApp((s) => s.expireToasts);
  const hover = useRef(false);
  const passing = toasts.some((t) => lifeMs(t) !== null);
  useEffect(() => {
    if (!passing) return undefined;
    const t = setInterval(() => expire(hover.current || document.hidden), 250);
    return () => clearInterval(t);
  }, [passing, expire]);
  const { shown, more } = visibleNotes(toasts);
  if (!toasts.length) return null;
  return (
    <div
      className="fixed bottom-20 start-4 end-4 z-50 flex flex-col gap-2 md:bottom-4 md:start-auto md:w-[360px]"
      role="region" aria-label={tr('Notifications')} aria-live="polite" data-toasts
      onMouseEnter={() => { hover.current = true; }} onMouseLeave={() => { hover.current = false; }}
    >
      {more > 0 && <div className="self-end rounded bg-bg-raised px-2 py-1 text-meta text-fg-muted shadow-card" data-toasts-more={more}>{tr('+{more} more', { more })}</div>}
      {shown.map((t) => {
        const tone = TONE[t.kind];
        return (
          // Solid card under the tint: a notification sits over page content and must stay readable.
          <div key={t.id} className="animate-toast-enter rounded-lg bg-bg-raised shadow-overlay">
          <div data-toast={t.kind} role={t.kind === 'error' ? 'alert' : 'status'} className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${tone.box}`}>
            <Icon name={tone.icon} size={20} className={`mt-px ${tone.ink}`} />
            <div className="min-w-0 flex-1">
              {t.title && <div className="font-semibold">{t.title}</div>}
              <div className={t.title ? 'text-fg-dim' : ''}>{t.message}{t.count > 1 && <span className="num ms-2 text-meta text-fg-muted" title={tr('Happened {count} times', { count: t.count })}>×{t.count}</span>}</div>
              {t.action && (
                <button className="btn-ghost btn-sm mt-2" data-toast-action={t.action.screen} onClick={() => { window.dispatchEvent(new CustomEvent('dvpn:go', { detail: t.action!.screen })); dismiss(t.id); }}>{t.action.label}</button>
              )}
            </div>
            <button className="-me-1 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-fg-muted transition-colors duration-press hover:bg-bg-hover hover:text-fg" aria-label={tr('Dismiss')} data-toast-dismiss onClick={() => dismiss(t.id)}><Icon name="close" /></button>
          </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * An IP address, hidden until clicked (owner 2026-11-12: someone looking at the screen should not read
 * it). Every IP the app shows goes through this; one click shows it, another hides it again.
 */
export function HiddenIp({ ip, defaultShown = false }: { ip: string | null | undefined; defaultShown?: boolean }) {
  const [shown, setShown] = useState(defaultShown);
  if (!ip || !/^[0-9a-f.:]+$/i.test(ip)) return <>{ip ?? ''}</>;
  return (
    <button type="button" data-hidden-ip={shown ? 'shown' : 'hidden'} className="num inline-flex items-center rounded px-1 tabular-nums text-fg hover:bg-bg-hover" title={shown ? tr('Click to hide') : tr('Click to show')} aria-label={shown ? tr('IP address {ip}, click to hide', { ip }) : tr('IP address hidden, click to show')} onClick={(e) => { e.stopPropagation(); setShown((v) => !v); }}>
      {shown ? ip : '••••'}
    </button>
  );
}
