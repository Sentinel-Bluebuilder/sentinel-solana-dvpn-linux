// ─── P8 English review (hub docs/ENGLISH-REVIEW.md): every failure says whether money moved; one term per idea ───
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { CONNECT_CODES, PREFLIGHT_CODES } from '../../src/core/session/state';
import { moneyOf, moneyNote, MONEY_CODES, PARSE_CODES } from '../../src/cli/money-note';
import { toBaseUnits } from '../../src/core/chain/amounts';
import { errorOutput } from '../../src/cli/error-out';
import { cliMessage } from '../../src/cli/action-hint';

const root = path.resolve(__dirname, '../..');
const doc = fs.readFileSync(path.join(root, 'docs/AGENT-COMMANDS.md'), 'utf8');
const failures = doc.slice(doc.indexOf('## Failure codes'));
const fail = (code: string | null, msg = 'x'): Error => Object.assign(new Error(msg), code ? { code } : {});

describe('money-note: the class of every failure code', () => {
  it('classifies every code connect() can answer, except the ones that say nothing', () => {
    // `unknown`, `rpc-busy`, `rpc-unavailable` and `rpc-ws` (the network answer carries no word on payment) are unclear on purpose.
    const unclassified = CONNECT_CODES.filter((c) => moneyOf(c) === 'unclear' && !['unknown', 'rpc-busy', 'rpc-unavailable', 'rpc-ws'].includes(c));
    expect(unclassified).toEqual([]);
  });
  it('the check before paying is always "Nothing was paid."', () => {
    for (const c of PREFLIGHT_CODES) expect(moneyNote(c)).toBe('Nothing was paid.');
  });
  it('a failure after the start asked of the service says a deposit may be open and names the command', () => {
    for (const c of ['node-error', 'tunnel-failed', 'timeout', 'ticket_invalid', 'rate_limited', 'rpc-timeout', 'node-refused', 'server-stopped', 'stop-failed']) {
      expect(moneyOf(c)).toBe('open');
      expect(moneyNote(c)).toMatch(/^A deposit may be open: \S+ agent down --yes closes it and refunds the unused part\.$/);
    }
  });
  it('negative controls: a code nobody classified is never "nothing was paid"; a refund failure keeps the money held', () => {
    expect(moneyOf('brand-new-code')).toBe('unclear');
    expect(moneyNote('brand-new-code')).toMatch(/not known whether a deposit/);
    expect(moneyNote(undefined)).toMatch(/not known whether a deposit/);
    expect(moneyNote('settle-failed')).toMatch(/still held: \S+ settle run --yes returns it\./);
  });
  it('no code is in two classes', () => {
    expect(new Set(MONEY_CODES).size).toBe(MONEY_CODES.length);
  });
});

describe('W-A1 (rc.8): a value the command could not read moved no money', () => {
  const thrown = (amount: string): unknown => { try { toBaseUnits(amount); } catch (err) { return err; } return null; };
  it('device plan/setup --allowance 0.0000001 | -1 | abc: invalid-amount says "Nothing was sent or signed."', () => {
    for (const bad of ['0.0000001', '-1', 'abc']) {
      const err = thrown(bad);
      expect((err as { code?: string }).code).toBe('invalid-amount');
      const o = JSON.parse(errorOutput(err, true, 'device').text);
      expect(o).toMatchObject({ ok: false, code: 'invalid-amount', money: 'Nothing was sent or signed.' });
      expect(errorOutput(err, false, 'device').text).toMatch(/\nMoney: Nothing was sent or signed\.\n/);
    }
  });
  it('every parse/usage-class code is "none" for every command that can pay', () => {
    for (const c of PARSE_CODES) {
      expect(moneyOf(c)).toBe('none');
      for (const cmd of ['wallet', 'device', 'settle']) expect(moneyNote(c, cmd)).toBe('Nothing was sent or signed.');
      for (const cmd of ['agent', 'connect']) expect(moneyNote(c, cmd)).toBe('Nothing was paid.');
    }
  });
  it('negative control: a failed send after signing still says it is not known', () => {
    expect(moneyNote('send-failed', 'wallet')).toMatch(/^It is not known whether the transaction went through/);
  });
});

