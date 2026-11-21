// ─── i18n entry point: import from here, never from the files inside ───
export { tr, trPlural, setLanguage, currentLanguage, onLanguageChange, formatNumber, formatDate, formatList, intlLocale, keyOf, pluralKeyOf, fill, FSI, PDI } from './tr';
export type { Vars, PluralForms, Entry, Catalog } from './tr';
export { LANGUAGES, LOGICAL_LAYOUT, LONG_TEXT_CODE, DEFAULT_LANGUAGE, findLanguage, isSelectable, selectableLanguages, direction, documentMarks, resolveLanguage, matchSystem, searchLanguages } from './languages';
export type { Language } from './languages';
export { longText, skippedTr, LONG_TEXT_FACTOR } from './long-text';
export { ShownError, shownMessage } from './shown-error';
export { said, saidPlural, isSaid, showSaid, saidEnglish } from './said';
export type { Said } from './said';
