// ─── Install service: the onboarding install, reachable after setup too (Q0305) ───
// On a set-up device whose service is gone, setup no longer takes the window (setup-gate), so the
// "not answering" banner and Diagnostics need this button or there is no way back short of a
// reinstall. Same call as onboarding (DAEMON_INIT install: one administrator prompt).
// After a first install Windows lets this account reach the service only from its next sign-in
// (cb33 opens the pipe to the sentinel-dvpn group): the button then says so in one plain panel.
// Hooks: data-install-service="idle|busy|done|relogin"; errors reach the user through call()'s toast.
import { useState } from 'react';
import { call, useApp } from '../lib/store';
import { osPick } from '../lib/platform';
import { tr } from '../../../shared/i18n';

export function InstallServiceButton({ className = 'btn-primary btn-sm', label }: { className?: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'relogin'>('idle');
  if (state === 'relogin') {
    return (
      <div className="card text-sm" role="status" data-install-service="relogin">
        <strong>{tr('One more step: sign out of Windows and sign back in.')}</strong>
        <p className="mt-1 text-fg-muted">{tr('The VPN service is installed. Windows lets this account use it from your next sign-in. Your settings and device are kept.')}</p>
      </div>
    );
  }
  return (
    // 'done' stays disabled: a second click would raise a second administrator prompt (FWX review of 27aae7e).
    <button className={className} disabled={state !== 'idle'} data-install-service={state} onClick={async () => {
      setState('busy');
      try {
        const r = (await call(window.api.IPC.DAEMON_INIT, { step: 'install' })) as { relogin?: boolean } | undefined;
        if (r?.relogin) { setState('relogin'); return; }
        // Android: "install" starts the bundled engine again (nothing to install).
        useApp.getState().toast('success', osPick({ android: 'VPN service started.' }, 'VPN service installed.'));
        setState('done');
      } catch (err) {
        console.warn('service install failed', err);
        setState('idle');
      }
    }}>{state === 'busy' ? osPick({ win32: tr('Waiting for Windows…'), android: tr('Starting…') }, tr('Waiting for permission…')) : state === 'done' ? osPick({ android: tr('Started') }, tr('Installed')) : label ?? osPick({ android: tr('Start service') }, tr('Install service'))}</button>
  );
}
