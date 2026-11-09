# Linux port — what changed from the Windows app (#31)

Everything not listed here is the same code as #31 (`src/core`, the services in `src/main/services`,
the renderer, the CLI catalogue). Proof that each piece works is in `docs/LINUX-PARITY.md`.

| Windows (#31) | Linux (#32) | Files |
|---|---|---|
| Named pipe `\\.\pipe\dvpnd-client` + `pipe-bridge.exe` (dvpnd's pipe ACE was too narrow) | dvpnd's unix socket `/var/lib/dvpnd/client/daemon.sock`, dialled directly (`unix:` target). Mode 0660 group `dvpn` + a read/write ACL for the user who ran setup (a new group membership needs a fresh login; the ACL works at once). 15 s health re-probe. | `core/daemon/client.ts`, `main/daemon/manager.ts` |
| Windows service `dvpnd` (sc.exe), home `C:\ProgramData\dvpnd\client` | systemd `dvpnd-client.service`, home `/var/lib/dvpnd/client` (root:dvpn 0750, keys root 0700). Binaries copied to root-owned `/usr/local/lib/devnet-dvpn` (root cannot read an AppImage FUSE mount; the package dir is replaced on upgrade). | `resources/scripts/setup-daemon.sh` |
| `dvpnd init` (role client by default) | `dvpnd init --role client` (Linux default = node), WITHOUT `--socket-group` (init chowns the home to it → EPERM for a non-member). Setup writes `socket_group` and `device.pub` (the address, world-readable). | `main/daemon/manager.ts` |
| UAC + `.ps1` scripts via `Start-Process -Verb RunAs` | ONE root entry point `resources/scripts/dvpn-helper` with a fixed step list; `pkexec` (polkit action `network.sentinel.devnet-dvpn.helper`) on a desktop, `sudo -n` over SSH, direct as root. Validated path/token args only; JSON result file in a user-made temp folder. | `main/system/elevate.ts`, `resources/scripts/*.sh`, `build/linux/after-install.sh` |
| Daemon settings: stage TOML → UAC copy → service restart | same flow, `apply-daemon-config.sh` (backup, copy keeping mode/ACL, restart, roll back on failure) | `main/daemon/settings.ts` |
| DNS backend `netsh` | `resolvectl` (default) / `resolvconf` / `none`; leftover check reads `resolvectl dns` + `/etc/resolv.conf` (stub 127.0.0.53 ignored); flush = `resolvectl flush-caches` | `core/daemon/config.ts`, `main/system/dns-check.ts` |
| Kill switch: Windows Firewall rules | dvpnd's nftables table `inet dvpnd`; Restore network never runs `nft flush ruleset` | `resources/scripts/remove-tunnels.sh` |
| Leftovers: `sc query`, `tasklist`, Wintun adapters | `ip -o link` (`dvpn-wg-client`, `dvpn-awg-client`, `hy2-client`, `tunN`), `/proc` for orphan v2ray/xray/hysteria2/openvpn from our dirs only, policy table 51820 removed only when no other WireGuard link exists | `main/system/tunnels.ts`, `remove-tunnels.sh` |
| Drivers: WireGuard / AmneziaWG MSI, OpenVPN MSI, Wintun | apt: `wireguard-tools`, `openvpn`, `nftables`; AmneziaWG from `ppa:amnezia/ppa` (DKMS module, judged for the RUNNING kernel); report `/var/lib/devnet-dvpn/install-deps.json` | `main/system/drivers.ts`, `install-deps.sh` |
| System proxy: WinINET registry + `InternetSetOption` | GNOME `gsettings org.gnome.system.proxy*` (restored verbatim, `mode` last), KDE `kioslaverc` via kwriteconfig5/6. Backup before change, restore only if still ours, SOCKS must answer first. | `main/system/proxy.ts` |
| Browser window: Edge/Chrome from Program Files | `google-chrome`, `chromium`, `microsoft-edge` from PATH; same flags (own profile, `--proxy-server=socks5://…`) | `main/system/browser.ts` |
| CLI wallet: DPAPI file | libsecret (`secret-tool`, attrs `application devnet-dvpn kind cli-wallet data-dir <dir>`), marker `wallet.cli.keyring`; no keyring → "use --keyfile" | `cli/keystore.ts` |
| App wallet: Electron safeStorage (DPAPI) | Electron safeStorage on libsecret/KWallet; **`basic_text` refused** (it is not encryption) | `main/wallet/electron-keystore.ts` |
| Login item (registry Run key) | XDG autostart `~/.config/autostart/devnet-dvpn.desktop` with `--hidden` | `main/system/autostart.ts` |
| "Open in PowerShell" | "Open in terminal": gnome-terminal / konsole / xfce4-terminal / x-terminal-emulator / xterm with an rc file that binds `devnet-dvpn` to this app | `main/services/cli-exec.ts` |
| Data folder `%APPDATA%\Devnet dVPN` | `$XDG_CONFIG_HOME/Devnet dVPN` (`~/.config/Devnet dVPN`) | `main/runtime.ts` |
| NSIS installer, `devnet-dvpn.cmd` | `.deb` (primary: depends wireguard-tools, openvpn, nftables, iproute2, acl, pkexec, libsecret-tools) + AppImage; `/usr/bin/devnet-dvpn` → `/opt/Devnet dVPN/bin/devnet-dvpn`; prerm stops/removes the service, unit, group-free cleanup | `electron-builder.yml`, `build/linux/*`, `build/cli/devnet-dvpn` |
| Deps lock: Windows builds | Linux builds of the same versions (Hysteria2 2.13.0, V2Ray 5.53.0, Xray 26.3.27), SHA-256 checked against each publisher's digest; dvpnd = the LF Linux build `cf4c372-ddvN` (#31's dvpnd plus #32's numbered patches; the exact build and sha are pinned in `build/deps.lock.json`, never restated here) | `build/deps.lock.json`, `scripts/fetch-deps.mjs` |
| Tests: `.ps1` VM scripts, WSL rig | `scripts/e2e/linux/` on GCP VM `ddv-linux-1`: `cli-sweep.sh` (local / daemon / spend / cover), `ui-smoke.sh` (Xvfb, dark + light), `sync.sh`, `vm-startup.sh` (deadman timer) | `scripts/e2e/linux/*` |

Removed (Windows only, nothing replaces them): `tools/pipe-bridge/`, `build/installer.nsh`,
`resources/scripts/*.ps1`, the Wintun/OpenVPN-adapter recreate path (`recreateOpenvpnAdapter`
is a no-op on Linux), `scripts/release-win.mjs`.
