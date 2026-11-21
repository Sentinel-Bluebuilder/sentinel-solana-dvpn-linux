// ─── Kill switch page (owner 2026-10-22: research-led rebuild) ───
// Standards: docs/UI-STANDARDS-RESEARCH.md § Kill switch. Radio modes + one Apply (the change
// restarts the service, so no instant toggles: Microsoft/NN/g), a clear "Blocking internet" state with Restore network (Mullvad), the LAN
// range "Allow local network" lets through (ExpressVPN/Mullvad), and the split-tunnel interplay.
import { useEffect, useState } from 'react';
import { call } from '../lib/store';
import { useDaemonSettings } from '../lib/use-daemon-settings';
import { ApplyBar, Banner, KeepsHeight, InlineError, PageHeader, RadioCards, Section, Switch } from '../components/ui';
import { RestoreNetworkButton } from '../components/RestoreNetworkButton';
import { Icon, type IconName } from '../components/Icon';
import { ProtocolTag } from '../components/ProtocolMark';
import type { AppSnapshot, KillSwitch as Mode } from '../../../shared/types';
import { killSwitchBlocksProtocol, splitNotApplied } from '../../../core/session/state';
import { KS_STATE_COPY, ksActiveStep, ksState, ksSteps } from '../../../core/session/ks-view';
import { PROTOCOLS } from '../../../shared/protocols';
import { onAndroid, osPick, rendererPlatform } from '../lib/platform';
import { KillSwitchAndroid } from './android/KillSwitchAndroid';
import { checkMark, checksFine, type CheckLevel } from '../../../shared/check-level';
import { unreadableSettingsCopy } from '../../../shared/settings-copy';
import { tr } from '../../../shared/i18n';

const PLATFORM = rendererPlatform();
// One "On" (= dvpnd 'persist'): dvpnd's 'on' lifts the block when the service restarts or
// updates, so a separate weaker mode only added a leak. An old 'on' config reads as On.
// UI-196: the On sentence names all three ways out (reconnect, disconnect, Restore network).
// UI-100: one sentence per mode in the list; the rest of "On" (owner 2026-11-13: restarts, Restore
// network, start at log-in) is shown under the list only while On is the chosen mode.
// `what` is the section title for the mode: one whole sentence per mode, never the name put inside another sentence.
const MODES = (): Array<{ id: Mode; name: string; what: string; copy: string; more?: string }> => ([
  { id: 'off', name: tr('Off'), what: tr('What happens with “Off”'), copy: tr('If the VPN drops, your apps carry on over your normal connection until you reconnect.') },
  { id: 'persist', name: tr('On'), what: tr('What happens with “On”'), copy: tr('If the VPN drops, internet is blocked until it reconnects, you disconnect or you press Restore network. Recommended.'), more: tr('The block holds also across a restart of the computer or of the VPN service. While it is on, the app starts when you log in, so it can tell you.') },
]);
const LEVEL_ICON: Record<CheckLevel, IconName> = { ok: 'check', warn: 'alert', fail: 'x', skip: 'info' };
const LEVEL_WORD = (): Record<CheckLevel, string> => ({ ok: tr('Fine'), warn: tr('Needs a look'), fail: tr('Problem'), skip: tr('Not checked here') });
const shown = (k: Mode | undefined): Mode => (k === 'on' ? 'persist' : k ?? 'off');
const TONE = { ok: 'border-ok/40 bg-ok-soft text-ok', warn: 'border-warn/40 bg-warn-soft text-warn', bad: 'border-bad/50 bg-bad-soft text-bad', muted: 'border-line bg-bg-raised text-fg-muted' } as const;

// ─── UI-185: nothing on this page grows or moves while its data loads ───
// The VPN service settings are kept for the app run (lib/use-daemon-settings): only the first visit waits,
// and meanwhile the Mode and Local network cards are laid out invisibly at their real size under a placeholder.
/** The local network and the last kill-switch check, kept for the app run: a revisit shows them at once. */
const LAST: { lan: string[] | null; checks: Array<{ name: string; level: CheckLevel; detail: string }> | null } = { lan: null, checks: null };

