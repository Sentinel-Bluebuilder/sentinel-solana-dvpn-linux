// ─── Export CSV test hook (uifire export-csv): only inside a UI test run ───
// The save dialog cannot be driven under Xvfb, so a UI test names the file with DVPN_UI_SAVE_PATH.
// Outside DVPN_UI_SMOKE that variable must never skip the dialog.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const src = fs.readFileSync('src/main/ipc.ts', 'utf8');
const handler = src.slice(src.indexOf('[IPC.HISTORY_EXPORT]'), src.indexOf('[IPC.PROXY_SET]'));

describe('HISTORY_EXPORT test hook', () => {
  it('reads DVPN_UI_SAVE_PATH only when DVPN_UI_SMOKE is set', () => {
    expect(handler).toMatch(/process\.env\.DVPN_UI_SMOKE \? process\.env\.DVPN_UI_SAVE_PATH : undefined/);
  });
  it('Import a key file: DVPN_UI_OPEN_PATH only inside DVPN_UI_SMOKE, else the open dialog', () => {
    const imp = src.slice(src.indexOf('[IPC.WALLET_IMPORT_FILE]'));
    expect(imp).toMatch(/process\.env\.DVPN_UI_SMOKE \? process\.env\.DVPN_UI_OPEN_PATH : undefined/);
    expect(imp).toMatch(/testPath \? \{ canceled: false, filePaths: \[testPath\] \}\s*:\s*await \(win \? dialog\.showOpenDialog/);
  });
  it('still opens the save dialog otherwise', () => {
    expect(handler).toMatch(/testPath \? \{ canceled: false, filePath: testPath \}\s*:\s*await \(win \? dialog\.showSaveDialog/);
  });
});
