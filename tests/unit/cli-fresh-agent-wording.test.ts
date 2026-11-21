// ─── Fresh-agent test (clean Ubuntu, rc2): CLI lines that must stand alone, and additive JSON fields ───
// (1) disconnect named "the app" and "a day"; (2) nodes list --json prices had no unit; (3) two values ran
// together ("Device ready. <a><b>", "Done: <a><b>"); (5) quality ip `source` was unexplained.
import { describe, it, expect, vi } from 'vitest';

const NODE = { address: 'NodeA', countryCode: 'DE', pricePerGb: '2000', pricePerHour: '0', protocolNames: ['wireguard'], probe: { ok: true }, listingFresh: true };
vi.mock('../../src/main/wallet/vault', async (orig) => ({ ...(await orig<object>()), ownerAddress: () => 'Owner1' }));
vi.mock('../../src/main/app-state', async (orig) => ({ ...(await orig<object>()), snapshot: () => ({ session: { channel: 'Chan1', proxyEndpoint: undefined } }) }));
vi.mock('../../src/main/services/connection', async (orig) => ({
  ...(await orig<object>()),
  adoptRunningSession: async () => undefined,
  disconnect: async () => ({ ok: true, data: null }),
}));
vi.mock('../../src/main/services/settlement', async (orig) => ({
  ...(await orig<object>()),
  readSettlements: async () => [],
  runSettlement: async () => ({ ok: true, data: ['SigA', 'SigB'] }),
}));
vi.mock('../../src/main/services/wallet', async (orig) => ({
  ...(await orig<object>()),
  deviceSetupPlan: async () => ({ ok: true, data: { steps: ['approve 1 tDVPN'], topUpLamports: 0, approveTo: null } }),
  deviceSetup: async () => ({ ok: true, data: 'SigDev' }),
}));
vi.mock('../../src/main/daemon/manager', async (orig) => ({
  ...(await orig<object>()),
  daemonInfo: () => ({ device: 'Dev1', version: '1' }),
  startServiceIfStopped: async () => 'running',
}));
vi.mock('../../src/main/services/nodes', async (orig) => ({ ...(await orig<object>()), refreshNodes: async () => undefined, nodeViews: () => [NODE] }));
vi.mock('../../src/main/system/settings', async (orig) => ({ ...(await orig<object>()), getSettings: () => ({ thirdPartyChecks: true }) }));
vi.mock('../../src/core/quality/quality', async (orig) => ({ ...(await orig<object>()), publicIp: async () => ({ ip: '203.0.113.7', source: '1.0.0.1' }) }));

// rc.9 (review dvw-build): app-state emits on a setImmediate after patch(); with no host that threw after the test
// (vitest: 1 unhandled error, exit 1). The CLI entry always sets a host first, so the test does too.
const { setHost } = await import('../../src/main/host');
const { mkdtempSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
setHost({ name: 'cli', resourcesDir: '', dataDir: mkdtempSync(join(tmpdir(), 'fa-')), keyStore: {} as never, emit: () => undefined });
const { COMMANDS, PRICE_UNIT } = await import('../../src/cli/commands');
const { IP_SOURCE_NOTE } = await import('../../src/cli/info-cmd');
const { parseArgs } = await import('../../src/cli/args');

const run = async (line: string): Promise<{ human: string; data: unknown }> => {
  const out: { human: string; data: unknown }[] = [];
  const [cmd] = line.split(' ');
  await COMMANDS[cmd].run(parseArgs(line.split(' ')), { json: false, print: (human: string, data?: unknown) => { out.push({ human, data }); } });
  return out[out.length - 1];
};

describe('fresh-agent wording', () => {
  it('(1) disconnect stands alone: who refunds, when, per basis, and the command; no "the app", no "a day"', async () => {
    const { human } = await run('disconnect');
    expect(human).toContain('by the Devnet dVPN desktop app if it is running (a per-hour deposit 10 minutes after the session ends, a per-GB one after a day unused, so a reconnect can still use it), or now with "settle run --yes"');
    expect(human).toContain('A per-GB deposit then waits about 2 hours before it can be closed');
    // The service alone starts no refund (dvpnd only finishes closes): the line must not say it does.
    // "a day" is the real per-GB keep (auto-refund.ts KEEP_PER_GB_S, owner 2026-11-12; CODE-AUDIT E2): allowed
    // only with what it is for, never bare as the fresh agent saw it.
    expect(human).not.toMatch(/VPN service starts|^.*The app /i);
    expect(human.match(/a day/g)).toEqual(['a day']);
    expect(human).toContain('after a day unused, so a reconnect can still use it');
  });
  it('(2) nodes list --json: every node gets priceUnit; the raw price fields are unchanged', async () => {
    const { data } = await run('nodes list --no-probe');
    expect(data).toEqual([{ ...NODE, priceUnit: PRICE_UNIT }]);
    expect(PRICE_UNIT).toMatch(/base units \(1 tDVPN = 1000000\)/);
  });
  it('(3) device setup and settle run label and separate their values', async () => {
    expect((await run('device setup --yes')).human).toMatch(/^Device ready\. Transaction: SigDev\.$/m);
    expect((await run('settle run --yes')).human).toBe('Done. Transactions (2): SigA, SigB.');
  });
  it('(5) quality ip --json explains source; direct and viaSocks are unchanged', async () => {
    const { data } = await run('quality ip');
    expect(data).toEqual({ direct: { ip: '203.0.113.7', source: '1.0.0.1' }, viaSocks: null, sourceIs: IP_SOURCE_NOTE });
    expect(IP_SOURCE_NOTE).toMatch(/^source = the IP-check service that answered/);
  });
});
