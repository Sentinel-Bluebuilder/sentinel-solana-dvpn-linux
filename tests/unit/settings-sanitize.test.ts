// ─── Every AppSettings key goes through sanitize(): a good non-default value is kept, a bad one falls back ───
// The key list is DEFAULT_SETTINGS itself, so a new setting with no case here fails the first test,
// and a key dropped from sanitize() fails its "kept" case (the value never gets in).
import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, type AppSettings } from '../../src/shared/types';
import { sanitize } from '../../src/main/system/settings';
import { GB_OPTIONS, HOUR_OPTIONS } from '../../src/core/pricing/cost';
import { POLL_JOBS, POLL_JOB_NAMES } from '../../src/shared/poll';
import { findLanguage } from '../../src/shared/i18n/languages';

type Key = keyof AppSettings;
type Input = Partial<Record<Key, unknown>>;
interface Case { good: Input; bad: Input }

const flip = (k: Key): Case => ({ good: { [k]: !DEFAULT_SETTINGS[k] }, bad: { [k]: 'yes' } });
const job = POLL_JOB_NAMES[0];
const jobGood = POLL_JOBS[job].def === POLL_JOBS[job].min ? POLL_JOBS[job].max : POLL_JOBS[job].min;
const PIN = `sha256//${'A'.repeat(43)}=`;
const speed: Case = {
  good: { speedOrigin: 'https://speed.example.com', speedPin: PIN },
  bad: { speedOrigin: 'ftp://speed.example.com', speedPin: PIN },
};

const CASES: Record<Key, Case> = {
  rpcUrls: { good: { rpcUrls: ['https://rpc.example.com'] }, bad: { rpcUrls: ['javascript:alert(1)'] } },
  defaultBasis: { good: { defaultBasis: DEFAULT_SETTINGS.defaultBasis === 'per_gb' ? 'per_hour' : 'per_gb' }, bad: { defaultBasis: 'per_year' } },
  defaultGb: { good: { defaultGb: GB_OPTIONS.find((n) => n !== DEFAULT_SETTINGS.defaultGb) }, bad: { defaultGb: 7777 } },
  defaultHours: { good: { defaultHours: HOUR_OPTIONS.find((n) => n !== DEFAULT_SETTINGS.defaultHours) }, bad: { defaultHours: 7777 } },
  preferredCountry: { good: { preferredCountry: 'DE' }, bad: { preferredCountry: 'de1' } },
  autoConnect: flip('autoConnect'),
  autoTopUpDevice: flip('autoTopUpDevice'),
  autoDevicePermission: flip('autoDevicePermission'),
  startWithOs: flip('startWithOs'),
  closeToTray: flip('closeToTray'),
  thirdPartyChecks: flip('thirdPartyChecks'),
  notifications: flip('notifications'),
  proxyOnConnect: flip('proxyOnConnect'),
  theme: { good: { theme: DEFAULT_SETTINGS.theme === 'light' ? 'dark' : 'light' }, bad: { theme: 'blue' } },
  language: { good: { language: 'es' }, bad: { language: 'not-a-language' } },
  favourites: { good: { favourites: ['1'.repeat(32)] }, bad: { favourites: 'everything' } },
  allowanceTdvpn: { good: { allowanceTdvpn: '75' }, bad: { allowanceTdvpn: '-1' } },
  poll: { good: { poll: { [job]: jobGood } }, bad: { poll: { [job]: 'often' } } },
  speedOrigin: speed,
  speedPin: speed,
};

const KEYS = Object.keys(DEFAULT_SETTINGS) as Key[];

describe('sanitize() covers every setting', () => {
  it('every key of DEFAULT_SETTINGS has a case here, and no case is for a key that is gone', () => {
    expect(Object.keys(CASES).sort()).toEqual([...KEYS].sort());
  });
  it('the good values are not the defaults (else "kept" proves nothing)', () => {
    expect(findLanguage('es')?.code).toBe('es');
    for (const k of KEYS) expect(CASES[k].good[k], k).not.toEqual(DEFAULT_SETTINGS[k]);
  });
  for (const k of KEYS) {
    it(`${k}: a good non-default value is kept`, () => {
      const v = CASES[k].good[k];
      const out = sanitize(CASES[k].good)[k];
      if (k === 'poll') expect(out).toMatchObject(v as object);
      else expect(out).toEqual(v);
    });
    it(`${k}: a bad value falls back to the default`, () => {
      expect(sanitize(CASES[k].bad)[k]).toEqual(DEFAULT_SETTINGS[k]);
    });
  }
});
