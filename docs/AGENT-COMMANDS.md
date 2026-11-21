# Agent commands: the output contract

What `agent status`, `agent up` and `agent down` print with `--json`, field by field, and every
failure `code` they can return. A test fails if a failure code the CLI can return is missing here.

`<cli>` below is `devnet-dvpn`, or the value of `DVPN_CLI_NAME` when a wrapper sets it.

## The four kinds of answer

Every run prints exactly one JSON line on stdout. A warning (another VPN is on) goes to stderr.

| Exit | Line | Meaning |
|---|---|---|
| 0 | `{"ok":true, …, "next": "…"}` | Done. `next` is the command (or the funding) to do next. |
| 1 | `{"ok":false,"error":"…","code":"…"\|null,"action":"…"\|null,"next":"…"\|null,"docUrl":"…","money":"…"}` | Failed. `action` is the command that fixes it, or null; `next` is the same runnable line; `docUrl` links the code's row in `docs/CODES.md`. `money` says whether money moved (see "Did money move?" below). |
| 2 | `{"needsConfirm":true,"what":"…", …}` | Would spend: nothing was signed. Re-run with `--yes`. |
| 3 | `{"ok":false, …}` with code `usage` and `--json` (rc.8); else one line on stderr | Wrong usage: bad flag value, unknown flag, unknown command or subcommand. Nothing ran, nothing was sent or signed. |
| 4 | `{"ok":false, …}` as for 1 | Needs you or your operator: `not-funded`, `spending-limit`, `price-cap`, `no-wallet`, `keyfile-missing`, `keyfile-mode`, `clock-skew` (rc.8), `keyfile-unreadable` (rc.9: the key file cannot be read by this user), `needs-admin` (rc.9: `daemon install` from a standard Windows account; `action` is the elevated command). Nothing was paid; do `action` (fund, raise the limit, load the wallet). |
| 5 | `{"ok":false, …}` as for 1 | Refused for safety: `kill-switch`, `kill-switch-held`, `kill-switch-failed`, `kill-switch-remote` (rc9-e: `daemon set --kill-switch on` or `--kill-switch persist` from an SSH or Remote Desktop session; rc9-f2: also under sudo, sudo -i or su started from an SSH login, which is refused the same way; `--allow-remote-lockout` overrides). Read `action` (often `<cli> daemon restore-network`). |
| 6 | `{"ok":false, …}` as for 1 | Network or RPC (`rpc-busy`, `rpc-unavailable`, `rpc-ws`; rc.8: `waiting-for-network`, whose money class is none: the service could not reach its RPC before any deposit, next = the `daemon set --rpc` line). Their money class is unclear (the table below), so on a command that can pay (agent, connect, switch or test) they exit 1, not 6 (rc.9 final audit); elsewhere exit 6. Run `<cli> agent status` before retrying, then retry in a minute or set your own RPC endpoint. A network code after which a deposit may be open (`rpc-timeout`, `rpc-network`, `rpc-quota`, `timeout`) exits 1: read `money`. Exit 5 (`kill-switch-failed`) can also follow a paid deposit: read `money`. |

Exit codes 4–6 are from release 0.3.0-rc.6; older releases exit 1 for these.

Amounts are decimal strings in tDVPN or SOL (e.g. `"0.002"`). Each one has a sibling with the same amount in base units, as a string: `sol` → `solLamports`, `tdvpn` → `tdvpnBase`, `held` → `heldBase`, `spent` → `spentBase`, `refundable` → `refundableBase`, `deposit.tdvpn` → `deposit.tdvpnBase` (also `deposit.baseUnits`, the older name), `limitRaised.from/to` → `fromBase/toBase`. 1 tDVPN = 1000000 base units; 1 SOL = 1000000000 lamports. Times (`readyAt`) are Unix seconds.

**Default price cap (S7):** without `--max-price` (and without `--plan`), `agent up` never pays a deposit above the default cap: it answers `price-cap`, nothing paid. From rc7 the cap is the larger of the Settings spending limit / 10 and the market p75 price of the matching online nodes × `--units`, never above the spending limit (fewer than 3 priced nodes: limit / 10); a new install's limit is 150 tDVPN; `defaults.priceCap` shows it. rc.6: always limit / 10 (5 tDVPN with the default 50). `--max-price N` is your own cap and replaces it.

**Spending limit (S7, rc.6):** `agent up --yes` never raises this computer's spending limit on its own. When the deposit is above it, the answer is `code: "spending-limit"` (exit 4, nothing paid), and (rc.9) `action` is `<cli> device setup --allowance <this deposit> --yes`, then the same `agent up` line: the least privilege, the limit becomes this deposit and no more. `alsoNext` is the same `agent up` line with `--raise-limit --yes`, which raises the limit and connects in one step (the answer then carries `limitRaised` / `limitNote`).

**No catch-all (S5, rc.6):** a connect failure with no known cause never says "Something went wrong". It says whether a deposit was paid (`node-refused`, deposit safe and refunded after the wait) or not (`unknown`, "Nothing was paid", look at `<cli> logs --lines 80`).

**`version --json` (rc.6):** `{ app, network, programId, mint, platform, node, lan }`. Check `programId` = `J52dyXW3a6mkatvrQct3fo6dA9vqUtcsdBt5gGqrTBXs` and `mint` = `Hen2LVP6KooGaXEvdSyCHWghsEY4gLLn7wix8z6zHFSa` before you pay.

## agent status

