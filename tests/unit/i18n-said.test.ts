// ─── Saved text: a stored sentence follows a language switch ───
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { said, saidPlural, showSaid, saidEnglish, isSaid, setLanguage, pluralKeyOf } from '../../src/shared/i18n';
import { scanFile } from '../../scripts/i18n-extract.mjs';

afterEach(() => setLanguage('en'));

describe('said / showSaid', () => {
  it('a stored sentence is shown in the language in use when shown, not when stored', () => {
    const s = said('Paying deposit {amount}…', { amount: '1.5 tDVPN' });
    expect(showSaid(s)).toBe('Paying deposit 1.5 tDVPN…');
    setLanguage('es', { 'Paying deposit {amount}…': 'Pagando el depósito {amount}…' });
    expect(showSaid(s)).toBe('Pagando el depósito 1.5 tDVPN…');
    expect(saidEnglish(s)).toBe('Paying deposit 1.5 tDVPN…'); // logs and the CLI keep English
  });

  it('survives JSON (IPC, files), bigint values included', () => {
    const s = JSON.parse(JSON.stringify(said('{n} lamports', { n: 5_000_000n }))) as unknown;
    expect(isSaid(s)).toBe(true);
    expect(showSaid(s as never)).toBe('5000000 lamports');
  });

  it('plurals choose their form at show time, by the language then in use', () => {
    const s = saidPlural({ one: '{count} refund started.', other: '{count} refunds started.' }, 1, { count: 1 });
    expect(showSaid(s)).toBe('1 refund started.');
    expect(saidEnglish(s)).toBe('1 refund started.');
    setLanguage('ru', { [pluralKeyOf('{count} refunds started.')]: { one: '{count} возврат начат.', few: '{count} возврата начато.', many: '{count} возвратов начато.', other: '{count} возврата начато.' } });
    expect(showSaid(s)).toBe('1 возврат начат.');
  });

  it('a plain string (older state, logs) is shown as it is', () => {
    expect(showSaid('Disconnected.')).toBe('Disconnected.');
    expect(showSaid(null)).toBe('');
    expect(isSaid('x')).toBe(false);
  });
});

describe('the extractor reads said() like tr()', () => {
  it('said and saidPlural give keys; a template string is refused', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'said-'));
    const file = path.join(dir, 'x.ts');
    fs.writeFileSync(file, "said('Kept for later.'); saidPlural({ one: '{count} kept.', other: '{count} kept.' }, n, { count: n }); said(`no ${x}`);");
    const r = scanFile(file);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(r.keys.map((k: { key: string }) => k.key)).toEqual(['Kept for later.', pluralKeyOf('{count} kept.')]);
    expect(r.errors).toHaveLength(1);
  });
});
