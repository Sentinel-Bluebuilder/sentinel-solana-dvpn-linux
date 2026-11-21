// Q0357: dvpnd's post-connect tunnel check ends a session that carries nothing; the app must say why
// (never the generic "tunnel didn't come up" copy, never the TLS-interception copy).
import { describe, expect, it } from 'vitest';
import { closeReasonCopy, connectErrorCopy } from '../../src/core/session/state';

const LARGE =
  'StartSession: unknown: this network drops large packets, so the tunnel cannot carry traffic; a node with V2Ray or Xray usually works ' +
  '(after clamping TCP to a 1280-byte path: fetching https://www.cloudflare.com/cdn-cgi/trace through the tunnel: ' +
  'Get "https://www.cloudflare.com/cdn-cgi/trace": tls: failed to verify certificate: x509: certificate signed by unknown authority)';
const DEAD =
  'StartSession: unknown: no traffic passes through the tunnel: the node accepted the session but nothing comes back; ' +
  'try another node or protocol (connecting to www.google.com:443 through the tunnel: not ready)';

describe('tunnel check copy (Q0357)', () => {
  it('a path that drops large packets says so and points to a TCP protocol', () => {
    const c = connectErrorCopy(LARGE);
    expect(c.code).toBe('tunnel-mtu');
    expect(c.message).toMatch(/drops large packets/);
    expect(c.message).toMatch(/V2Ray or Xray/);
    expect(c.action).toBe('Try another protocol');
    expect(c.retry).toBe(false);
  });

  it('a dead tunnel is not mistaken for a tunnel that never came up', () => {
    const c = connectErrorCopy(DEAD);
    expect(c.code).toBe('tunnel-dead');
    expect(c.message).toMatch(/no traffic passes/);
    expect(c.retry).toBe(true);
  });

  // Q0369 (WINFIN 11-09, final 0.2.0 x64): the real Windows text carries one raw dial line per probe target.
  // No user-facing copy (connect error, session list, history) may show any of it; the raw text is for logs only.
  const WIN_DEAD =
    'calling daemon: rpc error: code = FailedPrecondition desc = failed precondition: no traffic passes through the tunnel: ' +
    'the node accepted the session but nothing comes back; try another node or protocol (connecting to [2606:4700:4700::1111]:53 ' +
    'through the tunnel: dial tcp [2606:4700:4700::1111]:53: connectex: An attempt was made to access a socket in a way forbidden by its access permissions.\n' +
    'connecting to www.google.com:443 through the tunnel: dial tcp: lookup www.google.com: i/o timeout\n' +
    'connecting to 9.9.9.9:53 through the tunnel: dial tcp 9.9.9.9:53: i/o timeout)';
  const RAW = /dial tcp|connectex|i\/o timeout|lookup |\d+\.\d+\.\d+\.\d+|\[[0-9a-f:]+\]|rpc error|FailedPrecondition/i;

  it('Q0369: a dead data channel on Windows is plain words in the connect error, with no raw dial text', () => {
    const c = connectErrorCopy(WIN_DEAD);
    expect(c.code).toBe('tunnel-dead');
    expect(c.message).not.toMatch(RAW);
    expect(c.action).not.toMatch(RAW);
  });

  it('Q0369: the same reason on an ended session (sessions list, history) is plain words too', () => {
    const c = closeReasonCopy(WIN_DEAD.replace(/^.*failed precondition: /, ''));
    expect(c.message).toMatch(/no traffic gets through/);
    expect(c.message).not.toMatch(RAW);
    expect(closeReasonCopy(LARGE).message).toMatch(/drops large packets/);
    expect(closeReasonCopy(LARGE).message).not.toMatch(/x509|cdn-cgi/);
  });

  it('the generic tunnel copy is unchanged', () => {
    expect(connectErrorCopy('StartSession: failed precondition: starting service: handshake did not complete').code).toBe('tunnel-failed');
  });
});
