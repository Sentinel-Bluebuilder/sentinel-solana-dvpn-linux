// ─── rc9-d (review live on Linux rc.9, reproduced on Mac): the service set up for another wallet is no loop ───
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { otherWallet, SWITCH_NEXT, switchAlsoNext } from '../../src/cli/wallet-mismatch';

const X = 'EC3UxxxxServiceWallet';
const Y = '4XGNFufbLoadedWallet';

describe('rc9-d: otherWallet', () => {
  it('the service config names X, Y is loaded: X', () => expect(otherWallet(Y, Y, X)).toBe(X));
  it('the device record names X (no service config read): X', () => expect(otherWallet(Y, X, null)).toBe(X));
  it('negative controls: both Y, nothing recorded, no wallet loaded: null', () => {
    expect(otherWallet(Y, Y, Y)).toBeNull();
    expect(otherWallet(Y, null, null)).toBeNull();
    expect(otherWallet(null, X, X)).toBeNull();
  });
  it('next is one runnable command; alsoNext names the other wallet', () => {
    expect(SWITCH_NEXT).toBe('devnet-dvpn device switch --yes');
    expect(switchAlsoNext(X)).toContain(X);
  });
});

// The four commands' answers in the loop state, as the code now gives them (a model of each path's first gate,
// pinned to the source below), walked next -> next as the onboarding walker does.
type Step = { cmd: string; code: string; next: string };
function answer(cmd: string, st: { serviceWallet: string; loaded: string; ready: boolean }): Step {
  const other = otherWallet(st.loaded, st.serviceWallet, st.serviceWallet);
  if (cmd === 'devnet-dvpn device switch --yes') { st.serviceWallet = st.loaded; return { cmd, code: 'ok', next: 'devnet-dvpn agent up --yes' }; }
  if (other) return { cmd, code: 'wallet-switch-needed', next: SWITCH_NEXT };
  if (cmd === 'devnet-dvpn agent up --yes') return { cmd, code: 'connected', next: 'devnet-dvpn agent down --yes' };
  return { cmd, code: 'ok', next: 'devnet-dvpn agent up --yes' };
}

describe('rc9-d: the walk from the loop state reaches connected', () => {
  for (const start of ['devnet-dvpn agent status --json', 'devnet-dvpn daemon install --yes', 'devnet-dvpn daemon doctor --json', 'devnet-dvpn agent up --yes']) {
    it(`from ${start}: connected in <= 6 steps, no command twice in the same state`, () => {
      const st = { serviceWallet: X, loaded: Y, ready: false };
      const seen: string[] = [];
      let cmd = start;
      let last: Step | null = null;
      for (let i = 0; i < 6 && last?.code !== 'connected'; i++) {
        const key = `${cmd} | service for ${st.serviceWallet}`; // a loop = the same command in the same state
        expect(seen, `repeat at ${key}`).not.toContain(key);
        seen.push(key);
        last = answer(cmd, st);
        cmd = last.next.split(',')[0];
      }
      expect(last?.code).toBe('connected');
    });
  }
});

describe('rc9-d: each command checks it before its own gate', () => {
  const agent = fs.readFileSync('src/cli/agent-cmd.ts', 'utf8');
  const dmn = fs.readFileSync('src/cli/daemon-cmd.ts', 'utf8');
  it('agent up: before the clock, device and service gates', () => {
    const up = agent.slice(agent.indexOf('const upOnce: Cmd'));
    const at = up.indexOf('if (otherW) throw switchNeeded(otherW, owner);');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(up.indexOf('WIN-W7'));
  });
  it('agent status: next is the switch before daemon-missing, with code and alsoNext', () => {
    expect(agent).toMatch(/otherW \? SWITCH_NEXT : serviceDown \? (startNext \?\? )?nextFor\('daemon-missing'/); // the Linux app: W47 start line first
    expect(agent).toMatch(/otherW \? \{ code: 'wallet-switch-needed', serviceWallet: otherW/);
  });
  it('daemon install: before the wallet read and device-not-ready', () => {
    const inst = dmn.slice(dmn.indexOf("} else if (sub === 'install') {"));
    expect(inst.indexOf('if (otherW) throw switchNeeded(otherW, ownerAddress()!);')).toBeGreaterThan(-1);
    expect(inst.indexOf('if (otherW) throw switchNeeded(otherW, ownerAddress()!);')).toBeLessThan(inst.indexOf("throw cliErr('device-not-ready'"));
  });
  it('daemon doctor: the service-wallet row comes first, with the code and next', () => {
    const doc = dmn.slice(dmn.indexOf("} else if (sub === 'doctor') {"), dmn.indexOf("} else if (sub === 'drivers') {"));
    expect(doc).toMatch(/rows\.unshift\(\{ name: 'service wallet', ok: false, level: 'fail'[^\n]*code: 'wallet-switch-needed', next: SWITCH_NEXT/);
  });
});
