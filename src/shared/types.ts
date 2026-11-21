// ─── Types shared by main, preload and renderer ───
// Everything crossing IPC is JSON: bigints travel as decimal strings.
import type { ConnView } from '../core/session/state';
import type { NodeRecord, ProbeResult } from '../core/nodes/discovery';
import type { PlanRecord, SubscriptionRecord } from '../core/plans/plans';
import type { WalletStatus } from '../core/app/wallet-status';
import type { DeviceAutoState } from '../core/app/device-setup';
import type { Basis } from '../core/pricing/cost';
import type { KillSwitch } from '../core/daemon/config';
import type { Coverage } from '../core/session/coverage';
import { DEFAULT_POLL, type PollSettings } from './poll';

export type { ConnView, NodeRecord, ProbeResult, PlanRecord, SubscriptionRecord, WalletStatus, Basis, KillSwitch, Coverage };

export interface AppSettings {
  rpcUrls: string[];
  defaultBasis: Basis;
  defaultGb: number;
  defaultHours: number;
  preferredCountry: string | null;
  autoConnect: boolean;
  autoTopUpDevice: boolean; // send the device SOL from the wallet when it runs low before a connect
  autoDevicePermission: boolean; // the first Connect signs this device's spending permission (no setup step)
  startWithOs: boolean;
  closeToTray: boolean;
  thirdPartyChecks: boolean; // IP check + speed test hit third-party services
  notifications: boolean; // desktop notifications while the window is hidden (F21.3)
  proxyOnConnect: boolean; // V2Ray/Xray: point the system proxy at the session on connect (restored on disconnect)
  theme: 'system' | 'dark' | 'light';
  /** '' = the system language when we have it switched on, else English (shared/i18n resolveLanguage); else a code from LANGUAGES. */
  language: string;
  favourites: string[];
  allowanceTdvpn: string; // default device allowance (display units)
  poll: PollSettings; // seconds per background job (src/shared/poll.ts)
  /** Node test speed measurement: own download origin (https://host[:port]) and its key pin (sha256//…). Both empty = public hosts. */
  speedOrigin: string;
  speedPin: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  rpcUrls: ['https://api.devnet.solana.com'],
  defaultBasis: 'per_gb',
  defaultGb: 1,
  defaultHours: 1,
  preferredCountry: null,
  autoConnect: false,
  autoTopUpDevice: true,
  autoDevicePermission: true,
  startWithOs: false,
  closeToTray: true,
  thirdPartyChecks: true,
  notifications: true,
  proxyOnConnect: true,
  theme: 'dark', // owner 2026-11-15: the app is dark unless you choose otherwise (Settings, or the sidebar switch)
  language: '', // the system language (plan Queue B); a saved choice wins, even a switched-off one
  favourites: [],
  allowanceTdvpn: '150', // R7 rule 2: 3 deposits at the live per-GB p75 (50 tDVPN, 2026-11-20); was 50 = one deposit
  poll: DEFAULT_POLL,
  speedOrigin: '',
  speedPin: '',
};

export interface DaemonInfo {
  reachable: boolean;
  bridge: 'running' | 'stopped' | 'missing' | 'error';
  version: string | null;
  networkOk: boolean | null; // daemon program_id/mint == app constants
  error: string | null;
  home: string | null;
  device: string | null;
  /** The service is restarting (services/service-transition.ts): show 'restarting', never a fix-it banner. */
  transition?: boolean;
  /** The service's state now, from facts: one title, one sentence, one action (core/daemon/service-state.ts).
   *  Every screen shows this; `error` is the same sentence, kept for older readers. */
  service?: import('../core/daemon/service-state').ServiceView;
}

export interface LiveSession {
  id: string;
  node: string;
  status: string;
  service: string;
  rxBytes: string;
  txBytes: string;
  seconds: string;
  spent: string;
  channel: string;
  proxyEndpoint: string;
  error: string;
  warning: string; // dvpnd's live session warning (Q0357), '' = none
  startedAt: number | null;
  /** rc.4 E-27: the wallet that paid the deposit, read from the deposit account itself after the start; null = not read. */
  payer?: string | null;
}

export interface PendingSettlement {
  channel: string;
  node: string;
  mode: number;
  escrow: string;
  redeemed: string;
  status: 'open' | 'closing' | 'ready' | 'in-use';
  readyAt: number | null;
  refundable: string;
  /** rc.4 E-17: listed although this computer's device record names another wallet (or none): an open deposit
   *  that may be in use on another computer of this wallet; `settle run` starts it only when it is named. */
  unverified?: true;
  /** rc.3.1 F1: the device that opened it, set only when that is not this computer's device (a replaced, revoked
   *  or other computer's device of the loaded wallet). This computer cannot reuse such a deposit, and the idle
   *  auto-refund never touches it (it cannot see that device's sessions). */
  device?: string;
  /** Unix seconds the deposit was opened (keeps a per-GB deposit for a reconnect, auto-refund.ts). */
  openedAt?: number;
  /** Row 78: a per-hour deposit's price per hour (base units), so the screen can say how long what is left
   *  lasts: minutes = refundable / ratePerHour × 60. Absent on per-GB deposits and when the chain gives none. */
  ratePerHour?: string;
  /** CODE-AUDIT E3: the server refused to reuse this deposit; the Connect dialog must not offer it as "nothing new is paid". */
  reuseRefused?: boolean;
}

