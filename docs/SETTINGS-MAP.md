# Settings map — everything configurable, where it lives, how it is set and tested

Owner rule (2026-10-21): anything configurable is a CLI function and has automated tests.
`tests/unit/settings-coverage.test.ts` fails when a new option has no CLI path or no Settings
screen control. `scripts/e2e/settings-e2e.sh` sets, reads back and refuses every app option
through the CLI (110 checks, laptop-safe). Service options are proven on the Linux test VMs
(`scripts/e2e/linux/cli-sweep.sh daemon`) because they need the root helper and a restart.

**Linux:** `<data>` = `$XDG_CONFIG_HOME/Devnet dVPN` (`~/.config/Devnet dVPN`). The service home is
`/var/lib/dvpnd/client/`; root steps run through `dvpn-helper` (polkit / pkexec). Rows that differ
from Windows are marked **Linux:**. The Windows map is an internal document (not published).

## 1. App settings — `<data>/settings.json` (instant, per user)
Allow-listed and clamped by `src/main/system/settings.ts` `sanitize()`; unknown keys dropped.
CLI writes report a dropped value as `Invalid value … (left unchanged)`, exit 1.

| Key | Values | Default | Screen | CLI |
|---|---|---|---|---|
| `defaultBasis` | `per_gb` \| `per_hour` | `per_gb` | Settings → Connection defaults | `settings set defaultBasis=per_hour` |
| `defaultGb` | GB_OPTIONS (1–50) | 1 | same | `settings set defaultGb=5` |
| `defaultHours` | HOUR_OPTIONS (1–24) | 1 | same | `settings set defaultHours=2` |
| `preferredCountry` | ISO 3166 alpha-2 (`US`) or `null` | null | same | `settings set preferredCountry=US` |
| `allowanceTdvpn` | positive tDVPN, ≤ 6 decimals | 50 | same (Device spending limit) | `settings set allowanceTdvpn=25` |
| `autoConnect` | bool | false | Settings → App | `settings set autoConnect=true` |
| `autoTopUpDevice` | bool | true | same (Top up this device's SOL automatically) | `settings set autoTopUpDevice=false` |
| `startWithOs` | bool | false | same | `settings set startWithOs=true` |
| `closeToTray` | bool | true | same | `settings set closeToTray=false` |
| `notifications` | bool | true | same | `settings set notifications=false` |
| `thirdPartyChecks` | bool (IP check + speed test) | true | same | `settings set thirdPartyChecks=false` |
| `theme` | `system` \| `dark` \| `light` | system | same | `settings set theme=dark` |
| `language` | `en` (v1 English only) | en | — | `settings set language=en` |
| `rpcUrls` | 1–8 https URLs (http only for 127.0.0.1) | public devnet | Settings → Solana RPC | `rpc set <url…>`, `rpc state` |
| `favourites` | node addresses (≤ 500) | [] | star on a node | `nodes fav <node>` (toggle) |
| `poll` | seconds per job, see §3 | §3 | Settings → Background refresh | `poll show / set / reset` |

## 2. Service settings — `/var/lib/dvpnd/client/client/config.toml` (+ root `/var/lib/dvpnd/client/config.toml`)
Validated by `src/core/daemon/config.ts` `validateSettings()` before anything is asked;
applied by one root step (`dvpn-helper apply-daemon-config`: pkexec prompt on a desktop, `sudo -n` over SSH) + service restart (`applyDaemonSettings`), with automatic rollback if the service does not come back.
Read: `daemon settings` (escrow in tDVPN, prepay in MB / min).

| Field | Values | Screen | CLI flag |
|---|---|---|---|
| `killSwitch` | off \| on \| persist. **Linux:** nftables table `inet dvpnd`, all six protocols (no gap #29 refusal) | Settings → VPN service | `--kill-switch` |
| `dnsServers` | preset handshake / cloudflare / google / quad9, or 1–4 IPs | same | `--dns` |
| `allowLan` | bool (the Kill switch page shows the LAN ranges it lets through: `lanRanges`, also CLI `version`) | Kill switch page (+ Settings) | `--allow-lan` |
| `wholeDevice` | bool: V2Ray/Xray carry every app (TUN) instead of only the proxy. **Linux: not offered** (dvpnd runs V2Ray/Xray as a proxy only); no toggle is shown | Split tunnelling page | `--whole-device` |
| `split.mode` | off \| include \| exclude | Split tunnelling page (radios) | `--split-mode` |
| `split.apps` | ≤ 64 full program paths. **Linux: not offered** (no per-app split on Linux, gap L10); the page offers split by address range only | — (CLI only, for parity; dvpnd ignores it on Linux) | `--split-apps "a.exe;b.exe"\|none` |
| `split.routes` | ≤ 256 CIDRs (a bare IP becomes /32 or /128) | Split tunnelling page (Addresses) | `--split-routes "CIDR,CIDR"\|none` |
| `basis` | per_gb \| per_hour (sessions started outside the app) | same (Service defaults) | `--basis` |
| `escrow` | positive tDVPN (stored as base units) | same | `--escrow` |
| `prepayBytes` | whole MB | same | `--prepay-mb` |
| `prepaySeconds` | whole minutes | same | `--prepay-minutes` |
| `rpcUrl` | https URL | same | `--rpc` (also sets the websocket URL) |
| `rpcWsUrl` | wss URL | derived from Service RPC | `--rpc-ws` |
| `dnsMode` | read-only (daemon's DNS backend). **Linux:** `resolvectl` (systemd-resolved) or `resolvconf` (no resolved, e.g. EL9: dvpnd writes `/etc/resolv.conf` for the session), or `none`; setup picks it | — | `daemon settings` |

`killSwitch` also has its own page (Kill switch: modes, live state, Restore network). What each
protocol does with `split` comes from one function, `splitNotApplied` (src/core/session/state.ts):
the page, its support table and `split status` all read it. Read: `split status`, `split apps`.

## 3. Background refresh — `poll` (src/shared/poll.ts)
The scheduler (`src/main/scheduler.ts`) reads these live; a change applies on the next tick.
`poll watch --seconds N [--hidden]` runs the real scheduler and fails (exit 1) if any job runs
more often than its interval, never runs when due, or runs while hidden when it should pause.

| Job | Default s | Range s | Runs while hidden |
|---|---|---|---|
| wallet | 60 | 15–3600 | no |
| nodes | 300 | 60–3600 | no (skips while the list on disk is fresh) |
| plans | 600 | 60–7200 | no |
| subscriptions | 600 | 60–7200 | no |
| settlements | 60 | 15–3600 | **yes** (refunds must not wait) |
| ip | 30 (while connected; once when idle) | 10–600 | no |
| dns | 15 | 5–600 | no |
| rpc | 60 | 15–3600 | no |
| session | 5 (only when the live stream drops) | 2–60 | yes (services/connection.ts) |

## 4. Fixed on purpose (not settings)
RPC query timeout 12 s, rate-limit cooldown 8 s, endpoint bench 60 s (`core/chain/rpc.ts`);
tx confirm 60 s (`core/chain/tx.ts`); daemon call deadline 20 s, StartSession 120 s
(`core/daemon/client.ts`); ticket retry 1.5 / 3 / 6 s (`core/session/state.ts`). These are
safety limits, tested by unit tests and the fault-injection rows of the edge matrix; exposing
them would let a user make the app hang or hammer a public RPC.
