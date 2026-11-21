// ─── L1: `device setup` with NO wallet must not send the user to `daemon init` ───
// The device-key hint is only true for a wallet that exists; without one the service's own
// "Create or import a wallet first" is the right step (composed-app sweep, 10-24).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('device setup hint (L1)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/cli/commands.ts'), 'utf8');
  const line = src.split('\n').find((l) => l.includes('has no device key yet')) ?? '';
  it('exists', () => expect(line).not.toBe(''));
  it('is guarded by a wallet check', () => expect(line).toMatch(/ownerAddress\(\)\s*&&\s*!daemonInfo\(\)\.device/));
});

// ─── P-N (the agent kit rc.8, Windows R4): no-device-key gives ONE command, not "daemon init, then device setup --yes" ───
describe('P-N: no-device-key next', () => {
  it('service installed: agent up --yes (it creates the key and sets the device up)', async () => {
    const { noDeviceKeyNext } = await import('../../src/cli/cli-fail');
    expect(noDeviceKeyNext(true)).toBe('devnet-dvpn agent up --yes');
  });
  it('AUD-1: no service: daemon init --yes, then device setup --yes (install refuses an unset-up device)', async () => {
    const { noDeviceKeyNext } = await import('../../src/cli/cli-fail');
    expect(noDeviceKeyNext(false)).toBe('devnet-dvpn daemon init --yes, then devnet-dvpn device setup --yes');
  });
  it('negative control: neither answer is two commands', async () => {
    const { noDeviceKeyNext } = await import('../../src/cli/cli-fail');
    expect(noDeviceKeyNext(true)).not.toMatch(/, then |daemon init|device setup/); // AUD-1: the no-service next is init, then setup
  });
  it('device setup uses it, coded, with the service state', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/cli/commands.ts'), 'utf8');
    const line = src.split('\n').find((l) => l.includes('has no device key yet')) ?? '';
    expect(line).toMatch(/cliErr\('no-device-key', noDeviceKeyNext\(daemonInfo\(\)\.reachable\)/);
    expect(line).not.toMatch(/daemon init, then/);
  });
});
