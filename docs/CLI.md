# CLI — every app function from a terminal

The desktop app and the CLI call the same services (`src/main`, Electron-free).
Nothing the app can do is missing from the CLI: `tests/unit/cli-map.test.ts` fails
when an app function (IPC channel) has no command, when a command is undocumented
here, or when this file is out of date.

## Three ways to run it

| Where | How | Notes |
|---|---|---|
| In the app | **CLI** in the sidebar | Same commands, run inside the running app (shares its wallet, service link and state). A recovery phrase or secret key is never shown or typed here; spending still needs `--yes`. |
| PowerShell from the app | CLI screen → **Open in PowerShell** | Opens a shell with `devnet-dvpn` ready, using the app's data folder. |
| Any terminal | `node out/cli/devnet-dvpn.cjs <command>` (dev) · `devnet-dvpn <command>` (installed) | Build with `npm run build:cli`. |

Flags on every command: `--json` (machine output, one JSON line) · `--yes` (do it; without
it a spend or system change only prints what it would do) · `--keyfile <path>` (use a key file
in place, never copied).

Exit codes: `0` ok · `1` error · `2` needs `--yes` · `3` usage.

Environment: `DVPN_DATA_DIR`, `DVPN_KEYFILE`, `DVPN_DAEMON_PIPE`, `DVPN_DAEMON_HOME`,
`DVPN_NO_BRIDGE=1`. Test rigs only: `DVPN_DAEMON_TARGET`, `DVPN_NODE_API_OVERRIDES`,
`DVPN_PROVIDER_API_OVERRIDES` (see `scripts/e2e/rig-env.sh`, `box-rig.sh env`).

Output never contains RPC API keys (URL query strings are redacted) or secrets.

## Commands

Generated from `src/cli/catalogue.ts` — edit that file, then `npm run docs:cli`.

<!-- cli-catalogue:start -->
### Overview

| Command | What it does | Asks for `--yes` |
|---|---|---|
| `version` | App version, network, program and mint. |  |
| `status` | Wallet, device, service and session at a glance. |  |
| `logs [--lines N]` | The app log, secrets removed. |  |

### Wallet

| Command | What it does | Asks for `--yes` |
|---|---|---|
| `wallet show` | Address and balances (SOL, tDVPN, refundable, approved). |  |
| `wallet receive` | Address with a QR code. |  |
| `wallet create [--keyfile <new path>] --yes` | New 24-word wallet; prints the phrase once. With --keyfile (or DVPN_KEYFILE) naming a new path: writes a key file there instead (no keyring needed). *(CLI only: The recovery phrase is shown only on the Wallet / setup screen.)* | yes |
| `wallet import <file\|->` | Import a phrase, key file or base58 secret. Never replaces a wallet already here (log out first). *(CLI only: Secrets are typed only on the Wallet / setup screen.)* |  |
| `wallet send --to <address> [--tdvpn N] [--sol N] [--allow-empty] --yes` | Send tDVPN or SOL. | yes |
| `wallet logout --yes` | Remove the wallet from this device. | yes |

### Device + spending permission

| Command | What it does | Asks for `--yes` |
|---|---|---|
| `device show` | Device key, spending limit, token permission, device SOL. |  |
| `device plan [--allowance N] [--max-price P] [--force]` | What setup would sign (no transaction). |  |
| `device setup [--allowance N] [--max-price P] [--force] --yes` | Approve tokens, give the device a spending permission (grant), send it fee SOL. | yes |
| `device switch --yes` | Set this computer up for the loaded wallet instead of the one it was set up for (that wallet keeps its deposits, refundable with its own key). | yes |
| `device discard-setup --yes` | Remove a half-finished device setup or wallet switch (a set-up device is never touched). | yes |
| `device register [pubkey] [--home <dir>]` | Adopt an existing service device key. Pass its address (pubkey) when the key folder is admin-only: that form needs no administrator. |  |
| `device revoke [--device D] --yes` | Remove this device's spending permission (other devices keep theirs; the shared token approval stays). --device D removes another device of this wallet, e.g. a computer that is gone. | yes |

### VPN service (dvpnd)

