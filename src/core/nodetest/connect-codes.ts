// ─── Node test: what a failed connect means for the server (row 151) ───
// The app's connect answers with a fixed code (core/session/state.ts connectErrorCopy and
// main/services/connection.ts). Each one maps to one test result code here, so no error
// text ever decides a verdict. Anything on our side, the Solana network or this computer
// reads "not tested"; only what the server itself did counts against it.
import type { ResultCode } from './stages';

export const CONNECT_CODE_TO_RESULT: Readonly<Record<string, ResultCode>> = {
  cancelled: 'STOPPED',
  // this computer / the VPN service
  'not-confirmed': 'SERVICE_NOT_READY',
  'no-wallet': 'SERVICE_NOT_READY',
  'keyfile-missing': 'SERVICE_NOT_READY',
  'keyfile-mode': 'SERVICE_NOT_READY',
  'wallet-switch-needed': 'SERVICE_NOT_READY',
  'clock-skew': 'SERVICE_NOT_READY', // rc.4 E-22: this computer's clock, refused before paying
  'no-device': 'SERVICE_NOT_READY',
  'device-permission': 'SERVICE_NOT_READY',
  'daemon-missing': 'SERVICE_NOT_READY',
  'daemon-restarting': 'SERVICE_NOT_READY',
  'daemon-relogin': 'SERVICE_NOT_READY',
  'daemon-unavailable': 'SERVICE_NOT_READY',
  'network-mismatch': 'SERVICE_NOT_READY',
  'service-stopped-connecting': 'SERVICE_NOT_READY',
  'session-active': 'SERVICE_NOT_READY',
  'tunnel-closing': 'SERVICE_NOT_READY',
  'tunnel-left': 'SERVICE_NOT_READY',
  'kill-switch-held': 'SERVICE_NOT_READY',
  'kill-switch-failed': 'SERVICE_NOT_READY',
  'switch-reconnecting': 'SERVICE_NOT_READY',
  'switch-offline': 'SERVICE_NOT_READY',
  'stop-failed': 'SERVICE_NOT_READY',
  'port-in-use': 'SERVICE_NOT_READY',
  'dns-apply': 'SERVICE_NOT_READY',
  'waiting-for-network': 'SERVICE_NOT_READY',
  'protocol-missing': 'PROTOCOL_UNSUPPORTED',
  busy: 'SERVICE_NOT_READY',
  'test-running': 'SERVICE_NOT_READY',
  unsupported: 'SERVICE_NOT_READY',
  'plan-limit': 'SERVICE_NOT_READY',
  'approval-revoked': 'SERVICE_NOT_READY',
  'protocol-blocked': 'SERVICE_NOT_READY',
  'driver-missing': 'SERVICE_NOT_READY',
  'dns-revert-failed': 'SERVICE_NOT_READY',
  // plans (a test never uses one; if it ever answers, it is ours)
  'ticket-other-owner': 'SERVICE_NOT_READY',
  subscription_invalid: 'SERVICE_NOT_READY',
  ticket_request_stale: 'SERVICE_NOT_READY',
  provider_unreachable: 'SERVICE_NOT_READY',
  ticket_invalid: 'SERVICE_NOT_READY',
  // the check before paying (nothing was paid)
  'node-gone': 'NOT_FOUND',
  'node-stale': 'LISTING_EXPIRED',
  'basis-unavailable': 'NO_PRICE',
  'not-enough-tdvpn': 'NOT_ENOUGH_FUNDS',
  'spending-limit': 'SPENDING_LIMIT',
  preflight: 'PAYMENT_FAILED',
  // the Solana network
  'rpc-busy': 'SOLANA_BUSY',
  'rpc-unavailable': 'SOLANA_BUSY',
  'rpc-ws': 'SOLANA_BUSY',
  'rpc-quota': 'SOLANA_BUSY',
  'rpc-timeout': 'SOLANA_BUSY',
  'rpc-network': 'SOLANA_BUSY',
  'chain-encoding': 'SOLANA_BUSY',
  'deposit-pending': 'SOLANA_BUSY',
  // CODE-AUDIT E12: the open-deposit read before paying failed; nothing was paid, try again (never the server's fault)
  'deposits-unread': 'SOLANA_BUSY',
  // money
  'device-sol': 'NOT_ENOUGH_FUNDS',
  // the server
  'node-identity': 'CONNECT_REFUSED',
  'node-ledger': 'CONNECT_REFUSED',
  'node-price': 'CONNECT_REFUSED',
  'node-error': 'CONNECT_REFUSED',
  // CODE-AUDIT E3: a reused deposit the server refused, or one whose refund started (not reached by the test's own connect)
  'deposit-unusable': 'CONNECT_REFUSED',
  // CODE-AUDIT U-13/U-15: the price went up since the deposit was sized; nothing was paid
  'price-changed': 'CONNECT_REFUSED',
  'node-offline': 'UNREACHABLE',
  peer_limit_reached: 'SERVER_FULL',
  credit_exhausted: 'CONNECT_REFUSED',
  lease_insufficient: 'CONNECT_REFUSED',
  unauthorized: 'CONNECT_REFUSED',
  'cannot cover the prepay': 'CONNECT_REFUSED',
  voucher_exceeds_escrow: 'CONNECT_REFUSED',
  channel_node_reopened: 'CONNECT_REFUSED',
  terms_rejected: 'CONNECT_REFUSED',
  rate_limited: 'CONNECT_REFUSED',
  voucher_signature_invalid: 'CONNECT_REFUSED',
  mode_not_voucher: 'CONNECT_REFUSED',
  mode_not_stream: 'CONNECT_REFUSED',
  timeout: 'CONNECT_TIMEOUT',
  'tunnel-failed': 'CONNECT_FAILED',
  'tunnel-mtu': 'CONNECT_FAILED',
  'tunnel-dead': 'CONNECT_FAILED',
};

/**
 * `paid` = a deposit exists for this try. An unknown code before payment is ours ("not tested");
 * after payment the server had its deposit and still did not connect.
 */
export function connectResultCode(code: string | undefined, paid: boolean): ResultCode {
  const known = code ? CONNECT_CODE_TO_RESULT[code] : undefined;
  if (known) return known;
  return paid ? 'CONNECT_FAILED' : 'PAYMENT_FAILED';
}
