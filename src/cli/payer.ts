// ─── E-27 / E-64: every paid answer names the wallet that paid ───
// connect() returns LiveSession.payer (read from the deposit account itself, 15e95175 / a35cbb8e; null = not read).
// When it is not the loaded wallet, say so plainly: an agent with KEY2 on KEY1's device was told only "not funded".

/** "AbCd…WxYz": enough to tell two wallets apart, short enough for one line. */
export function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}

/** The payer sentence, or null when the deposit account could not be read (nothing is guessed). */
export function payerNote(payer: string | null | undefined, loaded: string | null | undefined): string | null {
  if (!payer) return null;
  if (loaded && payer !== loaded) return `Paid by ${shortAddr(payer)}, not the loaded wallet ${shortAddr(loaded)}.`;
  return `Paid from ${shortAddr(payer)}.`;
}
