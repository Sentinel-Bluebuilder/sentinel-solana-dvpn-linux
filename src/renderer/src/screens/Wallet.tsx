// ─── Wallet (F2, F3): balances, receive, send, device permission, withdraw ───
import { useEffect, useState } from 'react';
import { HELP } from '../../../core/session/refund-copy';
import { sendToast, settleToast, withdrawToast } from '../../../shared/money-toast';
import { call, useApp } from '../lib/store';
import { byPlatform, osPick, thisDevice } from '../lib/platform';
import { Banner, ConfirmModal, Copy, Help, PageHeader, Section, StatCell, StatStrip } from '../components/ui';
import { tdvpn, formatTdvpn, formatTdvpnShort, plural, sol, short } from '../../../shared/format';
import type { AppSnapshot, PendingSettlement } from '../../../shared/types';
import { tr, trPlural } from '../../../shared/i18n';

const ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function Wallet({ snap }: { snap: AppSnapshot }) {
  const w = snap.wallet;
  // Same rule as revokeDevice (c8269e8): only a deposit in use blocks removal; settling never needs the permission.
  const inUse = !!snap.session || snap.settlements.some((x) => x.status === 'in-use');
  const [qr, setQr] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const [amt, setAmt] = useState('');
  const [asset, setAsset] = useState<'tdvpn' | 'sol'>('tdvpn');
  const [modal, setModal] = useState<null | 'send' | 'withdraw' | 'device' | 'logout' | 'revoke' | 'revoke-other' | 'settle-other'>(null);
  // Another device of this wallet (gap #95): a computer that is gone. Remove its permission, then settle its deposits.
  const [other, setOther] = useState('');
  const [otherList, setOtherList] = useState<PendingSettlement[] | null>(null);
  const [otherBusy, setOtherBusy] = useState(false);
  const [allowance, setAllowance] = useState(useApp.getState().settings?.allowanceTdvpn ?? '50');
  const [devicePlan, setDevicePlan] = useState<string[]>([]);

  useEffect(() => { call<string | null>(window.api.IPC.WALLET_QR).then(setQr, () => setQr(null)); }, [snap.owner]);

  const sendBlocker = !ADDR.test(to.trim()) ? tr('Enter a valid Solana address.') : !(Number(amt) > 0) ? tr('Enter an amount.') : to.trim() === snap.owner ? tr('That is your own address.') : null;
  const otherAddr = other.trim();
  const otherBlocker = !ADDR.test(otherAddr) ? tr('Enter its address.') : otherAddr === w?.device ? byPlatform(tr('That is this computer: use Remove spending limit above.'), tr('That is this phone: use Remove spending limit above.')) : otherAddr === snap.owner ? tr('That is your wallet address. Paste the address shown under This computer on the other one.') : null;
  const otherDue = (otherList ?? []).filter((x) => x.status === 'open' || x.status === 'ready');
  const otherRefund = (otherList ?? []).reduce((s, x) => s + BigInt(x.refundable || '0'), 0n);
  const loadOther = async (): Promise<void> => {
    setOtherBusy(true);
    // rc.3.1 F1: settle list --device no longer refuses a device that can still spend (its open deposits come
    // back marked unverified), so the old "can still spend" note had no way to show and is gone.
    try { setOtherList(await call<PendingSettlement[]>(window.api.IPC.SETTLE_LIST, { device: otherAddr }, { quiet: true })); } catch (err) {
      setOtherList(null);
      const e = err as Error;
      useApp.getState().toast('error', e.message || tr('Could not read its deposits. Try again.'));
      console.warn('other device deposits', err);
    } finally { setOtherBusy(false); }
  };

  return (
    <div>
      <PageHeader title={tr('Wallet')} subtitle={byPlatform(tr('Your keys stay encrypted on this computer.'), tr('Your keys stay encrypted on this phone.'))} />
      <StatStrip>
        {/* UI-071: one figure for what you can spend; both parts pay for a deposit. The split is in the hint. */}
        <StatCell label={tr('Balance')} value={`${formatTdvpnShort(w?.ownerTdvpn ?? '0')} tDVPN`} hint={w && BigInt(w.userBalance || '0') > 0n ? tr('{ownerTdvpn} with finished refunds', { ownerTdvpn: formatTdvpnShort((BigInt(w.ownerTdvpn || '0') + BigInt(w.userBalance)).toString()) }) : undefined} />
        <StatCell help={HELP().fees} label={tr('Fees')} value={`${sol(w?.ownerLamports ?? 0)} SOL`} />
        <StatCell help={HELP().readyToWithdraw} label={tr('Refunds ready')} value={`${formatTdvpnShort(w?.userBalance ?? '0')} tDVPN`} hint={w && BigInt(w.userBalance) > 0n ? <button className="mt-1.5 inline-flex h-8 items-center gap-2 rounded-lg border border-ok/40 bg-ok-soft px-3 text-meta font-semibold text-ok transition-colors duration-press hover:border-ok/70 hover:brightness-110" data-claim-refunds onClick={() => setModal('withdraw')}><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M10 3v9M6 8.5l4 4 4-4M4 16h12" /></svg>{tr('Claim refunds')}</button> : undefined} />
      </StatStrip>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        {/* Receive: QR left, address and actions right, one row. */}
        <Section title={tr('Receive')} className="mb-0">
          <div className="card flex items-start gap-4">
            {qr && <img src={qr} alt={tr('Wallet address QR code')} className="h-32 w-32 shrink-0 rounded bg-white p-1" />}
            <div className="min-w-0 flex-1">
              <div className="label">{tr('Your address')}</div>
              <div className="mono mb-4 break-all">{snap.owner}</div>
              <div className="flex flex-wrap items-center gap-2">
                {snap.owner && <Copy text={snap.owner} label={tr('Copy address')} />}
                <button className="btn-ghost btn-sm" onClick={() => void call(window.api.IPC.OPEN_EXTERNAL, 'https://faucet.solana.com/')}>{tr('Devnet SOL faucet')}</button>
              </div>
            </div>
          </div>
        </Section>
        <Section title={tr('Send')} className="mb-0">
          <div className="card flex flex-col gap-3">
            <input className="input mono" placeholder={tr('Recipient address')} value={to} onChange={(e) => setTo(e.target.value)} aria-label={tr('Recipient address')} />
            <div className="flex gap-2">
              <input className="input num" inputMode="decimal" placeholder={tr('Amount')} value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ''))} aria-label={tr('Amount')} />
              <select className="input w-28" value={asset} onChange={(e) => setAsset(e.target.value as 'tdvpn' | 'sol')} aria-label={tr('Asset')}><option value="tdvpn">tDVPN</option><option value="sol">SOL</option></select>
            </div>
            <div className="flex items-center justify-between gap-4">
              <p className="text-meta text-bad">{to && sendBlocker ? sendBlocker : ''}</p>
              <button className="btn-primary" disabled={!!sendBlocker} onClick={() => setModal('send')}>{tr('Review')}</button>
            </div>
          </div>
        </Section>
      </div>

      <Section title={byPlatform(tr('This computer'), tr('This phone'))}>
        {!w?.ready && <Banner kind="warn">{byPlatform(tr('This computer has no spending limit yet, so it cannot pay for a connection. Set one below.'), tr('This phone has no spending limit yet, so it cannot pay for a connection. Set one below.'))}</Banner>}
        <div className="card overflow-hidden p-0">
          {/* One key-value table: label left, value right, action at the row end. */}
          <dl className="text-sm">
            <div className="flex h-12 items-center gap-4 border-b border-line px-4"><dt className="flex-1 text-fg-dim">{tr('Address')}</dt><dd className="mono">{short(w?.device)}</dd><dd className="flex w-20 justify-end">{w?.device && <Copy text={w.device} />}</dd></div>
            <div className="flex h-12 items-center gap-4 border-b border-line px-4"><dt className="flex flex-1 items-center gap-1.5 text-fg-dim">{tr('Spending limit')} <Help text={byPlatform(tr('The most this computer may pay to servers from your wallet without asking you again. You can change or remove it at any time.'), tr('The most this phone may pay to servers from your wallet without asking you again. You can change or remove it at any time.'))} /></dt><dd className="num">{w?.grant ? `${formatTdvpn(w.grant.allowance)} tDVPN` : tr('none')}</dd><dd className="w-20" /></div>
            <div className="flex h-12 items-center gap-4 border-b border-line px-4"><dt className="flex flex-1 items-center gap-1.5 text-fg-dim">{tr('Left of the limit')} <Help text={tr('How much of the spending limit is still unused. Each new deposit uses some of it.')} /></dt><dd className="num">{formatTdvpn(w?.delegated ?? '0')} tDVPN</dd><dd className="w-20" /></div>
            <div className="flex h-12 items-center gap-4 border-b border-line px-4"><dt className="flex flex-1 items-center gap-1.5 text-fg-dim">{tr('Network fees')} <Help text={tr('A small amount of SOL kept here to pay Solana network fees when you connect. It is topped up from your wallet.')} /></dt><dd className="num">{sol(w?.deviceLamports ?? 0)} SOL</dd><dd className="w-20" /></div>
          </dl>
          <div className="flex flex-wrap items-end gap-2 bg-bg-raised/40 px-4 py-3">
            <div>
              <label className="label" htmlFor="lim">{tr('New limit (tDVPN)')}</label>
              <input id="lim" className="input num w-36" inputMode="decimal" value={allowance} onChange={(e) => setAllowance(e.target.value.replace(/[^0-9.]/g, ''))} />
            </div>
            <button className="btn-ghost" onClick={async () => {
              try {
                const plan = await call<{ steps: string[] }>(window.api.IPC.DEVICE_SETUP_PLAN, { allowance });
                if (!plan.steps.length) { useApp.getState().toast('info', tr('This limit is already set.')); return; }
                setDevicePlan(plan.steps); setModal('device');
              } catch (err) { console.warn('device plan failed', err); }
            }}>{tr('Set spending limit')}</button>
            <button className="btn-ghost ms-auto text-bad" disabled={!w?.grant || inUse} title={inUse ? tr('Disconnect first: a deposit is in use right now.') : undefined} onClick={() => setModal('revoke')}>{tr('Remove spending limit')}</button>
            {w?.grant && !inUse && snap.settlements.length > 0 && <p className="w-full text-meta text-fg-muted">{trPlural({ one: 'Removing the limit is safe: {count} deposit here is still refunded to your wallet.', other: 'Removing the limit is safe: {count} deposits here are still refunded to your wallet.' }, snap.settlements.length, { count: snap.settlements.length })}</p>}
          </div>
        </div>
      </Section>

      {/* Another computer of this wallet that is gone (gap #95): its permission and deposits stay on chain until removed here. */}
      <Section title={tr('Other computers and phones')}>
        <div className="card flex flex-col gap-3" data-other-device>
          <p className="text-sm text-fg-dim">{osPick({ android: tr('A phone or computer you no longer use can still spend from this wallet. Paste its address to remove its spending limit, then refund its deposits here.') }, tr('A computer you no longer use can still spend from this wallet. Paste its address to remove its spending limit, then refund its deposits here.'))}</p>
          <input className="input mono" placeholder={tr('Other device address')} value={other} onChange={(e) => { setOther(e.target.value); setOtherList(null); }} aria-label={tr('Other device address')} />
          <div className="flex flex-wrap items-center gap-2">
            <p className="me-auto min-w-0 text-meta text-bad">{other && otherBlocker ? otherBlocker : ''}</p>
            <button className="btn-ghost" disabled={!!otherBlocker || otherBusy} onClick={() => void loadOther()}>{tr('Check deposits')}</button>
            <button className="btn-ghost text-bad" disabled={!!otherBlocker || otherBusy} onClick={() => setModal('revoke-other')}>{tr('Remove spending limit…')}</button>
          </div>
          {otherList && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3" data-other-deposits={otherList.length}>
              <span className="min-w-0 flex-1 text-sm">
                {otherList.length ? trPlural({ one: '{count} deposit, {amount} tDVPN to refund; {due} can be refunded now.', other: '{count} deposits, {amount} tDVPN to refund; {due} can be refunded now.' }, otherList.length, { count: otherList.length, amount: formatTdvpn(otherRefund.toString()), due: otherDue.length }) : tr('It has no deposits left.')}
              </span>
              {otherDue.length > 0 && <button className="btn-primary shrink-0" onClick={() => setModal('settle-other')}>{tr('Refund that device\'s deposits')}</button>}
            </div>
          )}
        </div>
      </Section>

      {/* Leaving the wallet sits last, quiet, like account sign-out in leading apps. */}
      <div className="card mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="min-w-0 text-sm text-fg-dim">{byPlatform(tr('Sign out removes this wallet from the app on this computer.'), tr('Sign out removes this wallet from the app on this phone.'))}</span>
        <button className="btn-ghost shrink-0 text-bad" onClick={() => setModal('logout')}>{tr('Sign out of this wallet')}</button>
      </div>

      {modal === 'send' && (
        <ConfirmModal title={tr('Send')} lines={[tr('Send {amount} {asset} to {address}.', { amount: amt, asset: asset === 'sol' ? 'SOL' : 'tDVPN', address: to.trim() }), tr('Transfers can’t be reversed.'), tr('Network: Solana devnet (test tokens).')]} confirmLabel={tr('Send')}
          onConfirm={async () => {
            try { await call(window.api.IPC.SEND, { to: to.trim(), [asset]: amt, confirmed: true }); useApp.getState().toast('success', sendToast(amt, asset, to.trim())); setTo(''); setAmt(''); } catch (err) {
              // TX-LAND (rc9-f2 H): not known whether it went through. No "Try again" here: a second Send signs a NEW
              // transfer. The modal closes and the amount is cleared; the error says to check the balances first.
              if ((err as { code?: string }).code === 'tx-unknown') { setAmt(''); return; }
              throw err;
            }
          }} onClose={() => setModal(null)} />
      )}
      {modal === 'withdraw' && (
        <ConfirmModal title={tr('Claim refunds')} lines={[tr('Claim {amount} tDVPN of finished refunds. They move into your wallet balance.', { amount: tdvpn(w?.userBalance ?? '0') })]} confirmLabel={tr('Claim refunds')}
          onConfirm={async () => { const amount = tdvpn(w?.userBalance ?? '0'); await call(window.api.IPC.WITHDRAW, { confirmed: true }); useApp.getState().toast('success', withdrawToast(amount)); }} onClose={() => setModal(null)} />
      )}
      {modal === 'device' && (
        <ConfirmModal title={tr('Set spending limit')} lines={[...devicePlan, tr('Network: Solana devnet (test tokens).')]} confirmLabel={tr('Sign')}
          onConfirm={async () => { await call(window.api.IPC.DEVICE_SETUP, { allowance, confirmed: true }); }} onClose={() => setModal(null)} />
      )}
      {modal === 'revoke' && (
        <ConfirmModal title={tr('Remove the spending limit?')} danger lines={[byPlatform(tr('This computer will not be able to pay for a connection until you set a limit again.'), tr('This phone will not be able to pay for a connection until you set a limit again.')), tr('The small network fee paid when it was set is returned to your wallet.'), tr('Network: Solana devnet (test tokens).')]} confirmLabel={tr('Remove')}
          onConfirm={async () => { await call(window.api.IPC.DEVICE_REVOKE, { confirmed: true }); }} onClose={() => setModal(null)} />
      )}
      {modal === 'revoke-other' && (
        <ConfirmModal title={tr('Remove that device\'s spending limit?')} danger lines={[tr('Address {address}.', { address: otherAddr }), osPick({ android: tr('Do this only for a phone or computer you no longer use: it can no longer pay for VPN sessions.') }, tr('Do this only for a computer you no longer use: it can no longer pay for VPN sessions.')), tr('That device\'s deposits can then be refunded here.'), tr('Network: Solana devnet (test tokens).')]} confirmLabel={tr('Remove')}
          onConfirm={async () => { await call(window.api.IPC.DEVICE_REVOKE, { device: otherAddr, confirmed: true }); await loadOther(); }} onClose={() => setModal(null)} />
      )}
      {modal === 'settle-other' && (
        <ConfirmModal title={tr('Refund that device\'s deposits')} lines={[trPlural({ one: 'Refund {count} deposit of {address} now.', other: 'Refund {count} deposits of {address} now.' }, otherDue.length, { count: otherDue.length, address: short(otherAddr) }), tr('Refunds go to this wallet. Any still in their 2-hour wait arrive later.'), tr('Network: Solana devnet (test tokens).')]} confirmLabel={tr('Refund')}
          onConfirm={async () => { const sigs = await call<string[]>(window.api.IPC.SETTLE_RUN, { device: otherAddr, confirmed: true }); useApp.getState().toast('success', settleToast(sigs)); await loadOther(); }} onClose={() => setModal(null)} />
      )}
      {modal === 'logout' && (
        <ConfirmModal title={tr('Sign out')} danger lines={[byPlatform(tr('Removes the encrypted key from this computer.'), tr('Removes the encrypted key from this phone.')), tr('You need your recovery phrase or key file to sign in again. Funds stay on chain.')]} confirmLabel={tr('Sign out')}
          onConfirm={async () => { await call(window.api.IPC.WALLET_LOGOUT); }} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