| Command | What it does | Asks for `--yes` |
|---|---|---|
| `daemon version` | Service build and network. |  |
| `daemon doctor` | Service health checks (ok / warn / fail). |  |
| `daemon dns-check [--dns handshake\|cloudflare\|ip,ip]` | Ask each DNS server one question from this computer; exit 1 when none answers (same check as the Settings DNS picker). |  |
| `daemon drivers` | The VPN drivers and tools this computer needs (WireGuard, AmneziaWG, OpenVPN and their helpers): ready or missing (no admin). |  |
| `daemon repair-drivers --yes` | Install or repair missing VPN drivers (one admin prompt). | yes |
| `daemon init` | Create the device key (no admin needed). |  |
| `daemon install --yes` | Install, update after an app update, and start the service (one admin prompt). | yes |
| `daemon uninstall --yes` | Remove the VPN service from this computer: networking restored, device key kept (one admin prompt). Then remove the app itself. | yes |
| `daemon migrate [--legacy-dvpnd PATH] --yes` | Move the service home of an older version to the new layout, same device key and settings (run as administrator; the installer does this). | yes |
| `daemon settings` | Kill switch, DNS, LAN, RPC (key hidden). |  |
| `daemon set [--kill-switch off\|on\|persist] [--allow-remote-lockout] [--dns handshake\|cloudflare\|ip,ip] [--dns-mode netsh\|networksetup\|resolvectl\|resolvconf\|vpn\|none] [--allow-lan true\|false] [--whole-device true\|false] [--split-mode off\|include\|exclude] [--split-apps "<app path>;..."\|none] [--split-routes IP-or-CIDR,...\|none] [--basis per_gb\|per_hour] [--escrow tDVPN] [--prepay-mb N] [--prepay-minutes N] [--rpc URL] [--rpc-ws URL] --yes` | Change service settings (admin prompt, restarts it). | yes |
| `daemon restore-network` | End any session, release kill switch and proxy. |  |

### Servers

| Command | What it does | Asks for `--yes` |
|---|---|---|
| `nodes list [--online] [--country DE] [--protocol wireguard] [--sort price] [--limit N] [--no-probe]` | Every listed server, checked live. |  |
| `nodes show <node>` | One server: prices, protocols, signature checks. |  |
| `nodes fav <node>` | Add or remove a favourite. |  |
| `nodes recent` | Servers you used most recently. |  |
| `cost <node> [--basis per_gb\|per_hour] [--units N]` | Exact deposit before you connect. |  |

### Connect + sessions

| Command | What it does | Asks for `--yes` |
|---|---|---|
| `agent up [--protocol any\|wireguard\|amneziawg\|openvpn\|v2ray\|xray\|hysteria2] [--country CC] [--node N] [--basis per_gb\|per_hour] [--units N] [--plan <subscription>] [--max-price N] [--raise-limit \| --raise-limit-to N] --yes` | For AI agents: pick the best online server that matches, pay a deposit (or use a plan) and connect. One JSON line with the exit IP, SOCKS endpoint and next step. Already connected: answers the live session. A deposit above the spending limit of this computer is refused until you add --raise-limit. | yes |
| `agent down --yes` | For AI agents: disconnect, close per-hour deposits at once (they bill until closed) and start the refund of per-GB ones. Says what is refundable and when. | yes |
| `agent status` | For AI agents: wallet, session and exit IP as one JSON line with the next step (e.g. what to fund). |  |
| `connect <node> [--basis per_gb\|per_hour] [--units N] [--plan <subscription>] [--switch] --yes` | Pay a deposit (or use a plan) and connect. | yes |
| `connect <node> … --follow` | Connect, then print usage every 5 s. *(CLI only: The Connect screen shows live usage.)* | yes |
| `disconnect` | Stop the session; the deposit settles later. |  |
| `sessions` | Sessions the service holds. |  |
| `tickets` | Plan access tickets the service holds. |  |
| `proxy status` | SOCKS endpoint and system-proxy state. |  |
| `proxy on --yes` | Point this computer's apps (the system proxy) at the session SOCKS proxy. | yes |
| `proxy browser [--browser NAME] [--url U]` | Open a Chromium browser (Edge or Chrome; Chromium on macOS) in its own profile through the session (only that window uses the VPN). |  |
| `proxy off` | Restore your own proxy settings. |  |
| `split status` | Split tunnelling: mode, chosen apps and addresses, and what each protocol does with them. |  |
| `split apps [--search TEXT]` | Installed and running apps you can choose (full paths for daemon set --split-apps; Android: package names). |  |
| `split show` | Android: which apps and addresses use the VPN (all, only these, all except these). |  |
| `split set all\|include\|exclude [package…]` | Android: choose apps for the VPN, every protocol. Applies from the next connect. |  |
| `split routes all\|include\|exclude [address\|network…]` | Android: choose addresses for the VPN (like 10.0.0.0/8), every protocol. Applies from the next connect. |  |

