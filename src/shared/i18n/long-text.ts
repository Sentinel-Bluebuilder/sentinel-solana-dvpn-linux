// ─── The long-text test language (code en-XL) ───
// Every sentence comes out at least 40% longer, still readable, so the pictures show where a
// longer language would clip or overflow. Letters get accents (a missed tr() call stands out as
// plain English); padding words are appended so lines wrap like real words do.
// Numbers, addresses and anything in {braces} are left as they are.

const ACCENT: Record<string, string> = {
  a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý', c: 'ç', n: 'ñ',
  A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', Y: 'Ý', C: 'Ç', N: 'Ñ',
};
const PAD_WORDS = ['ŀóñĝ', 'ŵóŕð', 'ţéxţ', 'ƒíŀŀ'];

export const LONG_TEXT_FACTOR = 1.4;

/** Characters of `s` a person reads (combining marks are not counted twice). */
export const visibleLength = (s: string): number => [...s.normalize('NFC')].length;

/** Words that stay as written in every language (plan: never translated), so en-XL cannot mark them. */
const KEPT = /^(Devnet|dVPN|Sentinel|Solana|tDVPN|SOL|WireGuard|AmneziaWG|OpenVPN|V2Ray|Xray|VLESS|VMess|Trojan|Shadowsocks|Hysteria2?|TUIC|SOCKS5?|DNS|IP|IPv[46]|RPC|URL|CLI|LAN|VPN|OK|ID|GB|MB|KB|UTC)$/;

/**
 * Words on screen in en-XL that skipped tr(): en-XL accents every plain vowel, so a word that still
 * has one did not come through tr() (or came through a placeholder value that is not translated).
 */
export function skippedTr(text: string): string[] {
  return text.split(/\s+/).map((w) => w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')).filter((w) =>
    w.length >= 2 && /^[A-Za-z]/.test(w) && !/[\d@/\\]|\w\.\w/.test(w) && !KEPT.test(w) && /[aeiouyAEIOUY]/.test(w));
}

export function longText(s: string): string {
  if (!s.trim()) return s;
  // Words with a digit, an @, a slash or a dot inside (amounts, addresses, hosts) stay as written.
  const body = s.split(/(\s+)/).map((w) => (/[\d@/\\]|\w\.\w/.test(w) ? w : [...w].map((ch) => ACCENT[ch] ?? ch).join(''))).join('');
  const want = Math.ceil(visibleLength(s) * LONG_TEXT_FACTOR);
  let out = body;
  let i = 0;
  while (visibleLength(out) < want) out += ' ' + PAD_WORDS[i++ % PAD_WORDS.length];
  return out;
}
