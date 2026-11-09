// ─── Q0229: a refused second start (session-active) logs at warn, Cancel at info, the rest at error ───
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { connectErrorCopy } from '../../src/core/session/state';

const src = readFileSync(join(__dirname, '../../src/main/services/connection.ts'), 'utf8');

describe('connect failure log level (Q0229)', () => {
  it('dvpnd text for a second start maps to session-active', () => {
    expect(connectErrorCopy('StartSession: failed precondition: a session is already active').code).toBe('session-active');
  });
  it('connect logs session-active at warn and Cancel at info, everything else at error', () => {
    expect(src).toMatch(/copy\.code === 'cancelled' \? 'info' : copy\.code === 'session-active' \? 'warn' : 'error'/);
    expect(src).toMatch(/log\[level\]\('connect failed'/);
  });
});
