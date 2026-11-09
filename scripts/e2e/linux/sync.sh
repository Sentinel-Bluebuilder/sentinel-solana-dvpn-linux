#!/usr/bin/env bash
# ─── Copy this working tree to the Linux test VM (~/ddvl) ───
# Sends tracked + new files (no node_modules/out/dist/.git) over ssh as a tar stream, and
# dvpnd (Linux, cf4c372-ddv16.30 = #31 cf4c be2c793 + #32 0011-0017 + #33 0019 + #31 gap #73 (ee148a1, 7f31f0d) + #32 0018 IPv6 guard, 0019 exit stdout, 0020 confirm retry + #32 0022 inbound replies keep the card, every full-tunnel protocol (replaces 0021) + #32 0023 cloud metadata stays on the card + #32 0024 metadata and OpenVPN server by rule (NetworkManager-proof) + #31 c694f7c batched reads + #31 a977c26 WG failed-start teardown + #32 0027 WG/AWG /1 halves + endpoint rule + #31 45574d5 (#84) + #31 1477c48, 88e51e3, LF build) once, for the VM's own
# CPU (x86_64 → the amd64 build, aarch64 → the arm64 build; DVPND_SRC overrides).
# Usage: bash scripts/e2e/linux/sync.sh [host]
set -euo pipefail
H="${1:-ddv-linux}"
cd "$(dirname "$0")/../../.."
{ git ls-files; git ls-files --others --exclude-standard; } | sort -u | while read -r f; do [ -e "$f" ] && printf '%s\n' "$f"; done > "${TMPDIR:-/tmp}/ddvl-files.txt"
tar -czf - -T "${TMPDIR:-/tmp}/ddvl-files.txt" | ssh "$H" 'mkdir -p ~/ddvl && tar -xzf - -C ~/ddvl'
D="$HOME/work/devnet-dvpn-dvpnd-devnet/build"
M=$(ssh "$H" 'uname -m')
case "$M" in
  x86_64) DEF="$D/dvpnd-linux-cf4c372-ddv18.36" ;;
  aarch64) DEF="$D/dvpnd-linux-arm64-cf4c372-ddv18.36" ;;
  *) echo "sync: $H is $M; only x86_64 and aarch64 are supported" >&2; exit 1 ;;
esac
SRC="${DVPND_SRC:-$DEF}"
want=$(sha256sum "$SRC" | cut -d' ' -f1)
have=$(ssh "$H" 'sha256sum ~/ddvl-dvpnd 2>/dev/null | cut -d" " -f1' || true)
[ "$want" = "$have" ] || gzip -1c "$SRC" | ssh "$H" 'gunzip > ~/ddvl-dvpnd && chmod 755 ~/ddvl-dvpnd'
echo "synced $(wc -l < "${TMPDIR:-/tmp}/ddvl-files.txt") files to $H:~/ddvl ($M, dvpnd ${want:0:12})"
