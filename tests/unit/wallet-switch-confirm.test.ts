// ─── rc.4 E-55 (screen half): the Connect dialog asks before a wallet switch; Diagnostics removes a half-finished setup ───
// The engine (a1d13d0c) answers 'wallet-switch-needed' and writes nothing unless the connect carries
// confirmWalletSwitch. Without this screen an app user who loaded another wallet met that code with no way on.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { walletSwitchFrom } from '../../src/shared/wallet-switch';

const sheet = readFileSync(join(__dirname, '../../src/renderer/src/components/ConnectSheet.tsx'), 'utf8');
const diag = readFileSync(join(__dirname, '../../src/renderer/src/screens/Diagnostics.tsx'), 'utf8');
const ipcShared = readFileSync(join(__dirname, '../../src/shared/ipc.ts'), 'utf8');
const ipcMain = readFileSync(join(__dirname, '../../src/main/ipc.ts'), 'utf8');

describe('walletSwitchFrom', () => {
  it('names the wallet the computer is set up for when it is not the loaded one', () => {
    expect(walletSwitchFrom({ owner: 'Loaded111', deviceOwner: 'Recorded22' })).toBe('Recorded22');
  });
  it('is null for the same wallet, no device record, or no wallet loaded', () => {
    expect(walletSwitchFrom({ owner: 'Same', deviceOwner: 'Same' })).toBeNull();
    expect(walletSwitchFrom({ owner: 'Loaded', deviceOwner: null })).toBeNull();
    expect(walletSwitchFrom({ owner: 'Loaded' })).toBeNull();
    expect(walletSwitchFrom({ owner: null, deviceOwner: 'Recorded' })).toBeNull();
  });
});

describe('Connect dialog: a wallet switch is asked first', () => {
  const confirmAt = sheet.indexOf('data-wallet-switch-confirm');
  const blockerAt = sheet.indexOf('data-connect-blocker');
  const footerAt = sheet.indexOf('<footer');

  it('shows the question in the fixed part, after the blocker and before the footer, only with nothing blocking', () => {
    expect(confirmAt).toBeGreaterThan(blockerAt);
    expect(footerAt).toBeGreaterThan(confirmAt);
    expect(sheet).toContain('{switchFrom && !blocker && (');
  });

  it('says which wallet, what it costs in SOL, and that the other wallet\'s deposits stay refundable', () => {
    const block = sheet.slice(confirmAt, footerAt);
    expect(block).toContain('This computer is set up for another wallet ({other}). Continuing sets it up for this wallet ({mine}) first, which needs about {sol} SOL');
    expect(block).toContain('short(switchFrom)');
    // rc.3.1 F2: UI-LEAD's exact sentence, the same words as the CLI's switch confirm (cli-device-switch.test.ts).
    expect(block).toContain("tr('This sets this computer up as a new device for the loaded wallet, which pays about 0.05 SOL of fee float for it. About 0.05 SOL of fee float stays on the previous device and cannot be sent back yet. Deposits made with the previous device stay refundable: Activity shows them.')");
    expect(block).toContain('data-wallet-switch-float');
    expect(block).not.toContain('Other computers and phones');
    expect(sheet).toContain('const setupSol = !w ? 0 : switchFrom ? ownerSolForSetup(0) : ownerSolForSetup(w.deviceLamports);');
  });

  it('the button reads "Set up for this wallet" and is the only place confirmWalletSwitch is sent', () => {
    expect(sheet).toContain("const confirmText = switchFrom ? tr('Set up for this wallet')");
    expect(sheet.match(/confirmWalletSwitch/g)).toHaveLength(1);
    expect(sheet).toContain('...(switchFrom ? { confirmWalletSwitch: true } : {})');
    // Cancel stays beside it and sends nothing.
    expect(sheet).toContain("<button className=\"btn-ghost\" onClick={onClose} disabled={busy}>{tr('Cancel')}</button>");
  });

  it('a wallet too short of SOL for the switch is blocked before the question is shown', () => {
    expect(sheet).toContain('const setupBlocker = !(firstSetup || switchFrom) || !w ? null');
    // The other wallet's limit and fees do not block: the switch sets this computer up first.
    expect(sheet).toContain(': switchFrom ? null');
  });

  it('keeps every data-* hook the dialog had', () => {
    for (const hook of ['data-connect-sheet', 'data-connect-blocker', 'data-connect-confirm', 'data-autofocus', 'data-first-connect-setup', 'data-raise-limit', 'data-reuse-deposit', 'data-closing-deposit', 'data-refused-deposit']) expect(sheet).toContain(hook);
  });
});

describe('Diagnostics: Remove half-finished setup', () => {
  it('shows the button only when the app reports one', () => {
    expect(diag).toContain('{snap.halfFinishedSetup && (!confirmDiscard');
    expect(diag).toContain("tr('Remove half-finished setup')");
  });

  it('asks once, says nothing is paid or refunded, then calls the engine removal', () => {
    expect(diag).toContain("tr('Remove it? Nothing is paid or refunded by this.')");
    expect(diag).toContain('window.api.IPC.DISCARD_SETUP');
    expect(diag.indexOf('IPC.DISCARD_SETUP')).toBeGreaterThan(diag.indexOf('const discardSetup = (): Promise<void> => run(\'discard\''));
    expect(diag).toContain('onClick={() => void discardSetup()}');
  });

  it('says so when there was nothing left to remove (the engine answers an empty list)', () => {
    expect(diag).toContain('out.removed.length > 0');
    expect(diag).toContain("tr('There was no half-finished setup left to remove.')");
  });

  it('the channel is local (no spend, no admin prompt) and refreshes the snapshot so the button goes away', () => {
    expect(ipcShared).toContain("DISCARD_SETUP: 'device:discard-setup',");
    expect(ipcShared).toContain("[IPC.DISCARD_SETUP]: 'local',");
    expect(ipcMain).toContain('[IPC.DISCARD_SETUP]: async () => { const out = discardSetup(); await refreshWallet(); return ok(out); },');
  });
});
