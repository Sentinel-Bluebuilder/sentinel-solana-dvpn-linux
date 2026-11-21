// ─── The app's language in the main process (B5) ───
// Main writes sentences too (connect errors, toasts, tray menu), so it runs in the same language as the screens.
// It decides which one: the saved choice, else the system's languages, else English (resolveLanguage). The
// screens follow snapshot().language, so both processes always show one language.
// A change in Settings applies at once: the state is sent again and the tray menu rebuilt in the new language.
// A sentence already stored in the state (the last error, a close message) keeps the language it was written in
// until it is next replaced.
import { resolveLanguage, onLanguageChange } from '../shared/i18n';
// Not through the i18n index: the CLI imports that, and must not carry the language files.
import { applyLanguage } from '../shared/i18n/catalogs';
import { getSettings, onSettingsChanged } from './system/settings';
import { patch } from './app-state';
import { log } from './logger';

let saved: string | null = null;

async function use(systemLanguages: readonly string[]): Promise<void> {
  saved = getSettings().language;
  const want = resolveLanguage(saved, systemLanguages);
  const code = await applyLanguage(want);
  if (code !== want) log.warn('language files did not load; English instead', { want });
  log.info('language', { code, saved: saved || 'system' });
  patch({ language: code });
}

/** Call once at start, before the window opens. `onChange` runs after every switch (the tray rebuild). */
export async function startLanguage(systemLanguages: readonly string[], onChange: () => void = () => {}): Promise<void> {
  onLanguageChange(() => {
    try { onChange(); } catch (err) { log.warn('language: redraw after a switch failed', { err: (err as Error).message }); }
  });
  await use(systemLanguages);
  onSettingsChanged((s) => {
    if (s.language === saved) return;
    use(systemLanguages).catch((err: unknown) => log.error('language switch failed', { err: (err as Error)?.message ?? String(err) }));
  });
}
