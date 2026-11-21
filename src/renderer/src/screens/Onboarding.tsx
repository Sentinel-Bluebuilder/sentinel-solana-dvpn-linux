// ─── First run (F1.5, F2): wallet → device key, then straight into the app ───
// Owner 2026-11-11: no spending-permission step. The app signs it in the background once the
// wallet holds SOL (setting autoDevicePermission, services/wallet.autoDeviceSetup); until then,
// and until the service runs, the main layout shows a banner. The device key is created on its own.
import { useEffect, useRef, useState } from 'react';
import { call } from '../lib/store';
import { t } from '../lib/strings';
import { AppMark, Banner, ConfirmModal, Copy, DevnetBadge } from '../components/ui';
import { InstallServiceButton } from '../components/InstallServiceButton';
import { formatTdvpn, sol, formatTdvpnShort, short } from '../../../shared/format';
import type { AppSnapshot } from '../../../shared/types';
import { pickCheckPositions, wrongPhraseWords } from '../../../shared/phrase-check';
import { byPlatform, osPick, thisDevice } from '../lib/platform';
import { tr } from '../../../shared/i18n';
import { LanguageSelect, menuLanguages, saveLanguage } from '../components/LanguageSelector';
import { useApp } from '../lib/store';

/** Where the wallet key is encrypted on this OS (the words only; the code is each OS's keystore). */
// Where the key is kept, as whole sentences per OS (the store's name is never put inside another sentence).
const keyStaysLine = (): string => osPick({
  win32: tr('The key is encrypted with Windows (DPAPI) and stays on this computer.'),
  darwin: tr('The key is encrypted with the macOS Keychain and stays on this computer.'),
  linux: tr('The key is encrypted with your desktop keyring and stays on this computer.'),
  android: tr('The key is encrypted with the Android Keystore and stays on this phone.'),
}, tr('The key is encrypted with the system key store and stays on this computer.'));
const keyFileLine = (): string => osPick({
  win32: tr('A Solana key file (.json). It is read here and encrypted with Windows (DPAPI); it is not copied anywhere.'),
  darwin: tr('A Solana key file (.json). It is read here and encrypted with the macOS Keychain; it is not copied anywhere.'),
  linux: tr('A Solana key file (.json). It is read here and encrypted with your desktop keyring; it is not copied anywhere.'),
  android: tr('A Solana key file (.json). It is read here and encrypted with the Android Keystore; it is not copied anywhere.'),
}, tr('A Solana key file (.json). It is read here and encrypted with the system key store; it is not copied anywhere.'));

export type Step = 'wallet' | 'device' | 'permission' | 'service' | 'done';

export function onboardingStep(s: AppSnapshot): Step {
  if (!s.hasWallet) return 'wallet';
  if (!s.daemon.device && !s.wallet?.device) return 'device';
  if (s.wallet && !s.wallet.ready) return 'permission';
  if (!s.daemon.reachable) return 'service';
  return 'done';
}

const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'wallet', label: t('onb.wallet') },
  { id: 'device', label: t('onb.device') },
  { id: 'service', label: t('onb.service') },
];

