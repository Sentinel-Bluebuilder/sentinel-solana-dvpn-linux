// ─── Connect sheet (F8, F9): basis + amount → exact cost → confirm ───
// The escrow shown is what gets locked; unused escrow is refundable after close.
// Nothing is spent until the user presses Connect here.
// Layout (owner 2026-11-11, "much more aesthetic"): header (where) → price cards → amount
// segments → what happens to the money → notes → footer (wallet, Cancel, Connect).
import { useEffect, useState, type ReactNode } from 'react';

/** The amount last chosen per pricing, kept for the app run (UI-077). */
const LAST_UNITS = new Map<string, number>();
import { call, useApp } from '../lib/store';
import { costPreview, GB_OPTIONS, HOUR_OPTIONS, WIRE_OVERHEAD_NOTE, tdvpn, formatTdvpn, formatTdvpnShort, sol, short } from '../../../shared/format';
import { PROTOCOL_FEE_BPS } from '../../../core/pricing/cost';
import { CopyAddr, Flag, Help, Sheet } from './ui';
import { Term, TERMS } from './Term';
import { ownerSolForSetup } from '../../../core/session/setup-gate';
import { openDepositFor, closingDepositFor } from '../../../core/session/open-deposit';
import { deviceLimitFor } from '../../../core/session/device-limit';
import { toBaseUnits } from '../../../shared/format';
import { aboutTime } from '../../../core/session/refund-copy';
import type { NodeView, Basis, AppSnapshot } from '../../../shared/types';
import { byPlatform, thisDevice } from '../lib/platform';
import { walletSwitchFrom } from '../../../shared/wallet-switch';
import { tr } from '../../../shared/i18n';

/** The limit a first connect sets: the Settings value, raised to cover this deposit (display tDVPN). */
/** The limit Connect signs, the same rule as main (device-limit.ts): room for several deposits. */
export function firstConnectLimit(settingTdvpn: string, escrowBase: string): string {
  return formatTdvpnShort(deviceLimitFor(BigInt(toBaseUnits(settingTdvpn || '0')), BigInt(escrowBase || '0')).toString());
}

