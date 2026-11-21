// ─── The REAL confirm() / NeedsConfirm (agent-cmd.test.ts mocks its own copy): --yes passes, else exit-2 line + throw ───
import { describe, it, expect } from 'vitest';

const { confirm, NeedsConfirm } = await import('../../src/cli/commands');
const { parseArgs } = await import('../../src/cli/args');

const out = (): { json: boolean; lines: { h: string; d?: unknown }[]; print: (h: string, d?: unknown) => void } => {
  const lines: { h: string; d?: unknown }[] = [];
  return { json: true, lines, print: (h, d) => { lines.push({ h, d }); } };
};

describe('confirm()', () => {
  it('--yes: returns and prints nothing', () => {
    const o = out();
    expect(() => confirm(parseArgs(['agent', 'up', '--yes']), o, 'Connect to NodeA.', { node: 'NodeA' })).not.toThrow();
    expect(o.lines).toEqual([]);
  });
  it('-y works like --yes', () => {
    const o = out();
    expect(() => confirm(parseArgs(['agent', 'down', '-y']), o, 'Close.')).not.toThrow();
  });
  it('no --yes: prints {needsConfirm, what, ...data} and throws NeedsConfirm (index.ts maps it to exit 2)', () => {
    const o = out();
    expect(() => confirm(parseArgs(['agent', 'up']), o, 'Connect to NodeA.', { node: 'NodeA', switchFrom: null })).toThrow(NeedsConfirm);
    expect(o.lines).toHaveLength(1);
    expect(o.lines[0].d).toEqual({ needsConfirm: true, what: 'Connect to NodeA.', node: 'NodeA', switchFrom: null });
    expect(o.lines[0].h).toBe('Connect to NodeA.\nRe-run with --yes to do it.');
  });
});