export function Onboarding({ snap, onContinue, phrase, setPhrase }: { snap: AppSnapshot; onContinue?: () => void; phrase: string | null; setPhrase: (p: string | null) => void }) {
  // The phrase is held in App, not here: creating the wallet can end setup at once (a device key
  // already exists, and the spending permission is no step), which unmounted this screen and lost
  // the phrase card with it (owner 2026-11-11: "Create a new wallet" jumped straight into the app).
  const step = onboardingStep(snap);
  const savedLang = useApp((s) => s.settings?.language ?? '');
  const at = STEPS.findIndex((s) => s.id === step);
  return (
    <div className="grid h-full grid-cols-1 min-[880px]:grid-cols-[minmax(320px,0.9fr)_1.1fr]" data-onboarding-step={onContinue ? 'welcome' : step}>
      {/* Brand side (F2.1): what this is, in three lines. */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-e border-line bg-bg-card p-10 min-[880px]:flex">
        <div className="pointer-events-none absolute -start-24 -top-24 h-80 w-80 rounded-full bg-sol-purple/25 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-28 -end-20 h-72 w-72 rounded-full bg-sol-green/15 blur-3xl" aria-hidden />
        <div className="relative flex items-center gap-3">
          <AppMark size={40} />
          <div>
            <div className="font-display text-section font-semibold tracking-[-0.01em]">Devnet <span className="bg-sol bg-clip-text text-transparent">dVPN</span></div>
            <div className="text-meta text-fg-muted">{tr('Built on Solana')}</div>
          </div>
        </div>
        <div className="relative">
          <h1 className="font-display text-hero">{t('onb.title')}</h1>
          <p className="mt-4 text-sm text-fg-dim">{t('app.tagline')}</p>
          <ul className="mt-8 space-y-4 text-sm">
            {[
              [tr('Peer to peer'), tr('You connect straight to a server run by anyone, anywhere.')],
              [tr('Pay only for use'), tr('A refundable deposit; the server is paid per GB or per hour.')],
              [tr('Your keys'), byPlatform(tr('No account. Your wallet stays encrypted on this computer.'), tr('No account. Your wallet stays encrypted on this phone.'))],
            ].map(([h, d]) => (
              <li key={h} className="flex gap-3">
                <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sol text-label font-semibold text-sol-ink" aria-hidden>✓</span>
                <div><div className="font-display font-semibold">{h}</div><div className="text-fg-dim">{d}</div></div>
              </li>
            ))}
          </ul>
        </div>
        <div className="relative hidden md:block"><DevnetBadge /></div>
      </aside>
      <section className="flex flex-col justify-center overflow-y-auto p-6 min-[880px]:p-10">
        <div className="mx-auto w-full max-w-xl">
          {/* Narrow window: the brand side is hidden, so name the app here. */}
          <div className="mb-6 flex items-center gap-3 min-[880px]:hidden">
            <AppMark size={32} />
            <div className="font-display text-section font-semibold tracking-[-0.01em]">Devnet <span className="bg-sol bg-clip-text text-transparent">dVPN</span></div>
            <div className="ms-auto"><DevnetBadge /></div>
          </div>
          {/* Queue B5: the language on the first screen (a new wallet, or the welcome back), before any choice. */}
          {!phrase && (onContinue || step === 'wallet') && menuLanguages().length > 1 && (
            <div className="mb-4 ms-auto w-56 max-w-full" data-onboarding-language>
              <LanguageSelect look="row" value={savedLang} languages={menuLanguages()} onChange={(code) => void saveLanguage(code)} />
            </div>
          )}
          {onContinue && !phrase ? <div className="card-raised rounded-xl p-6"><WelcomeBack snap={snap} onContinue={onContinue} /></div> : <>
          <ol className="mb-6 grid grid-cols-3 gap-3" aria-label={tr('Setup steps')}>
            {STEPS.map((s, i) => (
              <li key={s.id} aria-current={i === at ? 'step' : undefined}>
                <div className={`mb-2 h-1 rounded-full ${i < at ? 'bg-ok' : i === at ? 'bg-sol' : 'bg-bg-hover'}`} />
                <div className={`min-w-0 break-words text-label font-semibold uppercase leading-snug ${i < at ? 'text-ok' : i === at ? 'text-fg' : 'text-fg-muted'}`}>{i < at ? '✓ ' : `${i + 1}. `}{s.label}</div>
              </li>
            ))}
          </ol>
          <div className="card-raised rounded-xl p-4 md:p-6">
            {phrase ? <PhraseCard phrase={phrase} onDone={() => setPhrase(null)} /> : step === 'wallet' && <WalletStep onCreated={setPhrase} />}
            {!phrase && step === 'device' && <DeviceStep snap={snap} />}
            {!phrase && step === 'service' && <ServiceStep snap={snap} />}
          </div>
          </>}
        </div>
      </section>
    </div>
  );
}

// F2.1: the welcome screen comes first on every launch, even when set up. One click on.
function WelcomeBack({ snap, onContinue }: { snap: AppSnapshot; onContinue: () => void }) {
  const [confirmOut, setConfirmOut] = useState(false);
  const w = snap.wallet;
  return (
    <div>
      {/* Centered card (owner 2026-11-12): title, wallet line, balances side by side, one primary action. */}
      <div className="flex flex-col items-center text-center" data-welcome>
        <h2 className="font-display text-title">{tr('Welcome back')}</h2>
        <p className="mt-1 text-sm text-fg-muted">{byPlatform(tr('Your wallet is ready on this computer.'), tr('Your wallet is ready on this phone.'))}</p>
        <div className="mt-5 inline-flex h-9 items-center gap-3 rounded-[10px] border border-line bg-bg-input px-3" data-welcome-wallet>
          <span className="text-label uppercase leading-none text-fg-muted">{tr('Wallet')}</span>
          <span className="mono text-sm leading-none text-fg-dim" title={snap.owner ?? ''}>{short(snap.owner, 6)}</span>
          {snap.owner && <Copy text={snap.owner} />}
        </div>
        {/* UI-185: the balances hold their place while the wallet is read (a dash until then); the refunds line keeps its height. */}
        <div className="mt-5 grid w-full max-w-sm grid-cols-2 overflow-hidden rounded-lg border border-line bg-bg-card" aria-busy={!w} data-welcome-balances={w ? 'ready' : 'reading'}>
          <div className="flex flex-col items-center px-4 py-3"><span className="text-label uppercase text-fg-muted">{tr('Balance')}</span><span className="num font-display text-value">{w ? formatTdvpnShort(w.ownerTdvpn) : '—'}</span><span className="text-meta text-fg-muted">tDVPN</span></div>
          <div className="flex flex-col items-center border-s border-line px-4 py-3"><span className="text-label uppercase text-fg-muted">{tr('Fees')}</span><span className="num font-display text-value">{w ? sol(w.ownerLamports) : '—'}</span><span className="text-meta text-fg-muted">SOL</span></div>
        </div>
        <p className="mt-3 min-h-[1lh] text-meta text-fg-muted">{w && w.userBalance !== '0' ? <>{tr('Plus {userBalance} tDVPN of refunds ready to add in Wallet.', { userBalance: formatTdvpnShort(w.userBalance) })}</> : null}</p>
        <div className="mt-6 flex w-full max-w-sm flex-col gap-2">
          <button className="btn-primary w-full justify-center" data-welcome-continue onClick={onContinue} autoFocus>{tr('Continue')}</button>
          <button className="btn-ghost w-full justify-center" onClick={() => setConfirmOut(true)}>{tr('Use a different wallet')}</button>
        </div>
      </div>
      {confirmOut && (
        <ConfirmModal title={tr('Use a different wallet?')} confirmLabel={tr('Remove this wallet')} danger
          lines={[`This removes the encrypted key from ${thisDevice()}.`,'You can restore it later only with its recovery phrase or key file.', 'Funds stay on chain; nothing is sent.']}
          onClose={() => setConfirmOut(false)}
          onConfirm={async () => { setConfirmOut(false); await call(window.api.IPC.WALLET_LOGOUT); }} />
      )}
    </div>
  );
}

// Q0297: "I saved it" leads to a check of a few words by position; a wrong or empty word keeps the card open.
// Hooks: data-phrase-word="N" (phrase card), data-phrase-check, data-phrase-ask="N" (input, 1-based),
// data-phrase-check-submit, data-phrase-wrong (error). The words are not in the DOM while the check shows.
function PhraseCard({ phrase, onDone }: { phrase: string; onDone: () => void }) {
  const [checking, setChecking] = useState(false);
  const [positions, setPositions] = useState<number[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [wrong, setWrong] = useState<number[]>([]);
  // Q0324: the window stays out of screenshots and screen recording while the phrase card is open.
  // Android (Q0309): FLAG_SECURE through the WebView bridge, also hiding the Recents thumbnail.
  useEffect(() => {
    void call(window.api.IPC.PROTECT_SCREEN, true, { quiet: true }).catch((err) => console.warn('screen protection on failed', err));
    window.api.android?.setSecure(true);
    return () => { void call(window.api.IPC.PROTECT_SCREEN, false, { quiet: true }).catch((err) => console.warn('screen protection off failed', err)); window.api.android?.setSecure(false); };
  }, []);
  if (checking) {
    return (
      <div data-phrase-check>
        <h2 className="mb-2 font-display text-section">{tr('Check your recovery phrase')}</h2>
        <p className="mb-3 text-sm text-fg-dim">{tr('Type these words from what you wrote down, so a missed or mis-copied word is caught now.')}</p>
        <div className="mb-3 grid gap-3 sm:grid-cols-3">
          {positions.map((p, i) => (
            <div key={p}>
              <label className="label" htmlFor={`pw${p}`}>{tr('Word {p}', { p: p + 1 })}</label>
              <input id={`pw${p}`} data-phrase-ask={p + 1} aria-label={tr('Word {p}', { p: p + 1 })} className={`input mono ${wrong.includes(p) ? 'border-bad' : ''}`} value={answers[i] ?? ''} autoComplete="off" autoCapitalize="none" spellCheck={false}
                onChange={(e) => { const next = [...answers]; next[i] = e.target.value; setAnswers(next); setWrong([]); }} />
            </div>
          ))}
        </div>
        {wrong.length > 0 && <p className="mb-3 text-sm text-bad" role="alert" data-phrase-wrong={wrong.map((p) => p + 1).join(',')}>{wrong.length === 1 ? tr('Word {word} does not match. Check what you wrote down, or show the phrase again.', { word: wrong[0] + 1 }) : tr('Words {words} do not match. Check what you wrote down, or show the phrase again.', { words: wrong.map((p) => p + 1).join(', ') })}</p>}
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => { setChecking(false); setWrong([]); }}>{tr('Show the phrase again')}</button>
          <button className="btn-primary" data-phrase-check-submit onClick={() => { const bad = wrongPhraseWords(phrase, positions, answers); if (bad.length) setWrong(bad); else onDone(); }}>{tr('Check')}</button>
        </div>
      </div>
    );
  }
  return (
    <div>
      <h2 className="mb-2 font-display text-section">{tr('Write down your recovery phrase')}</h2>
      <p className="mb-3 text-sm text-fg-dim">{tr('It is the only way to restore this wallet. Anyone with it controls your funds. After the check below it is never shown again.')}</p>
      <div className="mono mb-4 grid grid-cols-3 gap-2 sm:grid-cols-4 rounded border border-line bg-bg-input p-3">
        {phrase.split(' ').map((w, i) => <span key={i} data-phrase-word={i + 1}><span className="text-fg-muted">{i + 1}.</span> {w}</span>)}
      </div>
      <button className="btn-primary" data-phrase-saved onClick={() => {
        if (!positions.length) setPositions(pickCheckPositions(phrase.trim().split(/\s+/).length));
        setAnswers([]); setChecking(true);
      }}>{tr('I saved it')}</button>
    </div>
  );
}

// UI-108: a failed step says so under its own button (a toast is gone before it is read).
const failText = (err: unknown, fallback: string): string => ((err as Error | null)?.message || '').trim() || fallback;
function StepError({ text }: { text: string | null }) {
  return text ? <p className="mt-3 text-sm text-bad" role="alert" data-step-error>{text}</p> : null;
}

function WalletStep({ onCreated }: { onCreated: (phrase: string) => void }) {
  const [mode, setMode] = useState<'choose' | 'import'>('choose');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  if (mode === 'import') {
    return (
      <div>
        <h2 className="mb-2 font-display text-section">{tr('Import a wallet')}</h2>
        <label className="label" htmlFor="imp">{tr('Recovery phrase, the contents of a key file, or a secret key')}</label>
        <textarea id="imp" aria-label={tr('Wallet to import')} className="input mono mb-3 h-24" value={input} onChange={(e) => setInput(e.target.value)} autoComplete="off" spellCheck={false} />
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => setMode('choose')}>{tr('Back')}</button>
          <button className="btn-primary" data-import-submit disabled={!input.trim() || busy} onClick={async () => {
            setBusy(true);
            setFailed(null);
            try { await call(window.api.IPC.WALLET_IMPORT, input.trim(), { quiet: true }); setInput(''); } catch (err) { console.warn('import failed', err); setFailed(failText(err, 'That could not be imported. Check the phrase or key and try again.')); } finally { setBusy(false); }
          }}>{tr('Import')}</button>
        </div>
        <StepError text={failed} />
        <p className="mt-3 text-meta text-fg-muted">{keyStaysLine()}</p>
      </div>
    );
  }
  return (
    <div>
      <h2 className="mb-2 font-display text-section">{tr('Set up your wallet')}</h2>
      <p className="mb-4 text-sm text-fg-dim">{tr('Your wallet pays servers directly in tDVPN. There is no account and no sign-up.')}</p>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" data-wallet-create disabled={busy} onClick={async () => {
          setBusy(true);
          setFailed(null);
          try { const r = await call<{ mnemonic: string }>(window.api.IPC.WALLET_CREATE, undefined, { quiet: true }); onCreated(r.mnemonic); } catch (err) { console.warn('create failed', err); setFailed(failText(err, 'The wallet could not be created. Try again.')); } finally { setBusy(false); }
        }}>{tr('Create a new wallet')}</button>
        <button className="btn-ghost" data-wallet-import onClick={() => setMode('import')}>{tr('Import a wallet')}</button>
      </div>
      <div className="mt-4 border-t border-line pt-4">
        <button className="text-sm text-accent-ink underline-offset-2 hover:underline" data-import-keyfile disabled={busy} onClick={async () => {
          setBusy(true);
          setFailed(null);
          try { await call(window.api.IPC.WALLET_IMPORT_FILE, undefined, { quiet: true }); } catch (err) { if ((err as { code?: string }).code !== 'cancelled') setFailed(failText(err, 'That key file could not be imported.')); } finally { setBusy(false); }
        }}>{tr('Import a key file (devnet test wallet)…')}</button>
        <p className="mt-1 text-meta text-fg-muted">{keyFileLine()}</p>
      </div>
      <StepError text={failed} />
    </div>
  );
}

