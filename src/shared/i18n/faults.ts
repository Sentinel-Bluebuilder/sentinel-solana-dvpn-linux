// ─── i18n page faults: the shape the picture run records (found by renderer/src/lib/i18n-faults.ts) ───
export type FaultKind = 'clipped' | 'ellipsis' | 'off-window' | 'untranslated';
export interface Fault { kind: FaultKind; text: string; where: string; detail?: string }
export interface ScreenFaults { screen: string; lang: string; shown: number; translated: number; faults: Fault[] }

/** One line per screen for the run's summary: shown vs translated, and fault counts by kind. */
export function summariseFaults(rows: ScreenFaults[]): string[] {
  return rows.map((r) => {
    const by: Record<string, number> = {};
    for (const f of r.faults) by[f.kind] = (by[f.kind] ?? 0) + 1;
    const kinds = Object.entries(by).map(([k, n]) => `${k} ${n}`).join(', ');
    return `${r.screen} [${r.lang}] shown ${r.shown}, translated ${r.translated}${kinds ? `; ${kinds}` : '; no faults'}`;
  });
}
