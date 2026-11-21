// ─── About (Android) ───
// Android bundles a different set of programs than the desktop installers, and its full licence texts
// ship inside the app (scripts/android-notices.mjs writes THIRD-PARTY-NOTICES.txt next to index.html),
// so the phone shows them here instead of the desktop credits list. Settings picks it on onAndroid().
import { useEffect, useState } from 'react';
import { call, useApp } from '../../lib/store';
import { Section } from '../../components/ui';
import { tr } from '../../../../shared/i18n';
import { trJsx } from '../../lib/tr-jsx';

export function AboutAndroid() {
  const [version, setVersion] = useState('');
  const [notices, setNotices] = useState<string | null>(null);
  const openNotices = (): void => {
    // Shipped next to index.html (scripts/android-notices.mjs).
    fetch('./THIRD-PARTY-NOTICES.txt')
      .then((r) => { if (!r.ok) throw new Error(`Notices: http ${r.status}`); return r.text(); })
      .then(setNotices)
      .catch((err) => { console.warn('notices failed', err); useApp.getState().toast('warn', tr('The licence notices could not be opened.')); });
  };
  useEffect(() => {
    call<{ version: string }>(window.api.IPC.APP_INFO, undefined, { quiet: true })
      .then((i) => setVersion(i.version))
      .catch((err) => console.warn('app info failed', err));
  }, []);
  return (
    <Section title={tr('About')}>
      <div className="card text-sm" data-about>
        <p>{version ? trJsx('Devnet dVPN <v/>, on Solana devnet', { v: () => <span className="num text-fg-muted">{version}</span> }) : tr('Devnet dVPN, on Solana devnet')}</p>
        <p className="mt-2">
          {tr('Built on Sentinel.')}
          <button className="text-accent-ink underline" onClick={() => void call(window.api.IPC.OPEN_EXTERNAL, 'https://sentinel.co/')}>sentinel.co</button>
        </p>
        <p className="mt-2 text-meta text-fg-muted">{tr('The VPN service (dvpnd) and the Sentinel protocol files are under the Sentinel dVPN License. The other open-source parts are under their own licences.')}</p>
        <button className="btn-ghost btn-sm mt-3" data-notices-open onClick={openNotices}>{tr('Open-source licences')}</button>
      </div>
      {notices !== null && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={tr('Open-source licences')}>
          <div className="card-raised flex max-h-full w-full max-w-2xl flex-col rounded-xl p-4">
            <h2 className="mb-3 font-display text-section">{tr('Open-source licences')}</h2>
            <pre className="mono min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words text-meta text-fg-dim" data-notices>{notices}</pre>
            <div className="mt-3 flex justify-end"><button className="btn-primary" onClick={() => setNotices(null)}>{tr('Close')}</button></div>
          </div>
        </div>
      )}
    </Section>
  );
}
