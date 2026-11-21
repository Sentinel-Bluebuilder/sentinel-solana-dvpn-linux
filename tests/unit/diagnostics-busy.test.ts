// ─── Audit U-11: Diagnostics keeps every running action, not only the last one started ───
// One shared busy name: "Run again" during a repair replaced it and cleared it on finishing, so Repair was
// enabled again mid-repair and a second repair (another administrator prompt) could start.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync('src/renderer/src/screens/Diagnostics.tsx', 'utf8');

describe('Diagnostics: running actions', () => {
  it('are a set: each action adds itself and removes only itself', () => {
    expect(src).toContain('const [running, setRunning] = useState<ReadonlySet<string>>(() => new Set());');
    expect(src).toContain('setRunning((r) => new Set(r).add(name));');
    expect(src).toContain('n.delete(name)');
    expect(src).not.toMatch(/setBusy\(/);
  });

  it('Repair stays disabled while anything runs, and the per-section buttons check their own action', () => {
    expect(src).toContain("onClick={() => void repair()}");
    expect(src).toMatch(/disabled=\{busy\} onClick=\{\(\) => void repair\(\)\}/);
    expect(src).toContain("disabled={isBusy('drivers') || isBusy('repair')}");
    expect(src).not.toMatch(/busy === '/);
  });
});
