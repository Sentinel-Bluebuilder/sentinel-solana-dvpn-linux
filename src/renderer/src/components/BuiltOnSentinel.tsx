// ─── "Built on Sentinel" (owner 2026-11-15) ───
// On the right of the Connect header. The owner picked this layout from a preview (option B):
// a large box, one line: "BUILT ON", a hairline, then the Sentinel shield and the name.
// Everything sits on one centre line.
import { SentinelMark } from './SentinelMark';
import { call } from '../lib/store';
import { tr } from '../../../shared/i18n';

export const SENTINEL_URL = 'https://sentinel.co/';

export function BuiltOnSentinel() {
  return (
    <button
      className="group flex h-14 items-center gap-3.5 rounded-xl border border-line bg-bg-raised/50 px-5 text-start shadow-[inset_0_1px_0_rgb(255_255_255/.05)] transition-colors duration-state hover:border-[#0156FC]/65 hover:bg-bg-hover"
      data-built-on-sentinel
      title={tr('Sentinel is the decentralised VPN network this app runs on. Opens sentinel.co.')}
      onClick={() => void call(window.api.IPC.OPEN_EXTERNAL, SENTINEL_URL).catch((err) => console.warn('open sentinel.co failed', err))}
    >
      <span className="text-meta font-medium uppercase leading-none tracking-[0.14em] text-fg-muted">{tr('Built on')}</span>
      <span className="h-6 w-px bg-line" aria-hidden />
      <span className="flex items-center gap-2.5">
        <SentinelMark size={28} />
        <span className="font-display text-value font-semibold leading-none tracking-tight text-fg">Sentinel</span>
      </span>
    </button>
  );
}
