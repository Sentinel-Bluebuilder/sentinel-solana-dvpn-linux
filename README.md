# Sentinel dVPN for Linux (Solana devnet)

A pure peer-to-peer dVPN app on the Sentinel Solana devnet protocol. Pick any server and pay it
directly, or subscribe to any plan. No accounts, no servers in the middle. Electron + React +
TypeScript; sessions run through the `dvpnd` daemon; the app signs owner transactions itself.
Every app function is also a command (`devnet-dvpn …`).

## Download

Latest release: [**Releases**](https://github.com/Sentinel-Bluebuilder/sentinel-solana-dvpn-linux/releases/latest)

| Distro family | x86_64 | arm64 |
|---|---|---|
| Debian / Ubuntu | `devnet-dvpn_<ver>_amd64.deb` | `devnet-dvpn_<ver>_arm64.deb` |
| Fedora / Rocky / RHEL | `devnet-dvpn-<ver>.x86_64.rpm` | `devnet-dvpn-<ver>.aarch64.rpm` |
| Arch | `devnet-dvpn-<ver>-x64.pkg.tar.zst` | `devnet-dvpn-<ver>-aarch64.pkg.tar.zst` |
| Any (AppImage) | `Devnet-dVPN-<ver>-x86_64.AppImage` | `Devnet-dVPN-<ver>-arm64.AppImage` |

> **Devnet only, unsigned builds.** This app uses Sentinel's Solana **devnet**: tokens have no value.
> Packages are not code-signed; verify them with `SHA256SUMS` (below).

## Verify

```bash
# put SHA256SUMS and the file(s) you downloaded in one folder
sha256sum -c --ignore-missing SHA256SUMS
```

## Install

```bash
sudo apt install ./devnet-dvpn_<ver>_amd64.deb      # Debian / Ubuntu
sudo dnf install ./devnet-dvpn-<ver>.x86_64.rpm     # Fedora / Rocky / RHEL
sudo pacman -U devnet-dvpn-<ver>-x64.pkg.tar.zst    # Arch
devnet-dvpn help
```

AppImage: see [`docs/INSTALLER.md`](docs/INSTALLER.md) (Ubuntu 24.04 needs `libfuse2t64` and `--no-sandbox`).

## Build from source

```bash
npm ci
npm run typecheck
npm test
npm run release:linux     # on Linux: .deb + AppImage + SHA256SUMS
```

## Test results and known issues

Method, per-OS results and the full bug catalogue live in
[sentinel-solana-dvpn-testing-tools](https://github.com/Sentinel-Bluebuilder/sentinel-solana-dvpn-testing-tools),
including [`docs/known-issues-rc1.md`](https://github.com/Sentinel-Bluebuilder/sentinel-solana-dvpn-testing-tools/blob/main/docs/known-issues-rc1.md).

## Docs

| doc | what it is |
|---|---|
| [`docs/INSTALLER.md`](docs/INSTALLER.md) | .deb, .rpm, Arch, AppImage, hooks |
| [`docs/CLI.md`](docs/CLI.md) | every command |
| [`docs/LINUX-PORT.md`](docs/LINUX-PORT.md) | each Windows piece and what replaced it on Linux |
| [`docs/LINUX-PARITY.md`](docs/LINUX-PARITY.md) | feature parity checklist |
| [`CHANGELOG.md`](CHANGELOG.md) | release history |

## License

Built on Sentinel. <https://sentinel.co>

Released under the Sentinel dVPN License ([`LICENSE`](LICENSE)). Bundled programs and libraries
(Hysteria 2, V2Ray, Xray, fonts under OFL-1.1, rpc-websockets under LGPL-3.0) are listed with their
licenses and sources in `THIRD-PARTY-NOTICES.txt`, which every package installs.
