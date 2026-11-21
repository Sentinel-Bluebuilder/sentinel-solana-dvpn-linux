// ─── Sentinel mark (owner 2026-11-15: "the logo is wrong we need to use the Sentinel logo") ───
// The Sentinel shield, from our own Sentinel homepage project (ecoSentinelShield.svg), in its own
// blue. `size` is the height in px; the shield is 45:48.
import shield from '../assets/brand/sentinel-shield.svg';

export function SentinelMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return <img src={shield} alt="" aria-hidden width={Math.round(size * 45 / 48)} height={size} className={`shrink-0 ${className}`} style={{ height: size, width: 'auto' }} />;
}
