# Test plan — Devnet dVPN

"Tests pass" is not "it works": the C# SDK once had 656 green tests and zero working features
(`Sentinel SDK/suggestions/2026-03-23-learn-from-mistakes.md`). Every feature is proven on the
live devnet with real sessions and real traffic.

## Ground rules

- **Never run a full-tunnel client session on the owner's laptop** (or the shared admin box).
  Client daemons run in a disposable Windows VM or a Linux network namespace (WSL), as in
  `sentinel-solana/scripts/e2e-*.sh`.
- Spend only from the #28 devnet wallet (`keys/devnet/client.json`, key file, no mnemonic) via
  `TEST_KEYFILE`. Never copy it anywhere else.
- Chain tests run **sequentially**, 7 s between transactions, 60 s+ between suites. Every test
  cleans up what it opened (channels settled, subscriptions closed, balances withdrawn).
- Fixtures are **captured from devnet** (account bytes, signed metadata, tickets) — never
  hand-written values.

## Layers

| layer | tool | what it proves |
|---|---|---|
| unit | vitest | `core/` logic: decoders against captured accounts, PDA derivation, error-number mapping, pricing maths, state machine transitions, country map, JSON round-trips |
| IPC contract | vitest + Electron harness | every IPC channel registered on both sides, tier map matches registrar, every handler returns code + message (M5.2) |
| integration | devnet, no tunnel | chain reads, tx builders simulate + land, node probe, provider API, daemon gRPC (doctor-level) |
| e2e | devnet + client daemon in VM / netns | full user flows below, through the app's own IPC handlers |
| UI walk-through | Electron window driven through the app's own IPC harness, screenshots reviewed | every button, filter, state |

## Suites (feature IDs from FEATURE-PLAN.md)

| ID | suite | steps / assertions |
|---|---|---|
| T0 | P0 spikes | grpc-js reaches `\\.\pipe\…\dvpnd\client` as a normal user with `socket_group=Users`; Windows WG session up/down in a VM; each new TS builder (`add_operator`, `update_operator`, `remove_operator`, `start_close_channel`, `close_channel`, `fund_channels`) simulates then lands, and chain state is read back; elevated config apply + restart + doctor green |
| T1 | install | fresh VM: install → service running → pipe reachable → uninstall restores network |
| T2 | wallet | create / import phrase / import key file / base58; safeStorage on; logout wipes; round-trip of stored state; browser-wallet relay rejects wrong fee payer and foreign programs |
| T3 | grant | approve → open_grant → device funded → doctor `grant` passes; update allowance reads back; revoke refused while a channel is open |
| T4 | RPC | failover on a dead endpoint; 429 injection does not fail a read or a send; resend after lost response confirms the same signature; network-identity mismatch blocks Connect |
| T5 | polling | one timer per source (count network calls on startup: each endpoint once); ws drop falls back to polling; minimised throttling |
| T6 | discovery | full devnet registry decodes; tampered metadata signature rejected; wrong TLS pin rejected; expired listing hidden; REALITY hidden |
| T9 | direct connect | preflight blocks (no allowance, no device SOL, dead node, missing binary) cost 0; voucher connect → traffic flows → usage updates within 60 s; stream connect |
| T9b | second attempt | connect → disconnect (soft) → reconnect same node reuses the channel and pays no new escrow; connect → kill app → restart → state rebuilt, no auto-resume |
| T10 | plans | subscribe with expected terms; terms changed → refused and re-shown; ticket connect with ≥3 retries on `ticket_invalid`; `max_connections` second ticket → `peer_limit_reached`; close subscription |
| T11 | state machine | every daemon status + 8 close reasons map to a state and copy; concurrent actions refused; reconnect shows "internet blocked" + Stop |
| T12 | settlement | voucher: start_close → `GraceNotElapsed` before 7200 s → close after → withdraw; stream: close immediately; queue survives app restart |
| T14 | kill switch | daemon killed mid-session → app detects → Restore network brings connectivity back; persist mode survives daemon restart; credit exhausted holds traffic |
| T15 | DNS | each preset applied and reverted; `dns_revert_failed` surfaced; leak check |
| T16 | split tunnel | V2Ray/Xray session: proxied IP ≠ direct IP (curl `--proxy socks5://` vs direct); browser profile through proxy; system proxy set and restored after a crash; WG full-tunnel regression. **Page (U5):** choose an app on the Split tunnelling page, Apply, connect: the chosen / left-out app exits where the mode says (real Edge vs curl.exe), lanes and `split status` agree — `scripts/e2e/vm-split-ui.ps1` |
| T19 | quality | speed test fallback reaches a result when Cloudflare is blocked; baseline recorded |
| T20 | node test | 10-node run, progress increments on error/cancel, Stop between nodes, history saved and reloaded, test channels settled |
| T21 | desktop | tray actions, close-to-tray, notifications fire once, single instance |
| T24 | security | renderer cannot reach Node APIs; no secret in any IPC payload or log (grep the log for key material); RPC URL with token is redacted |

## Per-feature questions (applied in review)

Each feature must pass the six-question standard (HNS RETROSPECTIVE): first use · return visit ·
after restart · after failure · output shareable · issues investigable — and the eight
learn-from-mistakes questions listed in `STANDARDS-TRACE.md`.

## How to run

