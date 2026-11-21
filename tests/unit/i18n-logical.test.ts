// ─── B4 converter: left/right classes → start/end, and nothing else ───
import { describe, expect, it } from 'vitest';
import { convert } from '../../scripts/i18n-logical.mjs';

describe('i18n-logical convert', () => {
  it('turns physical classes into logical ones, keeping variants and negatives', () => {
    const { out } = convert('<div className="ml-2 md:pr-4 -right-2 text-left border-l rounded-tr-lg hover:mr-auto" />');
    expect(out).toBe('<div className="ms-2 md:pe-4 -end-2 text-start border-s rounded-se-lg hover:me-auto" />');
  });

  it('reads arbitrary values and arbitrary variants (the first pass skipped these strings whole)', () => {
    const { out } = convert('<a className="min-[880px]:flex border-r shadow-[inset_0_1px_0_rgb(255_255_255/.05)] grid-cols-[84px_minmax(0,140px)] text-left hover:border-[#0156FC]/65" />');
    expect(out).toBe('<a className="min-[880px]:flex border-e shadow-[inset_0_1px_0_rgb(255_255_255/.05)] grid-cols-[84px_minmax(0,140px)] text-start hover:border-[#0156FC]/65" />');
  });

  it('works inside template literals and leaves the ${} parts alone', () => {
    const { out } = convert('const c = `text-right ${on ? "pl-2" : "pr-2"} px-3`;');
    expect(out).toBe('const c = `text-end ${on ? "ps-2" : "pe-2"} px-3`;');
  });

  it('negative controls: English text, tr() and translate-x centring stay as written', () => {
    const src = [
      'const a = "Turn left at the corner";',
      'const b = tr("ml-2");',
      'const c = "absolute left-1/2 -translate-x-1/2";',
      'const d = "left";',
    ].join('\n');
    const { out, kept } = convert(src);
    expect(out).toBe(src);
    expect(kept).toHaveLength(1);
  });
});