// Android has its own page: the VPN service and the system's Always-on VPN apply these there, not dvpnd's firewall.
export function KillSwitch({ snap }: { snap: AppSnapshot }) {
  return onAndroid() ? <KillSwitchAndroid snap={snap} /> : <DesktopKillSwitch snap={snap} />;
}

function DesktopKillSwitch({ snap }: { snap: AppSnapshot }) {
  const { daemon, draft, setDraft, dirty, pending, applying, apply, reset } = useDaemonSettings();
  const [lan, setLanRaw] = useState<string[] | null>(LAST.lan);
  const setLan = (v: string[]): void => { LAST.lan = v; setLanRaw(v); };
  // UI-114: a failed read or a failed Restore network is said in place, not only in the console.
  const [lanFailed, setLanFailed] = useState(false);
  useEffect(() => {
    call<{ lan?: string[] }>(window.api.IPC.APP_INFO, undefined, { quiet: true }).then((i) => setLan(i.lan ?? [])).catch((err) => { console.warn('app info failed', err); setLan([]); setLanFailed(true); });
  }, []);

  const mode = shown(draft.killSwitch as Mode | undefined);
  const saved = shown(daemon?.settings.killSwitch as Mode | undefined);
  const live = snap.session;
  const state = ksState({ phase: snap.conn.phase, restoreNetwork: snap.conn.restoreNetwork, connected: !!live, saved });
  const copy = KS_STATE_COPY()[state];
  const steps = ksSteps(mode);
  const active = mode === saved ? ksActiveStep(state, !!live) : -1;
  const split = draft.split;
  const splitOn = !!split && split.mode !== 'off';

  return (
    <div>
      <PageHeader title={tr('Kill switch')} subtitle={tr('Blocks traffic if the VPN connection drops.')} />

      {/* ── Live state: one compact status line ── */}
      <div className={`mb-6 flex min-h-14 items-center justify-between gap-4 rounded-lg border px-4 py-3 ${TONE[copy.tone]}`} data-ks-state={state} role={state === 'blocking' ? 'alert' : 'status'}>
        <div className="min-w-0">
          <div className="font-display text-section">{copy.title}</div>
          {/* UI-187 pictures: with Off, the 'What happens' panel already says what a drop does; the line here said it a third time. */}
          {(state !== 'off' || live) && <p className="text-sm text-fg-dim" data-ks-detail>{state === 'off' ? null : copy.detail}{live ? <>{state === 'off' ? '' : ' '}{tr('Connected with')} <ProtocolTag protocol={live.service} size={18} />.</> : null}</p>}
          {live && saved !== 'off' && killSwitchBlocksProtocol(PLATFORM, saved, live.service, snap.daemon.version) && <p className="mt-1 text-meta text-warn">{tr('The kill switch does not cover this connection type until the VPN service is updated.')}</p>}
        </div>
        {state === 'blocking' && <RestoreNetworkButton />}
      </div>

      {/* Wide windows: settings left, what it does + checks right. */}
      <div className="grid grid-cols-1 gap-x-6 xl:grid-cols-2 [&>*]:min-w-0">
      <div>
      {!daemon || daemon.readable ? (
        <KeepsHeight loading={!daemon} label={tr('Reading the kill switch settings')}>
          {/* ── Mode ── */}
          <Section title={tr('Mode')}>
          <div data-section="mode">
          <RadioCards name="ks" label={tr('Kill switch mode')} value={mode} onChange={(id) => setDraft({ ...draft, killSwitch: id })}
            options={MODES().map((m) => ({ id: m.id, title: <>{m.name}{m.id === saved && <span className="pill ms-2">{tr('Current')}</span>}</>, text: m.copy, hook: { 'data-ks-mode': m.id } }))} />
          </div>
          {MODES().find((m) => m.id === mode)?.more && <p className="mt-2 text-meta text-fg-muted" data-ks-mode-more>{MODES().find((m) => m.id === mode)?.more}</p>}
          </Section>

          {/* ── Local network ── */}
          <Section title={tr('Local network')}>
          <div className="card">
            <label className="flex cursor-pointer items-start justify-between gap-4">
              <span>
                <span className="text-sm font-medium">{tr('Allow local network')}</span>
                <span className="block text-meta text-fg-muted">{tr('Printers, file shares and other devices at home or work stay reachable while the kill switch blocks the internet.')}</span>
                <span className="mt-1 block text-meta text-fg-muted" data-lan>{lan === null ? tr('Finding your local network…') : lanFailed ? tr('Your local network could not be read. Open this page again to retry.') : lan.length ? <>{tr('Your local network:')} <span className="mono">{lan.join(', ')}</span></> : tr('No local network found on this computer right now.')}</span>
              </span>
              <Switch label={tr('Allow local network')} checked={!!draft.allowLan} onChange={(on) => setDraft({ ...draft, allowLan: on })} />
            </label>
          </div>
          </Section>

          {splitOn && (
            <Banner kind="info">
              {split?.mode === 'include' ? tr('Split tunnelling is on (only chosen apps use the VPN).') : tr('Split tunnelling is on (some apps skip the VPN).')} {mode === 'off' ? tr('With the kill switch off, nothing is blocked if the VPN drops.') : splitNotApplied({ daemonVersion: snap.daemon.version, service: 'xray', killSwitch: mode, wholeDevice: true, hasApps: (split?.apps.length ?? 0) > 0, platform: PLATFORM }) ?? tr('If the VPN drops, what you chose for the VPN is blocked; what you left out keeps your normal connection.')}
            </Banner>
          )}

          {dirty && (
            <ApplyBar hook={{ 'data-ks-apply': '' }} busy={applying} onApply={() => void apply()} onDiscard={reset}
              note={<><span className="block" data-pending-areas>{tr('Not applied yet: {join}.', { join: pending.join(', ') })}</span>{live ? 'Disconnects you first.' : 'Asks for administrator once.'}</>} />
          )}
        </KeepsHeight>
      ) : <Banner kind="info"><span data-settings-unreadable={daemon.empty ? 'empty' : 'missing'}>{unreadableSettingsCopy(daemon.empty)}</span></Banner>}

      {/* ── Read-only check (plan U6): the service's own kill-switch rows. A real drop test cuts
          the network, so it runs only on test VMs (scripts/e2e/vm-split-ui.ps1 -Case ks). ── */}
      <Section title={tr('Check the kill switch')}>
        <KsCheck />
      </Section>

      <Section title={tr('If your internet stops working')}>
        <div className="card flex flex-wrap items-center justify-between gap-4">
          <p className="min-w-0 flex-1 text-sm text-fg-dim">{tr('Restore network removes every block the kill switch left and puts your DNS back. Your settings stay as they are.')}</p>
          <RestoreNetworkButton />
        </div>
      </Section>
      </div>

      <div>
      {/* ── What happens (picture for the selected mode); stacked in the right column on wide windows ── */}
      <Section title={MODES().find((m) => m.id === mode)?.what}>
      <ol className="grid grid-cols-3 gap-2 xl:grid-cols-1" data-ks-steps={mode}>
        {steps.map((st, i) => (
          <li key={st.label} className={`relative rounded-lg border p-4 text-sm ${i === active ? 'ring-2 ring-accent' : ''} ${st.tone === 'ok' ? 'border-ok/35' : st.tone === 'warn' ? 'border-warn/40' : 'border-bad/40'} bg-bg-card`} data-ks-step={i} aria-current={i === active ? 'step' : undefined}>
            <div className={`mb-1 text-label font-semibold uppercase ${st.tone === 'ok' ? 'text-ok' : st.tone === 'warn' ? 'text-warn' : 'text-bad'}`}>{i + 1}. {st.label}</div>
            <div className="text-fg-dim">{st.text}</div>
            {i === active && <div className="mt-2 text-meta font-medium text-accent-ink">{tr('You are here')}</div>}
            {i < 2 && <span className="absolute -end-2 top-1/2 z-10 -translate-y-1/2 text-fg-muted xl:hidden" aria-hidden>›</span>}
          </li>
        ))}
      </ol>
      </Section>

      {/* ── Protocols ── */}
      <Section title={tr('Which server types it works with')}>
      <div className="card overflow-hidden p-0" data-ks-support>
        {PROTOCOLS.map((p) => {
          const blocked = killSwitchBlocksProtocol(PLATFORM, 'on', p, snap.daemon.version);
          return (
            <div key={p} className="flex h-12 items-center justify-between gap-4 border-b border-line px-4 text-sm last:border-0" data-ks-protocol={p}>
              <ProtocolTag protocol={p} />
              <span className={`text-end text-meta ${blocked ? 'text-warn' : 'text-ok'}`}>{blocked ? tr('Needs a newer VPN service. Nothing is paid.') : tr('Works')}</span>
            </div>
          );
        })}
      </div>
      </Section>

      </div>
      </div>

      {/* UI-101: kept, closed, last on the page. */}
      <details className="card mb-6" data-cli-card>
        <summary className="cursor-pointer text-sm text-fg-dim">{tr('The same from the command line')}</summary>
        <div className="mono mt-3 leading-6">
          <div>devnet-dvpn daemon set --kill-switch off|on|persist --yes</div>
          <div>devnet-dvpn daemon set --allow-lan true|false --yes</div>
          <div>{tr('devnet-dvpn daemon restore-network')}</div>
          <div>{tr('devnet-dvpn status')}</div>
          <div>{tr('devnet-dvpn version (shows your local network)')}</div>
        </div>
      </details>

    </div>
  );
}

