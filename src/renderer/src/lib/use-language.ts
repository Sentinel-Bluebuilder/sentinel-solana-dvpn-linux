// ─── The screens' language (B5): the one main runs in, from snapshot().language ───
// Loads that language's files, then marks the page: <html lang> for fonts, hyphenation and screen readers,
// <html dir> for right to left (only once the start/end layout allows it, languages.ts direction()).
import { useEffect, useState } from 'react';
import { currentLanguage, documentMarks } from '../../../shared/i18n';
import { applyLanguage } from '../../../shared/i18n/catalogs';

function applyDocument(code: string): void {
  const { lang, dir } = documentMarks(code);
  document.documentElement.lang = lang;
  document.documentElement.dir = dir;
}

/** The language in use now; re-renders once a new one is loaded. `code` absent = keep the current one. */
export function useLanguage(code: string | undefined): string {
  const [shown, setShown] = useState(currentLanguage);
  useEffect(() => {
    if (!code || code === currentLanguage()) {
      applyDocument(currentLanguage());
      return undefined;
    }
    let live = true;
    applyLanguage(code).then((used) => {
      if (!live) return;
      applyDocument(used);
      setShown(used);
    }, (err: unknown) => console.error('[i18n] language not applied', { code, err }));
    return () => { live = false; };
  }, [code]);
  return shown;
}