export function ConnectSheet({ node, snap, onClose, subscription }: {
  node: NodeView; snap: AppSnapshot; onClose: () => void;
  subscription?: { provider: string; subscription: string };
}) {
  const settings = useApp((s) => s.settings);
  const hasGb = BigInt(node.pricePerGb || '0') > 0n;
  const hasHour = BigInt(node.pricePerHour || '0') > 0n;
  // An open deposit with this server is used before any new one (owner 2026-11-12: a per-hour deposit
  // was left unused while a per-GB one was paid to the same server). Its pricing is the one offered.
  const openDep = subscription ? null : openDepositFor(snap.settlements, node, snap.session?.channel ?? null);
  // A deposit that is already closing cannot be reused (the program refuses it); say so instead of
  // leaving the owner to wonder why the locked tokens are not used.
  const closingDep = subscription || openDep ? null : closingDepositFor(snap.settlements, node);
  // A deposit this server refused to use again (CODE-AUDIT E3): never offered, refunded at once; say so.
  const refusedDep = subscription ? undefined : snap.settlements.find((s) => s.node === node.address && s.reuseRefused === true && s.status !== 'in-use');
  const [basis, setBasis] = useState<Basis>(openDep ? openDep.basis : settings?.defaultBasis === 'per_hour' && hasHour ? 'per_hour' : hasGb ? 'per_gb' : 'per_hour');
  // UI-077: the amount you chose last time for this pricing is offered again (for this app run); the
  // Settings default is used only until you have chosen one.
  const [units, setUnits] = useState<number>(LAST_UNITS.get(basis) ?? (basis === 'per_hour' ? settings?.defaultHours ?? 1 : settings?.defaultGb ?? 1));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setUnits(LAST_UNITS.get(basis) ?? (basis === 'per_hour' ? settings?.defaultHours ?? 1 : settings?.defaultGb ?? 1)); }, [basis, settings]);

  const preview = costPreview(node, basis, units);
  const reusing = !!openDep && openDep.basis === basis;
  const w = snap.wallet;
  const funds = w ? BigInt(w.ownerTdvpn) + BigInt(w.userBalance) : 0n;
  // First connect (owner 2026-11-11): no setup step; this Connect also signs the device permission,
  // with a limit that covers this deposit (a 50 tDVPN default could not pay one 66 tDVPN GB).
  const firstSetup = !!w?.needsPermission && settings?.autoDevicePermission !== false;
  const limit = firstConnectLimit(settings?.allowanceTdvpn ?? '50', subscription ? '0' : preview.escrow);
  // A limit below this deposit is raised by the same Connect (owner 2026-11-11: blocking on the 50 tDVPN
  // default was a dead end). Off in Settings = the old blocker and the Wallet route.
  const autoOn = settings?.autoDevicePermission !== false;
  const raise = autoOn && !firstSetup && !subscription && !reusing && !!w?.grant
    && (BigInt(w.grant.allowance) < BigInt(preview.escrow) || BigInt(w.delegated) < BigInt(preview.escrow));
  // E-55: set up for another wallet. The switch makes a new device key (it has no SOL yet), so the wallet
  // needs the full setup amount, the same figure switchWallet checks before writing anything.
  const switchFrom = walletSwitchFrom(snap);
  const setupSol = !w ? 0 : switchFrom ? ownerSolForSetup(0) : ownerSolForSetup(w.deviceLamports);
  const setupBlocker = !(firstSetup || switchFrom) || !w ? null
    : w.ownerLamports < setupSol ? byPlatform(tr('Add devnet SOL to your wallet first: setting up this computer needs about {setupSol} SOL for fees (it has {ownerLamports}).', { setupSol: (setupSol / 1e9).toFixed(3), ownerLamports: (w.ownerLamports / 1e9).toFixed(3) }), tr('Add devnet SOL to your wallet first: setting up this phone needs about {setupSol} SOL for fees (it has {ownerLamports}).', { setupSol: (setupSol / 1e9).toFixed(3), ownerLamports: (w.ownerLamports / 1e9).toFixed(3) }))
      : null;
  const blocker = setupBlocker ?? (subscription || reusing ? null
    : !preview.available ? tr('This server does not offer this pricing.')
      : !w ? tr('Wallet balances are still loading.')
        : funds < BigInt(preview.escrow) ? tr('This needs {escrowText}; your wallet has {funds} tDVPN.', { escrowText: preview.escrowText, funds: formatTdvpn(funds) })
          : firstSetup || raise ? null
          // E-55: a switch sets this computer up for the loaded wallet first, so its old limit and fees do not block.
          : switchFrom ? null
            : w.grant && BigInt(w.grant.allowance) < BigInt(preview.escrow) ? byPlatform(tr('This is above the spending limit for this computer ({allowance} tDVPN). Raise it in Wallet.', { allowance: tdvpn(w.grant.allowance) }), tr('This is above the spending limit for this phone ({allowance} tDVPN). Raise it in Wallet.', { allowance: tdvpn(w.grant.allowance) }))
              : BigInt(w.delegated) < BigInt(preview.escrow) ? byPlatform(tr('The spending limit for this computer needs renewing. Set it again in Wallet.'), tr('The spending limit for this phone needs renewing. Set it again in Wallet.'))
                : w.deviceLamports < 5_000_000 ? byPlatform(tr('Network fees for this computer are running low. Top them up in Wallet.'), tr('Network fees for this phone are running low. Top them up in Wallet.'))
                  : null);

  const opts = basis === 'per_hour' ? HOUR_OPTIONS : GB_OPTIONS;
  const unit = basis === 'per_hour' ? 'h' : 'GB';
  // Connected elsewhere: the button switches (new server checked first, then the old session stops).
  const switching = snap.conn.phase === 'connected' && !!snap.session && snap.session.node !== node.address;
  const feeMax = tdvpn(((BigInt(preview.escrow) * BigInt(PROTOCOL_FEE_BPS)) / 10_000n).toString());
  const fundsShort = !!w && (!!setupBlocker || (!subscription && !reusing && funds < BigInt(preview.escrow)));
  const place = node.probe?.city || node.country || tr('Unknown location');
  // UI-044: the button says what pressing it does. A deposit you already have, or a plan, adds nothing to pay.
  // One whole sentence per case (never a translated piece joined to another).
  const noDeposit = subscription || reusing;
  const confirmText = switchFrom ? tr('Set up for this wallet')
    : switching
      ? (noDeposit ? tr('Switch server') : tr('Switch server and deposit {amount}', { amount: preview.escrowText }))
      : (noDeposit ? tr('Connect') : tr('Connect and deposit {amount}', { amount: preview.escrowText }));
  const switchSol = (setupSol / 1e9).toFixed(3);

  return (
    <Sheet title={tr('Connect')} onClose={onClose} locked={busy} width="max-w-lg" bare data-connect-sheet={node.address}>
        {/* Where you are connecting. */}
        <header className="flex items-start gap-4 border-b border-line px-6 pb-5 pt-6">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-bg-input"><Flag code={node.countryCode} size={30} /></div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-title leading-tight">{place}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-meta text-fg-muted">
              <span title={tr('Self-declared by the operator')}>{node.probe?.city && node.country ? tr('{country}. Location reported by the operator.', { country: node.country }) : tr('Location reported by the operator.')}</span>
            </p>
            <p className="mt-2 text-meta text-fg-muted">{tr('Server')} <CopyAddr text={node.address} /></p>
          </div>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {subscription ? (
            <div className="rounded-xl border border-line bg-bg-input p-4 text-sm text-fg-dim">{tr('Connect with your plan. Usage is covered by the plan; nothing new is paid.')}</div>
          ) : (
            <>
              {/* Pricing: two cards; the price is the headline. */}
              <section>
                <div className="label">{tr('Pay by')}</div>
                <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label={tr('Pricing')}>
                  {([['per_gb', tr('Per GB'), node.pricePerGb, tr('tDVPN / GB'), hasGb], ['per_hour', tr('Per hour'), node.pricePerHour, tr('tDVPN / hour'), hasHour]] as const).map(([id, label, price, per, offered]) => {
                    const on = basis === id;
                    // While a deposit is open with this server, only its pricing can be used (no second deposit).
                    const lockedOut = !!openDep && openDep.basis !== id;
                    return (
                      <button key={id} role="radio" aria-checked={on} disabled={!offered || lockedOut} title={lockedOut ? tr('You already have a deposit with this server; it is used first.') : id === 'per_gb' ? TERMS().perGb : TERMS().perHour} onClick={() => setBasis(id)}
                        className={`rounded-xl border p-4 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${on ? 'border-sol-green/60 bg-sol-soft ring-1 ring-sol-green/40' : 'border-line bg-bg-input hover:border-line-strong hover:bg-bg-hover'}`}>
                        <span className={`block text-label uppercase ${on ? 'text-fg' : 'text-fg-muted'}`}>{label}</span>
                        <span className="mt-1 block">
                          {offered
                            ? <><span className="num font-display text-section font-semibold">{tdvpn(price)}</span> <span className="text-meta text-fg-muted">{per}</span></>
                            : <span className="text-meta text-fg-muted">{tr('Not offered')}</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {closingDep && (
                <Callout tone="info" title={tr('Your earlier deposit is on its way back')} data-closing-deposit={closingDep.channel}>
                  {closingDep.readyAt
                    ? tr('{amount} tDVPN from your last session with this server is being refunded, ready in about {time}. A deposit that is being refunded cannot be used again, so connecting now pays a new one.', { amount: formatTdvpnShort(closingDep.left), time: aboutTime(closingDep.readyAt - Date.now() / 1000) })
                    : tr('{amount} tDVPN from your last session with this server is being refunded. A deposit that is being refunded cannot be used again, so connecting now pays a new one.', { amount: formatTdvpnShort(closingDep.left) })}
                </Callout>
              )}
              {refusedDep && (
                <Callout tone="info" title={tr('Your earlier deposit could not be used again')} data-refused-deposit={refusedDep.channel}>
                  {tr('This server no longer accepts your earlier deposit, so connecting now pays a new one. The {refundable} tDVPN left of the earlier one is being refunded to your wallet.', { refundable: formatTdvpnShort(refusedDep.refundable) })}
                </Callout>
              )}
              {reusing && openDep && (
                <Callout tone="info" title={tr('You already have a deposit with this server')} data-reuse-deposit={openDep.channel}>
                  {tr('You have {left} tDVPN on deposit with this server. Connecting uses it first, so nothing new is paid. What you do not use is refunded to your wallet after you disconnect.', { left: formatTdvpnShort(openDep.left) })}
                </Callout>
              )}
              {/* Amount: one segmented control. */}
              {!reusing && <section>
                <div className="label">{basis === 'per_hour' ? tr('How long') : tr('How much data')}</div>
                <div className="flex gap-1 rounded-xl border border-line bg-bg-input p-1" role="radiogroup" aria-label={basis === 'per_hour' ? tr('Hours') : tr('Gigabytes')}>
                  {opts.map((o) => (
                    <button key={o} role="radio" aria-checked={o === units} onClick={() => { LAST_UNITS.set(basis, o); setUnits(o); }}
                      className={`num h-9 flex-1 whitespace-nowrap rounded-lg text-ctl transition-colors ${o === units ? 'bg-bg-raised font-semibold text-fg shadow-card' : 'text-fg-dim hover:bg-bg-hover hover:text-fg'}`}>
                      {o} {unit}
                    </button>
                  ))}
                </div>
              </section>}

              {/* What happens to the money. */}
              {!reusing && <section className="rounded-xl border border-line bg-bg-input">
                <div className="flex items-baseline justify-between gap-4 px-4 pb-3 pt-4">
                  <span className="inline-flex items-center gap-1.5 text-sm text-fg-dim">{tr('Deposit')} <Help text={tr('The amount set aside for this server when you connect. You pay only for what you use; the rest is refunded to your wallet.')} /></span>
                  <span className="num whitespace-nowrap"><span className="font-display text-title font-semibold">{tdvpn(preview.escrow)}</span> <span className="text-sm text-fg-muted">tDVPN</span></span>
                </div>
                <dl className="divide-y divide-line border-t border-line text-sm">
                  <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="shrink-0 text-fg-muted">{tr('You pay')}</dt><dd className="text-end">{tr('Only what you use')}</dd></div>
                  <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="shrink-0 text-fg-muted">{tr('The rest')}</dt><dd className="text-end">{basis === 'per_gb' ? tr('Kept a day for a reconnect, then back to your wallet about 2 h later') : tr('Back to your wallet a few minutes after you disconnect')}</dd></div>
                  <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="shrink-0 text-fg-muted"><Term k="protocolFee">{tr('Protocol fee')}</Term></dt><dd className="num text-end">{tr('{PROTOCOL_FEE_BPS}% of what you use, up to {feeMax} tDVPN', { PROTOCOL_FEE_BPS: PROTOCOL_FEE_BPS / 100, feeMax })}</dd></div>
                </dl>
                {basis === 'per_gb' && <p className="border-t border-line px-4 py-2.5 text-meta text-fg-muted">{WIRE_OVERHEAD_NOTE()}</p>}
              </section>}
            </>
          )}

          {firstSetup && !setupBlocker && !switchFrom && (
            <Callout tone="info" title={byPlatform(tr('First connect on this computer'), tr('First connect on this phone'))} data-first-connect-setup>
              {byPlatform(tr('This also lets this computer pay servers from your wallet, up to {limit} tDVPN, and sends it {max} SOL for network fees. Change this any time in Settings.', { limit, max: (Math.max(0, 50_000_000 - (w?.deviceLamports ?? 0)) / 1e9).toFixed(3) }), tr('This also lets this phone pay servers from your wallet, up to {limit} tDVPN, and sends it {max} SOL for network fees. Change this any time in Settings.', { limit, max: (Math.max(0, 50_000_000 - (w?.deviceLamports ?? 0)) / 1e9).toFixed(3) }))}
            </Callout>
          )}
          {raise && w?.grant && (
            <Callout tone="info" title={byPlatform(tr('Raises this computer\'s spending limit'), tr('Raises this phone\'s spending limit'))} data-raise-limit>
              {byPlatform(tr('This deposit is more than this computer may spend now ({allowance} tDVPN). Connect raises the limit to {limit} tDVPN in the same step. Change this any time in Settings.', { allowance: tdvpn(w.grant.allowance), limit }), tr('This deposit is more than this phone may spend now ({allowance} tDVPN). Connect raises the limit to {limit} tDVPN in the same step. Change this any time in Settings.', { allowance: tdvpn(w.grant.allowance), limit }))}
            </Callout>
          )}
          {switching && <Callout tone="info" title={tr('Switching servers')}>{tr('You leave your current server. Its unused deposit is refunded automatically.')}</Callout>}
        </div>

        {/* Why the button is off. Outside the scrolling part, so it is in view the moment the sheet
            opens: at 1180x780 it used to sit below the fold, leaving a greyed button and no reason. */}
        {blocker && (
          <div className="shrink-0 border-t border-line px-6 py-3" data-connect-blocker>
            <Callout tone="error" title={fundsShort ? tr('Add funds to connect') : tr('Can’t connect yet')} role="alert">
              {blocker}
              {fundsShort && snap.owner && <span className="mt-2 flex items-center gap-2 text-meta text-fg-muted">{tr('Your wallet')} <CopyAddr text={snap.owner} /></span>}
            </Callout>
          </div>
        )}

        {/* E-55: asked before anything is done; the connect is sent only from the button below. */}
        {switchFrom && !blocker && (
          <div className="shrink-0 border-t border-line px-6 py-3" data-wallet-switch-confirm={switchFrom}>
            <Callout tone="info" title={byPlatform(tr('This computer is set up for another wallet'), tr('This phone is set up for another wallet'))} role="alert">
              <p>{byPlatform(
                tr('This computer is set up for another wallet ({other}). Continuing sets it up for this wallet ({mine}) first, which needs about {sol} SOL from this wallet for network fees.', { other: short(switchFrom), mine: short(snap.owner), sol: switchSol }),
                tr('This phone is set up for another wallet ({other}). Continuing sets it up for this wallet ({mine}) first, which needs about {sol} SOL from this wallet for network fees.', { other: short(switchFrom), mine: short(snap.owner), sol: switchSol }))}</p>
              {/* rc.3.1 F2 (UI-LEAD ruling): the exact sentence; the CLI's switch confirm says the same. */}
              <p className="mt-1" data-wallet-switch-float>{byPlatform(
                tr('This sets this computer up as a new device for the loaded wallet, which pays about 0.05 SOL of fee float for it. About 0.05 SOL of fee float stays on the previous device and cannot be sent back yet. Deposits made with the previous device stay refundable: Activity shows them.'),
                tr('This sets this phone up as a new device for the loaded wallet, which pays about 0.05 SOL of fee float for it. About 0.05 SOL of fee float stays on the previous device and cannot be sent back yet. Deposits made with the previous device stay refundable: Activity shows them.'))}</p>
              {!noDeposit && <p className="mt-1">{tr('Then it connects and pays the deposit of {amount} shown above.', { amount: preview.escrowText })}</p>}
            </Callout>
          </div>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-bg-card/60 px-6 py-4">
          <span className="num text-meta text-fg-muted">{w ? tr('Wallet {ownerTdvpn} tDVPN and {ownerLamports} SOL', { ownerTdvpn: formatTdvpn(w.ownerTdvpn), ownerLamports: sol(w.ownerLamports) }) : tr('Wallet loading…')}</span>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={onClose} disabled={busy}>{tr('Cancel')}</button>
            <button data-connect-confirm data-autofocus {...(switchFrom ? { 'data-wallet-switch-go': true } : {})} className="btn-primary whitespace-nowrap" disabled={!!blocker || busy || (!snap.conn.canConnect && !switching)} onClick={async () => {
              setBusy(true);
              onClose();
              // UI-022: after confirming you are on the Connect screen, where the progress is shown.
              useApp.getState().connectAsked();
              window.dispatchEvent(new CustomEvent('dvpn:go', { detail: 'home' }));
              try {
                await call(window.api.IPC.CONNECT, { node: node.address, basis, units, confirmed: true, subscription, switch: switching, ...(switchFrom ? { confirmWalletSwitch: true } : {}), ...(subscription || reusing ? {} : { shownEscrow: preview.escrow }) }, { quiet: true });
              } catch (err) {
                // UI-018: the Connect screen owns a failed or stopped connect (its text and its one button).
                // Only a failure that carries no code, which that screen cannot explain, is said here.
                const e = err as Error & { code?: string };
                if (!e.code) useApp.getState().toast('error', e.message);
                console.warn('connect failed', e.code, e.message);
                // L-4: connectAsked() showed "Getting ready…" before the app answered. A refusal that
                // changes nothing in the app's state (e.g. a bad request) would leave that on screen,
                // so the real state is read again after any failure.
                void call<AppSnapshot>(window.api.IPC.STATE_SNAPSHOT, undefined, { quiet: true })
                  .then((s) => useApp.getState().setSnap(s), (e2) => console.warn('state refresh after a failed connect', e2));
              }
            }}>
              {confirmText}
            </button>
          </div>
        </footer>
    </Sheet>
  );
}

/** A titled note inside the sheet: info or error, with a dot that carries the tone. */
function Callout({ tone, title, children, role, ...data }: { tone: 'info' | 'error'; title: string; children: ReactNode; role?: string; [k: `data-${string}`]: unknown }) {
  const box = tone === 'error' ? 'border-bad/40 bg-bad-soft' : 'border-accent/35 bg-accent-soft';
  const dot = tone === 'error' ? 'bg-bad' : 'bg-accent';
  return (
    <div className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${box}`} role={role} {...data}>
      <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
      <div className="min-w-0">
        <div className="font-semibold">{title}</div>
        <div className="mt-0.5 text-fg-dim">{children}</div>
      </div>
    </div>
  );
}
