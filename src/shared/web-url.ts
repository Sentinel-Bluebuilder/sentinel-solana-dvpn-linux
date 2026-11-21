// ─── A web address for the browser opened through the VPN (W31-16, rc9-c2, review) ───
// `proxy browser --url` handed its value to Edge / Chrome as a bare argument, so `--proxy-server=direct://` made the
// "through the VPN" window go direct and `--renderer-cmd-prefix=` started a program. Only an http(s) URL is taken,
// as its normalised href (never a value that starts with '-'). Pure; shared by every OS's browser.ts and the CLI.

/** The href of an http: or https: URL, or null for anything else (a flag, file:, javascript:, data:, not a URL). */
export function webUrl(raw: string): string | null {
  const v = String(raw ?? '').trim();
  if (!v || v.startsWith('-')) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch (err) {
    console.warn(`[web-url] not a URL: ${(err as Error).message}`);
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname) return null;
  return u.href;
}

export const WEB_URL_ONLY = '--url takes only a web address (http:// or https://). Nothing was opened.';
