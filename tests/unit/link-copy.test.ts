import { describe, it, expect } from 'vitest';
import { daemonLinkCopy, RELOGIN_COPY, RESTARTING_COPY } from '../../src/core/daemon/link-copy';
import { serviceView } from '../../src/core/daemon/service-state';

const OFF = serviceView('stopped').sentence;
const BROKEN = serviceView('link-broken').sentence;

describe('daemonLinkCopy (F23: never raw errors; rows 119-142: one sentence per state)', () => {
  it('without OS facts: a missing pipe is "off", a refusal is "not allowed yet", anything else is the link', () => {
    expect(daemonLinkCopy('GetVersion: No connection established. Last error: connect ECONNREFUSED 127.0.0.1:50071 (2026-10-20T12:41:16.793Z)')).toBe(OFF);
    expect(daemonLinkCopy('open \\\\.\\pipe\\dvpnd\\client: The system cannot find the file specified.')).toBe(OFF);
    expect(daemonLinkCopy('dial pipe: Access is denied.')).toBe(RELOGIN_COPY);
    expect(daemonLinkCopy('4 DEADLINE_EXCEEDED: Deadline exceeded')).toBe(BROKEN);
    expect(daemonLinkCopy('14 UNAVAILABLE: Connection dropped')).toBe(BROKEN);
    expect(daemonLinkCopy('something new')).toBe(BROKEN);
  });

  it('with OS facts the same raw text gives the state the OS proves', () => {
    const raw = 'open \\\\.\\pipe\\x: The system cannot find the file specified.';
    expect(daemonLinkCopy(raw, { installed: false, running: false, startPending: false })).toBe(serviceView('not-installed').sentence);
    expect(daemonLinkCopy(raw, { installed: true, running: false, startPending: false })).toBe(OFF);
    expect(daemonLinkCopy(raw, { installed: true, running: false, startPending: true })).toBe(serviceView('starting').sentence);
    expect(daemonLinkCopy(raw, { installed: true, running: true, startPending: false })).toBe(BROKEN);
    // row 127: refused 3 s after a start is "starting", never the permission sentence
    expect(daemonLinkCopy('Access is denied.', { installed: true, running: true, startPending: false }, 3_000)).toBe(serviceView('starting').sentence);
    expect(daemonLinkCopy('Access is denied.', { installed: true, running: true, startPending: false }, 120_000)).toBe(RELOGIN_COPY);
  });

  it('never the old catch-all, never "sign out"', () => {
    for (const raw of ['ECONNREFUSED', 'Access is denied.', 'deadline', 'x', '']) {
      expect(daemonLinkCopy(raw)).not.toMatch(/is not running|sign out/i);
    }
    expect(RELOGIN_COPY).toMatch(/not allowed to talk to the VPN service yet\. Press Finish setup/);
    expect(RESTARTING_COPY).toBe('The VPN service is restarting. This takes a few seconds.');
  });
});
