// ─── String catalogue (F25): every navigation/heading string lives here ───
// English only for v1; screens read t('key') so a language can be added without a code hunt.
import { tr } from '../../../shared/i18n';
const en = () => ({
  'nav.home': tr('Connect'),
  'nav.nodes': tr('Servers'),
  'nav.plans': tr('Plans'),
  'nav.activity': tr('Activity'),
  'nav.nodetest': tr('Node test'),
  'nav.wallet': tr('Wallet'),
  'nav.killswitch': tr('Kill switch'),
  'nav.split': tr('Split tunnelling'),
  'nav.settings': tr('Settings'),
  'nav.diagnostics': tr('Diagnostics'),
  'nav.cli': 'CLI',
  'nav.more': 'More',
  'app.tagline': tr('Pay any server directly. No accounts, no company in the middle.'),
  'net.devnet': tr('Solana devnet — test tokens only'),
  'onb.title': tr('Welcome to Devnet dVPN'),
  'onb.wallet': tr('Your wallet'),
  'onb.device': 'Payments',
  'onb.service': tr('VPN service'),
  'rpc.publicOnly': tr('Only the public devnet RPC is configured. It rate-limits real use; add your own endpoint in Settings.'),
} as const);

export type StringKey = keyof ReturnType<typeof en>;
export const t = (k: StringKey): string => en()[k];
