// ─── device register: an admin-only key folder names the address form (Windows live run, E-55) ───
// In a normal Windows terminal `device register --home C:\ProgramData\sentinel-dvpn\c0` fails (the keys folder is
// admin-only) while `device register <address> --home …` works. The error says so, with the address filled in.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({
  rec: { owner: 'Own1', device: 'DevRec1' } as null | { owner: string; device: string }, svcDevice: 'DevSvc1' as string | null,
  detect: { ok: false, error: "Could not read the service's device key (Access is denied). Enter its address instead." } as { ok: boolean; device?: string; error?: string },
  registered: [] as unknown[][],
}));
vi.mock('../../src/main/wallet/vault', async (orig) => ({ ...(await orig<object>()), ownerAddress: () => 'Own1' }));
vi.mock('../../src/main/daemon/manager', async (orig) => ({
  ...(await orig<object>()),
  deviceRecord: () => st.rec,
  daemonInfo: () => ({ reachable: true, device: st.svcDevice }),
  detectDevice: async () => st.detect,
  registerDevice: (...args: unknown[]) => { st.registered.push(args); },
}));

const { COMMANDS, registerByAddress } = await import('../../src/cli/commands');
const { parseArgs } = await import('../../src/cli/args');

async function run(line: string): Promise<{ text: string; error?: Error & { code?: string; action?: string } }> {
  let text = '';
  try {
    await COMMANDS.device.run(parseArgs(line.split(' ')), { json: false, print: (t: string) => { text = t; } } as never);
    return { text };
  } catch (err) { return { text, error: err as Error & { code?: string; action?: string } }; }
}

const HOME = 'C:\\ProgramData\\sentinel-dvpn\\c0';
beforeEach(() => {
  st.rec = { owner: 'Own1', device: 'DevRec1' }; st.svcDevice = 'DevSvc1'; st.registered = [];
  st.detect = { ok: false, error: "Could not read the service's device key (Access is denied). Enter its address instead." };
});

describe('device register: the form that needs no administrator', () => {
  it('a key read that fails names the address form, the recorded address and the same --home', async () => {
    const r = await run(`device register --home ${HOME}`);
    expect(r.error?.code).toBe('device-key-unreadable');
    expect(r.error?.action).toBe(`devnet-dvpn device register DevRec1 --home ${HOME}`);
    expect(r.error?.message).toBe(`Could not read the service's device key (Access is denied). Pass the device address instead (no administrator needed): devnet-dvpn device register DevRec1 --home ${HOME}`);
    expect(r.error?.message).not.toMatch(/Enter its address/); // the app's text field, not a CLI step
    expect(st.registered).toEqual([]);
  });
  it('no record: the running service names the device; neither: a placeholder', () => {
    st.rec = null;
    expect(registerByAddress()).toBe('devnet-dvpn device register DevSvc1');
    st.svcDevice = null;
    expect(registerByAddress(HOME)).toBe(`devnet-dvpn device register <device address> --home ${HOME}`);
  });
  it('the address form registers without reading the key', async () => {
    st.detect = { ok: true, device: 'never-read' };
    const r = await run(`device register DevRec1 --home ${HOME}`);
    expect(r.error).toBeUndefined();
    expect(st.registered).toEqual([['DevRec1', 'Own1', HOME]]);
  });
  it('negative control: a key read that works registers what it read', async () => {
    st.detect = { ok: true, device: 'DevRead1' };
    await run(`device register --home ${HOME}`);
    expect(st.registered).toEqual([['DevRead1', 'Own1', HOME]]);
  });
});
