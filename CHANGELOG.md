# Changelog

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
