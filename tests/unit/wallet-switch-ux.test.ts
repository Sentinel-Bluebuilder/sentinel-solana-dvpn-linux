// ─── New wallet on a computer that had one (owner 2026-11-11) ───
// 1. "Create a new wallet" jumped straight into the app: the recovery phrase card lived inside the
//    setup screen, which closed as soon as the wallet existed (device key present, permission no step).
// 2. A fresh wallet showed the old wallet's servers under "Your servers": history was per computer.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const st = vi.hoisted(() => ({ file: [] as Array<Record<string, unknown>> }));
vi.mock('../../src/main/store', () => ({
  readJson: (_f: string, d: unknown) => (st.file.length ? JSON.parse(JSON.stringify(st.file)) : d),
  writeJson: (_f: string, v: Array<Record<string, unknown>>) => { st.file = JSON.parse(JSON.stringify(v)); },
}));

const OLD = 'CWT5iHdi76j2wGkfWcs8NXAUyPwJ44A7ZGAdGoYFRaf9';
const NEW = '4eS9b1LQVD7ZQLAsGaeYCZy8SkYBdWgCNsGj7pyKfv9C';
const h = await import('../../src/main/services/history');
const session = (id: string) => ({ id, node: `N-${id}`, service: 'v2ray', startedAt: 1, rxBytes: '0', txBytes: '0', spent: '0', channel: 'c' }) as never;

describe('history is per wallet', () => {
  let owner: string | null = OLD;
  beforeEach(() => {
    st.file = [{ id: 'a', node: 'N-a', startedAt: 1 }, { id: 'b', node: 'N-b', startedAt: 2 }];
    owner = OLD;
    h.setHistoryOwner(() => owner);
  });
  it('old entries go to the wallet that set the computer up', () => {
    expect(h.stampLegacyHistory(OLD)).toBe(2);
    expect(h.stampLegacyHistory(OLD)).toBe(0); // once only
    expect(h.listHistory().map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('a new wallet sees none of them', () => {
    h.stampLegacyHistory(OLD);
    owner = NEW;
    expect(h.listHistory()).toEqual([]);
  });
  it('new sessions carry the current wallet, and only it sees them', () => {
    h.stampLegacyHistory(OLD);
    owner = NEW;
    h.recordStart(session('c'));
    expect(h.listHistory().map((x) => x.id)).toEqual(['c']);
    owner = OLD;
    expect(h.listHistory().map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('recordEnd still finds a session of any wallet', () => {
    owner = NEW;
    h.recordStart(session('d'));
    owner = OLD;
    h.recordEnd({ ...(session('d') as object), spent: '7' } as never, 'user');
    expect(st.file.find((x) => x.id === 'd')?.spent).toBe('7');
  });
  it('no wallet: no history', () => {
    owner = null;
    expect(h.listHistory()).toEqual([]);
  });
});

describe('recovery phrase always shows after "Create a new wallet"', () => {
  const app = readFileSync(join(__dirname, '../../src/renderer/src/App.tsx'), 'utf8');
  const onb = readFileSync(join(__dirname, '../../src/renderer/src/screens/Onboarding.tsx'), 'utf8');
  it('the phrase is held in App and keeps the setup screen up', () => {
    expect(app).toMatch(/const \[phrase, setPhrase\] = useState<string \| null>\(null\)/);
    expect(app).toMatch(/if \(phrase \|\| showWelcome \|\|/);
    expect(app).toMatch(/<Onboarding snap=\{snap\} phrase=\{phrase\} setPhrase=\{setPhrase\}/);
  });
  it('Onboarding no longer owns the phrase state', () => {
    expect(onb).not.toMatch(/const \[phrase, setPhrase\] = useState/);
    expect(onb).toMatch(/phrase \? <PhraseCard phrase=\{phrase\} onDone=\{\(\) => setPhrase\(null\)\} \/>/);
  });
  it('startup stamps old history before anything can rewrite device.json', () => {
    const rt = readFileSync(join(__dirname, '../../src/main/runtime.ts'), 'utf8');
    expect(rt).toMatch(/stampLegacyHistory\(deviceRecord\(\)\?\.owner \?\? null\)/);
    expect(rt).toMatch(/setHistoryOwner\(\(\) => ownerAddress\(\)\)/);
  });
});
