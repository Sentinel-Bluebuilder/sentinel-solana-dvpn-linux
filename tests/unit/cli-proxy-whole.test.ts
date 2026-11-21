// ─── `proxy status` in whole-device mode (CLI audit, Windows rc2: V2Ray with tun on, direct = node) ───
// The SOCKS port is still listed, but "send only that app through the VPN" is untrue when every app already is.
import { describe, it, expect, vi } from 'vitest';

const st = vi.hoisted(() => ({ tun: true }));
vi.mock('../../src/main/app-state', async (orig) => ({ ...(await orig<object>()), snapshot: () => ({ session: { service: 'v2ray', proxyEndpoint: '127.0.0.1:1080' } }) }));
vi.mock('../../src/main/services/connection', async (orig) => ({ ...(await orig<object>()), adoptRunningSession: async () => undefined }));
vi.mock('../../src/main/system/proxy', async (orig) => ({ ...(await orig<object>()), systemProxyActive: () => false }));
vi.mock('../../src/main/daemon/settings', async (orig) => ({ ...(await orig<object>()), serviceUsesTun: () => st.tun }));

const { proxyCmd } = await import('../../src/cli/info-cmd');
const { parseArgs } = await import('../../src/cli/args');

const run = async (): Promise<{ human: string; data: unknown }> => {
  let out = { human: '', data: undefined as unknown };
  await proxyCmd(parseArgs(['proxy', 'status']), { json: false, print: (human: string, data?: unknown) => { out = { human, data }; } });
  return out;
};

describe('proxy status', () => {
  it('whole device: says the SOCKS port is not needed', async () => {
    st.tun = true;
    const r = await run();
    expect(r.human.split('\n')[0]).toBe('SOCKS proxy: 127.0.0.1:1080 (not needed: this session already sends the whole computer through the VPN)');
    expect(r.data).toEqual({ endpoint: '127.0.0.1:1080', active: false, wholeDevice: true });
  });
  it('negative control: SOCKS only keeps "only that app"', async () => {
    st.tun = false;
    const r = await run();
    expect(r.human).toMatch(/send only that app through the VPN/);
    expect(r.data).toMatchObject({ wholeDevice: false });
  });
});
