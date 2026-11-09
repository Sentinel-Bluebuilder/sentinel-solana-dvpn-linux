# Network safety — everything that can touch this computer's internet (Linux)

The owner's rule: nothing in this app, its CLI or its tests may leave a computer
without internet. This file lists **every** code path that changes host networking on Linux,
the guard on each, and how it is tested. A new path that is not listed here is a bug.
(The Windows app's list is an internal document (not published).)

## The paths

| # | What changes | Who changes it | When it is undone | Guard | Tested by |
|---|---|---|---|---|---|
| 1 | Tunnel links (`dvpn-wg-client`, `dvpn-awg-client`, `dvpn-hy2-client`, `dvpn-ovp-client`), routes + policy rules, kill switch (nftables table `inet dvpnd` only), DNS (`resolvectl` on the tunnel link, or `resolvconf` mode = dvpnd writes `/etc/resolv.conf` and puts the old file back) | `dvpnd` service only (the app never touches them) | Session stop (Disconnect, quit, Restore network); daemon releases a non-persist kill switch after its reconnect attempts fail | App quits only after `StopSession`; **Restore network** (Connect + Diagnostics + CLI `daemon restore-network`) runs `remove-tunnels.sh`, which removes only our links, our table and our wg-quick rules — **never `nft flush ruleset`, never a user's own tunnel** | `matrix.sh`, `edge.sh` (leaks, killdaemon, nicflap, …), `soak.sh`, `reboot-test.sh` on GCP VMs; `dirty-test.sh` proves a user's own VPN, firewall, proxy and DNS are untouched |
| 2 | Kill-switch **mode** (`off` / `on` / `persist`) and other service settings | User, Settings → VPN service (root step `apply-daemon-config.sh` via `dvpn-helper` + service restart) | User changes it back | Daemon default is `on` (blocks only while a session is up or reconnecting). `persist` copy says plainly it can leave you offline | `validateSettings` unit tests; CLI `daemon set` stops for `--yes`; matrix `ks-on` / `ks-persist` cases on VMs |
| 3 | Desktop system proxy (GNOME `gsettings org.gnome.system.proxy`, KDE `kioslaverc`) | App, only on the user's toggle **and only while a V2Ray/Xray session exposes a loopback SOCKS endpoint** | Session end (any reason), Disconnect, Restore network, app quit, next app start (crash recovery), uninstall (per user, through that user's session bus) | Refuses non-loopback endpoints and no-session; saves the user's own values first (`proxy-backup.json`) and restores them exactly; only undoes values that are still ours | unit tests (save/restore/only-ours); `cli-sweep.sh` proxy rows (GNOME + KDE, byte-for-byte restore); `dirty-test.sh` (a user's own proxy survives) |
| 4 | The `dvpnd-client.service` systemd unit, binaries in `/usr/local/lib/devnet-dvpn`, polkit rule (sudoers drop-in on polkit 0.105) | One root step in first run (`setup-daemon.sh`), after device setup | Package removal: prerm → `uninstall-cleanup.sh`: graceful stop (session ends, kill switch + DNS released), unit + drop-ins + binaries + rule removed | Unit presence is asked with `systemctl show -p LoadState` (on systemd 259 `systemctl cat` with output discarded exits 141 and once left the service running) | `clean-install-test.sh`, `installer-test.sh`, fingerprint diff before/after purge |
| 5 | Host firewall exception for the Hysteria2 interface: firewalld zone `trusted` binding / `ufw allow in on dvpn-hy2-client` | `setup-daemon.sh` (and package upgrade for ufw), only when that firewall is running | Uninstall removes the binding / rule | Hysteria2's TUN hands each TCP connection to a local listener, which the kernel sees as new inbound; the interface carries only traffic Hysteria2 injects | Fedora 44 live (public zone → every TCP connect timed out; trusted → egress = node) |
| 6 | SELinux labels (Fedora/EL): file-context rule `bin_t` for `/usr/local/lib/devnet-dvpn`, `restorecon` of `/var/lib/dvpnd` | `setup-daemon.sh`; the upgrade hook relabels | Uninstall drops the rule | Labels only our own paths | Rocky 9.8 / Fedora 44 runs; `platform-el.sh` (0 AVC denials) |
| 7 | VPN drivers (wireguard-tools, openvpn, nftables, AmneziaWG DKMS module; EPEL on EL9) | Package dependencies + Diagnostics → Repair drivers (`install-deps.sh`, root) | Kept on uninstall (system packages a user may use) | Already-installed packages are left alone; `--CheckOnly` never installs | `clean-install-test.sh` drivers rows, `edge.sh drivers` |
| 8 | Connect on launch | App, opt-in setting | — | Once per start; never when the daemon still holds a session (adopted instead) or a previous run left a Restore-network warning; never in UI smoke runs | code review (`services/auto-connect.ts`) |

Nothing else changes host networking. Check with:
`grep -rnE "nft |ip (route|rule|link)|gsettings|kwriteconfig|firewall-cmd|ufw |resolvectl|resolv\.conf" src resources/scripts`
Commands that CHANGE something appear only in `src/main/system/proxy.ts`, `src/main/system/tunnels.ts`
(runs `remove-tunnels.sh`) and the root scripts named above. The other hits are probes
(`dns-check.ts` reads `resolvectl dns` and may run `resolvectl flush-caches`, which empties
systemd-resolved's cache and changes nothing else; `drivers.ts` runs `install-deps.sh --CheckOnly`) or the DNS mode
name `resolvectl` in settings, CLI help and the Diagnostics labels.

## Test rules
- Full-tunnel and kill-switch tests run **only on GCP test VMs**, never on the owner's laptop.
  Each VM carries a deadman timer (`ddv-deadman.timer`) that restores the network after 3 failed
  checks; `touch /run/ddv-deadman.hold` for a deliberate block of up to 4 minutes.
- While a kill switch is on, the VM drops SSH replies to the laptop too (the `ADMIN_IP` route rule
  only keeps routing off the tunnel). Suites run detached (`queue.sh`) and never depend on the
  laptop's connection.
- Chain tests are sequential: 7 s between transactions, 60 s between suites.

## Kill switch: what the screens promise
- An unexpected session end with the kill switch on leaves the internet blocked by dvpnd. The
  app checks 3 s later (`checkLeftoverBlock`) and every screen then says **Blocking internet**
  with Restore network; it never says "Not connected / nothing blocked" while the block holds.
  Proven on VMs by `split-ui.sh` (kill-process cases) and `edge.sh`.

## Known residual risks
- `persist` kill switch + a daemon that dies uncleanly can leave rules until the next
  service start (daemon re-applies, then releases on stop). The UI warns before `persist`.
- After an NXDOMAIN, glibc retries the name with the NIC's search domains and
  systemd-resolved sends those to the LAN DNS (only names that do not exist; see
  `PROTOCOL-MATRIX.md` → DNS).
- Uninstall restores the system proxy through each user's own session bus; a user who is not
  logged in at uninstall gets it restored on their next app start.
- Link-local and the LAN gateway stay on the NIC during a full tunnel (dvpnd patch 0014). Before
  it, a GCE test VM's metadata traffic went through the node and the VM was renamed after it.
