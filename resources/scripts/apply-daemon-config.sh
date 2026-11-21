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
# D5 (AUDIT-FINAL the Linux app): the helper runs as root for any process in the polkit keep window: only our own unit.
[ "$SERVICE" = sentinel-dvpnd@c0 ] || die "bad service name $SERVICE"
# L32-2 (port of the macOS app M33-1): --Staged is the login's own folder, read with that login's rights
USER_NAME="${ARG[User]:-}"
[ -n "$USER_NAME" ] && id -u -- "$USER_NAME" >/dev/null 2>&1 || die 'the login (--User) is required'
check_caller_user "$USER_NAME" || die "--User $USER_NAME is not the account that asked"
user_home_real="$(real_home "$USER_NAME")"; [ -n "$user_home_real" ] || die "no home folder for $USER_NAME"
staged_real="$(cd -P -- "$STAGED" 2>/dev/null && pwd -P)" || die "staged folder not found: $STAGED"
case "$staged_real" in "$user_home_real"/?*) ;; *) die "staged folder $STAGED is not under $USER_NAME's home $user_home_real" ;; esac
SRC="$staged_real/config.toml"; DST="$HOME_DIR/config.toml"
[ -f "$DST" ] || die "daemon home has no $DST"
# D3 (AUDIT-FINAL the Linux app, port of the macOS app C2): the staged folder is the user's. The old step checked `[ ! -L src ]`, stopped
# the service, and only then read src: a swap to a link in that window put a root-only file into config.toml and its
# user-readable mirror. Copy it with cp -P (a link stays a link) into a root-owned folder first, refuse a link, and
# read only the snapshot from here on.
snap="$(mktemp -d "$HOME_DIR/.staged.XXXXXX")" || die 'could not make a folder for the staged settings'
trap 'rm -rf -- "$snap"' EXIT
[ ! -L "$SRC" ] && [ -f "$SRC" ] || die "staged file is not a plain file: $SRC"
[ "$(stat -c %h -- "$SRC")" = 1 ] || die "staged file has another name (hard link); refused: $SRC"
as_user "$USER_NAME" head -c 65537 -- "$SRC" > "$snap/config.toml" 2>/dev/null || die "missing staged file $SRC"
if [ -L "$snap/config.toml" ] || [ ! -f "$snap/config.toml" ]; then die "staged file is not a plain file: $SRC"; fi
[ "$(stat -c %s "$snap/config.toml")" -le 65536 ] || die "staged file too large: $SRC"
cp -p "$DST" "$DST.bak"
has_unit=0; [ "$(systemctl show -p LoadState --value "$SERVICE" 2>/dev/null)" = loaded ] && has_unit=1
[ $has_unit = 1 ] && systemctl stop "$SERVICE"
# atomic_write keeps the existing file's owner and mode (root 0600, what cb33 expects) and never leaves
# a cut file if the machine stops mid-write
atomic_write "$snap/config.toml" "$DST" || die "could not write $DST"
restore() { atomic_write "$DST.bak" "$DST"; refresh_mirror "$HOME_DIR"; systemctl restart "$SERVICE"; }
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
