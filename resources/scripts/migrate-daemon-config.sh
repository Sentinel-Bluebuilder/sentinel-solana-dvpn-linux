#!/bin/bash
# ─── Rename dvpnd config keys written by older builds to the names the bundled dvpnd reads ───
# dvpnd (upstream cf4c372, bundled since 2026-10-21) renamed keys and IGNORES unknown ones, so
# an old `escrow = 5000000` would silently fall back to a 1000 tDVPN deposit and an old
# `dns = 'none'` would let the service change system DNS again. Run as root by the package's
# postinst (upgrade) and by setup-daemon.sh. Idempotent: a key is renamed only when its new name
# is not already in the file. Keeps one .pre-migrate backup; mode and owner are preserved.
# Same renames as #31's migrate-daemon-config.ps1. Plus one value: kill_switch 'on' -> 'persist' (below).
# Two home shapes: pre-cb33 (/var/lib/dvpnd/client: config.toml + client/config.toml) and cb33
# (/var/lib/sentinel-dvpn/c0: ONE config.toml, where the "client/config.toml" rows below apply too).
# Usage: migrate-daemon-config.sh [--DaemonHome /var/lib/sentinel-dvpn/c0]
set -uo pipefail
HOME_DIR=/var/lib/sentinel-dvpn/c0
[ "${1:-}" = --DaemonHome ] && HOME_DIR="${2:-}"
case "$(readlink -m -- "$HOME_DIR")/" in
  /var/lib/dvpnd/*|/var/lib/sentinel-dvpn/*) ;;
  *) echo "migrate-daemon-config: daemon home must be under /var/lib/sentinel-dvpn or /var/lib/dvpnd: $HOME_DIR" >&2; exit 2 ;;
esac
CLIENT_REL=client/config.toml
[ -f "$HOME_DIR/$CLIENT_REL" ] || CLIENT_REL=config.toml

# file (relative to the home) | old key | new key   (key names are unique within each file)
RENAMES='config.toml pipe endpoint
config.toml compute_unit_margin compute_unit_margin_percent
config.toml loaded_data_limit loaded_data_limit_bytes
config.toml max_priority_fee max_priority_fee_lamports
config.toml priority_fee priority_fee_lamports
client/config.toml escrow escrow_base_units
client/config.toml dns dns_backend'

KS_MARK=.ks-stepped-down   # written by uninstall-cleanup.sh next to config.toml
changed=0
for rel in $(printf '%s
' config.toml "$CLIENT_REL" | sort -u); do
  f="$HOME_DIR/$rel"
  [ -f "$f" ] || continue
  tmp=$(mktemp) || { echo "migrate-daemon-config: mktemp failed" >&2; exit 1; }
  cp -- "$f" "$tmp"
  while read -r file old new; do
    [ "$file" = client/config.toml ] && file=$CLIENT_REL
    [ "$file" = "$rel" ] || continue
    grep -qE "^[[:space:]]*${new}[[:space:]]*=" "$tmp" && continue
    sed -i -E "s/^([[:space:]]*)${old}([[:space:]]*=)/\\1${new}\\2/" "$tmp"
  done <<< "$RENAMES"
  # Kill switch "on" -> "persist" (Q0426, same as #33 97eb1077): dvpnd's "on" lifts the block whenever
  # the service stops, so a restart or an update sent traffic direct. The app has one "On" = persist;
  # this moves configs written before (and dvpnd init's default) here, before the service starts.
  # "off" and "persist" are left alone. Except once after an uninstall: uninstall-cleanup.sh stepped
  # persist down to "on" and left KS_MARK, so this one start releases the block row the kept home
  # still holds (#31 #84) instead of cutting the machine off; the marker is used up here.
  if [ "$rel" = "$CLIENT_REL" ]; then
    if [ -e "$HOME_DIR/$KS_MARK" ]; then
      rm -f -- "$HOME_DIR/$KS_MARK"
      echo "kill switch kept at 'on' for this start (stepped down at uninstall)"
    else
      sed -i -E "s/^([[:space:]]*kill_switch[[:space:]]*=[[:space:]]*)(['\"])on(['\"])/\1\2persist\3/" "$tmp"
    fi
  fi
  if ! cmp -s "$f" "$tmp"; then
    cp -p -- "$f" "$f.pre-migrate"
    cat "$tmp" > "$f"   # rewrite in place: owner, mode and ACLs of $f stay as they were
    changed=$((changed + 1))
    echo "migrated $f"
  fi
  rm -f -- "$tmp"
done
# Q0365: the old 2-server Handshake default becomes the current preset in dvpnd's own file.
if [ -f "$HOME_DIR/$CLIENT_REL" ] && [ "$(/bin/bash "$(dirname -- "$0")/upgrade-dns-list.sh" "$HOME_DIR/$CLIENT_REL")" = upgraded ]; then
  changed=$((changed + 1))
  echo "upgraded the Handshake DNS list in $HOME_DIR/$CLIENT_REL"
fi
echo "migrate-daemon-config: $changed file(s) changed"
exit 0
