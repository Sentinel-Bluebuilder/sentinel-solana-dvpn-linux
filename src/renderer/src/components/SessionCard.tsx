// ─── Status card (UI-040 to UI-043) ───
// The connection at a glance, from every page: state, place, protocol; a clock and data while
// connected; the step while connecting; Restore network when the internet may be blocked.
// One view (core/session/status-card) for the sidebar card, the More list and the phone header.
// The card has one height in every state, and a click opens the Connect page.
import { useEffect, useState } from 'react';
import { RestoreNetworkButton } from './RestoreNetworkButton';
import { call, useApp } from '../lib/store';
import { Icon } from './Icon';
import { Flag } from './ui';
import { ProtocolMark } from './ProtocolMark';
import { protocolLabel } from '../../../shared/protocols';
import { countryName, formatBytes, formatDuration } from '../../../shared/format';
import { coverageCopy } from '../../../core/session/coverage';
import { IDLE_LINE, statusCard, type CardView } from '../../../core/session/status-card';
import type { StageInput, Tone } from '../../../core/session/connect-stage';
import type { AppSnapshot } from '../../../shared/types';
import { tr } from '../../../shared/i18n';

/** The stage input every surface derives the same way (Connect screen, status card). */
export function stageInput(snap: AppSnapshot): StageInput {
  const { conn, coverage } = snap;
  const live = conn.phase === 'connected';
  const safe = live && !!coverage && coverageCopy(coverage).ok;
  const unsafe = live && (coverage === 'proxy-only' || coverage === 'leaking');
  // Not measured yet: no coverage, or the full-tunnel check still running (its title ends in an ellipsis).
  const measuring = !coverage || (coverage === 'unchecked' && conn.title.endsWith('…'));
  return { phase: conn.phase, covered: !live || measuring ? null : safe ? true : unsafe ? false : 'unknown', blocked: conn.restoreNetwork };
}

const DOT: Record<Tone, string> = { neutral: 'bg-fg-muted', working: 'bg-accent', ok: 'bg-ok shadow-[0_0_0_3px_rgb(var(--sol-green)/.18)]', warn: 'bg-warn', bad: 'bg-bad' };
const BOX: Record<Tone, string> = { neutral: 'border-line bg-bg-raised/60', working: 'border-line bg-bg-raised/60', ok: 'border-ok/30 bg-ok-soft', warn: 'border-warn/35 bg-warn-soft', bad: 'border-bad/40 bg-bad-soft' };

const ICON_COL = 'flex w-4 shrink-0 items-center justify-center';

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function useStatusCard(snap: AppSnapshot): CardView & { countryCode: string; service: string } {
  // The server in use, or the one a connect is working on before its session exists.
  const address = snap.connectTarget?.node ?? snap.session?.node ?? null;
  const node = useApp((s) => (address ? s.nodes.find((n) => n.address === address) : undefined));
  const session = snap.session;
  const now = useNow(!!session && snap.conn.phase === 'connected');
  const secs = session ? Math.max(Number(session.seconds), session.startedAt ? Math.floor((now - session.startedAt) / 1000) : 0) : 0;
  const sv = snap.daemon.service;
  const test = snap.nodeTest ?? null;
  const agent = snap.agent?.attached === true;
  const view = statusCard({
    stage: stageInput(snap),
    title: snap.conn.title,
    place: node?.probe?.city || (node?.countryCode ? countryName(node.countryCode) : ''),
    protocol: session?.service ? protocolLabel(session.service) : '',
    time: session ? formatDuration(secs) : '',
    data: session ? formatBytes((BigInt(session.rxBytes || '0') + BigInt(session.txBytes || '0')).toString()) : '',
    service: sv && sv.state !== 'ready' ? { title: sv.title, action: sv.action ?? null } : null,
    test,
    agent,
  });
  return { ...view, countryCode: node?.countryCode ?? '', service: session?.service ?? '' };
}

