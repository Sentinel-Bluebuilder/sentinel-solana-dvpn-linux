# Changelog

## 0.3.0-rc.2 (release `v0.3.0-rc2`, 2026-11-14) - release candidate
- Daemon `dvpnd` final6.14.
- Kill switch: with the kill switch on, the app starts at login (XDG autostart entry) and opens a
  window that says the internet is blocked, with a Restore button.
- Tested on this build: upgrade from 0.1.21 (wallet, device and settings kept, connect and
  disconnect OK); a reboot with the kill switch on and one with it off; a clean install on a fresh
  Ubuntu 24.04 x64 machine, then key-file wallet, device setup, service install, WireGuard
  connect, disconnect and settle, all from the CLI over SSH.
- Install note: on a fresh machine run `sudo apt-get update` before `apt install` (see README).
- Packages: .deb, .rpm, Arch `.pkg.tar.zst` and AppImage, x86_64 and arm64, with `SHA256SUMS`.
  File names use `0.3.0-rc.2`, for example `devnet-dvpn_0.3.0-rc.2_amd64.deb`.

## 0.1.21 (2026-11-09) - final release
- Daemon repinned to fork cut `fork-cb33-4-final6.5` (`90014b2`): a tunnel that receives nothing is reported within 2 s, and long soaks show no false "Reconnecting" (Q0445, Q0480).
- Tested on this build: smoke on Ubuntu 22 x64, Ubuntu 24 arm64 and Fedora 44; 90 s network cut with and without the kill switch; one 30-minute WireGuard soak.
- Packages: .deb, .rpm, Arch `.pkg.tar.zst` and AppImage, x86_64 and arm64, with `SHA256SUMS`.

## 0.1.20 RC2 (2026-11-09)
- Same app build as RC1 (0.1.20), re-verified against daemon cut `fork-cb33-4-final6.1` (`02b22fc`).
- Includes the stored-RPC-endpoint fix.
- Packages: .deb, .rpm, Arch `.pkg.tar.zst` and AppImage, x86_64 and arm64, with `SHA256SUMS`.

## 0.1.20 RC1 (2026-11-08)
- First release candidate on Sentinel Solana devnet: deb, rpm, Arch and AppImage packages, x86_64 and arm64.
- Tested on Ubuntu, Debian, Fedora and Rocky (see the testing-tools repo).
