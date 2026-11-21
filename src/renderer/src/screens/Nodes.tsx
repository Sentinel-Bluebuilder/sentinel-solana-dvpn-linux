// ─── Server browser (F6, F7) ───
// Listed ≠ online: only nodes whose signed metadata verified are connectable.
// Row ORDER is frozen until the user presses "Re-sort" so probe results never
// make rows jump under the cursor; row DATA updates live.
import { useEffect, useMemo, useState } from 'react';
import { call, useApp } from '../lib/store';
import { Copy, Flag, PageHeader, Skeleton } from '../components/ui';
import { Icon } from '../components/Icon';
import { ProtocolList } from '../components/ProtocolMark';
import { ConnectSheet } from '../components/ConnectSheet';
import { rowStatus, useCensus } from '../lib/use-census';
import { useKept } from '../lib/use-kept';
import { priceLabel, countryName, short } from '../../../shared/format';
import { protocolLabel } from '../../../shared/protocols';
import type { CensusEntry } from '../../../core/nodes/census';
import { Term } from '../components/Term';
import type { AppSnapshot, NodeView } from '../../../shared/types';
import type { Screen } from '../App';
import { tr } from '../../../shared/i18n';

type Sort = 'latency' | 'price_gb' | 'price_hour' | 'peers';
const PROTOCOLS = ['wireguard', 'v2ray', 'xray', 'openvpn', 'amneziawg', 'hysteria2'];
// Server rows: the Protocols column only where it fits (a 1366x768 screen at 150 % leaves ~630 px of
// page); narrower, the protocol marks sit under the address and the server name keeps its width.
// Every column is centered under its header except Server (owner 2026-11-12: "properly aligned").
const ROW_COLS = 'grid-cols-[28px_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_96px] min-[1100px]:grid-cols-[28px_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_96px]';

// Online first, then servers whose last (expired) check said online, then the rest.
function sortKey(n: NodeView, sort: Sort, e: CensusEntry | undefined): number {
  const off = e?.state === 'usable' ? 0 : e?.previous?.state === 'usable' ? 1e12 : 1e15;
  if (sort === 'latency') return off + (n.probe?.latencyMs ?? 9e9);
  if (sort === 'price_gb') return off + (Number(n.pricePerGb) || 9e12);
  if (sort === 'price_hour') return off + (Number(n.pricePerHour) || 9e12);
  return off + (n.probe?.peers ?? 9e9);
}

