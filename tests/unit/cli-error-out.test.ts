// ─── E-66 (macOS rc.3): a key store that throws prints one plain line, never "fatal: <stack>" ───
// `status` over SSH with the login Keychain locked threw outside the command's try (the daemon link start, or a promise
// nobody awaited), so index.ts printed the raw stack. All three paths now go through errorOutput().
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { errorOutput } from '../../src/cli/error-out';

// the macOS app's keyringError sentence for exit 36 (errSecInteractionNotAllowed), as the Mac key store throws it.
const LOCKED = 'The login Keychain is locked in this session (for example an SSH login). Unlock it (security unlock-keychain), or use a key file: --keyfile <path> or DVPN_KEYFILE.';
const thrown = (): Error => { const e = new Error(LOCKED); e.stack = `Error: ${LOCKED}\n    at load (keystore.ts:89:13)\n    at ownerKeypair (vault.ts:20:5)`; return e; };

describe('E-66: errors outside the command are one plain line', () => {
  it('text: "Error: <sentence>", no stack frames', () => {
    const o = errorOutput(thrown(), false, 'status');
    expect(o.stream).toBe('stderr');
    expect(o.text).toBe(`Error: ${LOCKED}\n`);
    expect(o.text).not.toMatch(/\bat \w+ \(|keystore\.ts|fatal/);
  });
  it('--json: one { ok:false } object on stdout, no stack', () => {
    const o = errorOutput(thrown(), true, 'status');
    expect(o.stream).toBe('stdout');
    expect(JSON.parse(o.text)).toEqual({ ok: false, error: LOCKED, code: null, action: null, next: null }); // R3 gap 6: next = action on every failure
  });
  it('a non-Error rejection still prints a line', () => {
    expect(errorOutput('boom', false, 'status').text).toBe('Error: boom\n');
  });
  it('index.ts: the daemon link start is inside the try; stray rejections and the top level use the same output', () => {
    const src = fs.readFileSync('src/cli/index.ts', 'utf8');
    const tryAt = src.indexOf('  try {\n    if (cmd.needsDaemon) {');
    expect(tryAt).toBeGreaterThan(0);
    expect(src.indexOf('startDaemonLink();')).toBeGreaterThan(tryAt);
    expect(src).toContain("process.on('unhandledRejection'");
    expect(src).not.toContain('fatal: ${(err as Error).stack}');
    expect((src.match(/writeError\(err, /g) ?? []).length).toBe(3);
  });
  it('negative control: a service error still becomes its plain copy (the old path is kept)', () => {
    const o = errorOutput(new Error('14 UNAVAILABLE: No connection established'), true, 'status');
    expect(JSON.parse(o.text).code).not.toBeNull();
  });
});

describe('rc.8 (the agent kit T-A 14, T-C 18): usage errors with --json are one { ok:false } object on stdout', () => {
  it('--json: code usage, the usage line, a runnable next, nothing sent', async () => {
    const { usageOutput } = await import('../../src/cli/error-out');
    const o = usageOutput('--units must be a whole number from 1 to 1000', true, 'agent up [--units N]');
    expect(o.stream).toBe('stdout');
    const j = JSON.parse(o.text);
    expect(j).toMatchObject({ ok: false, code: 'usage', error: '--units must be a whole number from 1 to 1000', usage: 'agent up [--units N]', next: 'devnet-dvpn help', action: 'devnet-dvpn help', money: 'Nothing was sent or signed.' });
    expect(j.docUrl).toMatch(/CODES\.md#code-usage$/);
    expect(o.text.endsWith('\n')).toBe(true);
    expect(o.text.split('\n').length).toBe(2);
  });
  it('an unknown command has no usage line (null), still a next', async () => {
    const { usageOutput } = await import('../../src/cli/error-out');
    const j = JSON.parse(usageOutput('unknown command: bogus', true, null).text);
    expect(j).toMatchObject({ ok: false, code: 'usage', usage: null, next: 'devnet-dvpn help' });
  });
  it('text mode is unchanged: the message on stderr (negative control)', async () => {
    const { usageOutput } = await import('../../src/cli/error-out');
    expect(usageOutput('bad', false, 'x')).toEqual({ stream: 'stderr', text: 'bad\n' });
  });
  it('index.ts routes all three exit-3 paths through usageOutput', () => {
    const src = fs.readFileSync('src/cli/index.ts', 'utf8');
    expect(src.match(/writeUsage\(/g)?.length).toBeGreaterThanOrEqual(4); // the helper + 3 call sites
    expect(src).not.toMatch(/UsageError\) \{ process\.stderr\.write/);
  });
});