/** Sidebar and More list. `onOpen` goes to the Connect page. */
export function SessionCard({ snap, onOpen }: { snap: AppSnapshot; onOpen: () => void }) {
  const v = useStatusCard(snap);
  const tone = v.stage.tone;
  // Not connected (owner 2026-11-15: sleek): one calm line with a power mark and a way in, same height
  // as every other state so the sidebar never moves.
  if (v.stage.stage === 'idle' && v.line1 === IDLE_LINE()) {
    return (
      <div className="group relative overflow-hidden rounded-lg border border-line bg-gradient-to-b from-bg-raised/70 to-bg-card/30 shadow-[inset_0_1px_0_rgb(255_255_255/.05)] transition-colors duration-state hover:border-accent/45" data-sidebar-session data-stage={v.stage.stage}>
        <button className="flex h-[86px] w-full items-center gap-3 px-3 text-start" onClick={onOpen} title={tr('{title}. Open Connect.', { title: v.title })} aria-label={tr('{title}. Open Connect.', { title: v.title })}>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line bg-bg text-fg-muted transition-colors duration-state group-hover:border-accent/60 group-hover:text-accent-ink" aria-hidden><Icon name="power" size={20} /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold tracking-tight" data-card-title>{v.title}</span>
            <span className="mt-0.5 block truncate text-meta text-fg-muted" data-card-line="1">{v.line1}</span>
          </span>
          {v.agent && <Icon name="agent" className="text-accent-ink" label={tr('An AI agent is using this app')} />}
          <Icon name="chevron-right" className="shrink-0 text-fg-muted opacity-60 transition-[opacity,transform] duration-state group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 group-hover:opacity-100" />
        </button>
      </div>
    );
  }
  return (
    <div className={`relative overflow-hidden rounded-lg border transition-colors duration-state ${BOX[tone]}`} data-sidebar-session data-stage={v.stage.stage}>
      <button className="block w-full p-3 text-start transition-colors duration-press hover:bg-bg-hover/60" onClick={onOpen} title={tr('{title}. Open Connect.', { title: v.title })} aria-label={tr('{title}. Open Connect.', { title: v.title })}>
        {/* One 16 px icon column (dot, flag, protocol mark) so every line starts at the same x (owner 2026-11-12). */}
        <span className="flex h-5 items-center gap-2">
          <span className={ICON_COL}><span className={`inline-block h-2 w-2 rounded-full transition-colors duration-state ${DOT[tone]} ${v.stage.busy ? 'animate-pulse' : ''}`} aria-hidden /></span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium" data-card-title>{v.title}</span>
          {v.agent && <Icon name="agent" className="text-accent-ink" label={tr('An AI agent is using this app')} />}
        </span>
        <span className="mt-1.5 flex h-4 items-center gap-2 text-meta text-fg-muted" data-card-line="1">
          <span className={ICON_COL}>{v.countryCode && <Flag code={v.countryCode} size={14} />}</span>
          <span className="min-w-0 truncate">{v.line1}</span>
        </span>
        <span className="mt-1 flex h-4 items-center gap-2 text-meta text-fg-muted" data-card-line="2">
          <span className={ICON_COL}>{v.service && v.progress === null && <ProtocolMark protocol={v.service} size={14} />}</span>
          <span className="num min-w-0 truncate">{v.line2}</span>
        </span>
      </button>
      {v.action === 'restore' && (
        <div className="px-3 pb-3" data-card-restore><RestoreNetworkButton small full /></div>
      )}
      {/* A thin line that fills as the connection moves through its steps. */}
      <span className="absolute bottom-0 start-0 h-0.5 bg-accent transition-[width,opacity] duration-state" style={{ width: `${Math.round((v.progress ?? 0) * 100)}%`, opacity: v.progress === null ? 0 : 1 }} aria-hidden />
    </div>
  );
}

/** Phone header: the same state on one line. */
export function SessionLine({ snap }: { snap: AppSnapshot }) {
  const v = useStatusCard(snap);
  return (
    <div className="flex items-center gap-1.5 truncate text-label text-fg-muted" data-stage={v.stage.stage}>
      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[v.stage.tone]} ${v.stage.busy ? 'animate-pulse' : ''}`} aria-hidden />
      <span className="truncate"><span className="text-fg-dim">{v.title}</span>{v.line1 ? <span className="ms-2">{v.line1}</span> : null}</span>
    </div>
  );
}
