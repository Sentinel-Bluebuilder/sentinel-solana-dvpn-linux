// ─── Q0508: `daemon set` and the app's Apply buttons apply EXACTLY the same settings, refuse the same inputs ───
// The app's Apply sends { ...saved, ...draft } (use-daemon-settings.ts); the CLI builds its object from flags.
// For every permutation below both must reach the one apply path with an identical object, or both be
// refused with identical words (settingsProblem in services/daemon-apply.ts).
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DaemonSettings } from '../../src/core/daemon/config';

// rc9-e: daemon set refuses --kill-switch on from an SSH/RDP session; this parity test is about the settings written.
for (const k of ['SSH_CONNECTION', 'SSH_CLIENT', 'SSH_TTY', 'SESSIONNAME']) delete process.env[k];

const SAVED: DaemonSettings = {
  killSwitch: 'off', allowLan: false, dnsServers: ['1.1.1.1', '1.0.0.1'], dnsMode: 'netsh', basis: 'per_gb', escrow: '1000000',
  prepayBytes: '0', prepaySeconds: '0', rpcUrl: 'https://api.devnet.solana.com', rpcWsUrl: 'wss://api.devnet.solana.com',
  wholeDevice: false, split: { mode: 'off', apps: [], routes: [] },
} as DaemonSettings;

const applied: DaemonSettings[] = [];
vi.mock('../../src/main/daemon/settings', () => ({
  getDaemonSettings: () => ({ readable: true, settings: JSON.parse(JSON.stringify(SAVED)) }),
  applyDaemonSettings: async (s: DaemonSettings) => { applied.push(JSON.parse(JSON.stringify(s))); return { ok: true }; },
}));
vi.mock('../../src/main/services/connection', () => ({
  adoptRunningSession: async () => undefined,
  endAfterServiceRestart: async () => false,
  releaseKeptKillSwitch: async () => false,
  checkLeftoverBlock: async () => false,
  connectRunningElsewhere: () => false,
  restoreNetwork: async () => ({ ok: true }),
}));
// The CLI's DNS reachability warning is network I/O; both paths apply the same servers regardless.
vi.mock('../../src/main/system/dns-probe', () => ({ probeDns: async () => [], dnsProbeProblem: () => null, dnsDoctorRow: async () => null }));
vi.mock('../../src/main/services/service-transition', () => ({ writeApplyMarker: () => undefined, clearApplyMarker: () => undefined, applyMarkerFresh: () => false }));
vi.mock('../../src/main/daemon/manager', async (orig) => ({ ...(await orig<Record<string, unknown>>()), daemonInfo: () => ({ version: 'cf4c372-ddv18.37-mac1' }) }));

const { daemonCmd } = await import('../../src/cli/daemon-cmd');
const { parseArgs } = await import('../../src/cli/args');
const { applyServiceSettings, settingsProblem } = await import('../../src/main/services/daemon-apply');

const realPlatform = process.platform;
const setPlatform = (p: string): void => { Object.defineProperty(process, 'platform', { value: p, configurable: true }); };
afterAll(() => setPlatform(realPlatform));

interface Cell { name: string; argv: string[]; change: Partial<DaemonSettings> }
const KS: Cell[] = [
  { name: 'ks persist', argv: ['--kill-switch', 'persist'], change: { killSwitch: 'persist' } },
  { name: 'ks off', argv: ['--kill-switch', 'off'], change: { killSwitch: 'off' } },
  { name: 'ks on (session only)', argv: ['--kill-switch', 'on'], change: { killSwitch: 'on' } },
];
const WD: Cell[] = [
  { name: 'whole on', argv: ['--whole-device', 'true'], change: { wholeDevice: true } },
  { name: 'whole off', argv: ['--whole-device', 'false'], change: { wholeDevice: false } },
];
const SPLIT: Cell[] = [
  { name: 'split off', argv: ['--split-mode', 'off'], change: { split: { mode: 'off', apps: [], routes: [] } } },
  { name: 'include app A', argv: ['--split-mode', 'include', '--split-apps', 'C:\\A\\a.exe'], change: { split: { mode: 'include', apps: ['C:\\A\\a.exe'], routes: [] } } },
  { name: 'include apps A+B', argv: ['--split-mode', 'include', '--split-apps', 'C:\\A\\a.exe;C:\\B\\b.exe'], change: { split: { mode: 'include', apps: ['C:\\A\\a.exe', 'C:\\B\\b.exe'], routes: [] } } },
  { name: 'exclude app B', argv: ['--split-mode', 'exclude', '--split-apps', 'C:\\B\\b.exe'], change: { split: { mode: 'exclude', apps: ['C:\\B\\b.exe'], routes: [] } } },
  { name: 'include route', argv: ['--split-mode', 'include', '--split-routes', '10.0.0.0/8'], change: { split: { mode: 'include', apps: [], routes: ['10.0.0.0/8'] } } },
  { name: 'exclude route', argv: ['--split-mode', 'exclude', '--split-routes', '192.168.0.0/16'], change: { split: { mode: 'exclude', apps: [], routes: ['192.168.0.0/16'] } } },
];
const LAN: Cell[] = [
  { name: 'lan on', argv: ['--allow-lan', 'true'], change: { allowLan: true } },
  { name: 'lan off', argv: ['--allow-lan', 'false'], change: { allowLan: false } },
];

