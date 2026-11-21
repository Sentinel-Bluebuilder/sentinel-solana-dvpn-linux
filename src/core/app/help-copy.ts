// ─── Plain-language explanations (tooltips) ───
// One table for every term a person may not know. Each line says what the thing is, what it costs
// or does, and when it changes: one or two short sentences, no internal words. Screens show these
// through the Help (?) popover (components/Term.tsx), so a term reads the same everywhere.

import { tr } from '../../shared/i18n';
export const TERMS = () => ({
  deposit: tr('The amount set aside for a server when you connect. You pay only for what you use; the rest is refunded to your wallet.'),
  refund: tr('The unused part of a deposit, returned to your wallet. Per-hour deposits are refunded in minutes; per-GB deposits take about 2 hours once the refund starts.'),
  refundsOnTheWay: tr('Unused deposit money that is being returned. A per-GB deposit is kept for a day so a reconnect can use it, then refunded automatically.'),
  refundsReady: tr('Refunds that have finished and are waiting to be added to your wallet balance.'),
  spendingLimit: tr('The most this computer may pay to servers from your wallet without asking you again. You can change or remove it at any time in Wallet.'),
  networkFees: tr('A small amount of SOL that pays the Solana network for each transaction. Connecting usually costs well under 0.001 SOL.'),
  tdvpn: tr('The token servers are paid in. On this network it is a test token with no real value.'),
  devnet: tr('A test network. Tokens here are free test tokens, so nothing you do in this app costs real money.'),
  perGb: tr('You pay for the data you use. Good when you browse now and then; the deposit is kept for a day so reconnecting costs nothing new.'),
  perHour: tr('You pay for the time you stay connected, however much data you use. Good for streaming and large downloads.'),
  protocolFee: tr('A small share of what you pay that goes to the network itself rather than to the server.'),
  plan: tr('One payment for a set time. While it lasts you can connect to any server on the plan without a deposit.'),
  planAccess: tr('Your right to use one server of a plan. Some plans limit how many different servers you can use at once.'),
  wireguard: tr('WireGuard: fast and covers the whole computer. The best choice when it is not blocked where you are.'),
  amneziawg: tr('AmneziaWG: WireGuard made harder to detect. Covers the whole computer; use it where WireGuard is blocked.'),
  openvpn: tr('OpenVPN: older and slower than WireGuard, but works on almost every network. Covers the whole computer.'),
  v2ray: tr('V2Ray: looks like ordinary web traffic, so it gets through strict networks. Covers browsers and apps set to use it, not the whole computer.'),
  xray: tr('Xray: a newer V2Ray with stronger disguise. Covers browsers and apps set to use it, not the whole computer.'),
  hysteria2: tr('Hysteria2: built for slow or lossy connections. Covers browsers and apps set to use it, not the whole computer.'),
  killSwitch: tr('Blocks your internet if the VPN drops, so nothing leaves unprotected. Off: no block. On: blocked until the VPN is back. Always: blocked whenever you are not connected.'),
  splitTunnelling: tr('Lets you choose which apps use the VPN and which use your normal connection.'),
  wholeComputer: tr('Everything on this computer goes through the VPN, not only your browser.'),
  dns: tr('The service that turns site names into addresses. Through the VPN, your internet provider cannot see which sites you look up.'),
  solanaConnection: tr('The address this app uses to read from and write to the Solana network. The public one is free but slow and limited; your own is faster.'),
  vpnService: tr('A small background program that makes the VPN connection for this app. It is installed once and starts with the computer.'),
  responseTime: tr('How long the server took to answer a check, in milliseconds. Lower is better; it is not the download speed.'),
  favourites: tr('Servers you starred. They are listed first.'),
  sitesSee: tr('The address websites see instead of your own while you are connected.'),
  yourOwnIp: tr('The address your internet provider gave you. Websites see it when you are not connected.'),
  protectedState: tr('Protected: everything on this computer goes through the VPN. Protected in browsers: only apps that use the proxy are covered.'),
  restoreNetwork: tr('Removes the block the kill switch put on your internet connection. Use it when you are not connected and nothing loads.'),
  recoveryPhrase: tr('Twelve or more words that are your wallet. Anyone who has them can spend from it; without them a lost wallet cannot be recovered.'),
  keyFile: tr('A file that holds your wallet key. Keep a copy somewhere safe and never share it.'),
  nodeTest: tr('Connects to servers one at a time with a real, paid session and measures whether each works and how fast it is.'),
  serversOnline: tr('Servers that answered a check in the last 10 minutes and can take a connection now.'),
  sessionSpent: tr('What this session has cost so far. It updates every minute and includes the first block, which is paid up front.'),
} as const);

export type TermKey = keyof ReturnType<typeof TERMS>;

/** The tooltip for a protocol as the chain names it ("wireguard", "V2Ray"…), or null when unknown. */
export function protocolHelp(name: string): string | null {
  const k = name.toLowerCase().replace(/[^a-z0-9]/g, '') as TermKey;
  return k in TERMS() && ['wireguard', 'amneziawg', 'openvpn', 'v2ray', 'xray', 'hysteria2'].includes(k) ? TERMS()[k] : null;
}