function DeviceStep({ snap }: { snap: AppSnapshot }) {
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);
  const [addr, setAddr] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  // No click needed (owner 2026-11-11): create or read the device key once, on its own. Neither
  // needs admin rights. The buttons below stay as the retry and the manual fallback.
  const tried = useRef(false);
  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    setBusy(true);
    const step = snap.daemon.reachable ? 'adopt' : 'init';
    call(window.api.IPC.DAEMON_INIT, { step }, { quiet: true })
      .catch((err) => { console.warn(`device ${step} (automatic) failed`, err); setFailed(failText(err, step === 'adopt' ? tr('The address could not be read from the service. Enter it below.') : tr('Payments could not be set up. Try again.'))); if (step === 'adopt') setManual(true); })
      .finally(() => setBusy(false));
  }, [snap.daemon.reachable]);
  if (snap.daemon.reachable) {
    return (
      <div>
        <h2 className="mb-2 font-display text-section">{byPlatform(tr('Use the VPN service on this computer'), tr('Use the VPN service on this phone'))}</h2>
        <p className="mb-4 text-sm text-fg-dim">{tr('A VPN service is already running here. It pays servers from its own address, within a spending limit your wallet sets. The app reads that address from the service.')}</p>
        {!manual ? (
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy} onClick={async () => {
              setBusy(true);
              setFailed(null);
              try { await call(window.api.IPC.DAEMON_INIT, { step: 'adopt' }, { quiet: true }); } catch (err) { console.warn('detect failed', err); setFailed(failText(err, 'The address could not be read from the service. Enter it below.')); setManual(true); } finally { setBusy(false); }
            }}>{busy ? tr('Reading…') : tr('Read it from the service')}</button>
            <button className="btn-ghost" onClick={() => setManual(true)}>{tr('Enter it')}</button>
          </div>
        ) : (
          <div>
            <label className="label" htmlFor="dev">{tr('Payment address of the VPN service (shown when it was set up)')}</label>
            <input id="dev" className="input mono mb-3" value={addr} onChange={(e) => setAddr(e.target.value.trim())} spellCheck={false} />
            <button className="btn-primary" disabled={!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)} onClick={() => { setFailed(null); call(window.api.IPC.DAEMON_INIT, { step: 'adopt', device: addr }, { quiet: true }).catch((err) => { console.warn('adopt failed', err); setFailed(failText(err, 'That address could not be used.')); }); }}>{tr('Use this address')}</button>
          </div>
        )}
        <StepError text={failed} />
      </div>
    );
  }
  return (
    <div>
      <h2 className="mb-2 font-display text-section">{byPlatform(tr('Set up payments on this computer'), tr('Set up payments on this phone'))}</h2>
      <p className="mb-4 text-sm text-fg-dim">{tr('The VPN service pays servers from its own address, within a spending limit your wallet sets, so your wallet key is never used during a session.')}{byPlatform(<> {tr('This step needs no administrator rights.')}</>, null)}</p>
      <button className="btn-primary" disabled={busy} onClick={async () => {
        setBusy(true);
        setFailed(null);
        try { await call(window.api.IPC.DAEMON_INIT, { step: 'init' }, { quiet: true }); } catch (err) { console.warn('device init failed', err); setFailed(failText(err, 'Payments could not be set up. Try again.')); } finally { setBusy(false); }
      }}>{busy ? tr('Setting up…') : tr('Set up payments')}</button>
      <StepError text={failed} />
    </div>
  );
}

// The same Install service control as the banner and Diagnostics (one control, one test cell).
function ServiceStep({ snap }: { snap: AppSnapshot }) {
  return (
    <div>
      <h2 className="mb-2 font-display text-section">{osPick({ android: tr('Start the VPN service') }, tr('Install the VPN service'))}</h2>
      <p className="mb-3 text-sm text-fg-dim">{tr('The service builds tunnels, guards against leaks and meters usage.')} {osPick({ win32: tr('Windows asks for administrator permission once.'), android: tr('It runs inside this app; Android asked once to allow VPN connections.') }, tr('Your system asks for administrator permission once.'))}</p>
      {snap.daemon.error && <Banner kind="info">{snap.daemon.error}</Banner>}
      <InstallServiceButton className="btn-primary" />
    </div>
  );
}
