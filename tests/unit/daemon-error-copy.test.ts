// Q0433 / Q0453 (TLX2, final3 131d3a2): raw gRPC text from the VPN service reached the user. The exact
// strings TLX2 captured now read as one plain sentence; anything unrecognised is left alone.
import { describe, expect, it } from 'vitest';
import { daemonErrorCopy } from '../../src/core/daemon/link-copy';
import { connectErrorCopy } from '../../src/core/session/state';
import { cliActionHint } from '../../src/cli/action-hint';

const SOCK = '(/run/sentinel-dvpn/c0/daemon.sock): rpc error: code = Unavailable desc = connection error: desc = "transport: Error while dialing: dial unix /run/sentinel-dvpn/c0/daemon.sock: connect: connection refused"';
const DOWN = `error: the client service (instance c0) isn't running: start it with \`sentinel-dvpnd service start --instance c0\` (or run \`sentinel-dvpnd run --instance c0\` in a terminal) ${SOCK}`;
const TUNNEL = `error: the client service (instance c0) isn't running, but a tunnel it started (dvpn-c0) is still up; start the service to recover and remove it ${SOCK}`;
const NOT_READY = `error: the client daemon (instance c0) is not ready (starting up or stopping); try again ${SOCK}`;
const ACTIVE = 'error: calling daemon: rpc error: code = FailedPrecondition desc = failed precondition: a session is already active';
const REVOKED = 'error: calling daemon: rpc error: code = FailedPrecondition desc = failed precondition: open_channel: simulation failed: token-2022 error: OwnerMismatch (4): owner does not match';
const SHORT = 'start session: failed precondition: open_channel: simulation failed: token-2022 error: InsufficientFunds (1): insufficient funds';

describe('daemon error copy', () => {
  it('keeps the plain part before the socket path and drops the rpc text (a, b, c)', () => {
    for (const raw of [DOWN, TUNNEL, NOT_READY]) {
      const c = daemonErrorCopy(raw)!;
      expect(c.message).not.toMatch(/rpc error|daemon\.sock|transport/);
      expect(raw.startsWith(`error: ${c.message}`)).toBe(true);
    }
    expect(daemonErrorCopy(TUNNEL)!.message).toContain('a tunnel it started (dvpn-c0) is still up');
  });
  it('a second start reads as plain words (d)', () => {
    expect(daemonErrorCopy(ACTIVE)).toMatchObject({ code: 'session-active', message: 'A session is already active; disconnect it first.' });
  });
  it('a revoked spending approval says so and names device setup (e)', () => {
    const c = daemonErrorCopy(REVOKED)!;
    expect(c.code).toBe('approval-revoked');
    expect(c.message).toMatch(/spending approval .* was revoked/);
    expect(c.message).not.toMatch(/OwnerMismatch|token-2022|rpc error/);
    expect(cliActionHint(c.action, c.message)).toBe('devnet-dvpn device setup --yes');
    const app = connectErrorCopy(REVOKED);
    expect(app.code).toBe('approval-revoked');
    expect(app.message).toBe(c.message);
  });
  it('a wallet short of tDVPN keeps its plain case', () => {
    expect(daemonErrorCopy(SHORT)?.code).toBe('not-enough-tdvpn');
    expect(connectErrorCopy(SHORT).code).toBe('not-enough-tdvpn');
  });
  it('our own link error (service stopped mid-command) reads as not running', () => {
    expect(daemonErrorCopy('client status: 14 UNAVAILABLE: No connection established. Last error: connect ECONNREFUSED /var/lib/sentinel-dvpn/c0/daemon.sock'))
      .toMatchObject({ code: 'service-down', message: 'The VPN service is not running.' });
  });
  it('negative controls: unrelated errors and SOL fees are left alone', () => {
    expect(daemonErrorCopy('node said: rate_limited')).toBeNull();
    expect(daemonErrorCopy('Transfer: insufficient lamports 100, need 2000')).toBeNull();
    expect(connectErrorCopy('Transfer: insufficient lamports 100, need 2000').code).toBe('device-sol');
    expect(connectErrorCopy('ticket was issued for another owner').code).toBe('ticket-other-owner');
  });
});
