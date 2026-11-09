# Linux packages — Devnet dVPN

Two packages from one build (`npm run release:linux`, on Linux): the **.deb** is primary
(Debian / Ubuntu, fully sandboxed, polkit, CLI on PATH); the **AppImage** is portable.
The Windows installer this replaces is described in #31 (an internal document (not published)).

## What the user gets

| | .deb | AppImage |
|---|---|---|
| App | `/opt/devnet-dvpn/` (menu entry "Devnet dVPN") | runs from the file |
| CLI | `/usr/bin/devnet-dvpn` | `devnet-dvpn` via the app's CLI screen → "Open in terminal" |
| Root helper | polkit action `network.sentinel.devnet-dvpn.helper` → `resources/scripts/dvpn-helper` | same helper, copied out of the mount before root runs it |
| VPN drivers | `Depends:` wireguard-tools, openvpn, nftables, iproute2, acl, pkexec, libsecret-tools; AmneziaWG via Diagnostics → Repair (amnezia PPA) | Diagnostics → Repair installs all of them |
| Service | first run: device setup, then ONE admin prompt writes `dvpnd-client.service` | same |

The VPN service (`dvpnd`, client role, root) is installed by the app's first run, not by the
package: dvpnd will not start until its device key holds an on-chain permission, which needs
the user's wallet (`docs/LINUX-PORT.md`).

## Install

```bash
sudo apt install ./devnet-dvpn_0.1.0_amd64.deb      # pulls the drivers it depends on
devnet-dvpn version                                  # CLI on PATH
```

**Same version again (repair, or a rebuilt package with the same version number):** use
`sudo apt-get install --reinstall ./devnet-dvpn_0.1.0_amd64.deb`. Without `--reinstall`, apt sees
version 0.1.0 already installed and keeps the old files, so a fixed build would never land. The
reinstall keeps the device home (`/var/lib/dvpnd`) and the wallet; the service restarts on the new
`dvpnd`. Every live test run installs this way.

AppImage on **Ubuntu 24.04+**: install `libfuse2t64` first (24.04 ships only FUSE 3; every
type-2 AppImage needs FUSE 2). Then run it with `--no-sandbox`: 24.04 blocks unprivileged user
namespaces through AppArmor, and Chromium's SUID fallback cannot be setuid inside a FUSE mount,
so Chromium aborts before any app code runs. This holds for every Electron AppImage; the .deb
avoids it with an AppArmor profile. Proven on `ddv-linux-1` (below). Since 0.1.10 the AppImage
says so itself: when `kernel.apparmor_restrict_unprivileged_userns = 1` and this user cannot map
root in a new user namespace, AppRun prints the exact `--no-sandbox` command (and shows it in a
zenity/kdialog dialog when started from a desktop), then starts the app as asked. It never turns
the sandbox off by itself (`build/linux/apprun-sandbox-hint_lib.sh`, added by `scripts/appimage-apprun.mjs`).

## .rpm — Fedora and EL9 (Rocky / Alma / RHEL)

```bash
sudo dnf install ./devnet-dvpn-0.1.0.x86_64.rpm   # package name devnet-dvpn-linux
devnet-dvpn daemon repair-drivers --yes            # openvpn (EPEL on EL9) + AmneziaWG
```

Built natively on Rocky 9 (`release-linux.mjs --targets rpm,AppImage`). What differs from the .deb:

| | Fedora 44 | EL9 (Rocky 9.8) |
|---|---|---|
| `Requires:` | wireguard-tools, nftables, iproute, acl, polkit, libsecret + Electron libs | same |
| openvpn | `Recommends:` (in Fedora) | EPEL only: repair-drivers installs `epel-release` and enables it (also when installed but switched off) |
| AmneziaWG | pinned source build (tools + DKMS module), like Debian | same. **Not** the amnezia Copr: its EPEL 9 `amneziawg-tools 1.0.20240201` refuses current node configs (`Line unrecognized: S3=1`). An awg whose `--version` does not say `amneziawg-tools` counts as missing, so repair replaces it |
| DKMS | `dkms` wants `kernel-devel-matched`; setup installs the one for the **running** kernel (`kernel-devel-matched-$(uname -r)`, no weak deps), so no newer kernel is added (was: dnf picked the newest and installed a new kernel, Rocky + Fedora). A warning goes to the install log if the kernel set still changes | `kernel-devel-$(uname -r)` + EPEL `dkms` |
| DNS | systemd-resolved runs → `resolvectl` mode | no systemd-resolved: setup writes `dns_backend = 'resolvconf'` (dvpnd writes `/etc/resolv.conf` for the session and puts NetworkManager's file back) |
| SELinux (enforcing) | setup labels `/usr/local/lib/devnet-dvpn` `bin_t` (`semanage fcontext`, `chcon` fallback; the upgrade hook relabels; uninstall drops the rule) so dvpnd runs as `unconfined_service_t`, and `restorecon`s `/var/lib/dvpnd` (the copied staging home kept `user_home_t` and the service was refused its own lock file) | same |
| systemd | 259: `RestartSteps` backoff | 252 ignores `RestartSteps`: setup writes `RestartSec=20` (not a 3 s storm) |
| Host firewall | firewalld default zone `public` rejects Hysteria2's TCP (new inbound on its TUN) → setup binds `dvpn-hy2-client` to zone `trusted`, uninstall removes it | GCE's Rocky image defaults to `trusted`; the same binding is made |
| systemd-resolved package | already installed and running | EL9's `wireguard-tools` **requires** `systemd-resolved`, so it gets installed but stays switched off; setup still picks `resolvconf`, and a purge removes it again |
| Uninstall keeps | the AmneziaWG DKMS build and `dkms.service` (drivers a user may use) | the same, plus OpenVPN and the EPEL repo files (OpenVPN is EPEL-only, not a package dependency) |
| AppImage | needs FUSE 2: `sudo dnf install fuse fuse-libs` (`fusermount` is in `fuse`; without it: "fuse: failed to exec fusermount"). First run shows the licence (zenity/kdialog, when installed) and starts after **Agree** (recorded in `~/.config/devnet-dvpn-desktop/eulaAccepted`) | same |

rpm details: scriptlets read rpm's count argument (`0` = removal, `1+` = upgrade) next to dpkg's
words. `_build_id_links none` because one bundled binary shares a build id with python3 (dnf
refused the install as a file conflict). No `%dir` ownership from fpm, so the postrm deletes the
empty folders it leaves under `/opt/devnet-dvpn`. "Is the unit installed" is asked with
`systemctl show -p LoadState`: on systemd 259 `systemctl cat` with its output thrown away exits
141, and the uninstaller once left the service enabled and running that way.

## 64-bit ARM (arm64 / aarch64) — Debian 12, Ubuntu 24.04, Raspberry Pi OS 64-bit

```bash
sudo apt install ./devnet-dvpn_0.1.0_arm64.deb        # same package, same steps as amd64
sudo dnf install ./devnet-dvpn-0.1.0.aarch64.rpm      # Fedora / EL9 on ARM
```

Same app, same CLI, same six protocols; only the bundled binaries differ. Files:
`devnet-dvpn_0.1.0_arm64.deb`, `devnet-dvpn-0.1.0.aarch64.rpm`, `Devnet-dVPN-0.1.0-arm64.AppImage`
(x64 names are unchanged). 32-bit ARM (armhf, Pi OS 32-bit) is refused at build time: dvpnd and
the protocol binaries are 64-bit only.

| | arm64 |
|---|---|
| Build | natively on an arm64 machine: `node scripts/release-linux.mjs --arch arm64` (one arch per run; `resources/bin` holds one arch). The .rpm needs `USE_SYSTEM_FPM=true` + the `fpm` gem: electron-builder's bundled fpm is x86_64 only |
| Bundled binaries | `build/deps.lock.json` pins every dep per arch (hysteria / v2ray / Xray arm64 builds checked against each publisher's digest file); `fetch-deps.mjs` also refuses any executable whose ELF machine is not AArch64 (`0xb7`). dvpnd = the same tree and flags built with `GOARCH=arm64` |
| AppImage runtime | electron-builder 25's arm64 runtime links the unversioned `libz.so` (a `-dev` package only), so the AppImage exited 127 at once on stock Debian 12 and Ubuntu 24.04. The release script swaps in the official static type2 runtime (tag `20251108`, SHA-256 pinned in `deps.lock.json` `appimageRuntime`); x64 keeps electron-builder's runtime |
| `proxy browser` | Google Chrome has no Linux arm64 build: use `--browser chromium` (Debian `chromium`; Ubuntu ships it as a snap). A snap browser cannot write hidden folders in the home directory, so its own profile lives in `~/snap/<name>/common/devnet-dvpn-browser` (in `~/.config` snap Chromium exited 21 at once, "SingletonLock: Permission denied", 08f7ea13). A browser that closes with an error within 3 s is reported, not "Opened" |
| AppArmor | as amd64: the profile is installed only where userns is restricted (Ubuntu 24.04+); Debian 12 runs AppArmor 3 with userns open |
| systemd | Debian 12 has 252: setup writes `RestartSec=20` (as EL9) |
| No GPU (cloud VMs, many SBCs, xvfb) | since 0.1.11 the app turns hardware acceleration off when `/dev/dri` has no `renderD*` node. Before, Chromium's GPU-process fallback could run out and the app quit at start with "Trace/breakpoint trap" (`GPU process isn't usable. Goodbye.`, exit 133; 1-3 starts in 10 on Debian 12 arm64 with the sandbox on, Q0246). `DVPN_GPU=on` keeps Chromium's default. All Linux arches, not only arm64 |
| Raspberry Pi | Pi OS 64-bit (Bookworm) is Debian 12 arm64, the platform proven on `ddv-plat-arm-deb12`. **Real Pi hardware is not yet tested**: the Pi kernel's WireGuard/nftables are expected to match, and AmneziaWG falls back to the pinned source build (needs `raspberrypi-kernel-headers` / `linux-headers-rpi-*`) |

## Arch Linux (x86_64, rolling) — `.pkg.tar.zst`

```bash
sudo pacman -U ./devnet-dvpn-0.1.0-x64.pkg.tar.zst
```

Same app, same CLI, same six protocols. Proven on `ddv-plat-arch` (GCE Arch image brought to
current rolling Arch: `[community]` and the dead `[gce]` repo dropped, keyring first, full `-Su`).

| | Arch |
|---|---|
| Build | natively on Arch: `node scripts/release-linux.mjs --arch x64 --targets pacman,AppImage` (pacman is not in the default target list; needs `bsdtar`). Build deps besides node/npm/git: `python-setuptools` (electron-builder's old node-gyp imports `distutils`, gone in Python 3.12+) and `libxcrypt-compat` (its bundled fpm's ruby links `libcrypt.so.1`) |
| Scriptlets | fpm inlines them into `.INSTALL`; pacman runs `post_upgrade`, not `post_install`, on an upgrade, so the install script is wired to both; the remove scriptlets read pacman's old-version argument (`pre_remove`/`post_remove` run only on a removal) |
| Drivers | `install-deps.sh` pacman path: `wireguard-tools openvpn nftables` from the official repos; AmneziaWG = the pinned source build with `base-devel dkms` + the headers package of the RUNNING kernel (`pacman -Qoq /usr/lib/modules/$(uname -r)/vmlinuz` → `<kernel>-headers`) |
| DNS | no systemd-resolved and `dhclient@<nic>` owns `/etc/resolv.conf`: setup writes `dns_backend = 'resolvconf'`. dvpnd (0015, ddv16.12+) re-asserts the session DNS within 1 s when a DHCP renewal rewrites the file, and on disconnect puts back the writer's NEWEST file, not the one from connect time (suite `dhcp-renew.sh`: 11/0) |
| IPv6 | the GCE image has no IPv6 route: dvpnd 0018 (ddv16.18+) rejects IPv6 while the node is IPv4-only, so dual-stack apps fall back to IPv4 under Hysteria2 instead of hanging on its fake IPv6 |
| polkit | `polkitd` starts on demand; the first passwordless `systemctl start` right after install can race it (the installer test retries once) |

## Dependencies are pinned and verified

`build/deps.lock.json` pins Hysteria2, V2Ray and Xray (Linux builds) by version, URL and
SHA-256, checked against each publisher's own digest file. `scripts/fetch-deps.mjs` refuses a
mismatch, extracts only the listed files (`chmod 755`), copies `dvpnd` from #28's Linux build
(`DVPND_SRC`, sha pinned) and writes `build/THIRD-PARTY-NOTICES.txt` + `build/license.txt`.
System drivers come from the distribution (apt) and the amnezia PPA, so apt verifies them.

## install-deps.sh rules

- Judges the **running** kernel: the AmneziaWG DKMS module must exist for `uname -r`. A kernel
  it cannot build for (7.0 on 2026-10-21, UPSTREAM-GAPS L2) is reported with "boot an older
  one; the other protocols still work".
- Already installed → left alone. `--CheckOnly 1` reports without installing (no root): the
  app's Diagnostics and `devnet-dvpn daemon drivers` use it; **Repair drivers** /
  `daemon repair-drivers --yes` run it as root.
- Report: `/var/lib/devnet-dvpn/install-deps.json`. Exit 0 = ready, 2 = something missing.

## Package hooks (`build/linux/`)

| Hook | Does |
|---|---|
| `after-install.sh` (postinst) | `/usr/bin` links; `chrome-sandbox` root 4755; **AppArmor profile** `/etc/apparmor.d/devnet-dvpn` (`userns`, Ubuntu 24.04+; without it the app dies at launch); polkit action; `dvpn` group; driver report; **upgrade**: refresh `/usr/local/lib/devnet-dvpn/*` from the new package, **rename old dvpnd config keys** (`migrate-daemon-config.sh`), restart backoff drop-in, polkit start rule, then `try-restart` the service |
| `before-remove.sh` (prerm, remove/purge only) | `uninstall-cleanup.sh` while the files still exist: restore each user's GNOME proxy if it is still ours, stop + disable + delete the unit (+ drop-ins), delete `/usr/local/lib/devnet-dvpn` and the polkit rule, remove leftover tunnels / `inet dvpnd` table |
| `after-remove.sh` (postrm) | links, polkit action + rule, AppArmor profile (`apparmor_parser -R`) |

### Upgrading from the dfe36c7 dvpnd (2026-10-21, devnet grants program)

- dvpnd cf4c372 renamed config keys and **ignores the old names** (an old `escrow` would silently
  become a 1000 tDVPN deposit). `resources/scripts/migrate-daemon-config.sh` renames them (same
  table as #31's `.ps1`), keeps a `.pre-migrate` copy, preserves owner/mode/ACLs, and is a no-op
  the second time. It runs on package upgrade and in `setup-daemon.sh` (a kept home on reinstall).
- The service then **refuses to start until the device holds a grant** (preflight). The unit
  backs off 3 s → 5 min (`RestartSteps=8`, `RestartMaxDelaySec=300`) so it does not spend RPC
  calls every 3 s. Device setup (Wallet or `devnet-dvpn device setup --yes`) opens the grant and
  starts the service at once: `/etc/polkit-1/rules.d/50-devnet-dvpn.rules` lets the `dvpn` group
  start/restart `dvpnd-client.service` only; stop, enable, disable and other units still need an
  administrator (proven on `ddv-linux-1`).

Kept on remove on purpose: `/var/lib/dvpnd/client` (the device key holds an on-chain
permission and SOL; a reinstall picks it up) and the distribution's drivers.

**Install folder has no space** (`productName: devnet-dvpn`; the visible name stays
"Devnet dVPN" via `extraMetadata`): Chromium's zygote cannot exec a path with a space
(`FATAL zygote_host_impl_linux.cc:207`, found on `ddv-linux-1`).

## Packaging rule: main and CLI are self-contained bundles

Same as #31: the main process and the CLI bundle every runtime dependency (electron-builder 25
re-nests deduplicated npm packages and drops some).

## CLI shim

`bin/devnet-dvpn` (sh) runs the bundled CLI on the app's own runtime
(`ELECTRON_RUN_AS_NODE=1 devnet-dvpn-desktop resources/app.asar/out/cli/devnet-dvpn.cjs`),
the pattern of VS Code's `code`.

## Build

```bash
npm run release:linux                          # fetch-deps → typecheck → tests → build → CLI → electron-builder → SHA256SUMS
DVPND_SRC=/path/to/dvpnd node scripts/release-linux.mjs --skip-tests
```

Output: `dist/devnet-dvpn_<version>_amd64.deb`, `dist/Devnet-dVPN-<version>-x86_64.AppImage`,
`dist/SHA256SUMS.txt`. Build on Linux (the VM: `bash scripts/e2e/linux/sync.sh`).

## Signing

Unsigned. A signed apt repository (or `dpkg-sig`) and an AppImage signature (`--sign`) are
the options; owner decision pending, as for Windows.

## Proof — `ddv-linux-1` (Ubuntu 24.04, kernel 6.8 gcp-lts, 2026-10-21)

`scripts/e2e/linux/installer-test.sh` with the real packages — **19/19**
(`docs/evidence/linux/sweep/installer.*`, fingerprints `fp-*.txt`):

| phase | result |
|---|---|
| install + first run | `.deb` → `daemon repair-drivers` (AmneziaWG from the PPA) → `daemon init` → `device setup` → `daemon install`: service active, socket `root:dvpn 0660` + user ACL, doctor clean |
| upgrade over a running service (incl. the move `/opt/Devnet dVPN` → `/opt/devnet-dvpn`) | service still active, its `dvpnd` = the packaged one, AppArmor profile loaded, CLI answers |
| remove | unit gone, no `dvpnd`, app files + links + polkit + AppArmor gone, no nft table / tunnel link / rule 51820, direct egress, device key home kept, and with it the `dvpn` system group that owns it (also on `purge`: the home holds the device key with its on-chain permission and SOL, and deleting the group would leave its files with a dangling group id; a reinstall reuses both) |
| reinstall | package installed, `daemon install --yes` reuses the kept home: same device (`device.pub`), service active + enabled, doctor no FAIL |
| AppImage | without libfuse2: clear "AppImages require FUSE"; with sandbox on 24.04: Chromium's SUID abort (documented above), preceded since 0.1.10 by the AppRun `--no-sandbox` hint; `--no-sandbox`: runs and attaches the service |

Bugs this found and fixed: `dvpnd init --socket-group` EPERM for a user outside the group
(gap L1); protocol config folders left 0700 (doctor could not read them); device address
unreadable from the root-only key folder (`device.pub`); the app could not start from
`/opt/Devnet dVPN` (space) nor at all on 24.04 without the AppArmor profile.