const DNS: Cell[] = [
  { name: 'dns unchanged', argv: [], change: {} },
  { name: 'dns quad9', argv: ['--dns', 'quad9'], change: { dnsServers: ['9.9.9.9', '149.112.112.112'] } },
  { name: 'dns custom', argv: ['--dns', '8.8.8.8,1.1.1.1'], change: { dnsServers: ['8.8.8.8', '1.1.1.1'] } },
];

/** Every combination of one cell per group: 3 x 2 x 6 x 2 x 3 = 216 permutations. */
function permutations(): Cell[] {
  const out: Cell[] = [];
  for (const k of KS) for (const w of WD) for (const s of SPLIT) for (const l of LAN) for (const d of DNS) {
    const cells = [k, w, s, l, d];
    out.push({ name: cells.map((c) => c.name).join(' + '), argv: cells.flatMap((c) => c.argv), change: Object.assign({}, ...cells.map((c) => c.change)) });
  }
  return out;
}

async function viaCli(argv: string[]): Promise<{ applied: DaemonSettings | null; refused: string | null }> {
  applied.length = 0;
  try {
    await daemonCmd(parseArgs(['daemon', 'set', ...argv, '--yes']), { json: false, print: () => undefined });
    return { applied: applied[0] ?? null, refused: null };
  } catch (err) {
    return { applied: applied[0] ?? null, refused: (err as Error).message };
  }
}

async function viaApp(change: Partial<DaemonSettings>): Promise<{ applied: DaemonSettings | null; refused: string | null }> {
  applied.length = 0;
  const r = await applyServiceSettings({ ...SAVED, ...change } as DaemonSettings); // what use-daemon-settings sends
  return { applied: applied[0] ?? null, refused: r.ok ? null : r.error ?? 'refused' };
}

describe.each(['win32', 'linux', 'darwin'])('CLI == app buttons on %s', (platform) => {
  beforeEach(() => { setPlatform(platform); delete process.env.DVPN_PLATFORM; });

  it.each(permutations().map((c) => [c.name, c] as const))('%s', async (_n, cell) => {
    const cli = await viaCli(cell.argv);
    const app = await viaApp(cell.change);
    expect(cli.refused).toBe(app.refused);
    expect(cli.applied).toEqual(app.applied);
    if (!app.refused) expect(app.applied).toEqual({ ...SAVED, ...cell.change });
  });
});

describe('the shared refusals', () => {
  beforeEach(() => setPlatform('linux')); // app paths are checked against the running OS's path rules
  it('Linux refuses newly chosen apps and whole-computer mode with the same words for both paths', () => {
    expect(settingsProblem({ ...SAVED, split: { mode: 'include', apps: ['/usr/bin/x'], routes: [] } } as DaemonSettings, SAVED, 'linux', () => 'x')?.error).toMatch(/Choosing apps does not work on Linux/);
    // Q0516: Linux never gets whole-computer V2Ray/Xray, so no 'update' advice there; macOS without -mac1 does.
    expect(settingsProblem({ ...SAVED, wholeDevice: true } as DaemonSettings, SAVED, 'linux', () => 'x')?.error).toMatch(/not available on Linux/);
    expect(settingsProblem({ ...SAVED, wholeDevice: true } as DaemonSettings, SAVED, 'linux', () => 'x')?.error).not.toMatch(/Update/);
    expect(settingsProblem({ ...SAVED, wholeDevice: true } as DaemonSettings, SAVED, 'darwin', () => 'cf4c372-ddv18.20')?.error).toMatch(/needs a newer VPN service/);
  });
  it('Agent M KSM13: a service that is not running (no version) is not called old; Linux still refuses', () => {
    for (const v of [null, undefined, '']) {
      expect(settingsProblem({ ...SAVED, wholeDevice: true } as DaemonSettings, SAVED, 'darwin', () => v)).toBeNull();
      expect(settingsProblem({ ...SAVED, wholeDevice: true } as DaemonSettings, SAVED, 'linux', () => v)?.error).toMatch(/not available on Linux/);
      expect(settingsProblem({ ...SAVED, split: { mode: 'include', apps: ['/usr/bin/x'], routes: [] } } as DaemonSettings, SAVED, 'linux', () => v)?.error).toMatch(/Choosing apps does not work on Linux/);
    }
  });
  it('an app already saved (older app) never blocks an unrelated change', () => {
    const stored = { ...SAVED, split: { mode: 'include', apps: ['/usr/bin/x'], routes: [] } } as DaemonSettings;
    expect(settingsProblem({ ...stored, killSwitch: 'persist' } as DaemonSettings, stored, 'linux', () => 'x')).toBeNull();
  });
  it('negative control: a CLI flag mapped differently from the app is caught', async () => {
    setPlatform('win32');
    const cli = await viaCli(['--kill-switch', 'persist']);
    const app = await viaApp({ killSwitch: 'off' });
    expect(cli.applied).not.toEqual(app.applied);
  });
});
