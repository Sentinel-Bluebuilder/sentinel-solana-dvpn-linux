// ─── Language menu (plan "The language menu"; Queue B2/B5) ───
// One component, two looks, one shared list:
//   compact (Connect): flag + code + small arrow;   row (welcome, Settings): flag + own name + arrow.
// The list reads only the rows of shared/i18n/languages.ts: "System language" first, then English, then every
// enabled language in row order (by speakers, never alphabetical). A language that is not enabled, or whose
// direction the layout cannot carry yet (selectableLanguages), is not shown at all.
// Each row: Flag (or a plain tile with the code), the own name in its own direction (a right-to-left name
// reads correctly whatever the layout around it), the English name
// smaller, the code, a tick on the current choice. Search over own name, English name and code, ignoring case
// and accents. Up/Down/Home/End, Enter picks, Escape closes and returns focus; typing goes to the search.
// The value is the saved setting: a code, or '' for "System language". Start/end spacing only.
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Flag } from './ui';
import { Icon } from './Icon';
import { call, useApp } from '../lib/store';
import { findLanguage, resolveLanguage, tr, type Language } from '../../../shared/i18n';
import type { AppSettings } from '../../../shared/types';
import { SYSTEM, fold, menuLanguages, searchMenu } from '../../../shared/language-menu';

export { SYSTEM, menuLanguages };

/** Save the choice as the `language` setting ('' = System language). Main switches at once and the screens
 *  follow its state; the saved settings come back into the store so every menu shows the new choice. */
export async function saveLanguage(code: string): Promise<void> {
  try {
    useApp.getState().setSettings(await call<AppSettings>(window.api.IPC.SETTINGS_SET, { language: code }));
  } catch (err) {
    console.warn('language not saved', { code, err });
  }
}

const BOX = 'group flex h-9 min-w-0 items-center gap-[10px] rounded-lg border border-line bg-bg-raised/50 px-3 text-start shadow-[inset_0_1px_0_rgb(255_255_255/.05)] transition-colors duration-state hover:border-accent/50 hover:bg-bg-hover focus-visible:border-accent/60 disabled:opacity-50';

/** Flag 20x15 in a 28 px column; a plain tile with the code when the language has no country flag. */
export function LanguageFlag({ lang }: { lang: Language }) {
  return (
    <span className="grid w-7 shrink-0 place-items-center" aria-hidden>
      {lang.flag
        ? <Flag code={lang.flag} size={15} />
        : <span className="grid h-[15px] w-5 place-items-center rounded-[3px] bg-bg-hover text-[8px] font-semibold leading-none text-fg-dim" data-language-tile>{lang.label}</span>}
    </span>
  );
}

/** What "System language" stands for on this computer right now. */
function systemLanguage(): Language {
  const tags = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
  return findLanguage(resolveLanguage(SYSTEM, tags)) ?? findLanguage('en')!;
}

export interface LanguageSelectorProps {
  /** The saved choice: a code, or '' for "System language". */
  value: string;
  onChange: (code: string) => void;
  /** compact = flag + code (Connect); row = flag + own name (welcome, Settings). */
  look?: 'compact' | 'row';
  /** Defaults to menuLanguages(). */
  languages?: readonly Language[];
  disabled?: boolean;
}

type Item = { code: string; lang: Language; system: boolean };

