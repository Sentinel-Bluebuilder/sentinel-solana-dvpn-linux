// ─── Loading a language's files (B5): the app's main process and its screens, never the CLI ───
// Each language is three files, locales/<code>/{screens,core,main}.json, the same chunks as English. They load
// on demand (one bundle piece per file), so a person only ever downloads the language they use. English needs
// no file: the English sentence is the key. The CLI does not import this module; it stays English.
import { setLanguage, type Catalog } from './tr';
import { DEFAULT_LANGUAGE, LONG_TEXT_CODE, findLanguage } from './languages';

const FILES = import.meta.glob<Catalog>('./locales/*/*.json', { import: 'default' });

/** The merged catalogue of one language; null for English, the long-text test language or an unknown code. */
export async function loadCatalog(code: string): Promise<Catalog | null> {
  if (code === DEFAULT_LANGUAGE || code === LONG_TEXT_CODE || !findLanguage(code)) return null;
  const own = Object.entries(FILES).filter(([file]) => file.startsWith(`./locales/${code}/`));
  if (!own.length) return null;
  const parts = await Promise.all(own.map(([, load]) => load()));
  return Object.assign({}, ...parts) as Catalog;
}

let ticket = 0;

/**
 * Load a language and switch to it. A file that does not load leaves English on, logged, never a broken screen.
 * Two choices in quick succession: the last one wins, whatever order the files arrive in.
 * Returns the code actually in use afterwards.
 */
export async function applyLanguage(code: string): Promise<string> {
  const mine = ++ticket;
  let use = code;
  let cat: Catalog | null = null;
  try {
    cat = await loadCatalog(code);
  } catch (err) {
    console.error('[i18n] language files did not load; English instead', { code, err });
    use = DEFAULT_LANGUAGE;
  }
  if (mine !== ticket) return use;
  setLanguage(use, cat);
  return use;
}
