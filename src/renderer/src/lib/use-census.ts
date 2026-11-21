// ─── The server count, for every screen (rows 143–147) ───
// One census (core/nodes/census.ts), recomputed when the list changes and once a minute,
// so a check result ages out while a page stays open. Screens never count servers themselves.
import { useEffect, useMemo, useState } from 'react';
import { census, censusLine, type Census, type CensusEntry } from '../../../core/nodes/census';
import type { NodeView } from '../../../shared/types';
import { tr } from '../../../shared/i18n';

const TICK_MS = 60_000;

/** "12:04" in the user's locale. */
export const clock = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

export interface CensusView {
  c: Census;
  /** address → its entry. */
  byAddress: Map<string, CensusEntry>;
  /** "Checked 47 of 47 at 12:23" / "Last checked at 14:02, checking again" / "Not checked yet (47 on the network)". */
  line: string;
}

export function useCensus(nodes: readonly NodeView[]): CensusView {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);
  return useMemo(() => {
    // `nodes` changed = a fresh result arrived: judge it against the present, not the last tick.
    const c = census(nodes, Math.max(now, Date.now()));
    return { c, byAddress: new Map(c.entries.map((e) => [e.address, e])), line: censusLine(c, clock) };
  }, [nodes, now]);
}

/** What a row shows in its Response cell. Never a latency for a server that is not checked. */
export function rowStatus(e: CensusEntry | undefined, latencyMs: number | null | undefined, checking: boolean): { label: string; tone: string; title?: string } {
  if (!e) return { label: tr('Not checked'), tone: 'text-fg-muted' };
  switch (e.state) {
    case 'usable': return { label: `${latencyMs ?? '?'} ms`, tone: 'text-ok' };
    case 'verified-busy': return { label: e.reason === 'full' ? 'Full' : tr('Not supported'), tone: 'text-warn', title: e.sentence ?? undefined };
    case 'unverified': return { label: tr('Not verified'), tone: 'text-bad', title: e.sentence ?? undefined };
    case 'not-answering': return { label: tr('Offline'), tone: 'text-bad', title: e.sentence ?? undefined };
    case 'listing-expired': return { label: tr('Left the network'), tone: 'text-fg-muted', title: e.sentence ?? undefined };
    default:
      // Not checked: keep what the last check said, greyed, while the next one runs.
      if (e.previous?.state === 'usable') return { label: `${e.previous.latencyMs ?? '?'} ms`, tone: 'text-fg-muted', title: tr('Last checked {clock}. Checking again.', { clock: clock(e.previous.checkedAt) }) };
      return { label: checking || e.previous ? 'Checking' : tr('Not checked'), tone: 'text-fg-muted', title: e.sentence ?? undefined };
  }
}