### Plans + subscriptions

| Command | What it does | Asks for `--yes` |
|---|---|---|
| `plans list` | Every plan on the network. |  |
| `plans roster <plan>` | Servers on a plan, live or down. |  |
| `plans subscribe <plan> --yes` | Buy a plan (no refund). | yes |
| `plans subscriptions` | Your subscriptions and time left. |  |
| `plans close <subscription> --yes` | End a subscription (rent back, no refund). | yes |

### Deposits, refunds, history

| Command | What it does | Asks for `--yes` |
|---|---|---|
| `channels` | Deposits the service holds. |  |
| `channels fund <channel> --tdvpn N --yes` | Top up a deposit that is still open. | yes |
| `settle list [--device D]` | Deposits waiting to be refunded. --device D lists the deposits of a removed device. |  |
| `settle run [--channel C] [--device D] --yes` | Start / finish closing deposits. --device D settles the deposits of a removed device. | yes |
| `settle withdraw --yes` | Move refunds back to the wallet. | yes |
| `history list` | Every session with data and spend. |  |
| `history summary` | Totals, last 30 days, top servers. |  |
| `history export [--out file.csv]` | Session history as CSV. |  |

### Node testing

| Command | What it does | Asks for `--yes` |
|---|---|---|
| `test servers` | The server count every screen shows: on the network, can be used, not answering, not verified, not checked, listing expired (no transaction). |  |
| `test plan <server…> \| --online [--country C] [--protocol P] [--failed-last] [--never-tested] [--max-nodes N] [--limit N]` | What a test run would hold on deposit at once and pay in deposits over the run (no transaction). |  |
| `test run <server…> \| --online [--country C] [--protocol P] [--failed-last] [--never-tested] [--max-nodes N] [--limit N] --yes \| --resume --yes` | A real session on each server, one at a time: on the network, answers, details verified, deposit paid, connected, exit address, names resolve, speed, deposit closed. Each server ends as Working, Slow, Failed or Not tested. Each deposit is closed right after its server. --resume continues a run that stopped. | yes |
| `test run … --max-spend N --yes` | Old name of --limit, still accepted. | yes |
| `test stop` | Stop a running test at its next stage (the server being tested is disconnected and its deposit closed first; it shows as Stopped and runs again with --resume). Ctrl-C does the same in the terminal running it. |  |
| `test history` | Past test runs with their working, slow and failed counts. |  |
| `test show [run-id] [--compare]` | One run per server (latest if no id); --compare shows what changed since the run before. |  |
| `test export [run-id] [--out file.json]` | A run as JSON. |  |

### Diagnostics

| Command | What it does | Asks for `--yes` |
|---|---|---|
| `quality ip` | Public IP as websites see it. |  |
| `quality speed` | Download speed test. |  |

### Settings + RPC

| Command | What it does | Asks for `--yes` |
|---|---|---|
| `rpc state` | Endpoint in use, slot, latency (key hidden). |  |
| `rpc set <url> [url…]` | Your own Solana RPC endpoints (https). |  |
| `poll show` | Background refresh cadences: current, default and allowed range for each job. |  |
| `poll set <job>=<seconds> …` | Change how often a background job runs (wallet, nodes, plans, subscriptions, settlements, ip, dns, rpc, session). |  |
| `poll reset [job…]` | Put cadences back to their defaults. |  |
| `poll run [job…]` | Run background jobs once now and show how long each took. |  |
| `poll watch [--seconds N] [--hidden]` | Run the real scheduler for N seconds and check every job kept its cadence (exit 1 if not). |  |
| `settings get` | App settings. |  |
| `settings set key=value …` | Change app settings (unknown keys refused). |  |
| `settings reset --yes` | Restore default app settings; favourites and RPC endpoints are kept. | yes |
<!-- cli-catalogue:end -->

## Tests
- `tests/unit/cli-map.test.ts`: every app function → a CLI command; every command documented here.
- `scripts/e2e/cli-e2e.sh [local|daemon|all] [--spend]`: runs the commands against devnet
  (spend tier needs a rig: `scripts/e2e/wsl-rig.sh` or `scripts/e2e/box-rig.sh`).
