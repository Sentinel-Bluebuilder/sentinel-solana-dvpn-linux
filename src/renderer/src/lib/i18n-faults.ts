// ─── i18n page faults: what the picture run flags by script (plan B7) ───
// Run inside a rendered screen. Lists text that is clipped, cut with an ellipsis it was not meant to
// have, or spills out of the window, and (in the long-text language en-XL) text that did not pass
// through tr(): en-XL accents every vowel, so a word with a plain a/e/i/o/u skipped tr().
// Pictures are then looked at only where this flags something.
// Truncation is allowed where the full text is one hover away (title / aria-label on the element or
// a parent) or the element carries data-truncates (names, addresses).

import { LONG_TEXT_CODE, skippedTr } from '../../../shared/i18n';
import type { Fault, ScreenFaults } from '../../../shared/i18n/faults';

export type { Fault, FaultKind, ScreenFaults } from '../../../shared/i18n/faults';

function describe(el: Element): string {
  const hook = [...el.attributes].find((a) => a.name.startsWith('data-') && a.name !== 'data-theme');
  const id = el.id ? `#${el.id}` : '';
  const parent = el.closest('[data-screen],[data-sidebar-session],[role="dialog"],[data-toast],[data-tip]');
  const ctx = parent && parent !== el ? `${parent.tagName.toLowerCase()}[${[...parent.attributes].find((a) => a.name.startsWith('data-') || a.name === 'role')?.name ?? ''}] > ` : '';
  return `${ctx}${el.tagName.toLowerCase()}${id}${hook ? `[${hook.name}${hook.value ? `=${hook.value}` : ''}]` : ''}`;
}

function visible(el: HTMLElement): boolean {
  const s = getComputedStyle(el);
  if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function hoverText(el: Element): boolean {
  for (let p: Element | null = el; p; p = p.parentElement) {
    if (p.hasAttribute('data-truncates') || p.getAttribute('title') || p.getAttribute('aria-label')) return true;
    if (p.hasAttribute('data-screen')) break;
  }
  return false;
}

/** Faults in `root` (the window's document by default). `longText` = the screen is in en-XL. */
export function pageFaults(screen: string, lang: string, root: ParentNode = document, longText = lang === LONG_TEXT_CODE): ScreenFaults {
  const faults: Fault[] = [];
  let shown = 0;
  let translated = 0;
  const seen = new Set<Element>();
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
    const el = n.parentElement;
    if (!text || !el || !/\p{L}/u.test(text)) continue;
    if (el.closest('script,style,code,pre,kbd,samp,[data-i18n-skip],[aria-hidden="true"]')) continue;
    if (!visible(el)) continue;
    shown++;
    if (longText) {
      const missed = skippedTr(text);
      if (missed.length) faults.push({ kind: 'untranslated', text, where: describe(el), detail: missed.join(' ') });
      else translated++;
    }
    if (seen.has(el)) continue;
    seen.add(el);
    const s = getComputedStyle(el);
    const over = el.scrollWidth > el.clientWidth + 1;
    const overY = el.scrollHeight > el.clientHeight + 1 && /hidden|clip/.test(s.overflowY) && !/auto|scroll/.test(s.overflowY);
    if (s.textOverflow === 'ellipsis' && over && !hoverText(el)) faults.push({ kind: 'ellipsis', text, where: describe(el) });
    else if ((over && /hidden|clip/.test(s.overflowX)) || overY || (s.webkitLineClamp && s.webkitLineClamp !== 'none' && overY)) faults.push({ kind: 'clipped', text, where: describe(el), detail: `${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight}` });
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth + 1 || r.left < -1 || r.bottom > window.innerHeight + 1 && s.position === 'fixed') faults.push({ kind: 'off-window', text, where: describe(el), detail: `${Math.round(r.left)}..${Math.round(r.right)} of ${window.innerWidth}` });
  }
  return { screen, lang, shown, translated: longText ? translated : shown, faults };
}

/** Lets the picture run (main/dev/ui-smoke.ts) ask the page for its faults: window.__i18nFaults(screenName). Read-only. */
export function exposeFaults(lang: () => string): void {
  (window as unknown as { __i18nFaults?: (screen: string) => ScreenFaults }).__i18nFaults = (screen: string) => pageFaults(screen, lang());
}

export { summariseFaults as summarise } from '../../../shared/i18n/faults';
