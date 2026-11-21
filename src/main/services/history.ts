// ─── Local session history + export (F13.4, F13.5) ───
import type { HistoryEntry, LiveSession } from '../../shared/types';
import { readJson, writeJson } from '../store';
import { tr } from '../../shared/i18n';

const FILE = 'history.json';
const MAX = 1000;

// History belongs to a wallet, not to the computer (owner 2026-11-11: a new wallet showed the old
// wallet's servers under "Your servers"). main/index.ts wires the current wallet in; unset (tests,
// tools) = no filter.
let currentOwner: () => string | null = () => null;
let filtered = false;
export function setHistoryOwner(fn: () => string | null): void { currentOwner = fn; filtered = true; }

function allHistory(): HistoryEntry[] {
  return readJson<HistoryEntry[]>(FILE, []);
}

/** The current wallet's sessions (all of them when no wallet source is wired). */
export function listHistory(): HistoryEntry[] {
  const all = allHistory();
  if (!filtered) return all;
  const owner = currentOwner();
  return owner ? all.filter((h) => h.owner === owner) : [];
}

/**
 * Entries from before history had an owner belong to the wallet that set this computer up
 * (device.json owner, read at startup before any wallet switch rewrites it). Run once at startup.
 */
export function stampLegacyHistory(owner: string | null): number {
  if (!owner) return 0;
  const all = allHistory();
  let n = 0;
  for (const h of all) if (!h.owner) { h.owner = owner; n++; }
  if (n) save(all);
  return n;
}

function save(list: HistoryEntry[]): void {
  writeJson(FILE, list.slice(0, MAX));
}

export function recordStart(s: LiveSession, country = ''): void {
  const list = allHistory().filter((h) => h.id !== s.id);
  const owner = currentOwner();
  list.unshift({
    id: s.id, node: s.node, country, service: s.service, startedAt: s.startedAt ?? Date.now(), endedAt: null,
    rxBytes: s.rxBytes, txBytes: s.txBytes, spent: s.spent, channel: s.channel, closeReason: null,
    ...(owner ? { owner } : {}),
  });
  save(list);
}

export function recordEnd(s: LiveSession, reason: string): void {
  const list = allHistory();
  const h = list.find((x) => x.id === s.id);
  if (!h) return;
  Object.assign(h, { endedAt: Date.now(), rxBytes: s.rxBytes, txBytes: s.txBytes, spent: s.spent, closeReason: reason || null });
  save(list);
}

/** What closeEndedHistory needs from one row of dvpnd's session list. */
export interface ServiceRow {
  id: string;
  running: boolean;
  endedAt?: number | null;
  rxBytes?: string;
  txBytes?: string;
  spent?: string;
  reason?: string;
  replacedBy?: string;
}

/**
 * Q0505 (Linux hunt): a session dvpnd ended itself while no app was watching (CLI connect, then the
 * CLI exits) stayed "active" in history forever: endedAt null, 0 B, 0 spent. On every read of the
 * service's list, an open entry the service no longer runs is closed with the service's own totals and
 * reason when it still lists the row, else with "Ended by the VPN service". Never touches `keepId`
 * (the session the app shows) or a session the service reconnected as a new one (the chain goes on).
 */
export function closeEndedHistory(rows: ServiceRow[], keepId: string | null = null, now = Date.now()): number {
  const all = allHistory();
  let n = 0;
  for (const h of all) {
    if (h.endedAt !== null || h.id === keepId) continue;
    const row = rows.find((r) => r.id === h.id);
    if (row?.running || row?.replacedBy) continue;
    Object.assign(h, {
      endedAt: row?.endedAt || now,
      ...(row?.rxBytes ? { rxBytes: row.rxBytes } : {}),
      ...(row?.txBytes ? { txBytes: row.txBytes } : {}),
      ...(row?.spent ? { spent: row.spent } : {}),
      closeReason: row?.reason || h.closeReason || tr('Ended by the VPN service'),
    });
    n++;
  }
  if (n) save(all);
  return n;
}

export function historyCsv(list = listHistory()): string {
  const cols: Array<keyof HistoryEntry> = ['id', 'node', 'country', 'service', 'startedAt', 'endedAt', 'rxBytes', 'txBytes', 'spent', 'channel', 'closeReason'];
  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...list.map((h) => cols.map((c) => esc(h[c])).join(','))].join('\n') + '\n';
}
