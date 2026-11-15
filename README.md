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

`<ver>` is the package version, written with a dot before the RC number: release `v0.3.0-rc2`
ships `devnet-dvpn_0.3.0-rc.2_amd64.deb`, `devnet-dvpn-0.3.0-rc.2.x86_64.rpm` and so on. Copy
the exact file name from the release page.

```bash
# Debian / Ubuntu. On a fresh machine run `apt-get update` first: a new cloud image has no
# package lists yet, and the install stops at "libsecret-tools ... is not installable" (exit 100).
sudo apt-get update
sudo apt install ./devnet-dvpn_<ver>_amd64.deb         # arm64: devnet-dvpn_<ver>_arm64.deb

sudo dnf install ./devnet-dvpn-<ver>.x86_64.rpm        # Fedora / Rocky / RHEL; arm64: .aarch64.rpm
sudo pacman -U ./devnet-dvpn-<ver>-x64.pkg.tar.zst     # Arch; arm64: -aarch64.pkg.tar.zst

devnet-dvpn help
```

On Rocky / RHEL 9, OpenVPN comes from EPEL: `devnet-dvpn daemon repair-drivers --yes` enables it
and installs it. AppImage: see [`docs/INSTALLER.md`](docs/INSTALLER.md) (Ubuntu 24.04 needs
`libfuse2t64` and `--no-sandbox`).

## First run (terminal or AI agent)

Run these as your own user, not with `sudo`, in this order:

```bash
devnet-dvpn wallet create --keyfile ~/dvpn-wallet.json --yes   # or: wallet import <file> --yes
# fund the address it prints with devnet SOL and tDVPN
devnet-dvpn device setup --yes      # gives this computer's device key a spending permission
devnet-dvpn daemon install --yes    # installs and starts the VPN service
devnet-dvpn daemon doctor
```

- `daemon install` comes after `device setup`: the VPN service does not start until its device
  key holds an on-chain permission.
- It is the one step that needs root. With passwordless `sudo` (for example SSH to a cloud VM)
  the CLI runs that step itself with `sudo -n`, so no prompt appears. On a desktop it shows one
  polkit password prompt, which needs a person at the screen.
- With `--keyfile` (or `DVPN_KEYFILE`) every later command uses that key file. Keep it `0600`.

## Uninstall

The installed package is named `devnet-dvpn-linux` (the file names start `devnet-dvpn`).

```bash
devnet-dvpn settle list                       # deposits still waiting for a refund
devnet-dvpn daemon uninstall --yes            # stop and remove the VPN service, restore networking
sudo apt remove devnet-dvpn-linux             # Fedora / RHEL: sudo dnf remove devnet-dvpn-linux
                                              # Arch: sudo pacman -R devnet-dvpn-linux
```

Settle and withdraw open deposits (`settle run --yes`, then `settle withdraw --yes`) before you
uninstall. A per-GB deposit takes about 2 hours to unlock. The wallet stays yours: keep the key
file or the 24 words.

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
