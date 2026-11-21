// ─── B5 step 2a: values isolated in right-to-left sentences; English stays the default ───
import { afterEach, describe, expect, it } from 'vitest';
import { FSI, PDI, LANGUAGES, ShownError, resolveLanguage, selectableLanguages, setLanguage, tr, trPlural } from '../../src/shared/i18n';

afterEach(() => setLanguage('en'));

describe('FSI…PDI around values', () => {
  it('a right-to-left language isolates every value, in tr and trPlural', () => {
    setLanguage('fa', { 'Sent {amount} to {address}.': 'ارسال {amount} به {address}.' });
    expect(tr('Sent {amount} to {address}.', { amount: '1.5 tDVPN', address: '9enW…x4Qa' })).toBe(`ارسال ${FSI}1.5 tDVPN${PDI} به ${FSI}9enW…x4Qa${PDI}.`);
    expect(trPlural({ one: '{count} server', other: '{count} servers' }, 3, { count: 3 })).toBe(`${FSI}3${PDI} servers`);
  });

  it('negative controls: English, a left-to-right language, a sentence without values', () => {
    expect(tr('Sent {amount}.', { amount: '2 tDVPN' })).toBe('Sent 2 tDVPN.');
    setLanguage('es', {});
    expect(tr('Sent {amount}.', { amount: '2 tDVPN' })).toBe('Sent 2 tDVPN.');
    setLanguage('ar', {});
    expect(tr('Nothing to refund.')).toBe('Nothing to refund.');
  });

  it("an error's English .message never carries the marks; what it shows does", () => {
    setLanguage('ar', {});
    const err = new ShownError('"{address}" is not a server address.', { address: 'abc' });
    expect(err.message).toBe('"abc" is not a server address.');
    expect(err.shown()).toBe(`"${FSI}abc${PDI}" is not a server address.`);
  });
});

// rc.4: 15 translated left-to-right languages are on (Bengali and Telugu are translated but switched off by the
// owner for now); the five right-to-left ones wait for LOGICAL_LAYOUT.
const ON = ['en', 'zh-Hans', 'zh-Hant', 'es', 'fr', 'pt', 'ru', 'de', 'ko', 'hi', 'ta', 'id', 'ms', 'fil', 'th', 'kmr'];
const RTL_OFF = ['ur', 'ar', 'fa', 'ps', 'ckb'];

describe('which languages a first start can land in (rc.4)', () => {
  it('exactly the 15 switched-on left-to-right languages plus English are on', () => {
    expect(LANGUAGES.filter((l) => l.enabled).map((l) => l.code).sort()).toEqual([...ON].sort());
    expect(selectableLanguages().map((l) => l.code).sort()).toEqual([...ON].sort());
  });
  it('system language German: the app starts in German, the selector shows, English is in it', () => {
    expect(resolveLanguage('', ['de-DE', 'en-US'])).toBe('de');
    const listed = selectableLanguages().map((l) => l.code);
    expect(listed.length).toBeGreaterThan(1); // the selector is shown only when more than one language is selectable
    expect(listed).toContain('en'); // English one choice away
    expect(resolveLanguage('en', ['de-DE'])).toBe('en'); // once chosen, English is kept over the system language
  });
  it('system language Arabic (and the other right-to-left four): English', () => {
    expect(resolveLanguage('', ['ar-SA'])).toBe('en');
    for (const c of RTL_OFF) expect(resolveLanguage('', [c]), c).toBe('en');
    expect(resolveLanguage('ar', ['ar-SA'])).toBe('en'); // even when saved
  });
  it('every language that is not on resolves to English', () => {
    for (const l of LANGUAGES.filter((x) => !ON.includes(x.code))) {
      expect(resolveLanguage('', [l.code]), l.code).toBe('en');
      expect(resolveLanguage(null, [`${l.code}-XX`, 'en-US']), l.code).toBe('en');
    }
    expect(resolveLanguage('', ['zh-CN', 'pt-BR', 'tl-PH', 'ku'])).toBe('zh-Hans');
    expect(resolveLanguage('', ['fa-IR', 'ku-IQ', 'ja-JP'])).toBe('en');
  });
});
