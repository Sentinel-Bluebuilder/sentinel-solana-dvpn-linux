// ─── CODE-AUDIT L-15: "Agentic connection is on" has a producer ───
// The Connect card and the CLI screen read snap.agent.attached, which nothing set. `agent up` writes
// agent-session.json (connect-64, src/cli); main reads it and sets snap.agent while it names the live session.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-marker-'));
vi.mock('../../src/main/host', () => ({ getHost: () => ({ dataDir: dir, emit: vi.fn() }) }));
vi.mock('../../src/main/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const m = await import('../../src/main/services/agent-marker');
const { patch, snapshot } = await import('../../src/main/app-state');
const file = path.join(dir, m.AGENT_MARKER);
const live = { id: 'S1', node: 'NodeA' };

describe('agent marker', () => {
  it('written atomically with the agreed shape, no key or wallet', () => {
    m.writeAgentMarker({ session: 'S1', node: 'NodeA', protocol: 'v2ray' }, undefined, 42, 1000);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ v: 1, session: 'S1', node: 'NodeA', protocol: 'v2ray', pid: 42, at: 1000 });
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
  it('attached while it names the live session (or its server, after a dvpnd redial)', () => {
    expect(m.agentAttached(live)).toBe(true);
    expect(m.agentAttached({ id: 'S2', node: 'NodeA' })).toBe(true);
  });
  it('no live session: not attached, marker kept (agent up may be between connect and adopt)', () => {
    expect(m.agentAttached(null)).toBe(false);
    expect(fs.existsSync(file)).toBe(true);
  });
  it('a live session on another server: the stale marker is deleted', () => {
    expect(m.agentAttached({ id: 'S9', node: 'NodeB' })).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
  });
  it('a bad file is ignored, never thrown', () => {
    fs.writeFileSync(file, '{not json');
    expect(m.readAgentMarker()).toBeNull();
    fs.writeFileSync(file, JSON.stringify({ v: 2, session: 'S1' }));
    expect(m.readAgentMarker()).toBeNull();
    m.clearAgentMarker();
  });
  it('the snapshot carries agent.attached (negative control: none without the marker)', () => {
    patch({ session: { id: 'S1', node: 'NodeA' } as never });
    expect(snapshot().agent?.attached ?? false).toBe(false);
    m.writeAgentMarker({ session: 'S1', node: 'NodeA', protocol: 'v2ray' });
    patch({ session: { id: 'S3', node: 'NodeA' } as never }); // session change: read at once
    expect(snapshot().agent).toEqual({ attached: true });
    patch({ session: null });
    expect(snapshot().agent).toEqual({ attached: false });
  });
});
