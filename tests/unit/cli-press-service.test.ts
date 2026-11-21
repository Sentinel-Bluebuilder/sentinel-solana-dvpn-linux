// ─── WIN-W10 (the agent kit rc.9, review audit W-10): the service-state sentences name the command, not a UI button ───
// review rc.8 edge dry run (`agent down` as an SSH admin): "…The VPN service is off, so you cannot connect. Press
// Start the VPN service to turn it back on." There is no button on the command line.
import { describe, expect, it } from 'vitest';
import { cliMessage } from '../../src/cli/action-hint';

const OFF = 'Could not disconnect, so no deposit was closed (a per-hour deposit keeps billing). daemon: The VPN service is off, so you cannot connect. Press Start the VPN service to turn it back on.';
const MISSING = 'The VPN service is not installed, so you cannot connect. Press Install the VPN service to set it up.';

describe('WIN-W10: service-state sentences on the command line', () => {
  it('"Press Start the VPN service" names daemon install --yes from an elevated shell', () => {
    const m = cliMessage(OFF);
    expect(m).toContain('The VPN service is off, so you cannot connect. Run devnet-dvpn daemon install --yes (administrator once) to start it.');
    expect(m).not.toMatch(/Press /);
  });
  it('"Press Install the VPN service" names daemon install --yes too', () => {
    expect(cliMessage(MISSING)).toBe('The VPN service is not installed, so you cannot connect. Run devnet-dvpn daemon install --yes (administrator once) to set it up.');
  });
  it('negative control: other sentences are unchanged', () => {
    expect(cliMessage('The VPN service is starting. This takes a few seconds.')).toBe('The VPN service is starting. This takes a few seconds.');
  });
});