Reads only. It never signs, never connects, never asks for `--yes`.

| Field | Type | Meaning |
|---|---|---|
| `ok` | `true` | |
| `address` | string \| null | The wallet address; null = no wallet on this computer. |
| `sol` | string \| null | SOL in the wallet; null when there is no wallet or it could not be read. |
| `tdvpn` | string \| null | tDVPN in the wallet. |
| `held` | string \| null | The wallet's balance held in the program (`userBalance`), which `settle withdraw` moves to the wallet. Not the `refundable` of `agent down` (that sums the deposits still open). On devnet a closed deposit's refund went straight to the wallet's tDVPN, so this stayed `"0"` (Linux run 2026-11-15). Was `refundable` before this change. |
| `device` | string \| null | This computer's device key; null = not set up yet. |
| `service` | boolean | The VPN service answers. |
| `connected` | boolean | A session is live. |
| `blocked` | `true` | Only when no session is live and the internet does not answer (the kill switch still holds the block, or the network is down). |
| `session` | string | Only when connected: the session id. |
| `node` | string | Only when connected: the server's address. |
| `protocol` | string | Only when connected: the protocol in use. |
| `spent` | string | Only when connected: tDVPN used so far. |
| `exitIp` | string \| null | Only when connected: the address the internet sees; null if the check did not finish within 8 s. |
| `socks` | string \| null | Only when connected: `socks5h://host:port` for apps to use; null on Android or when the protocol gives none. |
| `wholeDevice` | boolean | Only when connected: true when the whole computer goes through the node (WireGuard, AmneziaWG, OpenVPN, Hysteria2 always; V2Ray and Xray when the service runs them whole-device, the default on a fresh Windows or macOS install; on Linux they cover only apps that use `socks`; Android always). |
| `code` | `"server-stopped"` | Only when a node stopped serving (see "The node stopped serving"). `connected` is false then. |
| `message` | string | With `code`: what happened, and that your deposit is safe. |
| `nodeStopped` | object | With `code`: `{ node, session, reason }`. |
| `alsoNext` | string | With `code`: `<cli> agent down --yes`, the other way out (`next` is `<cli> agent up --yes`). With `service: false` and a deposit to close (E-75): the deposit's own step (`<cli> settle run --yes after <ISO time> (a closing deposit waits 2 h), then <cli> settle withdraw --yes`, the same line `agent down` prints), while `next` is the service fix (`<cli> daemon install --yes …`). |
| `deposits` | object[] | Only when the wallet has deposits on chain: `{ channel, node, status, refundable, readyAt }` for each open or closing one. |
| `next` | string | See below. |

`next`, in this order: `blocked` → `<cli> agent up --yes to reconnect through a node (protection stays), or <cli> daemon restore-network to go direct (protection off until the next connect)` (with no wallet: `<cli> daemon restore-network (the internet is blocked), then` the no-wallet step);
no wallet → `<cli> wallet create --keyfile <path> --yes, then fund the address it prints`;
connected → `<cli> agent down --yes`; a deposit still open and no session → `<cli> agent down --yes` (only closing ones: `<cli> settle run --yes after <ISO readyAt>, then <cli> settle withdraw --yes`), never `agent up`, which would open a second deposit; balances unreadable → `<cli> agent status (the balances could not be read; try again in a moment)`;
SOL under 0.06 before the first connect (rc7; 0.02 on rc.6) (wallet not ready) or no tDVPN → `send at least … to <address>, then <cli> agent up --yes`;
device set up but service not answering → the `daemon-missing` action below; otherwise `<cli> agent up --yes`.

## agent up

`agent up [--protocol P] [--country CC] [--node N] [--basis per_gb|per_hour] [--units N] [--plan S] [--max-price N] --yes`

