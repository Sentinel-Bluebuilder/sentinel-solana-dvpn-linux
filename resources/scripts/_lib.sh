# ─── shared by the dvpn-helper steps (sourced, root) ───
# Named args: --Key value → $ARG_Key. Results: one JSON line in --Result (a file inside a
# folder the calling user created: /…/devnet-dvpn-XXXXXX/result.json).
declare -A ARG=()
parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --[A-Za-z]*) [ $# -ge 2 ] || { echo "missing value for $1" >&2; exit 64; }; ARG[${1#--}]="$2"; shift 2 ;;
      *) echo "unexpected argument: $1" >&2; exit 64 ;;
    esac
  done
}
json_str() {
  local s="$1"
  s="${s//\/\\}"; s="${s//\"/\\\"}"; s="${s//$'\n'/\n}"; s="${s//$'\r'/}"; s="${s//$'\t'/ }"
  printf '"%s"' "$s"
}
write_result() { # status detail [extra-json-fields]
  local r="${ARG[Result]:-}"
  [ -n "$r" ] || return 0
  if ! [[ "$r" =~ /devnet-dvpn-[A-Za-z0-9]+/result\.json$ ]] || [ -L "$r" ] || [ -L "$(dirname "$r")" ]; then
    echo "refusing result path $r" >&2; return 0
  fi
  printf '{"status":%s,"detail":%s,"at":"%s"%s}\n' "$(json_str "$1")" "$(json_str "$2")" "$(date -u +%FT%TZ)" "${3:+,$3}" > "$r"
  chmod 644 "$r"
}
die() { write_result error "$1"; echo "$1" >&2; exit 1; }
under() { # path prefix → true when path is inside prefix (after resolving)
  local p; p="$(realpath -m "$1")"; [[ "$p" == "$2"/* || "$p" == "$2" ]]
}

# ─── cb33 instance (sentinel-dvpnd, client c0) ───
STATE_ROOT=/var/lib/sentinel-dvpn
DAEMON_GROUP=sentinel-dvpn
# The app-readable copy of <home>/config.toml and the device address sit NEXT TO the instance folder:
# inside it cb33 wants every file 0600 and every folder 0700 (doctor reports anything looser as exposed).
mirror_path() { printf '%s/%s.config.toml' "$(dirname "$1")" "$(basename "$1")"; }
pub_path() { printf '%s/%s.device.pub' "$(dirname "$1")" "$(basename "$1")"; }
# refresh_mirror <home> [user]: copy config.toml to its mirror, root:<group> 0640 (+ the user's read ACL)
refresh_mirror() {
  local m; m="$(mirror_path "$1")"
  [ -f "$1/config.toml" ] || return 1
  if [ -f "$m" ]; then cat "$1/config.toml" > "$m" || return 1   # in place: owner, mode and ACL stay
  else install -m 640 -o root -g "$DAEMON_GROUP" "$1/config.toml" "$m" || return 1; fi
  [ -n "${2:-}" ] && command -v setfacl >/dev/null && setfacl -m "u:$2:r" "$m" 2>/dev/null
  return 0
}