export function LanguageSelect({ value, onChange, look = 'row', languages, disabled = false }: LanguageSelectorProps) {
  const sys = useMemo(systemLanguage, []);
  const langs = useMemo(() => [...(languages ?? menuLanguages())], [languages]);
  const [isOpen, setOpen] = useState(false);
  // The list is drawn in the page body at a fixed position worked out from the button, so no card around the
  // menu (overflow hidden) can clip it; it opens up or down by the room each way, and its height follows.
  const [pos, setPos] = useState<{ style: CSSProperties; listMax: number }>({ style: {}, listMax: 288 });
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const chosen = value === SYSTEM ? null : findLanguage(value);
  const shownLang = chosen ?? sys;
  const items: Item[] = useMemo(() => {
    const found = searchMenu(query, langs).map((l) => ({ code: l.code, lang: l, system: false }));
    const sysHit = !query.trim() || fold(tr('System language')).includes(fold(query.trim()));
    return sysHit ? [{ code: SYSTEM, lang: sys, system: true }, ...found] : found;
  }, [query, langs, sys]);

  useEffect(() => {
    if (!isOpen) return undefined;
    setActive(Math.max(0, items.findIndex((it) => (chosen ? it.code === chosen.code : it.system))));
    input.current?.focus();
    const inside = (t: Node) => !!(root.current?.contains(t) || pop.current?.contains(t));
    const away = (e: MouseEvent) => { if (!inside(e.target as Node)) close(false); };
    const moved = (e: Event) => { if (!inside(e.target as Node)) close(false); }; // the page scrolled or resized under the list
    document.addEventListener('mousedown', away);
    window.addEventListener('resize', moved);
    window.addEventListener('scroll', moved, true);
    return () => {
      document.removeEventListener('mousedown', away);
      window.removeEventListener('resize', moved);
      window.removeEventListener('scroll', moved, true);
    };
  }, [isOpen]); // only on opening: the active row must not jump while typing

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    if (isOpen) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, isOpen, listId]);

  function openList() {
    // Opens upward when there is no room below for the list (about 340 px) and more room above; the list's own
    // height shrinks to the room that is there (the search box takes about 50 px).
    const r = button.current?.getBoundingClientRect();
    if (r && typeof window !== 'undefined') {
      const below = window.innerHeight - r.bottom;
      const up = below < 340 && r.top > below;
      const room = (up ? r.top : below) - 24;
      // At least 288 px, so the own name, the English name and the code all fit (the sidebar button is narrower).
      const width = Math.min(Math.max(288, look === 'compact' ? 0 : r.width), window.innerWidth - 32);
      const rtl = document.documentElement.dir === 'rtl';
      const left = Math.max(16, Math.min(window.innerWidth - width - 16, rtl ? r.right - width : r.left));
      setPos({
        style: { position: 'fixed', left, width, ...(up ? { bottom: window.innerHeight - r.top + 8 } : { top: r.bottom + 8 }) },
        listMax: Math.max(120, Math.min(288, room - 50)),
      });
    }
    setOpen(true);
  }

  function close(refocus = true) {
    setOpen(false);
    setQuery('');
    if (refocus) button.current?.focus();
  }

  function pick(it: Item | undefined) {
    if (!it) return;
    if (it.code !== value) onChange(it.code);
    close();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(items.length - 1, i + 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); return; }
    if (e.key === 'Home') { e.preventDefault(); setActive(0); return; }
    if (e.key === 'End') { e.preventDefault(); setActive(items.length - 1); return; }
    if (e.key === 'Enter') { e.preventDefault(); pick(items[active]); return; }
    if (e.key === 'Tab') close(false);
  }

  const label = chosen ? tr('Language: {name}. Change the language.', { name: chosen.own }) : tr('Language: System language. Change the language.');
  return (
    <div ref={root} className="relative" data-lang-selector data-language-select={look} data-lang={chosen?.code ?? SYSTEM}>
      <button
        ref={button}
        type="button"
        className={`${BOX} ${look === 'compact' ? 'w-auto' : 'w-full'}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={label}
        title={label}
        onClick={() => (isOpen ? close() : openList())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openList(); return; }
          // typing goes to the search
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') { setQuery(e.key); openList(); }
        }}
      >
        <LanguageFlag lang={shownLang} />
        {look === 'compact'
          ? <span className="shrink-0 text-meta font-semibold tracking-[0.08em]" data-lang-code>{shownLang.label}</span>
          : <span className="min-w-0 flex-1 truncate text-meta text-fg-dim" lang={chosen?.code} dir="auto" data-lang-name>{chosen ? chosen.own : tr('System language')}</span>}
        <Icon name="chevron-down" size={16} className={`shrink-0 text-fg-muted transition-transform duration-state ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && createPortal(
        <div
          ref={pop}
          style={pos.style}
          className="z-[100] overflow-hidden rounded-lg border border-line bg-bg-card shadow-[0_12px_32px_rgb(0_0_0/.35)]"
          onKeyDown={onKey}
          data-lang-list
        >
          <div className="border-b border-line p-2">
            <input
              ref={input}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tr('Search languages')}
              aria-label={tr('Search languages')}
              aria-controls={listId}
              aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
              className="h-8 w-full rounded-md border border-line bg-bg px-2.5 text-meta text-fg placeholder:text-fg-muted focus:border-accent/60 focus:outline-none"
              data-lang-search
              data-language-search
            />
          </div>
          <ul id={listId} role="listbox" aria-label={tr('Languages')} style={{ maxHeight: pos.listMax }} className="overflow-y-auto py-1">
            {items.length === 0 && <li className="px-3 py-2 text-meta text-fg-muted" data-lang-empty>{tr('No language found')}</li>}
            {items.map((it, i) => {
              const selected = it.system ? value === SYSTEM : it.code === value;
              return (
                <li
                  key={it.system ? 'system' : it.code}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={selected}
                  className={`flex h-9 cursor-pointer items-center gap-[10px] px-3 transition-colors duration-press ${i === active ? 'bg-bg-hover' : ''} ${it.system ? 'border-b border-line' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(it)}
                  data-lang-option={it.code}
                  data-language-option={it.system ? 'system' : it.code}
                >
                  <LanguageFlag lang={it.lang} />
                  {it.system ? (
                    <>
                      <span className="min-w-0 flex-1 truncate text-meta text-fg">{tr('System language')}</span>
                      <span className="shrink-0 truncate text-label text-fg-muted" lang={it.lang.code} dir="auto">{it.lang.own}</span>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 truncate text-meta text-fg" lang={it.lang.code} dir={it.lang.rtl ? 'rtl' : 'ltr'}>{it.lang.own}</span>
                      <span className="min-w-0 flex-1 truncate text-label text-fg-muted">{it.lang.english}</span>
                      <span className="w-9 shrink-0 text-end text-label font-semibold tracking-[0.08em] text-fg-dim">{it.lang.label}</span>
                    </>
                  )}
                  <span className="grid w-4 shrink-0 place-items-center">{selected && <Icon name="check" size={16} className="text-accent-ink" />}</span>
                </li>
              );
            })}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  );
}

/** The earlier name (B2). */
export const LanguageSelector = LanguageSelect;
