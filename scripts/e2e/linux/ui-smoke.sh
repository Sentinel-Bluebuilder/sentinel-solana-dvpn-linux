#!/usr/bin/env bash
# ─── UI smoke on Linux: the INSTALLED desktop app on a virtual display (run ON the VM) ───
# Clicks every screen, screenshots each one, records renderer errors (src/main/dev/ui-smoke.ts).
# Own D-Bus session with an unlocked GNOME keyring, like a desktop login. Test wallet read-only
# via DVPN_KEYFILE. Extra env is passed through (DVPN_UI_SCENARIO, DVPN_UI_SMOKE_CONNECT …).
# Usage: bash ui-smoke.sh dark|light [out-dir]
set -u
THEME=${1:-dark}
OUT=${2:-$HOME/ui/$THEME}
: "${DVPN_KEYFILE:?set DVPN_KEYFILE to the test wallet key file}"
rm -rf "$OUT"; mkdir -p "$OUT"
pgrep -x Xvfb >/dev/null || { Xvfb :99 -screen 0 1440x900x24 >/dev/null 2>&1 & sleep 2; }
export DISPLAY=:99 DVPN_UI_SMOKE="$OUT" DVPN_UI_SMOKE_THEME="$THEME" DVPN_DATA_DIR="${DVPN_DATA_DIR:-$HOME/ddv-data}"
# DVPN_UI_NO_KEYFILE=1: the app starts WITHOUT the read-only test wallet, so it keeps its own
# keyring-encrypted one (uifire signout imports one through the window, then signs out).
timeout "${UI_TIMEOUT:-600}" dbus-run-session -- bash -c '
  echo -n ddvtest | gnome-keyring-daemon --unlock --components=secrets >/dev/null
  [ "${DVPN_UI_NO_KEYFILE:-}" = 1 ] && unset DVPN_KEYFILE
  devnet-dvpn-desktop 2>&1 | grep -v "^\[rpc\]" > "$DVPN_UI_SMOKE/app.log"
'
echo "exit=$?"
ls "$OUT"
echo "errors.json: $(cat "$OUT/errors.json" 2>/dev/null || echo missing)"
# final-pass effect line (PURE-UI shape): the smoke clicks every screen and screenshots each one, so the shot count is what fired
echo "fired: $(ls "$OUT"/*.png 2>/dev/null | wc -l) screens clicked and captured (theme $THEME)"
