// ─── RPC key masking ───
// RPC URLs carry provider API keys: never show them on screen. A key sits in the query string
// (Helius ?api-key=), in the path (Alchemy /v2/<key>, QuickNode /<token>/) or as user:password@.
// The path rule is the logger's (main/logger.ts redactUrls): a segment of 20+ key characters.
// A masked line that comes back unchanged maps to the stored URL (unmaskRpcUrls).

export const KEY_MASK = '••••';

const PATH_KEY = /^[A-Za-z0-9_-]{20,}$/;

export function maskRpcKey(url: string): string {
  return url
    .replace(/^((?:https?|wss?):\/\/)[^\s/?#@]+@/i, `$1${KEY_MASK}@`)
    .replace(/^((?:https?|wss?):\/\/[^\s/?#]+)(\/[^\s?#]*)/i, (_m, origin: string, p: string) => origin + p.split('/').map((seg) => (PATH_KEY.test(seg) ? KEY_MASK : seg)).join('/'))
    .replace(/([?&](?:api[-_]?key|key|token)=)[^&\s]+/gi, `$1${KEY_MASK}`);
}

/** Lines the user saved: a line still showing the mask means "unchanged", so the stored URL is used. */
export function unmaskRpcUrls(lines: string[], stored: string[]): string[] {
  return lines.map((u) => (u.includes(KEY_MASK) ? stored.find((o) => maskRpcKey(o) === u) ?? u : u));
}
