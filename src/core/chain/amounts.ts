// ─── Amount helpers (pure; ported from plans-solana lib/solana/accounts.js) ───
// tDVPN has 6 decimals. All on-chain amounts are base-unit strings so u64 values
// never pass through a float. No Node imports: the renderer uses this file too.
// TOKEN_DECIMALS must equal idl.TOKEN_DECIMALS (asserted in tests/unit/core-pure.test.ts).
import { ShownError } from '../../shared/i18n/shown-error';
export const TOKEN_DECIMALS = 6;

export const U64_MAX = 2n ** 64n - 1n;
const UNIT = 10n ** BigInt(TOKEN_DECIMALS);

export class AmountError extends ShownError {
  code = 'invalid-amount';
}

/** Base units → human tDVPN string ("1.5"). */
export function tdvpn(baseUnits: string | bigint | number | null | undefined): string {
  const n = BigInt(String(baseUnits ?? '0'));
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const whole = abs / UNIT;
  const frac = (abs % UNIT).toString().padStart(TOKEN_DECIMALS, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** Human tDVPN string → base-unit string. Throws AmountError. */
export function toBaseUnits(amount: string): string {
  const s = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new AmountError('"{amount}" is not a tDVPN amount. Use a number like 2.5.', { amount });
  const [whole, frac = ''] = s.split('.');
  if (frac.length > TOKEN_DECIMALS) throw new AmountError('A tDVPN amount has at most {decimals} decimals; "{amount}" has more.', { decimals: TOKEN_DECIMALS, amount });
  const base = BigInt(whole) * UNIT + BigInt((frac + '0'.repeat(TOKEN_DECIMALS)).slice(0, TOKEN_DECIMALS));
  if (base > U64_MAX) throw new AmountError('The tDVPN amount "{amount}" is too large.', { amount });
  return base.toString();
}

/** SOL string → lamports. */
export function toLamports(amount: string): bigint {
  const s = String(amount ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new AmountError('"{amount}" is not a SOL amount. Use a number like 0.05.', { amount });
  const [whole, frac = ''] = s.split('.');
  if (frac.length > 9) throw new AmountError('SOL has 9 decimals, got "{amount}"', { amount });
  return BigInt(whole) * 1_000_000_000n + BigInt((frac + '000000000').slice(0, 9));
}

export function sol(lamports: number | bigint | string): string {
  const n = BigInt(String(lamports));
  const whole = n / 1_000_000_000n;
  const frac = (n % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}