Flags: `--protocol` = `any` or one of `wireguard`, `amneziawg`, `openvpn`, `v2ray`, `xray`, `hysteria2`; `--country` = two letters;
`--basis` defaults to the saved setting (not always per_gb); `--units` 1–1000 GB or hours, default from settings;
`--max-price` = tDVPN per unit of the basis; `--plan` = a subscription address you hold (no deposit, the plan's live nodes only);
`--node` = one exact node (it must still be online and match the other filters).
Without `--node` it picks the lowest latency among the matching nodes that answer. With no `--max-price`, only
among the cheapest of them (a deposit at most 2 times the cheapest one's), so a fast node at 50 tDVPN/GB is
never taken while one at 0.002 answers; `--max-price` sets your own cap instead. A flag given with no value
(`--plan` alone, `--plan=`) is a usage error: nothing runs.

**On its own (no `--yes` needed):** reads the live session, the node list (probing them), wallet and
subscriptions; creates the device key if this computer has none (`daemon init`: local, no transaction).
**Never without `--yes`:** the deposit, the spending limit, the connect, a switch. Without `--yes` it
answers exit 2:

| Field (exit 2) | Type | Meaning |
|---|---|---|
| `needsConfirm` | `true` | |
| `what` | string | The sentence it would do, e.g. `Connect to <node> (DE, wireguard): deposit up to 0.002 tDVPN (1 GB), unused part refunded. Nothing is signed until you pass --yes.` A switch starts `Switch from <node>.` |
| `node` | string | The node it picked. |
| `deposit` | object | As below. |
| `switchFrom` | string \| null | The live node it would leave; null = not connected. |

A live session is reused when `--node` is the live node, or, with no `--node`, `--protocol` (if given) is the
live protocol and `--country` (if given) is the live node's country. Nothing else is compared: `--basis`,
`--units`, `--max-price` and `--plan` are ignored while a session is live. A reused session is answered at once, exit 0, `reused: true`, nothing paid, no `--yes` needed. One that does not match is
switched: the switch leaves it and connects to the new node; with the kill switch on, the
block stays up between the two. The live node is never picked for the switch.

| Field (exit 0) | Type | Meaning |
|---|---|---|
| `ok`, `connected` | `true` | |
| `session` | string | Session id. |
| `node` | string | The node's address. |
| `protocol` | string | The protocol really used (on a node that offers several, the service picks). |
| `country` | string \| null | Two-letter country of the node. |
| `exitIp` | string \| null | Address the internet sees; null if the check did not finish within 8 s. |
| `directIp` | string \| null | This computer's own address, never the node's. With only `socks` routed it is measured outside the tunnel; in whole-device mode a direct check exits by the node too, so it is the address read before the connect, or null if none was read. |
| `socks` | string \| null | `socks5h://host:port`; null on Android or when the protocol gives none. |
| `wholeDevice` | boolean | True when the whole computer goes through the node (WireGuard, AmneziaWG, OpenVPN, Hysteria2 always; V2Ray and Xray when the service runs them whole-device, the default on a fresh Windows or macOS install; on Linux they cover only apps that use `socks`; Android always). |
| `channel` | string \| null | The account of the deposit. |
| `deposit` | object \| null | `{basis, units, tdvpn, tdvpnBase, baseUnits}` for a per-node deposit (`tdvpn` = most it can hold; the unused part is refunded); `{plan, tdvpn: "0"}` with `--plan`; null when `reused`. |
| `reused` | `true` | Only when an existing session was kept. |
| `blockedBefore` | `true` | Only when the internet was blocked before this connect (no session, kill switch holding the block); the new session lifts it while it is up. A block connect cannot lift is refused with code `kill-switch-held`. |
| `limitRaised` / `limitNote` | object / string | Only when this connect raised the computer's spending limit, because the deposit was above it (E-73): `limitRaised` = `{ from, to, fromBase, toBase }` in tDVPN and base units, and `limitNote` = `This computer's spending limit was <from> tDVPN, below this deposit, so it was raised to <to> tDVPN (the Settings limit). To lower it: <cli> device setup --allowance <N> --yes`. Without `--yes`, the preview sentence says so first: `This computer's spending limit (<x> tDVPN) is below this deposit. It is raised only with --raise-limit: then --yes raises it to <y> tDVPN.` From rc.6 the raise needs `--raise-limit` (see "Spending limit" above). |
| `defaults` | object | rc7: how the cap was chosen: `priceCap`, `priceCapBase`, `spendingLimit` (rc.9: this computer's live limit, `grant.allowance`, when read; else the Settings amount), `spendingLimitSource` (`grant` \| `settings`), `configuredDefault` (the Settings amount), `spendingLimitRecommended`, `units`, `source` (`market` \| `fixed`), `reason`, `market` (`p50`, `p75`, `nodes`, `outliers`). Also on the preview. See `docs/JSON-FIELDS.md`. |
| `payer` / `payerIsLoaded` / `payerNote` | string \| null / boolean \| null / string \| null | The wallet that paid the deposit, read from the deposit account (E-27; null = not read, nothing is guessed); whether it is the loaded wallet; `Paid from <a…z>.` or `Paid by <a…z>, not the loaded wallet <a…z>.` |
| `next` | string | Always `<cli> agent down --yes` (one plain command a runner can run; E-38). |
| `note` | string | What the session means. Whole device: `the whole computer goes through the node; when done: <cli> agent down --yes`, with ` (<socks> works too)` after "node" when there is a `socks`. Only `socks`: `send traffic through <socks> (e.g. curl --proxy <socks> https://api.ipify.org); only apps that use it go through the node; when done: <cli> agent down --yes`. |
| `replaced` / `replacedNote` | object / string | Only when the live session was not tunnelled (its exit address is this computer's own, E-35): `replaced` = `{ node, code: "server-stopped" }`, `replacedNote` = `The node stopped serving; your traffic is NOT going through it. Switched to <node>; <old node> is skipped next time.` |

## agent down

`agent down --yes`. **On its own:** reads the live session and the open deposits. **Never without
`--yes`:** the disconnect or any transaction. Without `--yes`, exit 2:

| Field (exit 2) | Type | Meaning |
|---|---|---|
| `needsConfirm` | `true` | |
| `what` | string | e.g. `Disconnect from <node>, then close 1 per-hour deposit(s) (they bill until closed) and start closing 0 per-GB deposit(s); refunds go to your wallet.` |
| `session` | string \| null | The live session. |
| `perHour`, `perGb` | number | Deposits it would close / start closing: the open and ready ones, plus the live session's own deposit (it reads `in-use` until the disconnect). |

**Kill switch.** In these apps the kill switch `on` and `persist` are the same setting. After
`disconnect` / `agent down`, check `<cli> quality ip`. If it shows no address, the kill switch
is still blocking — this happens when the session had already dropped before you disconnected.
`<cli> daemon restore-network` lifts the block for now; it can come back at the next dropped
session or service restart. `<cli> daemon set --kill-switch off --yes` stops it coming back.

With `--yes` it runs `disconnect` (which also puts back a system proxy left with no session), then one `settle run`: a per-hour deposit is closed at once (it bills until closed); a per-GB one
starts its 2-hour close. Exit 0:

| Field | Type | Meaning |
|---|---|---|
| `ok` | `true` | |
| `disconnected` | object \| null | `disconnect`'s own answer, e.g. `{ok, next}`; `session` and `killSwitchReleased` appear only when it has them. null if it printed none. |
| `spent` | string \| null | tDVPN used by the deposits this run settled. null only when there was nothing to settle; a second `agent down` with no session can still show the closing deposits' use. |
| `deposited` / `depositedBase` | string | The sum of the deposits over `pending` (tDVPN / base units), not only the session it ended. |
| `refundable` | string | The sum of `refundable` over `pending`: tDVPN still to come back from the deposits left. Not the `held` balance of `agent status`. A lower bound: on the Linux run of 2026-11-15 a deposit listed 0.001883 and 0.001999 came back. |
| `readyAt` | number \| null | Latest time a closing deposit can be finished. |
| `signatures` | string[] | Transactions this run signed. |
| `pending` | object[] | Deposits left: `{channel, node, mode, status ('open'\|'closing'\|'ready'\|'in-use'), readyAt, refundable, …}`. |
| `notClosed` / `warning` | object[] / string | Only when a deposit another device of this wallet opened is still open (a replaced device, E-72): `notClosed` = `[{channel, device}]`, `warning` = `<n> deposit(s) opened by another device of this wallet (<device>) are still open: this computer cannot close them, so nothing was refunded for them.` `next` is then `<cli> device revoke --device <device> --yes (if it is not revoked yet), then <cli> settle run --device <device> --yes`. |
| `next` | string | A deposit of another device still open: see `notClosed`. With `readyAt`: `<cli> settle run --yes after <ISO time> (a closing deposit waits 2 h), then <cli> settle withdraw --yes`; deposits left: `<cli> settle list`; none: `<cli> agent up --yes to connect again`. |

## Failure codes (exit 1, or 4/5/6 by class: see the table above)

`action` is copied verbatim into the JSON line. Do what it says; when it is null, read `error`.

### Raised by agent-cmd itself

| Code | From | `action` | What the agent does |
|---|---|---|---|
| `no-wallet` | up | `<cli> wallet create --keyfile <path> --yes, then fund the address it prints`; when this computer has a device record: `<cli> wallet import <the key file of <owner>, the wallet that set up this computer's device>, then <cli> agent up --yes` | Create a wallet in a 0600 key file, ask its owner to fund it. With a device record, import that wallet instead: a new one would not hold its funds. Nothing was paid. |
| `no-wallet` | down | `<cli> disconnect to leave the VPN now; <cli> wallet import <file> (the wallet that paid), then <cli> agent down --yes to close the deposits` | This computer's CLI has no wallet, so it cannot read or close deposits. Nothing ran. `disconnect` needs no wallet: run it to leave the VPN at once, then import the wallet that paid and run `agent down --yes`. |
| `keyfile-missing` | up, down, status | `restore <path> from your backup, then run the command again` | The key file that --keyfile or DVPN_KEYFILE names is gone. This is not "no wallet": a new wallet would not hold the funds, which stay with the lost key. Nothing ran. |
| `keyfile-mode` | up | `chmod 600 <path>, then <cli> agent up --yes` | (rc.7) The key file can be read by other users (POSIX mode with group/other bits). Refused before anything is signed; exit 4. Nothing ran. |
| `wallet-switch-needed` | up | `load the key file of the wallet named in "error", or <cli> device switch --yes (sets this computer up for the loaded wallet; the other wallet's deposits stay refundable)` | This computer is set up for another wallet, so the loaded key cannot pay here. Nothing was paid. |
| `no-device` | up | `<cli> daemon doctor` (device key could not be made) | Run it; report what it says. Nothing was paid. |
| `no-subscription` | up `--plan` | `<cli> plans list, then <cli> plans subscribe <plan> --yes` | Subscribe, or drop `--plan`. Nothing was paid. |
| `no-nodes` | up | rc.8: the same `agent up` line at the cheapest `--max-price` a node that answers asks for, or without the `--country` / `--protocol` that no answering node matches; with `--node`, why that node is not picked and the line that can pick it; else `<cli> nodes list --online --json, then widen --protocol / --country / --max-price` | Never the value that failed again (check `--basis`). No transaction ran. |
| `not-funded` | up | `send at least <n> SOL and/or <n> tDVPN to <address> (<m> recommended: it also covers a reconnect), then <cli> agent up --yes` | The exact shortfall, plus the recommended amount (rc7). Ask the owner to fund the address. Nothing was paid. |
| `price-cap` | up (rc.6) | `<cli> agent up --node <node> --basis <basis> --units <n> --max-price <its price> --yes (you accept this price), or fewer --units, or another node` | No `--max-price` was given and the deposit is above the default cap (`defaults.priceCap`; the rule is under "Default price cap" above). Nothing was paid. Accept the price with `--max-price`, or ask for less. |
| `spending-limit` | up (rc.6) | rc.9: `<cli> device setup --allowance <this deposit> --yes, then <cli> agent up --node <node> [--protocol <p>] --basis <basis> --units <n> [--max-price <p>] --yes` (least privilege; every flag you gave is kept, E-88); `alsoNext` = the same line with `--raise-limit --yes` (raises it to the Settings limit) | The deposit is above this computer's spending limit and `--raise-limit` was not given (S7). Nothing was paid. Run `action` to raise the limit for this connect, or set your own with `<cli> device setup --allowance <N> --yes`. |
| `connect-failed` | up | `<cli> agent status` | The connect failed with no code: read `error`. It is not known whether a deposit was opened: `<cli> agent status` lists it. |
| `settle-failed` | down | `<cli> settle list` | The disconnect is done; the deposits are listed there. No new money was spent; the unused part of a deposit is still held: `<cli> settle run --yes` returns it. |
| `busy` | down | `<cli> settle run --yes` | The disconnect is done, but another refund run in the same process held the lock, so nothing was closed: run it (a per-hour deposit bills until closed). Nothing was paid. |
| disconnect's code (e.g. `daemon-unavailable`, `service-down`, `rpc-unavailable`), else `stop-failed` | down | `<cli> daemon doctor, then <cli> agent down --yes again` | The disconnect failed, so no deposit was closed (the message starts `Could not disconnect, so no deposit was closed`, then the service's plain sentence; this line is never rewritten by the rule below). A live session's deposit cannot be closed while the session is up, so a per-hour one keeps billing: fix the service, then run `agent down --yes` again. A deposit may be open: `<cli> agent down --yes` closes it. |

### Raised by other commands (`connect --follow`, `daemon set`)

| Code | From | `action` | What the agent does |
|---|---|---|---|
| `disconnect-failed` | `connect --follow` (Ctrl+C) | `<cli> agent status --json` | Ctrl+C asked the session to close and the disconnect failed, so the session may still be live. Read `agent status`; `<cli> agent down --yes` ends it and closes the deposit. |
| `apply-busy` | `daemon set` | `<cli> agent status --json` | Another settings change was still being applied, so nothing was changed and nothing was paid. When it has finished, run the same `daemon set` again. |
| `apply-while-connecting` | `daemon set` | `<cli> agent status --json` | A connection was starting or stopping, so nothing was changed and nothing was paid. When `agent status` shows it has settled, run the same `daemon set` again. |
| `apply-failed` | `daemon set` | `<cli> agent status --json` | Applying the settings or restarting the service failed: read `error`. Nothing was paid; a live session may have ended with the restart (its deposit stays open until `<cli> agent down --yes`); `agent status` says whether one is running. |

### From connect() (agent up), `action` = `nextFor(code)`

| Code | `action` |
|---|---|
| `daemon-missing` | Linux/macOS: `<cli> daemon install --yes (administrator/root once: passwordless sudo, or a person types the password), then <cli> agent up --yes`. Windows: `<cli> daemon install --yes from an elevated shell or an administrator SSH login (a normal shell shows a UAC prompt an agent cannot answer), then <cli> agent up --yes`. Nothing was paid. |
| `daemon-relogin` | Linux/macOS: as `daemon-missing`. Windows: `<cli> daemon install --yes once from an elevated shell or an administrator SSH login (the VPN service does not accept this account yet; …), then <cli> agent up --yes`. Nothing was paid. |
| `protocol-missing` | `<cli> daemon drivers (it lists the protocols ready on this computer), then <cli> agent up --protocol <a ready one> --yes; or <cli> daemon repair-drivers --yes`. The deposit is refunded by `agent down --yes`. A deposit may be open: `<cli> agent down --yes` closes it. |
| `device-permission` | `<cli> device setup --yes, then <cli> agent up --yes` (as `no-device` from connect) Nothing was paid. |
| `daemon-unavailable` | `<cli> daemon doctor` Nothing was paid. |
| `daemon-restarting` | `<cli> agent up --yes again in a few seconds (the VPN service is restarting); if it keeps failing, <cli> daemon doctor` Nothing was paid. |
| `preflight` for a service, settings or driver problem | `<cli> daemon doctor`, `<cli> daemon settings` or `<cli> daemon repair-drivers --yes`, each followed by `, then <cli> agent up --yes` Nothing was paid. |
| `test-running` | `<cli> test stop, then <cli> agent up --yes` (a node test holds the VPN service) Nothing was paid. |
| `rpc-busy` | `<cli> agent up --yes again in a minute (the network was busy)` It is not known whether a deposit was opened: `<cli> agent status` lists it. |
| `spending-limit`, and `preflight` saying "This device's spending limit is lower than this deposit" | `<cli> device setup --allowance <N> --yes (N = grant.allowance from "devnet-dvpn device show --json" divided by 1000000, plus the deposit, in tDVPN), then <cli> agent up --yes`. `device setup --allowance <N>` sets the limit to N, up or down: an N below the current limit lowers it. Nothing was paid. |
| `price-changed`, `deposit-unusable`, `deposits-unread` | `<cli> agent up --yes again (nothing was paid; it reads the price fresh)`. Nothing was paid in each case. `price-changed`: the node's price rose above the deposit `agent up` showed. `deposit-unusable`: your open deposit with this node started closing, so it cannot be used, and a new one is never paid without being shown. `deposits-unread`: your open deposits could not be read, so no second deposit was opened beside one you may have. `--max-price` still caps the next try. |
| `not-confirmed` | `<cli> agent up --yes (add --yes: nothing is paid without it)` Nothing was paid. |
| `busy` | `<cli> agent up --yes again in a few seconds (another connect was running)` Nothing was paid. |
| `keyfile-missing` | `restore the key file named in "error" from your backup (it is the only key to this wallet), then <cli> agent up --yes` Nothing was paid. |
| `keyfile-mode` | `chmod 600 <the key file named in "error">, then <cli> agent up --yes` Nothing was paid. |
| `plan-limit` | `<cli> agent up --plan <subscription> --node <a node you already use> --yes` Nothing was paid. |
| `network-mismatch` | `<cli> daemon install --yes (administrator once: it installs the service for this network), then <cli> agent up --yes` Nothing was paid. |
| `session-active` | `<cli> agent status --json` (another run holds the session, often a second `agent up` started at once: look, never end it) Nothing was paid. |
| `node-gone`, `node-stale`, `node-offline`, `node-identity`, `node-ledger`, `peer_limit_reached`, `terms_rejected`; `preflight` that asks for another node | `<cli> nodes list --online --json, then <cli> agent up --node <another node> --yes` A deposit may be open: `<cli> agent down --yes` closes it. |
| `protocol-blocked`, `tunnel-failed`, `tunnel-dead`, `tunnel-mtu`, `port-in-use` | `<cli> daemon drivers (it lists the protocols ready on this computer), then <cli> agent up --protocol <another ready one> --yes` A deposit may be open: `<cli> agent down --yes` closes it. |
| `driver-missing` | `<cli> daemon repair-drivers --yes, then <cli> agent up --yes` Nothing was paid. |
| `basis-unavailable` | `<cli> agent up --basis <the other one: per_gb or per_hour> --yes` Nothing was paid. |
| `not-enough-tdvpn` | `send tDVPN to the wallet address (<cli> agent status shows it), then <cli> agent up --yes` Nothing was paid. |
| `device-sol`, `ticket-other-owner`, `approval-revoked` | `<cli> device setup --yes, then <cli> agent up --yes` A deposit may be open: `<cli> agent down --yes` closes it. |
| `unauthorized` | `<cli> device show --json: if the grant is there and not revoked, set this computer's clock to the right time (a wrong clock makes the node refuse), then <cli> agent up --yes; otherwise <cli> device setup --yes, then <cli> agent up --yes` (E-22: clock skew answered this after a deposit opened) A deposit may be open: `<cli> agent down --yes` closes it. |
| `clock-skew` | rc.8: `sudo timedatectl set-ntp true && (sudo chronyc makestep 2>/dev/null \|\| true), then <cli> agent up --yes` (the chrony step is a no-op where chrony is not installed) (macOS `sudo sntp -sS time.apple.com`, Windows `w32tm /resync` from an elevated shell); exit 4. Refused before any deposit (nothing was paid), and no other node is the way out; the minutes are in `error` ("about N min ahead of / behind the network's time"); `daemon doctor` shows `clockSkewSec` |
| `kill-switch-held` | `<cli> daemon restore-network, then <cli> agent up --yes` Nothing was paid. |
| `kill-switch-remote` | `<cli> agent up --yes` (connect without it); alsoNext `<cli> daemon set --kill-switch on --allow-remote-lockout --yes` (only with console access). From `daemon set` in an SSH or Remote Desktop session: after a lost connection the kill switch blocks every new connection to this computer, SSH included, at every boot until `<cli> daemon restore-network` runs locally. Nothing was paid or changed. `agent status` in such a session with it on: `killSwitchRemoteRisk: true`, `killSwitchRemoteNote`, `restoreNetwork`. |
| `switch-reconnecting` | `<cli> agent status until "connected" is true, or <cli> agent down --yes first` Nothing was paid. |
| `switch-offline`, `timeout`, `ticket_request_stale`, `ticket_invalid`, `channel_node_reopened` | `<cli> agent up --yes again in a moment` A deposit may be open: `<cli> agent down --yes` closes it. |
| `cancelled` | `<cli> agent up --yes again (it was stopped before it finished)` A deposit may be open: `<cli> agent down --yes` closes it. |
| `waiting-for-network` | `<cli> daemon set --rpc <https url> --yes (the VPN service's Solana connection), then <cli> agent up --yes` Nothing was paid: the service could not reach its RPC before any deposit (rc.8: exit 6). |
| `service-stopped-connecting` | `<cli> quality ip; if it shows no address, <cli> daemon restore-network; then <cli> agent up --yes` A deposit may be open: `<cli> agent down --yes` closes it. |
| `node-price`, `credit_exhausted`, `lease_insufficient`, `voucher_exceeds_escrow`, `voucher_signature_invalid` | `<cli> agent down --yes, then <cli> agent up --yes (a new deposit)` A deposit may be open: `<cli> agent down --yes` closes it. |
| `node-error`, `rate_limited` | `<cli> agent up --yes again in a minute` A deposit may be open: `<cli> agent down --yes` closes it. |
| `provider_unreachable` | `<cli> agent up --yes again in a minute (the plan provider did not answer)` A deposit may be open: `<cli> agent down --yes` closes it. |
| `kill-switch-failed` | `<cli> agent up --yes again, or <cli> daemon set --kill-switch off --yes` A deposit may be open: `<cli> agent down --yes` closes it. |
| `tunnel-closing` | `<cli> agent up --yes again in a few seconds` A deposit may be open: `<cli> agent down --yes` closes it. |
| `dns-apply` | `<cli> daemon set --dns-mode none --yes (the VPN's DNS off), then <cli> agent up --yes` A deposit may be open: `<cli> agent down --yes` closes it. |
| `deposit-pending` | `<cli> agent up --yes again in a few minutes (it never pays twice)` A deposit may be open: `<cli> agent down --yes` closes it. |
| `rpc-network`, `rpc-quota` | `<cli> daemon set --rpc <https url> --yes (the VPN service's Solana connection), then <cli> agent up --yes` A deposit may be open: `<cli> agent down --yes` closes it. |
| `rpc-timeout` | `<cli> agent up --yes again in a minute; if it keeps failing, <cli> daemon set --rpc <https url> --yes (the VPN service's Solana connection), then <cli> agent up --yes` A deposit may be open: `<cli> agent down --yes` closes it. |
| `chain-encoding`, `mode_not_voucher` | `<cli> agent up --basis per_hour --yes` (pay per hour instead) A deposit may be open: `<cli> agent down --yes` closes it. |
| `mode_not_stream` | `<cli> agent up --basis per_gb --yes` A deposit may be open: `<cli> agent down --yes` closes it. |
| `subscription_invalid` | `<cli> plans subscriptions, then <cli> agent up --plan <an active one> --yes, or <cli> agent up --yes without --plan` A deposit may be open: `<cli> agent down --yes` closes it. |
| `cannot cover the prepay` | `<cli> agent up --units <more> --yes (a deposit large enough for the node's minimum)` A deposit may be open: `<cli> agent down --yes` closes it. |
| `preflight` (any other action) | `read "error": it names what to change (nothing was paid), then <cli> agent up --yes` |
| `stop-failed` | `<cli> daemon doctor, then <cli> agent up --yes` A deposit may be open: `<cli> agent down --yes` closes it. |
| `dns-revert-failed`, `tunnel-left` | `<cli> daemon restore-network` A deposit may be open: `<cli> agent down --yes` closes it. |
| `unknown`, `unsupported` | `<cli> agent status`: nothing more specific is known; read `error` (`connect-failed` is the row above) It is not known whether a deposit was opened: `<cli> agent status` lists it. |

Elevation: on Windows `agent up` can itself need one elevated step (the service pipe granting this
account); a non-elevated agent then gets `daemon-relogin`. On Linux/macOS the service install needs root once.

Every code connect() can answer (`CONNECT_CODES`) has a command above; a code before paying means nothing
was paid. Only `unknown`, `connect-failed` and `unsupported` answer `agent status`.
**An open deposit comes first (E-22):** when the start failed after the check before paying and a deposit is open
with that server, `action` is `a deposit of X tDVPN is open with this node (<channel>): <cli> agent up --yes
picks another node (this node is skipped), or <cli> agent down --yes closes it and refunds the unused part at once (per hour: it bills until closed)` (per GB:
`2 h after it starts the close`; a closing deposit: `after <ISO readyAt>`), whatever the code. A failure that follows the deposit with code `unknown` or `connect-failed` answers `node-refused` (E-37; the node refused after it was paid, and is skipped next time). `agent status` then lists every open or closing deposit in `deposits` (`channel`, `node`, `status`, `refundable`, `readyAt`), with `next` = `<cli> agent down --yes` (closing: `<cli> agent down --yes after <ISO readyAt>`), never `agent up`, which would open a second deposit.

**The node stopped serving (E-35 / E-36):** when the exit address of the live session is this computer's own, or the daemon ended the session with "the connection to this server stopped working" (the service's own words) in the last 30 min, `agent status` answers `connected: false`, `code: "server-stopped"`, `message` = `The node stopped serving; your traffic is NOT going through it. Your deposit is safe: <cli> agent down --yes closes it and the unused <X> tDVPN is refunded (<when>).`, `nodeStopped` = `{ node, session, reason }`, `next` = `<cli> agent up --yes` (the dead node is skipped for 10 min), `alsoNext` = `<cli> agent down --yes`. When the kill switch also holds the block (`blocked: true`, E-82), `next` = `<cli> daemon restore-network` (rc.6, E-86: one runnable command; rc.5 printed it with the rest in brackets) and `alsoNext` = `then <cli> agent up --yes to reconnect, or <cli> agent down --yes to close the deposit`. `agent up` never reuses such a session (see `replaced`).

**Reconnecting with the internet held (rc.7, E-87):** while the service reconnects a live session under the kill switch, no traffic flows. `agent status` answers `connected: false`, `reconnecting: true`, `blocked: true`, with `session`, `node` and `protocol` of that session, `next` = `<cli> daemon restore-network` (one runnable command; rc.6 printed it as `connected: true` with the rest in brackets) and `alsoNext` = `then <cli> agent up --yes to reconnect, or <cli> agent down --yes to close the deposit`. Plain `status --json` gives the same `next` and `alsoNext`. Wait for `connected: true` instead if the node comes back on its own.

A test fails when a new code has no command here, or a next step names an app screen or button. The CLI rewrites
app-screen words in `error` (text and JSON) to the command to run, and
says "node" where the service says "server".

A failed connect after a deposit was paid leaves that deposit open: `agent down --yes` closes it (closing an open
deposit is unit-tested; that connect() leaves it open after such a failure is not tested here).

### Did money move? (`money`)

Every failure line of `agent`, `connect`, `switch` and `test` carries `money`, one sentence, and the text error prints it as `Money: …`. Three answers:

| Class | `money` | Codes |
|---|---|---|
| none | `Nothing was paid.` (`wallet`, `device`, `settle`: `Nothing was sent or signed.`) | `invalid-amount`, `invalid-address`, `usage` (rc.8: a value the command could not read; nothing was built or signed), `insufficient-funds`, `bad-recipient`, `low-sol-after`, `allowance-above-balance` (rc.8: wallet send and device plan/setup refuse before signing), `price-cap` (rc.6), `session-active`, `node-gone`, `node-stale`, `node-offline`, `protocol-blocked`, `driver-missing`, `basis-unavailable`, `not-enough-tdvpn`, `spending-limit`, `device-sol`, `preflight`, `not-confirmed`, `no-wallet`, `keyfile-missing`, `keyfile-mode` (rc.7), `wallet-switch-needed`, `clock-skew`, `no-device`, `device-permission`, `plan-limit`, `busy`, `test-running`, `unsupported`, `daemon-missing`, `daemon-relogin`, `daemon-restarting`, `daemon-unavailable`, `network-mismatch`, `kill-switch-held`, `kill-switch-remote` (rc9-e: refused before any change), `switch-reconnecting`, `price-changed`, `deposit-unusable`, `deposits-unread`, `no-nodes`, `not-funded`, `no-subscription`, `service-down`, `service-not-ready`, rc.7 R2: `device-home-gone`, `no-plan`, `driver-repair-failed`, `no-device-key`, `migrate-failed`, `device-not-ready`, `install-failed`, `daemon-settings-empty`, `daemon-settings-unreadable`, `dns-no-answer`, `uninstall-failed`, `checks-off`, `test-plan-failed`, `no-test-run`, `keystore-unavailable`, `keyfile-read-only`, rc.8: `waiting-for-network`, rc.9: `keyfile-unreadable`, `needs-admin`, `device-key-unreadable`, `setting-rejected`, `keyfile-lock-failed` (rc.9 final audit; wallet, device and settle failures read "Nothing was sent or signed."), `tx-not-landed` (rc9-f2: a transaction the network never took before it expired) |
| open | `A deposit may be open: `<cli> agent down --yes` closes it.` | `cancelled`, `switch-offline`, `ticket-other-owner`, `approval-revoked`, `service-stopped-connecting`, `node-identity`, `node-ledger`, `node-price`, `node-error`, `kill-switch-failed`, `tunnel-failed`, `tunnel-dead`, `tunnel-mtu`, `tunnel-closing`, `port-in-use`, `dns-apply`, `protocol-missing`, `deposit-pending`, `rpc-network`, `rpc-timeout`, `rpc-quota`, `timeout`, `chain-encoding`, `credit_exhausted`, `peer_limit_reached`, `lease_insufficient`, `subscription_invalid`, `ticket_request_stale`, `provider_unreachable`, `ticket_invalid`, `unauthorized`, `cannot cover the prepay`, `voucher_exceeds_escrow`, `channel_node_reopened`, `terms_rejected`, `rate_limited`, `voucher_signature_invalid`, `mode_not_voucher`, `mode_not_stream`, `stop-failed`, `dns-revert-failed`, `tunnel-left`, `node-refused`, `server-stopped` |
| unclear | `It is not known whether a deposit was opened: `<cli> agent status` lists it.` | `unknown`, `connect-failed`, `rpc-busy`, `rpc-unavailable`, `rpc-ws` (rc.7), `tx-unknown` (rc9-f2: a transaction whose send and confirmation could not be read: `wallet show --json` before trying again) |
| refund | `No new money was spent; the unused part of a deposit is still held: `<cli> settle run --yes` returns it.` | `settle-failed`, `daemon-gone` (rc.6: the service stopped mid-refund) |

A row above that lists several codes says the worst case; the `money` of the answer is exact. The text of `money` uses the command name `devnet-dvpn` (or `DVPN_CLI_NAME`).

### Replaced on the way out (any of the three)

`index.ts` rewrites an error whose raw text is a VPN-service or RPC failure. Then `code` and `action`
come from the shared copy, not the table above:

| Code | `action` |
|---|---|
| `service-down` | the service start hint, or null Nothing was paid. |
| `service-not-ready` | null: try again in a moment Nothing was paid. |
| `approval-revoked` | `<cli> device setup --yes, then <cli> agent up --yes` A deposit may be open: `<cli> agent down --yes` closes it. |
| `not-enough-tdvpn` | `send tDVPN to the wallet address (<cli> agent status shows it), then <cli> agent up --yes` (here the sentence is in `error` and `action` is null) Nothing was paid. |
| `session-active` | `<cli> agent status --json` (when the service itself reports the live session; the row above is the answer to a connect `agent up` started). The session may be another run's: never end it on this answer. Only when `agent status` shows it is yours does `<cli> agent down --yes` end it. Nothing was paid. |
| `rpc-unavailable`, `rpc-ws` | `<cli> daemon set --rpc <https url> --yes (the VPN service's Solana connection), then <cli> agent up --yes` (rc.7; was the RPC hint) It is not known whether a deposit was opened: `<cli> agent status` lists it. |

### Usage (exit 3) and confirm (exit 2)

Exit 3, nothing ran: `--basis must be per_gb or per_hour`, `--units must be a whole number from 1 to 1000`,
`--protocol must be any, …`, `--country must be a two-letter country code, e.g. DE`, `--max-price: …`,
an unknown flag, `unknown: agent <x> (up | down | status)`. `agent` with no subcommand (e.g. `agent --json`) is `agent status`, exit 0. With `--json` (rc.8) each is one line on stdout:
`{"ok":false, "error", "code":"usage", "usage": <the command's usage line or null>, "next":"<cli> help", "docUrl", "money":"Nothing was sent or signed."}`. Exit 2: `up` or `down` without `--yes` (above).