const KS_CHECKS = (): Record<string, string> => ({ kill_switch: tr('What the service holds now'), kill_switch_backend: osPick({ win32: tr('Firewall control (Windows Filtering Platform)'), darwin: tr('Firewall control (pf)'), linux: tr('Firewall control (nftables)') }, tr('Firewall control')), privileges: tr('Service privileges') });

/** Read-only: the kill-switch rows of the service check (DAEMON_DOCTOR = CLI `daemon doctor`). Changes nothing. */
function KsCheck() {
  const [rows, setRowsRaw] = useState<Array<{ name: string; level: CheckLevel; detail: string }> | null>(LAST.checks);
  const setRows = (v: Array<{ name: string; level: CheckLevel; detail: string }>): void => { LAST.checks = v; setRowsRaw(v); };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      const all = await call<Array<{ name: string; level: CheckLevel; detail: string }>>(window.api.IPC.DAEMON_DOCTOR, undefined, { quiet: true });
      setRows(all.filter((r) => r.name in KS_CHECKS()));
      setError('');
    } catch (err) { console.warn('kill switch check failed', err); setError(tr('The VPN service did not answer the check. Try again in a moment.')); } finally { setBusy(false); }
  };
  return (
    <div className="card" data-ks-check={rows ? (checksFine(rows) ? 'ok' : 'problem') : 'none'}>
      <div className="mb-2 flex items-center justify-between gap-4">
        <p className="text-sm text-fg-dim">{tr('Asks the VPN service whether its firewall control works and what it is holding. Nothing is changed and your connection is not cut.')}</p>
        <button className="btn-ghost min-w-[7.5rem] shrink-0 justify-center" disabled={busy} onClick={() => void run()}>{busy ? tr('Checking…') : tr('Check now')}</button>
      </div>
      {error && <div className="mb-2" data-ks-check-error><InlineError>{error}</InlineError></div>}
      {rows && (rows.length ? rows.map((r) => (
        <div key={r.name} className="grid grid-cols-[1.25rem_14rem_1fr] gap-2 border-t border-line py-2 text-sm" data-ks-check-row={r.name} data-level={r.level}>
          <Icon name={LEVEL_ICON[r.level]} className={`mt-0.5 ${checkMark(r.level).className}`} label={LEVEL_WORD()[r.level]} />
          <span className="text-fg-dim">{KS_CHECKS()[r.name]}</span>
          <span className="min-w-0 break-words text-fg-dim">{r.detail || 'OK'}</span>
        </div>
      )) : <p className="text-sm text-fg-muted">{tr('This service version reports no kill-switch checks.')}</p>)}
    </div>
  );
}
