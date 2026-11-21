// ─── i18n: the language setting (app settings `language`) ───
// '' follows the system; a known code is kept even when that language is switched off (it still
// loads); the long-text test language is allowed; anything else keeps what was stored.
import { describe, expect, it } from 'vitest';
import { sanitize } from '../../src/main/system/settings';
import { DEFAULT_SETTINGS } from '../../src/shared/types';

describe('i18n: the language setting', () => {
  it('defaults to the system language', () => {
    expect(DEFAULT_SETTINGS.language).toBe('');
    expect(sanitize({}).language).toBe('');
  });

  it('keeps a known code, written our way, even a switched-off one', () => {
    expect(sanitize({ language: 'fa' }).language).toBe('fa');
    expect(sanitize({ language: 'ZH-hans' }).language).toBe('zh-Hans');
    expect(sanitize({ language: 'en' }).language).toBe('en');
    expect(sanitize({ language: 'en-XL' }).language).toBe('en-XL');
  });

  it('refuses anything else and keeps what was stored', () => {
    const base = { ...DEFAULT_SETTINGS, language: 'de' };
    expect(sanitize({ language: 'xx' }, base).language).toBe('de');
    expect(sanitize({ language: 42 }, base).language).toBe('de');
    expect(sanitize({ language: '../../etc' }, base).language).toBe('de');
    expect(sanitize({ language: '' }, base).language).toBe('');
  });
});
