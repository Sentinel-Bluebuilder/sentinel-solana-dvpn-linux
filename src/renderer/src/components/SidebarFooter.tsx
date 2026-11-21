// ─── Sidebar footer (owner 2026-11-15) ───
// On every page: where to get test SOL and test tDVPN, and a one-click dark / light switch.
// Each token button copies your address first, so the faucet page only needs a paste.
import { call, useApp } from '../lib/store';
import { Icon } from './Icon';
import { SentinelMark } from './SentinelMark';
import type { ReactNode } from 'react';
import type { AppSettings } from '../../../shared/types';
import { tr } from '../../../shared/i18n';

/** Solana's devnet faucet (free SOL for network fees). */
export const SOL_FAUCET_URL = 'https://faucet.solana.com/';
/** The test tDVPN faucet. Empty until its address is given: the button then copies your address and opens Wallet. */
export const TDVPN_FAUCET_URL = '';

/** Solana's three-bar mark, drawn here so nothing is fetched. */
function SolMark({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden>
      <defs><linearGradient id="sol-mark" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#9945FF" /><stop offset="1" stopColor="#14F195" /></linearGradient></defs>
      <g fill="url(#sol-mark)">
        <path d="M5.2 3.6h11.3l-2.2 2.6H3z" />
        <path d="M3 8.7h11.3l2.2 2.6H5.2z" />
        <path d="M5.2 13.8h11.3l-2.2 2.6H3z" />
      </g>
    </svg>
  );
}

const TOKEN_BTN = 'group flex h-8 min-w-0 flex-1 items-center justify-center gap-2 rounded-md border border-warn/30 bg-bg-card/70 px-2 text-meta font-medium text-fg-dim transition-colors duration-state hover:border-warn/60 hover:bg-bg-card hover:text-fg disabled:opacity-50';

/** Owner 2026-11-16: Devnet and "Get test tokens" are one card in the Devnet style: the Devnet line on top
 *  (mark, name, "Test tokens only"), the two token buttons under it, all centred on one line. */
export function TestTokens({ owner, onWallet }: { owner: string | null; onWallet: () => void; right?: ReactNode }) {
  const toast = useApp((s) => s.toast);
  const get = (url: string, what: string): void => {
    if (!owner) { toast('info', tr('Create or import a wallet first.')); return; }
    void window.api.invoke(window.api.IPC.COPY, owner);
    if (url) {
      void call(window.api.IPC.OPEN_EXTERNAL, url).catch((err) => console.warn('open faucet failed', err));
      toast('info', tr('Your address is copied. Paste it into the {what} faucet page.', { what }));
    } else {
      toast('info', tr('Your address is copied. Have {what} sent to it; it shows in Wallet.', { what }));
      onWallet();
    }
  };
  return (
    <div className="rounded-lg border border-warn/40 bg-warn-soft p-2" data-test-tokens data-devnet-card title={tr('This app runs on Solana devnet. The tokens are for testing and have no real value.')}>
      <div className="mb-2 flex h-6 items-center justify-center gap-2 text-meta leading-none text-warn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
          <path d="M9 3h6M10 3v6.5L4.6 18.2A1.8 1.8 0 0 0 6.1 21h11.8a1.8 1.8 0 0 0 1.5-2.8L14 9.5V3M7.5 15h9" />
        </svg>
        <span className="font-semibold">Devnet</span>
        <span className="truncate text-fg-dim">{tr('Get test tokens')}</span>
      </div>
      <div className="flex gap-2">
        <button className={TOKEN_BTN} data-get-token="sol" title={tr('Free devnet SOL for network fees. Copies your address and opens the Solana faucet.')} onClick={() => get(SOL_FAUCET_URL, 'SOL')}>
          <SolMark /><span className="truncate">SOL</span>
        </button>
        <button className={TOKEN_BTN} data-get-token="tdvpn" title={tr('Test tDVPN, used to pay servers. Copies your address.')} onClick={() => get(TDVPN_FAUCET_URL, 'tDVPN')}>
          <SentinelMark size={16} /><span className="truncate">tDVPN</span>
        </button>
      </div>
    </div>
  );
}

/** Light | dark as a two-part switch beside the language menu (owner 2026-11-16: "more intuitive"): both
 *  choices are visible, the current one is lit. The full choice (follow the system) stays in Settings. */
export function ThemeToggle({ settings, onChange }: { settings: AppSettings | null; onChange: (s: AppSettings) => void }) {
  const dark = settings?.theme === 'dark' || (settings?.theme !== 'light' && !window.matchMedia(tr('(prefers-color-scheme: light)')).matches);
  const set = (theme: 'light' | 'dark'): void => {
    void call<AppSettings>(window.api.IPC.SETTINGS_SET, { theme }).then(onChange, (err) => console.warn('theme change failed', err));
  };
  const part = (on: boolean): string => `grid h-full w-8 place-items-center rounded-md transition-colors duration-press ${on ? 'bg-bg-card text-fg shadow-[0_1px_2px_rgb(0_0_0/.25)]' : 'text-fg-muted hover:text-fg'}`;
  return (
    <div className="flex h-9 shrink-0 items-center gap-0.5 rounded-lg border border-line bg-bg-raised/50 p-0.5" role="group" data-theme-toggle={dark ? 'dark' : 'light'}>
      <button type="button" className={part(!dark)} aria-pressed={!dark} onClick={() => set('light')} title={tr('Switch to light')} aria-label={tr('Switch to light theme')} data-theme-choice="light">
        <Icon name="sun" size={16} />
      </button>
      <button type="button" className={part(dark)} aria-pressed={dark} onClick={() => set('dark')} title={tr('Switch to dark')} aria-label={tr('Switch to dark theme')} data-theme-choice="dark">
        <Icon name="moon" size={16} />
      </button>
    </div>
  );
}