export interface AppSnapshot {
  hasWallet: boolean;
  owner: string | null;
  signerKind: 'in-app' | 'browser' | null;
  wallet: WalletStatus | null;
  /** Row 140: the last balance read failed and is retried on the normal schedule; `wallet` holds the last good
   *  read (its `at` = when). since = when the failures began (ms). null or absent = the balances are current. */
  walletRefreshFailed?: { since: number } | null;
  /** rc.4 E-55 (UI-SCREENS): the wallet this computer's device record names, null = no record. The Connect sheet
   *  asks before switching when it is set and not the loaded wallet (the same test as ensureDevicePermission). */
  deviceOwner?: string | null;
  /** rc.4 E-55: Diagnostics shows "Remove half-finished setup" (manager.halfFinishedSetup). */
  halfFinishedSetup?: boolean;
  /** Background device permission (setting autoDevicePermission): what it is doing now. */
  deviceAuto?: { state: DeviceAutoState; error?: string };
  /** A device key waits for the service install; the next Connect does it (one admin prompt). */
  serviceSwitchPending?: boolean;
  /** Agent M (Mac): the installed VPN service runs older copies than this app (a dmg drag-over updates only the
   *  app). The names of the stale files; empty or absent = up to date. */
  serviceOutdated?: string[];
  daemon: DaemonInfo;
  conn: ConnView;
  session: LiveSession | null;
  settlements: PendingSettlement[];
  subscriptions: SubscriptionRecord[];
  /** privateOverLimit: the user's own (keyed) Solana endpoint says it is over its usage limit, so the public one
   *  is in use (UI-169); since = when that began (ms). */
  rpc: { serving: string | null; healthy: boolean; publicOnly: boolean; privateOverLimit?: boolean; inUse?: 'private' | 'public'; since?: number | null };
  lastCloseMessage: { message: string; action: string | null } | null;
  /** Why the last connect did not finish, with its next step and server (Home shows the button). */
  /** kept (row 79): the connect failed with a deposit open with this server. It is not lost: the next connect to
   *  this server uses it, or it is refunded. amount = what is left of it, in base units. Absent = nothing is held. */
  lastConnectError: { code: string; message: string; action: string | null; node: string; kept?: { channel: string; amount: string } } | null;
  proxyActive: boolean; // the system proxy currently points at our SOCKS endpoint
  publicIp: { ip: string; source: string; at: number; viaProxy?: boolean; directIp?: string | null; sid?: string | null; nodeIp?: string | null } | null; // F5.9: 30 s while connected, once when idle
  homeIp: string | null; // the user's own IP, measured while not connected (coverage check)
  coverage: Coverage | null; // what the live session really covers (core/session/coverage)
  dns: string | null; // the VPN service's resolver, by preset name (F15)
  /** The language main runs in (B5, main/language.ts); the screens load the same one. Absent = English. */
  language?: string;
  /** A server test run in progress (main/services/node-test.ts): the status card says "Testing servers · 12 of 78".
   *  server = the address being tested now, '' between servers. null or absent = no run. */
  nodeTest?: { done: number; total: number; server: string } | null;
  /** CODE-AUDIT L-15: an AI agent (`agent up`) holds the live session (main/services/agent-marker.ts). */
  agent?: { attached: boolean } | null;
  /** The server a connect is working on before a session exists (set when Connect starts, cleared when it ends
   *  either way): the Connect screen shows its place from the first stage; switching = leaving another server. */
  connectTarget?: { node: string; switching: boolean } | null;
}

export interface NodeView extends NodeRecord {
  probe: ProbeResult | null;
  favourite: boolean;
}

export interface HistoryEntry {
  id: string;
  node: string;
  country: string;
  service: string;
  startedAt: number;
  endedAt: number | null;
  rxBytes: string;
  txBytes: string;
  spent: string;
  channel: string;
  closeReason: string | null;
  owner?: string; // the wallet that paid for it; history is shown per wallet (2026-11-11)
}

export interface ConnectRequest {
  node: string;
  basis: Basis;
  units: number;
  confirmed: true;
  subscription?: { provider: string; subscription: string };
  /** Server switch (F11.6): check the new server first, then stop the current session. */
  switch?: boolean;
  /** 'test' = a server test's connect (main/services/node-test.ts): nothing on the Connect screen changes, no
   *  notification, no system proxy, no history entry, no deposit closed by the app afterwards (the test closes
   *  its own). Refused with 'session-active' while the user's own session is up or connecting. */
  purpose?: 'test';
  /** CODE-AUDIT U-13: the deposit (base units) the dialog or the test run showed; a higher fresh price is refused ('price-changed'). */
  shownEscrow?: string;
  /** rc.4 E-55: the user agreed to set this computer up for the loaded wallet (it is set up for another one).
   *  Without it such a connect answers 'wallet-switch-needed' and writes nothing. */
  confirmWalletSwitch?: boolean;
}

export interface Result<T = undefined> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
  action?: string | null;
  /** A failed connect only: a deposit exists for it (paid now, or one already open that it used). */
  paid?: boolean;
  /** A failed connect only: that deposit's address, when known. */
  channel?: string;
}