describe('errorOutput: money on the failure of a command that can pay', () => {
  it('--json: agent failure carries money', () => {
    const o = JSON.parse(errorOutput(fail('node-offline'), true, 'agent').text);
    expect(o).toMatchObject({ ok: false, code: 'node-offline', money: 'Nothing was paid.' });
    expect(JSON.parse(errorOutput(fail('tunnel-failed'), true, 'connect').text).money).toMatch(/^A deposit may be open/);
  });
  it('text: a Money: line before the hint', () => {
    const t = errorOutput(fail('no-wallet', 'No wallet.'), false, 'agent').text;
    expect(t).toBe('Error: No wallet.\nMoney: Nothing was paid.\n');
  });
  it('negative control: a read-only command prints no money line', () => {
    expect(JSON.parse(errorOutput(fail('no-wallet'), true, 'status').text).money).toBeUndefined();
    expect(errorOutput(fail('no-wallet'), false, 'nodes').text).not.toMatch(/Money:/);
  });
});

describe('cliMessage: app-screen words become commands, "server" becomes "node"', () => {
  it('S-1: "Raise it in Wallet → Device" names the command', () => {
    expect(cliMessage('This device\'s spending limit is lower than this deposit. Raise it in Wallet → Device.'))
      .toBe('This device\'s spending limit is lower than this deposit. Raise it: run devnet-dvpn device setup --allowance <N> --yes.');
    expect(cliMessage('Raise the spending limit in Wallet to at least 2.5 tDVPN, then start again.')).toBe('Raise it: run devnet-dvpn device setup --allowance 2.5 --yes, then start again.');
  });
  it('top up, spending approval, servers', () => {
    expect(cliMessage('This device needs a little SOL. Top it up in Wallet → Device.')).toBe('This device needs a little SOL. Top it up: run devnet-dvpn device setup --yes.');
    expect(cliMessage('Your spending approval is lower than this deposit.')).toBe('Your spending limit is lower than this deposit.');
    expect(cliMessage('The server ended the session. Try another server or protocol; servers differ.')).toBe('The node ended the session. Try another node or protocol; nodes differ.');
  });
  it('negative control: other sentences stay as they are', () => {
    expect(cliMessage('The login Keychain is locked.')).toBe('The login Keychain is locked.');
    expect(cliMessage('Run it in a service.')).toBe('Run it in a service.');
  });
  it('the JSON error uses it too', () => {
    const o = JSON.parse(errorOutput(fail('spending-limit', 'The server wants more. Raise it in Wallet → Device.'), true, 'agent').text);
    expect(o.error).toBe('The node wants more. Raise it: run devnet-dvpn device setup --allowance <N> --yes.');
  });
});

describe('docs/AGENT-COMMANDS.md: money is stated, and the same code reads the same', () => {
  const rows = failures.split('\n').filter((l) => /^\| (`|disconnect's code)/.test(l) && !l.startsWith('| `none`') && !/^\| (none|open|unclear|refund) \|/.test(l));
  it('found the failure rows (positive control)', () => {
    expect(rows.length).toBeGreaterThan(50);
  });
  it('every failure row says whether money moved', () => {
    const silent = rows.filter((l) => !/paid|deposit|refund|money|transaction|Nothing ran|signed|held/i.test(l));
    expect(silent).toEqual([]);
  });
  it('the "Did money move?" table lists every classified code', () => {
    const table = doc.slice(doc.indexOf('### Did money move?'), doc.indexOf('### Replaced on the way out'));
    expect(MONEY_CODES.filter((c) => !table.includes('`' + c + '`'))).toEqual([]);
  });
  it('no source file names, no app-screen buttons, no "approval" for the spending limit', () => {
    expect(doc).not.toMatch(/src\/(cli|core|shared|main)\//);
    expect(doc).not.toMatch(/Open diagnostics|Open settings|Pick another server|press Restore network|Wallet → Device/);
    expect(doc).not.toMatch(/spending approval/);
  });
  it('one command name: <cli> (devnet-dvpn only in quoted program output)', () => {
    const bare = doc.split('\n').filter((l) => /`devnet-dvpn (?!device show --json)/.test(l) && !/^\| `kill-switch-held`/.test(l));
    expect(bare).toEqual([]);
  });
  it('status renamed `refundable` to `held`; the stop fields are documented', () => {
    const status = doc.slice(doc.indexOf('## agent status'), doc.indexOf('## agent up'));
    expect(status).toMatch(/\| `held` \|/);
    expect(status).not.toMatch(/\| `refundable` \|/);
    for (const f of ['code', 'message', 'nodeStopped', 'alsoNext', 'deposits']) expect(status).toContain('| `' + f + '` |');
  });
});
