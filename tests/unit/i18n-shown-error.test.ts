// ─── Thrown errors a person reads (plan B3): English in .message, the chosen language where shown ───
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { SHOWN_ERROR_CLASSES, scanFile } from '../../scripts/i18n-extract.mjs';
import { ShownError, setLanguage, shownMessage } from '../../src/shared/i18n';
import { AmountError, toBaseUnits } from '../../src/core/chain/amounts';
import { ConfigError, validateSplit } from '../../src/core/daemon/config';
import { ProviderError } from '../../src/core/plans/plans';
import { errorText } from '../../src/core/chain/errors';

afterEach(() => setLanguage('en'));

const KEY = '"{amount}" is not a tDVPN amount. Use a number like 2.5.';

describe('ShownError', () => {
  it('every class the extractor reads as a sentence extends ShownError', () => {
    const classes: Record<string, unknown> = { ShownError, AmountError, ConfigError, ProviderError };
    expect(Object.keys(classes).sort()).toEqual([...SHOWN_ERROR_CLASSES].sort());
    for (const c of Object.values(classes)) expect((c as { prototype: object }).prototype instanceof ShownError || c === ShownError).toBe(true);
  });

  it('.message stays English with the values filled in; .shown() follows the language', () => {
    let err: unknown;
    try { toBaseUnits('abc'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(AmountError);
    expect((err as AmountError).code).toBe('invalid-amount');
    expect((err as Error).message).toBe('"abc" is not a tDVPN amount. Use a number like 2.5.');
    setLanguage('xx', { [KEY]: '«{amount}» no es una cantidad de tDVPN.' });
    expect((err as Error).message).toBe('"abc" is not a tDVPN amount. Use a number like 2.5.');
    expect(shownMessage(err)).toBe('«abc» no es una cantidad de tDVPN.');
    expect(errorText(err)).toBe('«abc» no es una cantidad de tDVPN.');
  });

  it('negative control: a plain Error is shown as its message, a missing message as the fallback', () => {
    setLanguage('xx', { boom: 'BOOM' });
    expect(shownMessage(new Error('boom'))).toBe('boom');
    expect(shownMessage(new Error(''), 'fallback')).toBe('fallback');
    expect(shownMessage(null, 'fallback')).toBe('fallback');
  });

  it('a subclass keeps its code and its own name', () => {
    expect(() => validateSplit({ mode: 'include', apps: [], routes: [] }, 'win32')).toThrow(ConfigError);
    const p = new ProviderError('Provider did not answer (HTTP {status})', { status: 502 }, 'provider-unreachable');
    expect(p.code).toBe('provider-unreachable');
    expect(p.name).toBe('ProviderError');
    expect(p.message).toBe('Provider did not answer (HTTP 502)');
  });

  it('the extractor reads new ShownError(…) and its subclasses as sentences (positive control)', () => {
    const keys = scanFile('src/core/chain/amounts.ts').keys.map((k: { key: string }) => k.key);
    expect(keys).toContain(KEY);
  });

  it('the edges show the translated sentence', () => {
    expect(readFileSync('src/main/ipc.ts', 'utf8')).toContain("error: shownMessage(err, tr('Something went wrong.'))");
    expect(readFileSync('src/core/chain/errors.ts', 'utf8')).toContain('if (err instanceof ShownError) return err.shown();');
    expect(readFileSync('src/renderer/src/screens/SplitTunnel.tsx', 'utf8')).toContain('invalid = shownMessage(err);');
  });
});
