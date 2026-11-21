// ─── Success copy for money actions (Q0310) ───
// Top up / Settle / Withdraw refunds / Send closed their dialog on success with nothing else: the
// person could not tell it worked. Browser-safe; the screens toast these after the call returns.

import { tr, trPlural } from './i18n';
export function topUpToast(amountTdvpn: string): string {
  return tr('Topped up {amountTdvpn} tDVPN.', { amountTdvpn });
}

/** `sigs`: the transactions the settlement run sent (none = nothing was ready). */
export function settleToast(sigs: unknown): string {
  const n = Array.isArray(sigs) ? sigs.length : 0;
  if (n === 0) return tr('No refund is ready yet. Each one arrives automatically when its 2-hour wait ends.');
  return n === 1 ? tr('Refund started. It reaches your wallet when ready.') : trPlural({ one: '{count} refund started. It reaches your wallet when ready.', other: '{count} refunds started. Each reaches your wallet when ready.' }, n, { count: n });
}

export function withdrawToast(amountTdvpn: string): string {
  return tr('Added {amountTdvpn} tDVPN of refunds to your wallet.', { amountTdvpn });
}

export function sendToast(amount: string, asset: 'sol' | 'tdvpn', to: string): string {
  return tr('Sent {amount} {asset} to {address}.', { amount, asset: asset === 'sol' ? 'SOL' : 'tDVPN', address: `${to.slice(0, 4)}…${to.slice(-4)}` });
}
