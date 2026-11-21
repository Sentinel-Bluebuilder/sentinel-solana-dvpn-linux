// ─── Restore network: the one button (UI-103) ───
// The same red button on every screen that offers it. It shows that it is working, and a failure is
// said next to it: pressing it three times with nothing happening is what the logs recorded.
import { useState } from 'react';
import { call } from '../lib/store';
import { Help, InlineError } from './ui';
import { tr } from '../../../shared/i18n';

export const RESTORE_HELP = (): string => tr('Removes the block the kill switch put on your internet connection. Use it when you are not connected to the VPN and nothing loads.');

export function RestoreNetworkButton({ small, full, help, onDone }: { small?: boolean; full?: boolean; help?: boolean; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const press = (): void => {
    setBusy(true); setError('');
    call(window.api.IPC.RESTORE_NETWORK, undefined, { quiet: true })
      .then(() => onDone?.(), (err: unknown) => {
        console.warn('restore network failed', err);
        setError(err instanceof Error && err.message ? err.message : tr('Restore network did not finish. Open Diagnostics to see why.'));
      })
      .finally(() => setBusy(false));
  };
  return (
    <span className={`${full ? 'flex w-full' : 'inline-flex'} flex-col gap-1`} data-restore-network-box>
      <span className="inline-flex items-center gap-1.5">
        <button className={`btn-danger ${small ? 'btn-sm' : ''} ${full ? 'w-full' : ''}`} data-restore-network disabled={busy} aria-busy={busy} onClick={press}>{busy ? tr('Restoring…') : tr('Restore network')}</button>
        {help && <Help text={RESTORE_HELP()} />}
      </span>
      <InlineError>{error}</InlineError>
    </span>
  );
}
