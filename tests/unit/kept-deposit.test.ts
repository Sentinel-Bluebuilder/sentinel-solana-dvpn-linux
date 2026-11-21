// Row 79: a connect that fails with a deposit open with that server names it (lastConnectError.kept), with what
// is left of it. keptOf picks it from the VPN service's own list.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../src/main/daemon/manager', () => ({}));

const { keptOf, connectedToast } = await import('../../src/main/services/connection');

describe('the note when a session has started (owner\'s laptop, build 9bf682c)', () => {
  it('says Connected, never the checking stage\'s title', () => {
    expect(connectedToast('Checking the connection…')).toBe('Connected');
    expect(connectedToast('Protected')).toBe('Connected');
    expect(connectedToast('Connected, checking')).toBe('Connected');
  });

  it('negative control: another title is said as it is', () => {
    expect(connectedToast('Reconnecting…')).toBe('Reconnecting…');
  });
});
const ch = (o: Partial<{ address: string; node: string; escrow: string; cumulative: string; openedAt: string; status: string }>) =>
  ({ address: 'Ch', node: 'NodeA', mode: 1, escrow: '2000', cumulative: '0', openedAt: '100', status: 'open', ...o });

describe('the deposit kept with a server after a failed connect', () => {
  it('is the open deposit with that server, with what is left of it', () => {
    expect(keptOf([ch({ address: 'Other', node: 'NodeB' }), ch({ address: 'Mine', escrow: '2000', cumulative: '119' })], 'NodeA')).toEqual({ channel: 'Mine', amount: '1881' });
  });

  it('is the newest when there are several', () => {
    expect(keptOf([ch({ address: 'Old', openedAt: '100' }), ch({ address: 'New', openedAt: '300' })], 'NodeA')?.channel).toBe('New');
  });

  it('is nothing when there is no deposit with that server, it is closing, or it is used up', () => {
    expect(keptOf([ch({ node: 'NodeB' })], 'NodeA')).toBeNull();
    expect(keptOf([ch({ status: 'closing' })], 'NodeA')).toBeNull();
    expect(keptOf([ch({ escrow: '500', cumulative: '500' })], 'NodeA')).toBeNull();
    expect(keptOf([], 'NodeA')).toBeNull();
  });

  it('claims nothing when the amounts cannot be read', () => {
    expect(keptOf([ch({ escrow: 'x' })], 'NodeA')).toBeNull();
  });
});
