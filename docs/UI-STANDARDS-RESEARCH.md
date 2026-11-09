# UI standards research — per page

What well-known VPN apps and the platform guidelines do, page by page. Each section ends in
**We will**: the checklist the page is built and tested against. Sources are linked inline.
Written 2026-10-22 (owner: "research deeply … get everything tested end to end").

## Shared control rules (apply on every page)

- **Toggle switch vs checkbox** — a toggle is only for a change that takes effect **immediately**;
  if the person must press Apply/Next, use a checkbox. Several related choices = checkboxes.
  ([Microsoft: toggle switches](https://learn.microsoft.com/en-us/windows/apps/design/controls/toggles),
  [NN/g: toggle-switch guidelines](https://www.nngroup.com/articles/toggle-switch-guidelines/))
- Toggle labels say what is **on** when the switch is on, keywords first, no questions; keep
  On/Off as the state words. Don't mix instant toggles with fields that need a Submit button
  in one block. (NN/g, same article)
- **Radio buttons** for 2–8 mutually exclusive, related options where the person should see all
  of them; one-line labels; the current state must be explicit; never two radio groups side
  by side. Keyboard: arrows move and select. ([Microsoft: radio buttons](https://learn.microsoft.com/en-us/windows/apps/design/controls/radio-button))
- Consistency: the same kind of setting uses the same control everywhere in the app (NN/g).
- Our own rules: `docs/DESIGN.md` (tokens, one primary button per view, plain words) and
  `docs/ERROR-STANDARDS.md` (what happened / what to do / money + network state).

## Split tunnelling

### What others do (Windows)
| App | Modes | Choosing apps | Addresses | Applying | Kill switch |
|---|---|---|---|---|---|
| Mullvad | exclude only | list of installed apps, "+" per app, "Find another app" at the bottom; Microsoft Store apps can't be chosen; warns that excluded apps show your real IP | — | instant | excluded apps keep internet even in Lockdown mode |
| Proton VPN | **Exclude** or **Include** | pick from a list, or **Add** → browse to an .exe; untick to disable without removing, trash icon to remove | IPv4/IPv6 + CIDR list | **Apply** when disconnected, **Reconnect** when connected | works with Standard and Advanced kill switch on Windows |
| ExpressVPN | "only selected apps use the VPN" / "do not allow selected apps" | "+" then tick apps | — | confirm | — |
| NordVPN | "Disable VPN for selected apps" / "Enable VPN for selected apps only" (labels vary by version) | add from a list | — | — | separate **App Kill Switch** closes chosen apps when the VPN drops |
| IVPN | split tunnel + firewall exceptions (IP / subnet) | — | exceptions list | — | exceptions bypass the firewall |

Sources: [Mullvad split tunneling](https://mullvad.net/en/help/split-tunneling-with-the-mullvad-app),
[Mullvad app guide](https://mullvad.net/en/help/using-mullvad-vpn-app),
[Proton split tunneling](https://protonvpn.com/support/protonvpn-split-tunneling),
[ExpressVPN split tunneling](https://expressvpn.com/support/knowledge-hub/split-tunneling-desktop),
[CyberInsider (NordVPN labels)](https://cyberinsider.com/vpn/best/split-tunneling-vpn/),
[NordVPN kill switch](https://support.nordvpn.com/hc/en-us/articles/19509682644369-NordVPN-Kill-Switch-how-does-it-work),
[IVPN firewall exceptions](https://ivpn.net/knowledgebase/general/firewall-exceptions).

### What our engine can do (2026-10-22)
- Xray 26.3.27 (bundled): routing rule `process` matches the program that opened a connection,
  Windows + Linux ([Xray routing](https://xtls.github.io/en/config/routing.html)); binary has a
  TUN inbound (`proxy/tun`). → true per-app include/exclude once dvpnd adds a TUN inbound.
- V2Ray 5.53: TUN (`app/tun`) but no per-app rule. Hysteria2: TUN (sing-tun), no per-app rule.
- WireGuard / AmneziaWG / OpenVPN: no per-app support. dvpnd work is owned by session
  `devnet-dvpn-live-test-loop`; contract in `docs/SPLIT-TUNNEL-CONTRACT.md`.
- Today (all builds): V2Ray/Xray expose a local SOCKS proxy; apps that follow the Windows proxy
  use the VPN, others don't.

### We will
1. Mode as a **radio group** of three: Every app uses the VPN · Only chosen apps · Every app
   except chosen. A mode the current/selected protocol can't do is disabled **with the reason**.
2. App list = installed apps (Start Menu) + running apps, real icons, search, count; **checkboxes**
   (changes need Apply — Microsoft rule), "Browse for an app…" (.exe) at the end; Store apps shown
   as "can't be chosen".
3. Running apps that are ticked/unticked get "Running — restart it to apply".
4. Addresses and websites list (IPv4/IPv6/CIDR/domain), validated, untick vs remove.
5. Apply bar: **Apply** (disconnected) / **Apply and reconnect** (connected); says the service
   restarts; one UAC prompt.
6. Warning copy on exclusion: "Apps you leave out use your normal connection and show your real
   IP address" (Mullvad).
7. Kill switch interaction stated on the page (what happens to left-out apps when the VPN drops).
8. Live picture: two lanes (VPN → node flag + protocol logo / Normal connection → provider), each
   app's icon in the lane it is really using, measured, not assumed; reduced-motion fallback.
9. Per-protocol support table with each protocol's logo.
10. Every control reachable from the CLI (`split …`), same words.

## Kill switch

### What others do (Windows)
| App | Modes | Default | Blocked-state UI | LAN | With split tunnelling |
|---|---|---|---|---|---|
| Proton VPN | toggle + **Standard** (blocks only on an unexpected drop) / **Advanced** (internet only while connected, survives restart) | off; Standard when turned on | "Enable kill switch?" confirm modal | — | both modes work with split tunnelling on Windows |
| Mullvad | **Kill switch** always on (greyed toggle) + **Lockdown mode** (also blocks after Disconnect/Quit) | kill switch on, lockdown off | tray icon red dot, "BLOCKING INTERNET" on the connect screen, in-app notice | "Local network sharing" toggle | excluded apps keep internet in lockdown |
| NordVPN | **Internet Kill Switch** (two modes: only on an unexpected drop / also when you disconnect) + **App Kill Switch** (closes chosen apps on a drop) | off | confirm warning when enabling | — | — |
| ExpressVPN | **Network Lock**, "Allow access to devices on local network" | on; LAN allowed on | — | LAN checkbox, default on | — |
| IVPN | firewall **on-demand** or **always-on** (even before boot), LAN option, IP/subnet exceptions; WFP, independent of the client | — | — | allow LAN | exceptions |

Sources: [Proton kill switch](https://protonvpn.com/support/what-is-kill-switch),
[Mullvad app guide](https://mullvad.net/en/help/using-mullvad-vpn-app),
[NordVPN kill switch](https://support.nordvpn.com/hc/en-us/articles/19509682644369-NordVPN-Kill-Switch-how-does-it-work),
[ExpressVPN Network Lock](https://ExpressVPN.com/features/network-lock),
[IVPN kill switch / firewall](https://ivpn.net/knowledgebase/general/do-you-offer-a-kill-switch-or-vpn-firewall).

### Ours (dvpnd): `off` / `on` / `persist` + `allow_lan`; set by staged config + UAC + service
restart (not instant → radio + Apply, no toggle). Support per protocol from
`killSwitchBlocksProtocol` (core/session/state.ts).

### We will
1. Mode as a radio group of three cards — **Off** · **On** (blocks only when the VPN drops, like
   Proton Standard / Nord default) · **Always** (blocks whenever not connected, survives restarts,
   like Proton Advanced / Mullvad Lockdown) — each with its consequence in one line; Always asks
   for confirmation (Proton/Nord confirm on enable).
2. Live state picture: three steps (Connected → VPN drops → result) with the path the traffic
   takes for the chosen mode, the current step highlighted from live state; a clear
   **"Blocking internet"** state (Mullvad) with Restore network next to it.
3. "Allow local network" checkbox showing the LAN range it lets through (ExpressVPN/Mullvad).
4. Split-tunnelling interaction stated (which apps are let through when blocked).
5. Per-protocol support table with logos; protocols that can't do it say so before paying.
6. Restore network always reachable; CLI equivalents listed.
7. A kill-switch check: read-only on a real machine (filters present? DNS?), drop test only on a
   test VM (never on the owner's laptop — tier 3 paused).

**Status (2026-10-22):** 1–6 built (ed68b0f) and proven on a Windows VM through the page: mode On,
xray killed → 8/8 samples blocked, 0 leaked, page shows **Blocking internet** + Restore network
(19d2646 fixed the page saying "Nothing is blocked" after an unexpected end); Always (persist) proven the same way on ui-win-1. 7: read-only **Check it** card on the page (service rows kill_switch / kill_switch_backend / privileges = CLI `daemon doctor`); the drop test stays VM-only (`vm-split-ui.ps1 -Case ks`).

## Every other page

Same loop per page: what the leading Windows VPN and wallet apps do → gaps found on our page
(VM screenshots 2026-10-22) → what we built. Sources at the end of this section.

### Connect (Home)
- **Others:** Proton's home card = status, server, IP, protocol, load, data, one big connect
  button; recents and profiles under it. Mullvad: one coloured status line ("SECURE
  CONNECTION" / "BLOCKING INTERNET"), location, connect/switch. Bitmask/Tor: status must never
  claim more than is measured.
- **Gaps:** "Refunds 110 ready" counted settled deposits worth 0 while Wallet said 0.
- **Built:** status orb + "Protected" only from the measured exit IP (coverage); chips for what
  sites see / your own IP / protocol logo / DNS / country; in split-include the chip says where
  chosen apps exit. Refund stat → **Coming back** = the amount, with the deposit count as a hint.

### Servers
- **Others:** Proton: country list with search, feature icons per country (Secure Core, P2P,
  Tor), filter tabs, load. Mullvad: filter by provider/ownership, location tree. NordVPN:
  specialty-server categories.
- **Gaps:** country rows did not say which protocols they offer; "Re-sort" unexplained.
- **Built:** protocol logos on every country row and server row; filters (protocol, pricing,
  online, favourites, recent); row order frozen while probes land, "Re-sort" explains that.

### Plans
- **Others:** subscription UIs show one primary action per screen; price, period and what you
  get before the confirm (wallet confirm-summary pattern).
- **Gaps:** a gradient primary "Subscribe" on every card broke DESIGN's one-primary rule.
- **Built:** card buttons are secondary; the confirm modal carries the primary and the summary.

### Activity
- **Others:** wallet/activity lists put money that needs attention first and fold noise; Proton
  connection details show data and duration per session.
- **Gaps:** hundreds of "0 tDVPN" deposits buried the few that return money.
- **Built:** "Coming back" total; deposits with money or a Top up first; fully used deposits
  folded into one line; protocol logos on deposits, history and service sessions.

### Wallet
- **Others:** crypto wallet UX: one balance, plain names, confirm summary before signing,
  receive with QR + copy, warnings in plain words.
- **Built:** "Ready to withdraw" (was "Refundable", which clashed with Activity's numbers);
  confirm modals name network and amount.

### Settings
- **Others:** Proton groups settings by topic with a "Restore default settings"; DNS choices
  say what they do; unreachable custom DNS is flagged by several clients.
- **Built:** DNS picker checks the chosen servers live (`dns:probe` = CLI `daemon dns-check`)
  and warns before Apply when none answers; kill switch and split live on their own pages.
- **Open:** restore-defaults action.

### Diagnostics
- **Others:** NordVPN/Proton: a diagnostics report the user can copy and send; checks named in
  plain words.
- **Gaps:** raw check names ("clock skew").
- **Built:** every service check named in sentence case, unknown future names sentence-cased;
  stable `data-check` hooks; copyable redacted log.

### Node test, CLI, Onboarding
- **Onboarding:** progressive disclosure, fewest steps (Pendo, elementary OS): one choice per
  screen, defaults pre-picked, the network named on every money step.
- **Node test / CLI:** our own; same rules (plain words, one primary, logos where a protocol is
  shown, every button = a CLI command, docs/UI-CONTROLS.md).

Sources: [Proton VPN Windows app](https://protonvpn.com/support/protonvpn-windows-vpn-application),
[Mullvad provider filter](https://mullvad.net/en/blog/use-filtering-show-your-preferred-hosting-providers),
[NordVPN diagnostics](https://support.nordvpn.com/hc/en-us/articles/19920718445457),
[Tor UX: honest status](https://gitlab.torproject.org/tpo/ux/design/-/issues/170),
[Bitmask status](https://0xacab.org/leap/bitmask-vpn/-/issues/513),
[wallet UX](https://coinbound.io/how-the-best-crypto-design-agencies-handle-wallet-ux/),
[progressive onboarding](https://www.pendo.io/pendo-blog/onboarding-progressive-disclosure/),
[elementary OS onboarding](https://blog.elementary.io/get-settled-into-elementary-os-with-onboarding/).

## Linux (#32) — what Linux VPN apps do, and our gaps

Researched 2026-10-22 for the Linux build (owner standard S1). The Windows sections above still
set the page shapes; this section records where Linux differs.

| App (Linux) | Split tunnelling | Kill switch |
|---|---|---|
| Mullvad | **exclude by process**: `mullvad-exclude <program>` starts an app outside the VPN; `mullvad split-tunnel add <pid>` excludes a running one (Linux works by PID, not by app). IP/port exclusion only by hand-written nftables rules. | kill switch always on; **Lockdown mode** blocks everything until connected (`mullvad lockdown-mode set on`) |
| Proton VPN (GTK app) | **exclude apps** since 4.11.0 (Sept 2025); Ubuntu by default, Debian needs kernel headers + systemd-resolved | **Advanced kill switch** since 4.2.0: locked down unless connected; can be turned off from the login screen |

Sources: [Mullvad CLI](https://mullvad.net/help/how-use-mullvad-cli/),
[Mullvad split tunneling with Linux (advanced)](https://mullvad.net/sv/help/split-tunneling-with-linux-advanced),
[Proton VPN Linux release notes](https://protonvpn.com/support/release-notes-linux).

### Ours on Linux (dvpnd `cf4c372-ddv16.5`)
- Split by **address range** on WireGuard, AmneziaWG, OpenVPN (IPv4 routes) and Hysteria2,
  include and exclude: more than Mullvad offers in its app (its IP exclusion is manual nftables).
- Split by **app**: refused by dvpnd on Linux. The page hides the app picker and says so; the
  Windows app has it. **Gap vs Mullvad/Proton** (both exclude apps on Linux): needs a dvpnd
  feature (cgroup v2 + nftables `socket cgroupv2` mark, or Xray's `process` rule on a TUN inbound).
  Tracked in `docs/UPSTREAM-GAPS.md`; not something the app can fake.
- V2Ray/Xray: proxy only (GNOME/KDE system proxy + SOCKS), so no whole-device card and no split.
- Kill switch: Off / On / Always (= Proton "advanced", Mullvad "lockdown") on nftables table
  `inet dvpnd`, LAN ranges allowed when chosen. Split + kill switch on Linux = full tunnel kept,
  and the page says why (Windows lets the left-out traffic through).

### We will (Linux)
1. Same page shapes, logos, Apply bar, live lanes and blocking state as Windows (ported from #31).
2. Copy that never promises an app choice Linux can't do; address-range wording on both pages.
3. Proof through the real app on a VM: `scripts/e2e/linux/split-ui.sh split|ks <protocol>`, real exit IPs.
