// ─── RPC URLs as shown to the user ───
// FMC-M6 (Mac, ported): `daemon set`'s confirm prompt printed the whole settings JSON, gate token included.
// A gate or provider token can sit in the path, the query or the login part, so only scheme + host is shown.

export function rpcShown(u: unknown): string {
  if (typeof u !== 'string' || !u) return String(u ?? '');
  try {
    const x = new URL(u);
    return `${x.protocol}//${x.host}${x.pathname !== '/' || x.search || x.username || x.password ? '/<hidden>' : ''}`;
  } catch (err) {
    console.warn(`rpc url not parseable; hidden (${(err as Error).message})`);
    return '<hidden>';
  }
}

/** A settings object with its RPC URLs shown as above; every other field unchanged. */
export function settingsShown<T extends object>(s: T): T {
  const o = { ...s } as Record<string, unknown>;
  for (const k of ['rpcUrl', 'rpcWsUrl']) if (k in o) o[k] = rpcShown(o[k]);
  return o as T;
}
