// ─── Gallery fixtures (UI-165) ───
// Made-up servers and app states so the gallery can render the real Connect screen and status
// card in every stage without a wallet, a VPN service or the network. Dev and screenshot runs only.
import { viewFor, type ConnPhase } from '../../../core/session/state';
import type { Coverage } from '../../../core/session/coverage';
import type { AppSnapshot, NodeView } from '../../../shared/types';

const now = Date.now();
const ADDR = ['GalleryFrankfurt1111111111111111111111111111', 'GallerySingapore1111111111111111111111111111', 'GalleryToronto111111111111111111111111111111'];

function server(i: number, code: string, country: string, city: string, proto: string, ms: number, ok: boolean): NodeView {
  return {
    address: ADDR[i], owner: 'GalleryOperator11111111111111111111111111111', listed: true, listingFresh: true,
    expiresAt: Math.floor(now / 1000) + 86_400, countryCode: code, country, protocolNames: [proto],
    pricePerGb: '2000000', pricePerHour: '500000', favourite: i === 0,
    probe: { ok, reachable: ok, latencyMs: ok ? ms : null, probedAt: now, city, peers: 3, maxPeers: 50, signatureValid: true, signerAuthorized: true, claimsMatch: true, metadataExpired: false, tlsPinMatch: true, error: ok ? null : 'not reachable', version: '1.0.0', downloadMbps: 200, uploadMbps: 100 },
  } as unknown as NodeView;
}

export const GALLERY_NODES: NodeView[] = [
  server(0, 'DE', 'Germany', 'Frankfurt', 'wireguard', 42, true),
  server(1, 'SG', 'Singapore', 'Singapore', 'v2ray', 180, true),
  server(2, 'CA', 'Canada', 'Toronto', 'openvpn', 0, false),
];

export interface Preview { id: string; name: string; snap: AppSnapshot }

function snap(phase: ConnPhase, over: Partial<Omit<AppSnapshot, 'session'>> & { title?: string; detail?: string; coverage?: Coverage | null; session?: boolean } = {}): AppSnapshot {
  const view = viewFor(phase, over.detail ?? '');
  const session = over.session ? { id: 'gallery-session-1', node: ADDR[0], status: 'active', service: 'wireguard', rxBytes: '1288490188', txBytes: '104857600', seconds: '724', spent: '2400000', channel: 'GalleryDeposit111111111111111111111111111111', proxyEndpoint: '', error: '', warning: '', startedAt: null } : null;
  const { title, detail: _detail, session: _session, ...rest } = over;
  return {
    hasWallet: true, owner: 'GalleryWallet1111111111111111111111111111111', signerKind: 'in-app',
    wallet: { ownerTdvpn: '124500000', userBalance: '0', ownerLamports: 500_000_000, deviceLamports: 50_000_000, delegated: '0', grant: null, needsPermission: false, device: 'GalleryDevice1111111111111111111111111111111' },
    daemon: { reachable: true, error: null, networkOk: true },
    conn: { ...view, title: title ?? view.title },
    session, settlements: [], subscriptions: [],
    rpc: { serving: 'gallery', healthy: true, publicOnly: false },
    lastCloseMessage: null, lastConnectError: null, proxyActive: false,
    publicIp: session ? { ip: '203.0.113.7', source: 'gallery', at: now, sid: session.id } : null,
    homeIp: '198.51.100.24', coverage: null, dns: session ? 'Cloudflare' : null,
    connectTarget: null,
    ...rest,
  } as unknown as AppSnapshot;
}

const target = { node: ADDR[0], switching: false };

/** The Connect screen in every stage, in the order a clean connect passes through them, then the others. */
export const PREVIEWS: Preview[] = [
  { id: 'idle', name: 'Not connected', snap: snap('idle') },
  { id: 'ready', name: 'Getting ready', snap: snap('preflight', { detail: 'Checking the server…', connectTarget: target }) },
  { id: 'deposit', name: 'Deposit', snap: snap('paying', { detail: 'Paying deposit 5 tDVPN…', connectTarget: target }) },
  { id: 'connecting', name: 'Connecting', snap: snap('connecting', { connectTarget: target }) },
  { id: 'checking', name: 'Checking', snap: snap('checking', { connectTarget: target, session: true }) },
  { id: 'protected', name: 'Protected', snap: snap('connected', { session: true, coverage: 'device', detail: 'Everything on this computer goes through the VPN.' }) },
  { id: 'leaking', name: 'Not protected', snap: snap('connected', { session: true, coverage: 'leaking', title: 'Not going through the VPN', detail: 'Sites still see your own address. Try another server, or open Diagnostics.' }) },
  { id: 'reconnecting', name: 'Reconnecting', snap: snap('reconnecting', { session: true }) },
  { id: 'switching', name: 'Switching server', snap: snap('disconnecting', { session: true, connectTarget: { node: ADDR[1], switching: true } }) },
  { id: 'problem', name: 'Problem', snap: snap('error', { title: 'Connection failed', lastConnectError: { code: 'rpc-busy', message: 'The Solana network did not answer in time, so nothing was paid. Try again in a moment.', action: 'Try again', node: ADDR[0] } }) },
  { id: 'blocked', name: 'Internet may be blocked', snap: snap('error', { title: 'Session ended', detail: 'The connection to this server stopped working.', conn: { ...viewFor('error', 'The connection to this server stopped working.'), title: 'Session ended', restoreNetwork: true } }) },
];
