// ─── UI-196 CLI half: `disconnect` with no session and the kill switch on (= persist) ───
// The old line said the block lasts "until you reconnect", which lifts it only while that session is up.
// The words follow docs/AGENT-COMMANDS.md (Kill switch): check quality ip, restore-network for now, off for good.
import { describe, it, expect, vi } from 'vitest';

const ks = vi.hoisted(() => ({ mode: 'persist' as string, stops: 0 }));
vi.mock('../../src/main/app-state', async (orig) => ({ ...(await orig<object>()), snapshot: () => ({ session: null }) }));
vi.mock('../../src/main/services/connection', async (orig) => ({
  ...(await orig<object>()),
  adoptRunningSession: async () => undefined,
  stopOtherConnect: async () => ({ stopped: false, ended: false }),
}));
vi.mock('../../src/main/system/proxy', async (orig) => ({ ...(await orig<object>()), clearSystemProxy: async () => undefined }));
vi.mock('../../src/main/daemon/settings', async (orig) => ({ ...(await orig<object>()), getDaemonSettings: () => ({ settings: { killSwitch: ks.mode } }) }));
vi.mock('../../src/main/daemon/manager', async (orig) => ({
  ...(await orig<object>()),
  daemon: () => ({ stopSession: async () => { ks.stops++; return { killSwitchReleased: false }; } }),
}));

const { COMMANDS } = await import('../../src/cli/commands');
const { parseArgs } = await import('../../src/cli/args');

const run = async (): Promise<string> => {
  let human = '';
  await COMMANDS.disconnect.run(parseArgs(['disconnect']), { json: false, print: (h: string) => { human = h; } });
  return human;
};

describe('disconnect, no session, kill switch on', () => {
  it('names the check and both ways out, and not "until you reconnect"', async () => {
    ks.mode = 'persist';
    const human = await run();
    expect(human).toBe('No active session. The kill switch may still be blocking the internet: if "quality ip" shows no address, run "daemon restore-network" to lift it for now; "daemon set --kill-switch off --yes" stops it coming back.');
    expect(human).not.toMatch(/reconnect/);
    expect(ks.stops).toBe(0);
  });
  it('negative control: kill switch off asks the service and prints the plain line', async () => {
    ks.mode = 'off';
    expect(await run()).toBe('No active session.');
    expect(ks.stops).toBe(1);
  });
});
