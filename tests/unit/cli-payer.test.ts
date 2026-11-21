// ─── E-27 / E-64: paid answers name the wallet that paid ───
import fs from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { payerNote, shortAddr } from '../../src/cli/payer';
import type { LiveSession } from '../../src/shared/types';

const st = vi.hoisted(() => ({ owner: 'KEY1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaavcFz' as string | null }));
vi.mock('../../src/main/wallet/vault', async (orig) => ({ ...(await orig<object>()), ownerAddress: () => st.owner }));
vi.mock('../../src/main/app-state', () => ({ snapshot: () => ({}), patch: () => undefined }));
const { upAnswer } = await import('../../src/cli/agent-cmd');

const KEY1 = 'KEY1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaavcFz';
const KEY2 = 'KEY2bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbQx9t';
const live = { id: 'S1', node: 'NodeA', service: 'v2ray', proxyEndpoint: '127.0.0.1:1080', channel: 'Ch1', spent: '0', rxBytes: '0', txBytes: '0', error: '', warning: '', startedAt: 1 } as unknown as LiveSession;

describe('E-27: the payer', () => {
  it('paid by the loaded wallet: "Paid from <short>"', () => {
    expect(payerNote(KEY1, KEY1)).toBe('Paid from KEY1…vcFz.');
  });
  it('paid by another wallet: says so plainly, both named', () => {
    expect(payerNote(KEY2, KEY1)).toBe('Paid by KEY2…Qx9t, not the loaded wallet KEY1…vcFz.');
  });
  it('not read: nothing is guessed', () => {
    expect(payerNote(null, KEY1)).toBeNull();
    expect(payerNote(undefined, KEY1)).toBeNull();
  });
  it('agent up answer carries payer, payerIsLoaded and the note', () => {
    expect(upAnswer({ ...live, payer: KEY2 }, 'DE', null, null, null)).toMatchObject({ payer: KEY2, payerIsLoaded: false, payerNote: 'Paid by KEY2…Qx9t, not the loaded wallet KEY1…vcFz.' });
    expect(upAnswer({ ...live, payer: KEY1 }, 'DE', null, null, null)).toMatchObject({ payer: KEY1, payerIsLoaded: true });
    expect(upAnswer(live, 'DE', null, null, null)).toMatchObject({ payer: null, payerIsLoaded: null, payerNote: null });
  });
  it('connect prints it too (source check)', () => {
    expect(fs.readFileSync('src/cli/commands.ts', 'utf8')).toContain('const paid = payerNote(r.data!.payer, ownerAddress());');
  });
  it('negative control: a short address is left whole', () => {
    expect(shortAddr('abc')).toBe('abc');
  });
});
