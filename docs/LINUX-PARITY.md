# Linux parity — Devnet dVPN (#32) vs the Windows app (#31)

Every CLI command, feature, screen and protocol, with the Windows proof next to the Linux proof.
Linux evidence lives in `docs/evidence/linux/` (raw logs; a row's evidence names the file).
Rig: GCP VM `ddv-linux-1` (Ubuntu 24.04, kernel 6.8.0-1071-gcp, e2-standard-2) running the
**installed .deb**, against #31's six nodes on `ddv-node-1` and #31's plan
provider. Same dvpnd build as Windows (`dfe36c7-dirty`). Date: 2026-10-21.

**Status:** ✅ proven live on Linux · 🧪 unit-tested only · ◐ partly · ⏸ blocked (reason given)

## Headline

The **Windows** column is the state #31 had when this file was started (a snapshot, not kept current). The live Windows status, including Hysteria2 and the kill switch on WG/AWG/OpenVPN fixed there since, is an internal document (not published). Compare against that file, not this column.

| | Windows (#31) | Linux (#32) |
|---|---|---|
| CLI commands (catalogue, 67) | e2e + VM sweep | ✅ **every command passed live** (`cover`: 0 missing) |
| Unit tests | Windows suite | ✅ **299/299** on the VM |
| Protocols, per GB: connect → egress = node → disconnect → direct IP back | see Windows `PLATFORM-MATRIX.md` (snapshot: Hysteria2 ✗, gap #28) | ✅ **all six** (run 1, before the redeploy) |
| Kill switch ON | see Windows `PLATFORM-MATRIX.md` (snapshot: WG/AWG/OVPN broken, gap #29) | ✅ **all six**: no leak when the path to the server is lost, clean restore (cf4c372) · ✗ a killed OpenVPN/Hysteria2 process lifts the block (dvpnd, gap #41) |
| UI, every screen, dark + light | ✅ | ✅ 0 renderer errors, screenshots |
| Installer | 25/25 + 9/9 | ✅ **22/22** on cf4c372 (upgrade incl. key migration + polkit start rule + restart backoff, remove, reinstall keeps the device, AppImage; `linux-cf4c372/sweep/installer.*`) |

At the time of that snapshot Linux was ahead on Hysteria2 and on the kill switch for WireGuard and AmneziaWG; check `PLATFORM-MATRIX.md` for Windows today.

## External event during the run

At **12:37:39 UTC** the maintainer redeployed the devnet program (grants model, no
`add_operator`; see an internal document (not published)). After that, opening a
new pay-as-you-go channel fails on **both** platforms (`dfe36c7` dvpnd → Custom 102). Ticketed
plan sessions, top-ups, settle and withdraw still work. Linux run 1 (`spend-run1.*`, 11:02 UTC)
is before the redeploy; run 2 (`spend.*`, 13:12 UTC) and the kill-switch run (`ksdns.*`) are
after it, which is why they use plan tickets.

## Re-run on the grants program (upstream cf4c372, from 14:15 UTC)

Both apps moved to the redeployed program and dvpnd `cf4c372-ddv1` (owner-approved). Linux
evidence: `docs/evidence/linux-cf4c372/` (installed .deb on `ddv-linux-1`, the six ddv- nodes
on the same build).

| | Linux result |
|---|---|
| Upgrade of an installed v1 service | ✅ package upgrade renamed the old config keys (dvpnd now ignores them), service refused to start without a grant, `device setup` opened the grant (`3MK5Dp…`), service started; doctor clean |
| Unit tests | ✅ 320/320 |
| CLI tiers | ✅ local 63/0 · daemon 33/0 · spend 67/2 (the 2 = plan connect, below) |
| Protocols per GB | ✅ all six: egress = node, nothing left after, direct IP back |
| Switch / per hour / follow | ✅ |
| V2Ray SOCKS + GNOME proxy + Chrome window | ✅ |
| Leftover check positive control | ✅ sees the live OpenVPN / Hysteria2 / Xray process |
| Deposit top-up / settle (18 tx) / withdraw / node test | ✅ |
| UI, every screen, dark + light | ✅ 0 renderer errors (`ui/`) |
| Kill switch ON, all six protocols (per GB) | ✅ **72 checks pass**: connect, egress = node, `inet dvpnd` up, names resolve, VPN DNS 1.1.1.1 on the WG/AWG/Hy2 links via resolvectl, V2Ray/Xray direct request blocked; **path to the server lost → no leak on all six**; clean restore, direct IP back (`sweep/ksdns.*`). ✗ 4: killing the OpenVPN / Hysteria2 process lifts the block (dvpnd ends the session as "service stats unavailable" and releases the firewall; UPSTREAM-GAPS #41; V2Ray/Xray hit the same path once 5 stats reads fail) |
| Plan connect | ⏸ provider-side, twice: first `POST /v1/tickets` 500 (provider DB, UPSTREAM-GAPS #39, fixed by #31 15:33); then the plan's six leases carry v1 vouchers and were start-closed at 15:38 (gap #40), new leases open after the 2 h close grace (~17:45 UTC). The app shows the plain "provider couldn't give you access" copy for both |

Found by this run and fixed in both apps (shared code): every cf4c372 node showed DOWN (signed
metadata domain is now sha256 of the tag; UPSTREAM-GAPS #38), plan rosters refused (provider tag
renamed), `daemon doctor` crashed (JSON field case), old deposits listed with no server, renamed
node error codes shown as "Something went wrong", node speeds 0 (field rename).

## CLI — every command

All 67 (`devnet-dvpn help`) passed at least once on Linux: `sweep/cover.tsv` + the tier files.

| Group | Commands | Linux evidence |
|---|---|---|
| Overview | version, status, logs | `local.tsv`, `daemon.tsv` |
| Wallet | show, receive, create (libsecret keyring), import (key file + junk refused), send (refusals + live funding), logout | `local.tsv`; keyring entry checked, nothing secret on disk |
| Device | show, plan, setup (live tx `5bbWkP…`), register (reads `device.pub`), revoke (`--yes` gate; live at teardown) | `daemon.tsv` |
| Service | version, doctor (no FAIL), drivers, repair-drivers (AmneziaWG via PPA), init, install, settings, set (allow-lan, DNS, DNS mode, kill switch round trips; `netsh` refused), restore-network | `daemon.tsv`, `ksdns.tsv` |
| Servers | nodes list (all filters), show, fav, recent, cost (GB + hour) | `local.tsv`, `spend.tsv` |
| Connect | connect (per GB ×6, per hour, `--switch`, `--plan`, `--follow`), disconnect, sessions, tickets, proxy status / on / off / browser | `spend-run1.tsv`, `spend.tsv` |
| Plans | list, roster, subscribe, subscriptions, close | `spend.tsv`, `ksdns.tsv`, `extra.tsv` |
| Money | channels, channels fund, settle list / run / withdraw, history list / summary / export | `spend.tsv` |
| Testing | test plan / run / stop / history / show --compare / export | `local.tsv`, `spend.tsv`, `test-run.json` |
| Quality | quality ip (= node while connected), quality speed | `local.tsv`, `spend-run1.tsv` |
| Settings | rpc state / set, poll show / set / reset / run / watch, settings get / set | `local.tsv` |

## Features F1–F26 (docs/FEATURE-PLAN.md)

| F | Feature | Windows (#31) | Linux (#32) |
|---|---|---|---|
| F1 | Install and bootstrap | ✅ NSIS, drivers via MSIs | ✅ .deb + first run (init → setup → one admin step); drivers via apt/PPA; installer 22/22 |
| F2 | Owner wallet | ✅ DPAPI (CLI), safeStorage (app) | ✅ libsecret (CLI, live); app safeStorage with `basic_text` refused 🧪; test wallet via `DVPN_KEYFILE` in the UI run |
| F3 | Device key + spending permission | ✅ | ✅ setup tx, `device.pub`, keys root 0700 |
| F4 | Network and RPC | ✅ | ✅ `rpc set/state`, pool + bench; key never echoed (fixed here) |
| F5 | Refresh and polling | ✅ | ✅ `poll *` commands; UI rpc-startup/rpc-end counts |
| F6 | Node discovery | ✅ | ✅ 35 listed, 11 online |
| F7 | Node browser | ✅ | ✅ Servers screen + `nodes show/fav/recent` |
| F8 | Pricing and cost | ✅ | ✅ `cost` GB + hour |
| F9 | Direct connect | ✅ 5 of 6 protocols | ✅ **6 of 6** per GB; per hour; switch; follow |
| F10 | Plans | ✅ (box rig) | ✅ subscribe → roster → connect --plan (egress = node) → close, after the redeploy |
| F11 | Session state machine | ✅ | ✅ status while connected, `--follow` ends on disconnect |
| F12 | Disconnect and settlement | ✅ | ✅ disconnect ×N, settle run, withdraw, channels closing |
| F13 | Sessions, channels, history | ✅ | ✅ sessions, channels, fund, history list/summary/export (CSV) |
| F14 | Kill switch | snapshot: ◐ WG/AWG/OVPN broken (gap #29); now: Windows `PLATFORM-MATRIX.md` | ✅ all six: path lost → no leak, restore (`linux-cf4c372/sweep/ksdns.*`) · WG/AWG link down → no leak · killed OVPN/Hy2 process → leak (dvpnd gap #41) |
| F15 | DNS | ✅ presets, leak with KS off (gap #30) | ✅ Cloudflare set on `dvpn-wg-client` / `dvpn-awg-client` via resolvectl, names resolve with KS on; `dns-mode` round trip |
| F16 | Split tunnelling (per app) | ✅ WinINET + browser | ✅ V2Ray SOCKS egress = node; GNOME system proxy on → `manual` + 127.0.0.1, off → `none`; Chrome window with `--proxy-server=socks5` · KDE path 🧪 |
| F17 | Protocols and dependencies | ✅ MSIs | ✅ apt/PPA, `daemon drivers` all ready; kernel 7.0 DKMS gap L2 |
| F18 | Settings | ✅ | ✅ app settings + service settings through the root helper (restart each time) |
| F19 | Quality and diagnostics | ✅ | ✅ quality ip/speed; Diagnostics screen; doctor run as user (fixed here) |
| F20 | In-app node testing | ✅ | ✅ `test run` on WG + V2Ray, reports |
| F21 | Desktop integration | ✅ tray, login item | ✅ tray + hide on close + shown again (`ui/*/desktop.json`); XDG autostart on → `~/.config/autostart/devnet-dvpn.desktop` (`--hidden`), off → removed (`sweep/autostart.txt`) |
| F22 | Updates and versions | ✅ | ✅ `version`, `daemon version` (network OK) |
| F23 | Errors and copy | ✅ | ✅ every refusal in the local tier is plain copy with an action; Linux wording on all screens |
| F24 | Security | ✅ | ✅ root only via `dvpn-helper` whitelist; keys root-only; phrase/key redaction in logs; AppArmor profile scoped to our binary |
| F25 | Language, accessibility, theme | ✅ | ✅ dark + light screenshots, 0 errors |
| F26 | Testing and release | ✅ | ✅ `release:linux`, unit 299/299, sweep tiers, installer test |

## Screens (UI smoke, installed app, Xvfb, `docs/evidence/linux/ui/{dark,light}`)

Welcome, Connect, Servers, Plans, Activity, Node test, Wallet, Settings, Diagnostics, CLI (+ a
command run in the in-app terminal): all render in both themes, `errors.json` = `[]`.

## Open items (honest list)

| Item | Why | Next |
|---|---|---|
| ~~Kill switch ON for OpenVPN, Hysteria2, V2Ray, Xray~~ | ✅ run per GB on cf4c372 (all six, path-lost case) | — |
| Killed protocol process lifts the kill switch | dvpnd releases the firewall when it ends a session as "service stats unavailable" (gap #41); the app cannot hold an nft rule of its own without fighting dvpnd | upstream fix |
| Plan connect on cf4c372 | provider leases (gap #40) | re-run `PLAN_ADDR=6zKPsC… cli-sweep.sh ksdns` after #31's new leases |
| ~~New pay-as-you-go sessions~~ | ✅ fixed by the cf4c372 migration (all six protocols per GB, above) | — |
| ~~pkexec prompt on a desktop~~ | ✅ proven: a desktop user without sudo (`ddvdesk`, own login session, GNOME polkit agent on the display) ran `daemon set`: the prompt shows the app's message + icon (`linux-cf4c372/pkexec/pk-dialog.png`), the admin password → "Applied and restarted."; Escape → "The administrator permission prompt was declined or closed." (exit 1, config unchanged) | — |
| ~~KDE system proxy~~ | ✅ live with KDE's own config tools (`kreadconfig5`/`kwriteconfig5`, `XDG_CURRENT_DESKTOP=KDE`) during a V2Ray session: the user's own HTTP proxy seeded first; `proxy on` → `kioslaverc` socksProxy `socks://127.0.0.1 1080`, SOCKS egress = node; `proxy off` → the user's values back byte for byte (`linux-cf4c372/kde/`). Not run inside a full Plasma desktop (KDE apps reading kioslaverc is KDE's part) | — |
| ~~Migration to the grants program~~ | ✅ done (section above) | plan connect waits on the provider fix |
| AppImage on Ubuntu 24.04 | needs `libfuse2t64` and `--no-sandbox` (all Electron AppImages) | documented; .deb is primary |
| Fedora 44 + Rocky 9.8 (rpm) | run 5: install, dirty, CLI sweeps, UI, matrix all six protocols, split, healthy-node edge cases pass (`evidence/linux-cf4c372/EL-RUN5.md`); 0 SELinux denials | Rocky on 16.30: `platform-el.sh` 108/0, matrix nine cases 0 FAIL, UI dark+light 0 renderer errors done (run6-16.30, `EL-RUN6.md`). Driver repair no longer installs a newer kernel (dnf: `kernel-devel-matched-$(uname -r)`, 4f168253; live proof in the clean-install turn). Still open (lane A turns 3–5 on ddv-node-3): clean / dirty / installer + sweeps, split + splitui, matrix plan, edge, dhcprenew, soak, reboot |
| AppImage first run on a desktop with zenity/kdialog | AppRun shows the licence and waits for **Agree** (Rocky: "--no-sandbox empty log") | documented in INSTALLER; test accepts it (635cc4ea) |
| ~~Leftover-process positive control~~ | ✅ cf4c372 spend run (OpenVPN, Hysteria2, Xray) | — |

## Final package additions (dvpnd ddv16.30, deb f131fba3, 2026-10-24)

Evidence: `evidence/linux-cf4c372/final-16.30/` (rig = `rig/`, queue VM Ubuntu 22.04 = `u2204c/`).

| Item | Windows | Linux | Linux evidence |
|---|---|---|---|
| Speed test caps the whole download at 45 s (`SPEED_MAX_MS`) | 5c03380 | ✅ unit (port 539cef38) · live: next queue spend turn (`quality speed`) | `tests/unit/speed-cap.test.ts` |
| Remove another device + settle its deposits: `device revoke --device D`, `settle list\|run --device D`, Wallet "Other devices" | 8fe1c5c, a57e4d9 | ✅ unit + CLI help (port 9b0b328b); refusals (own device, grant still open) · live tx: teardown | `tests/unit/other-device.test.ts`, `rig/build-final.txt` |
| CLI `device setup` before `daemon init` names the command (no loop on a fresh machine) | shared message names the Welcome screen | ✅ live on the rig (92fce1ef): "Create it first with: devnet-dvpn daemon init…"; caught by the clean tier (C11 port had dropped 8cc8988d) | `rig/build-final2.txt`, `u2204c/Q1-invalid-order/README.md` |
| Plan past its server limit is refused before any ticket, with the reason | ✅ | ✅ live: 3rd server on plan 8z7U383V (2 per wallet) refused "This plan gives access on 2 servers…" | `rig/matrix-T2/plan-rerun/README.md` |
| Plan connect, all six protocols, final lock | ✅ | WireGuard, AmneziaWG (rig T2) · Hysteria2, V2Ray (queue VM, deb bb3d3e72) · **OpenVPN, Xray owed** (2nd wallet, rig edge turn) | `PROTOCOL-MATRIX.md` FINAL section |
| Uninstall leaves the machine as found (apt: purge + autoremove) | — | ⏳ fresh-VM `fp-before clean fp-after` on f131fba3 in the next queue turn. Open: two EMPTY nft tables `ip filter` / `ip6 filter` (no chains or rules) appear after sessions; nothing in the app, scripts or dvpnd calls iptables | `u2204c/Q1b/README.md` |
| Package version | — | every build is `0.1.0`: `apt-get install <deb>` over an installed 0.1.0 is a no-op (tests use `--reinstall`). A release must bump the version | `rig/build-final.txt` correction |

## Security and LAN checks from #31's COSMOS-LESSONS (2026-10-22)

| Check | Linux result |
|---|---|
| Per-protocol session files (WireGuard keys, OpenVPN auth, Hysteria2 password, V2Ray/Xray ids) readable by other local users (Windows: they were, fixed app-side in #31 230670d) | ✅ not reachable: `/var/lib/dvpnd/client` is `750 root:dvpn`, so other users cannot traverse into it. The group (only the user who ran setup, who already drives the service through its socket) can read the protocol `config.toml` files and `data.db`; the device private key is not group-readable. Checked on `ddv-clean-u2204`. Live per-session check: edge `confwipe` (none world-readable during, nothing but `config.toml` left after disconnect). |
| Allow-LAN inbound (#33 0011) and inbound with the kill switch on (#31 ed6f012) | ✅ since dvpnd ddv16.11 (patch 0013): the kill switch has an nft `input` chain, policy drop. It accepts loopback, replies to our own connections (ct established/related), the tunnel, DHCP client ports, link-local and IPv6 neighbour discovery, and LAN sources only with allow-LAN on. Before it, inbound was open while the kill switch was on. Proof: `nft -c` of both rulesets + unit test, matrix `ks-on` 161/0 with it, edge `laninbound` (a LAN peer connects in iff allow-LAN). IPv6 local ranges (`fc00::/7`) joined the allow-LAN set in ddv16.14 (patch 0016, #31 gap #76): edge `lanv6` 158/0 on Debian 12 (a network-namespace LAN with fd00:ddd::/64 + 192.168.77/24, both directions, all six protocols). |
| Session credentials removed after a normal disconnect (Cosmos T13) | ✅ since ddv16.15 (patch 0017, UPSTREAM-GAPS L17): before it, OpenVPN/Hysteria2/V2Ray/Xray kept client.conf + auth.txt + tls-crypt.key / client.yaml / client.json until the next crash cleanup (edge `confwipe` 4 FAILs on u2404). WireGuard/AmneziaWG were already clean. |
| IPv6 never leaks or stalls when the node is IPv4-only (Windows ipv6Guard, #33 0023 on macOS) | ✅ since ddv16.18 (patch 0018, L18): nft `inet dvpnd_v6guard` rejects IPv6 (TCP reset / ICMPv6 admin-prohibited) except loopback, link-local, ULA and multicast while every node address is IPv4; removed on disconnect, by recovery after a crash and by restore-network. Edge case `v6guard` (curl -6 fails in < 3 s, dual-stack sites answer over IPv4). |
| A protocol process's failure names its cause (Xray port in use) | ✅ since ddv16.18 (patch 0019, L19): the exit detail includes the stdout tail; edge `porttaken` shows the busy port. |
| Disconnect always reaches the node (close confirm) | ✅ since ddv16.18 (patch 0020, L20): one retry when the pooled connection was just closed (`use of closed network connection`); edge `lanv6` OpenVPN. |
| Remote access to the machine during a full tunnel (kill switch off) | ✅ since ddv16.25 (patch 0022, replaces 0021; L21): per card a table with only its default route + `ip rule pref 8990 from <card address> lookup <table>`, for WireGuard, AmneziaWG, OpenVPN and Hysteria2; the SSH open before connect stays up and new inbound connections work, egress still the node (0021 proof on u2204; 0022 on u2404 R10/R11: outside host connects in WG 8/8, AWG 7/7, OpenVPN 8/8, Hy2 7/7, nothing left after; edge case `outsidein`). Windows: inbound breaks in any full tunnel (#31, documented behaviour). With the kill switch on, non-LAN inbound is blocked by design on both. |
| Uninstall with the kill switch on "Always", then reinstall | ✅ since ddv16.23 (L22): the uninstall steps "Always" down to "On" and dvpnd #31 45574d5 releases a leftover block the setting no longer asks for (#31 #84 parity); unit test in `linux-platform.test.ts`. Live reinstall case queued for round 8. |
| Full tunnel keeps the machine's own network (gateway, LAN, cloud metadata) | ✅ since ddv16.11 (patch 0014). Hysteria2 sent the gateway, the LAN and 169.254/16 into its TUN: SSH hung before the banner, LAN hosts unreachable even with allow-LAN, and on GCE the metadata server answered from the node side (it renamed a Rocky VM). Windows is unaffected (#31 hy2loc1). Live on Debian 12; edge `localnet` per protocol. |
| Cloud metadata server stays on the card on NetworkManager distros (UPSTREAM-GAPS L23 → L27) | ✅ since ddv16.30 (patches 0023 → 0024 → 0027). In a full tunnel on GCE Rocky/Fedora, 169.254.169.254 went through the tunnel and the node's metadata server renamed the VM. 0023: a main-table /32 (NetworkManager deleted it on re-apply). 0024: `ip rule pref 8989 to 169.254.169.254` (+ OpenVPN's server) into the card table. **0027:** wg-quick's unnumbered `fwmark 51820` / `suppress_prefixlength 0` rules took prefs just below 8989 and still won on WireGuard, so WG/AWG now use /1 halves, plus a pref 8989 endpoint rule. Proof on Rocky 9.8, 16.30 (lane A, `linux-cf4c372/rocky9/run6-16.30/`, 812d544d): restart → WireGuard ×2, 0 renames, against a 16.29 control on the same VM that was renamed; `platform-el` all six, KS on, firewalld reload/restart + NM re-apply 108/0, SELinux 0 AVC; matrix nine cases 0 FAIL. Ubuntu rig matrix on 16.30: pending (final run). Windows: not affected (#31 binds to the adapter). |
| dvpnd database files private to root (UPSTREAM-GAPS L24, #31/#33 gap #87) | ✅ fixed app-side, no dvpnd change: the unit chmods `data.db`, `-wal` and `-shm` to 600 before and after each start; upgrades get a drop-in + a one-time chmod. Live on u2204b: all three 0600 after a restart, CLI and status still work; unit test in `linux-platform.test.ts`. Already only `dvpn`-readable before (home dirs `0750 root:dvpn`). Final package recheck on the queue VM: pending. |
| Host firewall denying incoming (ufw, firewalld) | ✅ fixed in setup. Hysteria2's TUN hands each TCP connection to a local listener (= new inbound), so "deny incoming" let it say Connected while every TCP connect timed out. Debian 12 + ufw: 23 `UFW BLOCK … dvpn-hy2-client`; WireGuard unaffected. Setup and package upgrade add `ufw allow in on dvpn-hy2-client` (firewalld: trusted zone, platforms 7fbb0e8); uninstall removes both. Edge `ufw`. |
| Starting the service without a password on older polkit | ✅ polkit 0.105 (Ubuntu 22.04) has no JS rules, so the package rule did nothing there. `start-right.sh` writes a `visudo`-checked sudoers drop-in naming exactly `systemctl start|restart dvpnd-client.service` for the `dvpn` group, and the app falls back to `sudo -n` for it. installer-test proves it with a `dvpn` member without sudo rights. |
| Session DNS survives a DHCP lease renewal (resolvconf mode: Arch, minimal Debian, EL9 without resolved) | ✅ since ddv16.12 (patch 0015, UPSTREAM-GAPS L15): proven live by a test VM on ddv-plat-arch, `dhcprenew` 11/0 (WireGuard + Hysteria2, kill switch on). |
| Idle 5 min then traffic (CF6), DNS back when the tunnel link vanishes (rule 39), another VPN owning the default route (D6) | edge cases `idle`, `dnsgone`, `ownvpn` (results in `docs/evidence/linux-cf4c372/edge/`) |