export function Nodes({ snap }: { snap: AppSnapshot; go: (s: Screen) => void }) {
  // Selectors, not the whole store: a toast or an unrelated update does not re-render the list (UI-013).
  const nodes = useApp((s) => s.nodes);
  const probeProgress = useApp((s) => s.probeProgress);
  // The one server count (rows 143–147): this page never counts servers itself.
  const { c, byAddress, line } = useCensus(nodes);
  const usable = (n: NodeView): boolean => byAddress.get(n.address)?.state === 'usable';
  // Search, filters, sort and open countries are kept when you leave the page and come back (UI-021).
  const [q, setQ] = useKept('servers.q', '');
  const [onlineOnly, setOnlineOnly] = useKept('servers.onlineOnly', true);
  const [favOnly, setFavOnly] = useKept('servers.favOnly', false);
  const [recentOnly, setRecentOnly] = useKept('servers.recentOnly', false);
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => { call<string[]>(window.api.IPC.RECENT_NODES, undefined, { quiet: true }).then(setRecent, () => setRecent([])); }, []);
  const [proto, setProto] = useKept('servers.proto', '');
  const [basis, setBasis] = useKept<'' | 'per_gb' | 'per_hour'>('servers.basis', '');
  const [sort, setSort] = useKept<Sort>('servers.sort', 'latency');
  const [open, setOpen] = useKept<Record<string, boolean>>('servers.open', {});
  const [detail, setDetail] = useState<string | null>(null);
  const [sheet, setSheet] = useState<NodeView | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    call<NodeView[]>(window.api.IPC.NODES_LIST).then((list) => { if (list.length) useApp.getState().setNodes(list); }, (err) => console.warn('node list failed', err)).finally(() => setLoaded(true));
  }, []);

  const resort = (list = nodes): void => setOrder([...list].sort((a, b) => sortKey(a, sort, byAddress.get(a.address)) - sortKey(b, sort, byAddress.get(b.address))).map((n) => n.address));
  // Re-sort when the set of nodes changes or the user changes the sort, never on probe updates.
  const membership = nodes.map((n) => n.address).sort().join(',');
  useEffect(() => { resort(); }, [membership, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const byAddr = useMemo(() => new Map(nodes.map((n) => [n.address, n])), [nodes]);
  const needle = q.trim().toLowerCase();
  const visible = order.map((a) => byAddr.get(a)).filter((n): n is NodeView => !!n).filter((n) =>
    (!onlineOnly || usable(n) || byAddress.get(n.address)?.previous?.state === 'usable' || (byAddress.get(n.address)?.state === 'not-checked' && !!probeProgress))
    && (!favOnly || n.favourite)
    && (!recentOnly || recent.includes(n.address))
    && (!proto || n.protocolNames.includes(proto))
    && (!basis || BigInt((basis === 'per_gb' ? n.pricePerGb : n.pricePerHour) || '0') > 0n)
    && (!needle || [n.country, n.countryCode, n.probe?.city ?? '', n.address].some((f) => f.toLowerCase().includes(needle))));

  const groups = useMemo(() => {
    const m = new Map<string, NodeView[]>();
    for (const n of visible) m.set(n.countryCode || '??', [...(m.get(n.countryCode || '??') ?? []), n]);
    return [...m.entries()].sort((a, b) => countryName(a[0]).localeCompare(countryName(b[0])));
  }, [visible]);

  const onlineCount = c.usable;
  const searching = needle.length > 0;

  return (
    <div>
      <PageHeader
        title={tr('Servers')}
        subtitle={[tr('{usable} of {onNetwork} online.', { usable: c.usable, onNetwork: c.onNetwork }), probeProgress ? tr('Checking {done} of {total}.', { done: probeProgress.done, total: probeProgress.total }) : line].join(' ')}
        right={<><button className="btn-ghost" title={tr('Rows stay still while servers are checked; this re-orders them by the current sort.')} onClick={() => resort()}>{tr('Re-sort')}</button><button className="btn-ghost" onClick={() => void call(window.api.IPC.NODES_REFRESH)}>{tr('Refresh')}</button></>}
      />
      {/* One toolbar row: search takes the free width, filters keep one height, toggles are chips. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input className="input min-w-[220px] flex-1" placeholder={tr('Search country, city or address')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tr('Search servers')} />
        <select className="input w-40" value={proto} onChange={(e) => setProto(e.target.value)} aria-label={tr('Protocol')}>
          <option value="">{tr('All protocols')}</option>
          {PROTOCOLS.map((p) => <option key={p} value={p}>{protocolLabel(p)}</option>)}
        </select>
        <select className="input w-36" value={basis} onChange={(e) => setBasis(e.target.value as typeof basis)} aria-label={tr('Pricing')}>
          <option value="">{tr('Any pricing')}</option>
          <option value="per_gb">{tr('Pay per GB')}</option>
          <option value="per_hour">{tr('Pay per hour')}</option>
        </select>
        <select className="input w-44" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={tr('Sort')}>
          <option value="latency">{tr('Fastest response')}</option>
          <option value="price_gb">{tr('Price per GB')}</option>
          <option value="price_hour">{tr('Price per hour')}</option>
          <option value="peers">{tr('Fewest users')}</option>
        </select>
        <label className={`toggle-chip ${onlineOnly ? 'toggle-chip-on' : ''}`}><input type="checkbox" checked={onlineOnly} onChange={(e) => setOnlineOnly(e.target.checked)} /> {tr('Online only')}</label>
        <label className={`toggle-chip ${favOnly ? 'toggle-chip-on' : ''}`}><input type="checkbox" checked={favOnly} onChange={(e) => setFavOnly(e.target.checked)} /> {tr('Favourites')}</label>
        <label className={`toggle-chip ${recentOnly ? 'toggle-chip-on' : ''}`}><input type="checkbox" checked={recentOnly} onChange={(e) => setRecentOnly(e.target.checked)} disabled={!recent.length} /> {tr('Recent')}</label>
      </div>

      {!loaded || (!nodes.length && probeProgress) ? <Skeleton rows={6} /> : !groups.length ? (
        <div className="empty-box">
          {!c.onNetwork ? tr('No servers are on the network right now.')
            : onlineOnly && !onlineCount ? <>{tr('No servers are online right now.')} <button className="text-accent-ink underline" onClick={() => setOnlineOnly(false)}>{tr('Show all {onNetwork} on the network', { onNetwork: c.onNetwork })}</button></>
              : tr('No servers match these filters.')}
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map(([cc, list]) => {
            // Few countries: open them all, so the list is the page (no screen of collapsed rows).
            const isOpen = open[cc] ?? (searching || groups.length <= 3);
            const up = list.filter(usable).length;
            return (
              <div key={cc} className="card overflow-hidden p-0">
                <button className="row flex h-12 w-full items-center gap-3 px-4 text-start" aria-expanded={isOpen} onClick={() => setOpen({ ...open, [cc]: !isOpen })}>
                  <Icon name="chevron-right" className={`text-fg-muted transition-transform duration-state ${isOpen ? 'rotate-90 rtl:-rotate-90' : ''}`} />
                  <Flag code={cc} />
                  <span className="font-medium">{countryName(cc)}</span>
                  <span className="num text-meta text-fg-muted">{tr('{up} of {length} online', { up, length: list.length })}</span>
                  {/* Which protocols this country offers, before opening it (feature icons per country). */}
                  <span className="ms-auto flex items-center gap-1 text-fg-muted" data-country-protocols={cc}><ProtocolList names={[...new Set(list.flatMap((n) => n.protocolNames ?? []))]} compact /></span>
                </button>
                {isOpen && (
                  <div className={`grid h-8 ${ROW_COLS} items-center gap-4 border-t border-line px-4 text-label uppercase text-fg-muted`} aria-hidden>
                    <span /><span>{tr('Server')}</span><span className="hidden text-center min-[1100px]:block">{tr('Protocols')}</span><span className="text-center">{tr('Price')}</span><span className="flex justify-center"><Term k="responseTime">{tr('Response')}</Term></span><span />
                  </div>
                )}
                {isOpen && list.map((n) => {
                  const entry = byAddress.get(n.address);
                  const st = rowStatus(entry, n.probe?.latencyMs, !!probeProgress);
                  return (
                    <div key={n.address} className="border-t border-line" data-server-state={entry?.state}>
                      <div className={`row grid min-h-14 ${ROW_COLS} items-center gap-4 px-4 py-2`}>
                        <button className={`inline-flex h-8 w-8 items-center justify-center justify-self-center rounded transition-colors duration-press hover:bg-bg-raised ${n.favourite ? 'text-warn' : 'text-fg-muted hover:text-fg'}`} aria-label={n.favourite ? tr('Remove favourite') : tr('Add favourite')} aria-pressed={n.favourite} onClick={() => void call(window.api.IPC.FAVOURITE_TOGGLE, n.address).then(() => call<NodeView[]>(window.api.IPC.NODES_LIST)).then((l) => useApp.setState({ nodes: l }), (err) => console.warn('favourite not saved', err))}><Icon name={n.favourite ? 'star-filled' : 'star'} /></button>
                        <button className="min-w-0 text-start" onClick={() => setDetail(detail === n.address ? null : n.address)}>
                          <div className="truncate text-sm">{n.probe?.city || countryName(n.countryCode)}</div>
                          <div className="mono truncate text-meta text-fg-muted" title={n.address}>{short(n.address, 6)}</div>
                          <div className="mt-1 flex items-center gap-1 text-fg-dim min-[1100px]:hidden"><ProtocolList names={n.protocolNames} compact /></div>
                        </button>
                        <div className="hidden min-w-0 items-center justify-center gap-1 text-fg-dim min-[1100px]:flex"><ProtocolList names={n.protocolNames} /></div>
                        <div className="num flex flex-col items-center text-center text-meta leading-tight"><span className="text-fg">{priceLabel(n.pricePerGb, 'per_gb')}</span><span className="text-fg-muted">{priceLabel(n.pricePerHour, 'per_hour')}</span></div>
                        <div className={`num flex items-center justify-center gap-1.5 text-meta ${st.tone}`} title={st.title}><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden />{st.label}</div>
                        <button data-connect={n.address} className="btn-ghost btn-sm" disabled={entry?.state !== 'usable' || (!snap.conn.canConnect && snap.conn.phase !== 'connected') || snap.session?.node === n.address} title={entry?.state !== 'usable' ? (entry?.sentence ?? undefined) : undefined} onClick={() => setSheet(n)}>{tr('Connect')}</button>
                      </div>
                      {detail === n.address && <NodeDetail n={n} entry={entry} />}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
      {sheet && <ConnectSheet node={sheet} snap={snap} onClose={() => setSheet(null)} />}
    </div>
  );
}

function NodeDetail({ n, entry }: { n: NodeView; entry: CensusEntry | undefined }) {
  const p = n.probe;
  const row = (k: string, v: React.ReactNode) => <div className="flex justify-between gap-4 py-0.5"><span className="text-fg-muted">{k}</span><span className="text-end">{v}</span></div>;
  const check = (v: boolean | null | undefined) => (v == null ? '—' : v ? <Icon name="check" className="inline text-ok" label="yes" /> : <Icon name="x" className="inline text-bad" label="no" />);
  return (
    <div className="grid grid-cols-1 gap-x-8 bg-bg-input px-4 py-3 text-meta sm:grid-cols-2">
      <div>
        {row(tr('Location'), <span title={tr('Self-declared by the operator; not verified')}>{countryName(n.countryCode)}{p?.city ? `, ${p.city}` : ''} <span className="text-fg-muted">{tr('(reported)')}</span></span>)}
        {row(tr('Address'), <span className="mono">{n.address} <Copy text={n.address} /></span>)}
        {row(tr('Operator'), <span className="mono">{n.owner}</span>)}
        {row(tr('Protocols'), <ProtocolList names={n.protocolNames} />)}
        {row(tr('Users'), p?.peers != null ? `${p.peers}${p.maxPeers ? ` / ${p.maxPeers}` : ''}` : '—')}
        {row(tr('Bandwidth'), p?.downloadMbps ? tr('{down} ↓ / {up} ↑ Mbps', { down: p.downloadMbps, up: p.uploadMbps ?? '?' }) : '—')}
        {row(tr('Version'), p?.version ?? '—')}
      </div>
      <div>
        {row(tr('On the network'), entry && entry.state !== 'listing-expired' ? tr('yes, renews by {value}', { value: new Date(n.expiresAt * 1000).toLocaleString() }) : 'no')}
        {row(tr('Signed by owner or allowed operator'), check(p?.signerAuthorized))}
        {row(tr('Signature valid'), check(p?.signatureValid))}
        {row(tr('Matches chain'), check(p?.claimsMatch))}
        {row(tr('TLS key pinned'), check(p?.tlsPinMatch))}
        {entry?.sentence && entry.state !== 'usable' && row(tr('Status'), <span className={entry.state === 'not-checked' ? 'text-fg-muted' : 'text-bad'}>{entry.previous ? tr('Checking again.') : entry.sentence}</span>)}
      </div>
    </div>
  );
}
