#!/bin/bash
# ─── Apply the staged dvpnd config and restart the service (decision D4) ───
# Run as root by the app. Takes only paths: the app wrote and validated the file in its own folder;
# this step never sees config text on its command line. cb33 (sentinel-dvpnd, instance c0) has ONE
# <home>/config.toml (0600, root): the staged file replaces it, a backup is kept, the service
# restarts, and a failed start rolls back. The app-readable copy next to the instance folder is
# refreshed from whatever ends up live.
# Args: --Staged --DaemonHome [--Service] --Result
set -uo pipefail
source "$(dirname "$(readlink -f "$0")")/_lib.sh"
parse_args "$@"
STAGED="${ARG[Staged]:-}"; HOME_DIR="${ARG[DaemonHome]:-}"; SERVICE="${ARG[Service]:-sentinel-dvpnd@c0}"
under "$HOME_DIR" "$STATE_ROOT" || die "daemon home must be under $STATE_ROOT"
[[ "$SERVICE" =~ ^[a-z][a-z0-9-]{0,40}(@[cnp][0-9]{1,9})?$ ]] || die "bad service name $SERVICE"
SRC="$STAGED/config.toml"; DST="$HOME_DIR/config.toml"
[ -f "$SRC" ] && [ ! -L "$SRC" ] || die "missing staged file $SRC"
[ -f "$DST" ] || die "daemon home has no $DST"
[ "$(stat -c %s "$SRC")" -le 65536 ] || die "staged file too large: $SRC"
cp -p "$DST" "$DST.bak"
has_unit=0; [ "$(systemctl show -p LoadState --value "$SERVICE" 2>/dev/null)" = loaded ] && has_unit=1
[ $has_unit = 1 ] && systemctl stop "$SERVICE"
# cat onto the existing file keeps its owner and mode (root 0600, what cb33 expects)
cat "$SRC" > "$DST" || die "could not write $DST"
restore() { cat "$DST.bak" > "$DST"; refresh_mirror "$HOME_DIR"; systemctl restart "$SERVICE"; }
if [ $has_unit = 1 ]; then
  ok=0
  up() { for _ in $(seq 1 150); do [ -S "$HOME_DIR/daemon.sock" ] && systemctl is-active -q "$SERVICE" && return 0; sleep 0.2; done; return 1; }
  t0=$(date +%s)
  systemctl start "$SERVICE" && up && ok=1
  # dvpnd checks the Solana RPC before it starts. A busy public endpoint (429) fails that check
  # for a few seconds; that is not the new settings' fault, so wait and try again before rolling
  # back (Linux matrix 2026-10-22: a valid kill-switch change was rolled back on a 429).
  # Two shapes: the preflight's HTTP check, and the websocket dial right after it
  # ("connecting rpc: connecting websocket ... 429", arm64 Debian 12 + Ubuntu 24.04 the same day).
  RPC_FAIL='preflight failed: rpc|connecting rpc: '
  for wait in 5 10 20; do
    [ $ok = 1 ] && break
    journalctl -u "$SERVICE" --since "@$t0" --no-pager -o cat 2>/dev/null | grep -qE "$RPC_FAIL" || break
    echo "service start: RPC check failed (endpoint busy?); retrying in ${wait}s" >&2
    sleep "$wait"
    systemctl restart "$SERVICE" && up && ok=1
  done
  if [ $ok = 0 ]; then
    if journalctl -u "$SERVICE" --since "@$t0" --no-pager -o cat 2>/dev/null | grep -qE "$RPC_FAIL"; then
      restore
      die "the VPN service could not reach the Solana RPC endpoint to start (busy or down), so the change was not applied; previous settings restored. Try again in a minute, or set another RPC endpoint."
    fi
    why="$(journalctl -u "$SERVICE" -n 5 --no-pager -o cat 2>/dev/null | tail -2)"
    restore
    die "service failed to start with the new settings; previous settings restored: $why"
  fi
  refresh_mirror "$HOME_DIR" || die 'settings applied, but the copy the app reads could not be refreshed'
  write_result ok 'applied and restarted'
else
  refresh_mirror "$HOME_DIR" || die 'settings applied, but the copy the app reads could not be refreshed'
  write_result ok 'applied (no service installed)'
fi
