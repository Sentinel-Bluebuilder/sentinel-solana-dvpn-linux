// ─── How far this computer's spending limit is raised (owner 2026-11-12) ───
// Each deposit uses up part of the limit (the token delegation) and refunds do not add it back. A
// limit raised to exactly one deposit ran out on the next Connect, so every Connect signed the
// permission again (log 23:35, 23:36, 00:31, 00:32, 00:49, 00:50). Raise it to cover several.

/** Deposits of this size one raise covers before the next one is needed. */
export const DEPOSITS_PER_RAISE = 10n;

/** The limit to sign, in base units: the Settings limit, or room for 10 deposits of this size if more. */
export function deviceLimitFor(settingBase: bigint, depositBase: bigint): bigint {
  const room = depositBase * DEPOSITS_PER_RAISE;
  return room > settingBase ? room : settingBase;
}

/** W91b (the agent kit rc.9): a first setup with no allowance given is capped at what the wallet holds (never below this
 *  deposit; not capped when it holds nothing or that is unknown), the same rule as `device setup` (W91). */
export function firstSetupLimit(wantBase: bigint, ownBase: bigint | null, depositBase: bigint): bigint {
  if (ownBase === null || ownBase <= 0n || ownBase >= wantBase) return wantBase;
  return ownBase > depositBase ? ownBase : depositBase;
}
