// ─── Row 148: the speed origin setting is a pair (address + key pin): both well-formed, or both empty ───
import { describe, expect, it } from 'vitest';
import { parseSpeedOrigin, speedOriginProblems, storedSpeedOrigin } from '../../src/core/quality/speed-origin';
import { sanitize } from '../../src/main/system/settings';
import { DEFAULT_SETTINGS } from '../../src/shared/types';

const PIN = `sha256//${'A'.repeat(43)}=`;
const ORIGIN = 'https://speed.example.com:8443';

describe('speed origin setting', () => {
  it('both empty and both well-formed can be saved; the address loses a trailing slash', () => {
    expect(speedOriginProblems('', '')).toEqual({});
    expect(speedOriginProblems(`${ORIGIN}/`, PIN)).toEqual({});
    expect(storedSpeedOrigin(`${ORIGIN}/`, ` ${PIN} `)).toEqual({ origin: ORIGIN, pin: PIN });
    expect(storedSpeedOrigin('', '')).toEqual({ origin: '', pin: '' });
  });

  it('each wrong field is named on its own', () => {
    expect(Object.keys(speedOriginProblems(ORIGIN, ''))).toEqual(['pin']);
    expect(Object.keys(speedOriginProblems('', PIN))).toEqual(['origin']);
    expect(Object.keys(speedOriginProblems('http://speed.example.com', PIN))).toEqual(['origin']);
    expect(Object.keys(speedOriginProblems(`${ORIGIN}/path`, PIN))).toEqual(['origin']);
    expect(Object.keys(speedOriginProblems(ORIGIN, 'sha256//short'))).toEqual(['pin']);
    expect(Object.keys(speedOriginProblems('nonsense', 'nonsense'))).toEqual(['origin', 'pin']);
  });

  it('the settings file never holds half a pair or a malformed one', () => {
    const set = sanitize({ speedOrigin: ORIGIN, speedPin: PIN });
    expect([set.speedOrigin, set.speedPin]).toEqual([ORIGIN, PIN]);
    for (const bad of [{ speedOrigin: 'http://x' }, { speedPin: 'abc' }, { speedOrigin: '' }, { speedPin: '' }, { speedOrigin: 5 as unknown as string }]) {
      const kept = sanitize(bad, set);
      expect([kept.speedOrigin, kept.speedPin]).toEqual([ORIGIN, PIN]);
    }
    const cleared = sanitize({ speedOrigin: '', speedPin: '' }, set);
    expect([cleared.speedOrigin, cleared.speedPin]).toEqual(['', '']);
    expect([DEFAULT_SETTINGS.speedOrigin, DEFAULT_SETTINGS.speedPin]).toEqual(['', '']);
    expect(sanitize({ theme: 'dark' }, set).speedOrigin).toBe(ORIGIN); // an unrelated change leaves it alone
  });

  it('what is stored is what the test service accepts', () => {
    expect(parseSpeedOrigin(ORIGIN, PIN)).toEqual({ origin: ORIGIN, pin: PIN });
    expect(parseSpeedOrigin('', '')).toBeNull();
  });
});
