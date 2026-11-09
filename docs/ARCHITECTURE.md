# Architecture — Devnet dVPN

Feature IDs (F*.*) refer to [`FEATURE-PLAN.md`](FEATURE-PLAN.md). This is the **Linux** build:
the daemon link is a unix socket, the service is systemd, root steps go through one polkit-guarded
helper, and data lives in XDG paths. Every Windows piece and its Linux replacement is mapped in
[`LINUX-PORT.md`](LINUX-PORT.md).

## Processes and trust

```
┌ Devnet dVPN — Electron, runs as the logged-in user ─────────────────────────┐
│                                                                              │
│  renderer (React, sandboxed)                                                 │
│     │  window.api.*  — typed, IPC enum only, no secrets ever                 │
│  preload (contextBridge)                                                     │
│     │                                                                        │
│  main process                                                                │
│     ├─ scheduler        one owner for every poll / stream (F5)               │
│     ├─ daemon client    grpc-js → unix:///var/lib/dvpnd/client/daemon.sock   │
│     ├─ chain            RPC pool, decoders, tx builders, signer (F4, D2)     │
│     ├─ wallet           owner key in safeStorage, or browser relay (F2, D10) │
│     ├─ nodes / plans    discovery, signed-metadata probe, TLS pin (F6, F10)  │
│     ├─ settlement       voucher close queue, withdraw (F12)                  │
│     ├─ system           settings, elevated apply, proxy, tray (F16, F18, F21)│
│     └─ node-test        isolated service, own state (F20)                    │
└──────────────────────────────────────────────────────────────────────────────┘
      │ unix socket (group dvpn + user ACL)     │ HTTPS             │ HTTPS (pinned)
      ▼                                          ▼                   ▼
 dvpnd (client role, root systemd unit       Solana devnet RPC    nodes / providers
 dvpnd-client.service; root steps via
 dvpn-helper + polkit / pkexec)
 tunnel · kill switch · DNS · device key ·   (user-configurable    (any listed node,
 vouchers every 60 s · reconnect 5×           pool, failover)       any plan)
```

- **Only the daemon is privileged.** The app is unelevated after install. The single elevated
  operations are service setup, applying daemon settings (D4), driver repair and network restore,
  each a whitelisted step of ONE root entry point (`resources/scripts/dvpn-helper`, polkit action
  `network.sentinel.devnet-dvpn.helper`: `pkexec` on a desktop, direct as root, `sudo -n` over SSH)
  that copies a pre-validated file. Only validated paths/tokens as arguments, never a shell string
  with config inside it (M5.3 #8). `dvpnd init` itself runs as the user into a staging folder.
- **Two keys.** Owner key (the user's wallet) signs grants, subscriptions, settlement and
  withdrawals. Device key (inside dvpnd) signs channels, vouchers and node API calls, within the
  allowance the owner granted.
- **No server of ours.** The app talks to the daemon, Solana RPC, nodes and providers. Optional
  third-party calls (IP check, speed test) are listed in Settings and can be turned off.

## Source layout (planned)

Two-layer split (TypeScript mandate): pure logic in `core/` (no Electron, unit-tested with real
devnet fixtures); Electron/OS glue in `main/`. Every file ≤ 500 lines, one example per module.

```
src/
  shared/            types, IPC enum + tier map, error codes, string catalogue keys
  core/
    chain/           idl (devnet IDL + deployed sizes/offsets), accounts, pdas, builders, tx, errors
    daemon/          proto + client wrapper, status mapping, close reasons
    nodes/           discovery, metadata verify, tls pin, country map
    plans/           plans, providers, tickets
    pricing/         amounts, formatting, affordability
    session/         state machine, concurrent-action rules
    settlement/      queue model, timers
    quality/         ip, speed (fallback chain), dns check
  main/
    index.ts         app lifecycle, single-instance, cleanup-first registration
    ipc.ts           handlers, input validation, tiering
    scheduler.ts     polling + streams (F5)
    wallet/          safeStorage vault, signer (in-app), relay server (browser mode)
    system/          settings store, elevated apply, system proxy, startup, tray, notifications
    node-test/       NodeTestService + adapter (F20)
    logger.ts
  preload/           contextBridge api
  renderer/          screens (Welcome, Connect, Nodes, Plans, Sessions, Settlements, Wallet,
                     Settings, Diagnostics, Node test), components, theme tokens
```

Port sources for each module: [`REUSE-MAP.md`](REUSE-MAP.md).

## IPC tiers (M5.2 #1)

Every channel is tagged with its blast radius; tests prove the map matches the registered handlers.

| tier | examples |
|---|---|
| ui | theme, language, window |
| readonly | nodes, plans, balances, sessions, rpc health, doctor |
| local | settings (app store), favourites, history export, system proxy |
| privileged | daemon settings apply, service restart, restore network |
| spend | connect (opens channel), subscribe, settle, withdraw, top up, grant, send |

`spend` handlers always show the cost or effect first and require an explicit confirm from the
renderer; they serialise per owner key so two writes never race a blockhash (PM `tx.js`
`broadcastQueue`).

## Data at rest

| data | where |
|---|---|
| owner secret | `~/.config/Devnet dVPN/wallet.secret` (safeStorage on libsecret/KWallet; `basic_text` refused). CLI: libsecret (`secret-tool`) |
| app settings, favourites, history, settlement queue, node cache | `$XDG_CONFIG_HOME/Devnet dVPN/*.json` (`~/.config/Devnet dVPN`) |
| node-test runs | `~/.config/Devnet dVPN/node-tests/` |
| logs | `~/.config/Devnet dVPN/logs/` (rotating, redacted) |
| daemon config, device key, daemon db | `/var/lib/dvpnd/client/` (root; key folder root-only, config readable by group `dvpn`); service binaries `/usr/local/lib/devnet-dvpn/` |

Every persisted model round-trips through JSON (bigints as strings) — tested (F13.6).
