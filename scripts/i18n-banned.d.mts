// ─── Types for scripts/i18n-banned.mjs ───
export const LIST_PATH: string;
export function inScope(rel: string): boolean;
export function loadMatchers(listPath?: string): Array<{ name: string; re: RegExp }> | null;
export function addedLines(diffText: string): Array<{ file: string; line: number; text: string }>;
export function scan(opts?: { listPath?: string; diffPath?: string }): { skipped: boolean; fail: string[]; listed: string[] };