| layer | command | needs |
|---|---|---|
| unit | `npx vitest run tests/unit` | nothing |
| devnet builders | `TEST_KEYFILE=… npx vitest run tests/devnet/p0-builders.test.ts`, then `p0-settle.test.ts` after 2 h | devnet wallet; spends |
| CLI local | `bash scripts/e2e/cli-e2e.sh local` | nothing; scratch data dir, throwaway wallet |
| CLI daemon / spend | `bash scripts/e2e/cli-e2e.sh daemon` / `spend` | WSL rig (`wsl-rig.sh client` / `up`) |
| every node type, plans | the internal test-rig runbook (not published) run book | box rig; spends |
| UI | `DVPN_UI_SMOKE=<dir> [DVPN_UI_SMOKE_THEME=dark\|light] electron .` | build; add `DVPN_UI_SMOKE_CONNECT=…` only against the box rig |

## Results (2026-10-20)

| suite | status | evidence |
|---|---|---|
| T0 P0 spikes | ✅ | pipe ACL proof (UPSTREAM-GAPS #10); every new builder landed; p0 channel settled by `p0-settle` |
| T1 install | ✅ | **clean Windows Server 2022 VM (GCP, 2026-10-20), real setup .exe** (`scripts/e2e/vm-installer-test.ps1`): silent install 70 s, 25/25 checks (bundled binaries, WireGuard 1.1.1 + AmneziaWG 3.1.0 + OpenVPN 2.6.23 + Wintun adapter installed, CLI on PATH in a new shell, `daemon drivers` ready, Apps & features, Start menu); first run with a fresh wallet: `daemon init` → `device setup` → `daemon install` (elevated step ran directly, no prompt) → `daemon set --kill-switch off` → WireGuard connect, exit IP = node, 51 Mbps, disconnect, settle, revoke; upgrade over the top: service stopped + restarted, PATH not duplicated; uninstall 9/9 (service + tunnels gone, PATH cleaned, proxy off, internet OK, drivers + device key kept). Laptop too: service Running/Automatic, pipe-bridge unelevated, per-service PATH |
| T2 wallet | ✅ local | cli-e2e local create / import / logout; key-file import in the app |
| T3 grant | ✅ | box: `device setup` one tx; allowance top-up; `device revoke` (WSL device) |
| T4 RPC | ✅ | 429 injection live: an always-429 endpoint first in the pool → benched 8 s, reads served by the next endpoint, no user-visible error (`rpc set` + `nodes list` + `rpc state`) |
| T5 polling | ✅ | UI smoke counts RPC calls per source (`rpc-startup.json`): 12 sources, **each read once** at startup. The run found two doubles and fixed them (2026-10-21): `index.ts` called `refreshWallet()` on top of the scheduler's first tick (5 wallet reads ×2), and two callers raced `fetchConfig` before its cache filled (now one shared read). After walking all 9 screens only the 60 s health job had run again |
| T6 discovery | ✅ | full devnet registry (20 listed); REALITY filter unit-tested |
| T9 direct connect | ✅ | box: 6 protocols × per GB / per hour; **Windows laptop (real service): all 6 protocols against a GCP node host** (WG 2.3, AWG 1.4, OVPN 2.1, Hy2 3.1, V2Ray 2.3, Xray 2.5 MB/s; IP = node, direct IP back after disconnect; BOX-RIG → GCP host); preflight blocks cost 0 |
| T9b second attempt | ✅ | box: reconnect reuses the open channel; busy channel falls back only if the node has room |
| T10 plans | ✅ | box: subscribe → ticket connect → held-ticket reuse → plan-limit refusal → cancel |
| T11 state machine | ✅ | unit (all statuses, 8 close reasons) + box live transitions |
| T12 settlement | ✅ | devnet: stream close immediately; voucher start → grace → close → withdraw |
| T14 kill switch | ✅ Linux / ☐ Windows | box netns: daemon `kill -9` + tunnel gone → egress blocked by the leftover kill switch; daemon restart releases it; `restore-network` mid-session and after; Windows WFP case needs the VM |
| T15 DNS | ◐ | presets + `dns_revert_failed` copy; leak check not run |
| T16 split tunnel | ✅ (page: exclude + include ✅ on VM ddv-win-2 xray / ddv14 2026-10-22, `vm-split-ui.ps1`; ui-win-1 ddv17.5 installer 97f9de92: exclude ✅, include ✅ by #31 (curl.exe chosen → node, PowerShell → direct); open: a dual-stack site gets no answer from a chosen app, gap #66 — Windows snapshot copied from #31's TEST-PLAN 2026-10-24; Linux split = `split-test.sh` / `split-ui.sh`) | box + laptop: V2Ray/Xray SOCKS exits at the node (VPN IP ≠ direct IP, shown in app + `quality ip`); `proxy on` refuses a dead endpoint; real Windows system proxy on/off and crash restore on app start (BOX-RIG → Laptop client) |
| T19 quality | ✅ | `quality ip` / `quality speed` with fallbacks |
| T20 node test | ◐ | unit (verdicts, estimate, basis, exit-IP match, compare); CLI `test plan/run/stop/history/show/export` + Node test screen in the smoke walk (0 errors). Live run on the GCP nodes waits for the shared wallet |
| T21 desktop | ✅ (notifications ◐) | UI smoke (2026-10-21): tray created; closing the window hides it and the app keeps running; showing it again works; a second launch hands over to the running window (`second launch` logged) and exits in 1 s. **Bug found and fixed:** the second copy used to run its whole startup before quitting (daemon attach, and the stale-proxy restore that could clear a live SOCKS proxy). It now exits before startup. Notifications de-duplicate in code (`warnLowFunds`); not walked live |
| T24 security | ✅ | IPC tier test; no key material in logs; RPC URL redacted |
| UI walk | ✅ | smoke dark + light, 9 screens, CLI terminal runs `version`, 0 console errors; real connect on the box |

## Evidence

A suite passes only with evidence: tx signatures, chain state read back, byte counts, IPs, and
screenshots for UI. Results go to the handoff and tick the matching row in `STANDARDS-TRACE.md`.
