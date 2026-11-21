import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SESSION_WARNING_COPY, sessionWarningCopy } from '../../src/core/session/state';

// Q0357 (FAN, DIR: same banner on all 4 apps): dvpnd keeps a session whose full-size traffic still
// fails after its clamp and sets Session.warning = 'large-packets'; the app shows a warning banner.
describe('session warning', () => {
  it('large-packets reads the shared copy', () => {
    expect(sessionWarningCopy('large-packets')).toBe(
      'This network drops large packets; some sites may not load. V2Ray or Xray usually works.',
    );
    expect(SESSION_WARNING_COPY()['large-packets']).toBe(sessionWarningCopy('large-packets'));
  });

  it('no warning, or one this app does not know, shows nothing', () => {
    expect(sessionWarningCopy('')).toBeNull();
    expect(sessionWarningCopy(undefined)).toBeNull();
    expect(sessionWarningCopy(null)).toBeNull();
    expect(sessionWarningCopy('something-new')).toBeNull();
  });

  it('the bundled proto carries Session.warning = 13 (proto-loader drops unknown fields)', () => {
    const proto = fs.readFileSync(path.join(__dirname, '../../resources/daemon.proto'), 'utf8');
    const session = /message Session \{([\s\S]*?)\n\}/.exec(proto)?.[1] ?? '';
    expect(session).toMatch(/string warning = 13;/);
  });
});
