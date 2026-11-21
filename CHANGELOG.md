# Changelog — Devnet dVPN for Linux

Entries for builds not yet released. The history of shipped builds is on the public repository's
release pages (Sentinel-Bluebuilder/sentinel-solana-dvpn-linux). At the next release this section
moves there under its version.

## Unreleased — next release candidate (after 0.3.0-rc.2)

### Three commands for AI agents and scripts (the Windows app dff77e8…a75d4e5, ported in 9b989050)

- `devnet-dvpn agent up [--protocol any|wireguard|amneziawg|openvpn|v2ray|xray|hysteria2] [--country CC] [--node N] [--basis per_gb|per_hour] [--units N] [--plan <subscription>] [--max-price N] --yes`
  does three things: picks the best online server that matches, pays the deposit (or uses a
  plan), and connects. It prints one JSON line with the exit IP, the SOCKS endpoint and the next
  step. If a session is already live, it answers with that session and pays nothing again.
  `--max-price` is in tDVPN per unit of the basis. The basis defaults to the saved setting, so
  pass `--basis` (and `--units`) when it matters.
- `devnet-dvpn agent down --yes` disconnects, closes per-hour deposits at once (they bill until
  closed) and starts the refund of per-GB ones. It says what is refundable and when (per GB:
  about 2 h, then `settle run --yes` and `settle withdraw --yes`).
- `devnet-dvpn agent status` gives the wallet, session and exit IP as one JSON line with the next
  step (for example, what to fund).
- **The `--yes` rule:** `agent up` and `agent down` sign transactions, so without `--yes` they only
  print what they would do (exit code 2). `agent status` never spends.
- Tested: `agent-cmd`, `cli-map` and `ui-controls` unit tests 41/41 on Linux, typecheck clean
  (a build VM, 2026-11-15). Live run on the rc.2 service; its records are kept privately.

### Linux notes from the fresh-agent walk on 0.3.0-rc.2 (2026-11-15, clean Ubuntu 24.04)

Evidence is kept in the private test records. The whole agent flow passed on the public deb:
`wallet create --keyfile`, `device setup`, `daemon install`, connect, disconnect, `settle run`.

- **Run `sudo apt-get update` before installing the .deb on a fresh machine.** A fresh cloud image
  (GCE Ubuntu 24.04) has never fetched its universe package lists. The bare
  `sudo apt install ./devnet-dvpn_<version>_amd64.deb` then stops at
  "Depends: libsecret-tools but it is not installable" (exit 100).
- **Root once, two ways:**
  - **With passwordless `sudo`** (for example the default user of a GCE image): run `devnet-dvpn daemon install --yes` as the
    user, with no `sudo` in front. The CLI makes its own root step with `sudo -n`.
  - **On a desktop without passwordless sudo:** the same step is one polkit prompt, which needs a
    person.
  - Installing the package itself always needs root.
- **SSH survives a full tunnel.** With a WireGuard session up (kill switch off), an SSH session
  coming in from outside keeps working. dvpnd adds the policy rule
  `from <the machine's own address> lookup 8990`, whose default route is the real network card,
  so replies on connections that came in on that address leave outside the tunnel. Connections
  the machine opens itself go through the tunnel.
