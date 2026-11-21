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
  # D4 (AUDIT-FINAL the Linux app, port of the macOS app M7): the folder is the caller's, so the -L check above can be raced (swap in a
  # link before `>`). Write a new file beside it and rename it over the path: rename replaces a link, never follows it.
  local t; t="$(mktemp "$(dirname "$r")/.result.XXXXXX")" || { echo "could not write the result beside $r" >&2; return 0; }
  printf '{"status":%s,"detail":%s,"at":"%s"%s}\n' "$(json_str "$1")" "$(json_str "$2")" "$(date -u +%FT%TZ)" "${3:+,$3}" > "$t"
  chmod 644 "$t" && mv -f -- "$t" "$r" || { rm -f -- "$t"; echo "could not write the result $r" >&2; }
}
die() { write_result error "$1"; echo "$1" >&2; exit 1; }
under() { # path prefix → true when path is inside prefix (after resolving)
  local p; p="$(realpath -m "$1")"; [[ "$p" == "$2"/* || "$p" == "$2" ]]
}

# ─── L32-2 (the Linux app Phase 2 B audit; port of the macOS app M33-1): the user's staged files are read WITH THE USER'S RIGHTS ───
# Root refused symbolic links but copied hard links with root's rights; only fs.protected_hardlinks=1 stopped a
# config.toml hard-linked to a root-only file from landing in the user-readable mirror. Now the user's own tar or
# head reads them (a file the user cannot read fails), the copy is root-owned (--no-same-owner) so it cannot change
# between the checks and its use, and a copy holding a hard link is refused.
# caller_uid: the account that asked (pkexec / sudo); empty when root ran the step itself. SUDO_UID counts only when
# sudo ran this helper (SUDO_COMMAND names it): a root process started with sudo earlier (`sudo devnet-dvpn …`, which
# then runs the helper itself) passes its own SUDO_* on, and that account is not the one asking here.
caller_uid() {
  if [ -n "${PKEXEC_UID:-}" ]; then printf '%s' "$PKEXEC_UID"; return 0; fi
  [[ "${SUDO_COMMAND:-}" == *dvpn-helper* ]] && printf '%s' "${SUDO_UID:-}"
  return 0
}
# check_caller_user <user>: --User must be the account that asked, so a caller cannot name root (or anyone) to have
# the files read with that account's rights. Root running the step itself may name any account.
check_caller_user() {
  local u; u="$(caller_uid)"
  [ -z "$u" ] || [ "$u" = 0 ] && return 0
  [ "$(id -u -- "$1" 2>/dev/null)" = "$u" ]
}
# as_user <user> <cmd…>: run as that user (directly when this already is that user: tests, a root-run app)
as_user() { local u="$1"; shift; if [ "$(id -un)" = "$u" ]; then "$@"; else runuser -u "$u" -- "$@"; fi; }
# copy_as_user <user> <src folder> <dst folder (made 0700, root's)>
copy_as_user() {
  local u="$1" src="$2" dst="$3" st
  mkdir -m 700 -- "$dst" || return 1
  as_user "$u" tar -C "$src" -cf - . | tar -C "$dst" --no-same-owner -xf -
  st=("${PIPESTATUS[@]}")
  [ "${st[0]}" = 0 ] && [ "${st[1]}" = 0 ] || return 1
  chmod 700 -- "$dst"
}
# has_hardlink <folder>: a regular file in it has another name
has_hardlink() { [ -n "$(find "$1" -type f -links +1 -print 2>/dev/null | head -1)" ]; }
# real_home <user>: that account's home, every link resolved (empty when it has none)
real_home() { local h; h="$(getent passwd "$1" | cut -d: -f6)"; (cd -P -- "${h:-/nonexistent}" 2>/dev/null && pwd -P); }

# ─── cb33 instance (sentinel-dvpnd, client c0) ───
# L32-1 (the Linux app Phase 2 B audit, H): the deb/rpm install root. A helper that runs from here runs root-owned scripts,
# so the binaries root installs must be the package's own too (setup-daemon.sh pin_bundled).
PKG_ROOT=/opt/devnet-dvpn
STATE_ROOT=/var/lib/sentinel-dvpn
DAEMON_GROUP=sentinel-dvpn
# The app-readable copy of <home>/config.toml and the device address sit NEXT TO the instance folder:
# inside it cb33 wants every file 0600 and every folder 0700 (doctor reports anything looser as exposed).
mirror_path() { printf '%s/%s.config.toml' "$(dirname "$1")" "$(basename "$1")"; }
pub_path() { printf '%s/%s.device.pub' "$(dirname "$1")" "$(basename "$1")"; }
# atomic_write <src> <dst>: replace dst with src's bytes so a power loss leaves the old file or the new
# one, never a cut one. `cat src > dst` truncates first: hunt1 was spot-preempted mid-write (2026-11-12
# 18:04:05) and c0.config.toml stayed 0 bytes, so every later CLI/app read saw no settings. A temp file
# in the same folder takes dst's owner, mode and ACL, is fsynced, then renamed over dst.
atomic_write() {
  local src="$1" dst="$2" tmp
  tmp="$(mktemp "$(dirname "$dst")/.$(basename "$dst").XXXXXX")" || return 1
  if ! cat "$src" > "$tmp"; then rm -f "$tmp"; return 1; fi
  if [ -e "$dst" ]; then
    chown --reference="$dst" "$tmp" && chmod --reference="$dst" "$tmp" || { rm -f "$tmp"; return 1; }
    if command -v getfacl >/dev/null && command -v setfacl >/dev/null; then
      getfacl -p "$dst" 2>/dev/null | setfacl --set-file=- "$tmp" 2>/dev/null || echo "atomic_write: could not copy the ACL of $dst" >&2
    fi
  fi
  sync "$tmp" 2>/dev/null || sync
  mv -f "$tmp" "$dst" || { rm -f "$tmp"; return 1; }
  sync "$(dirname "$dst")" 2>/dev/null || sync
}
# refresh_mirror <home> [user]: copy config.toml to its mirror, root:<group> 0640 (+ the user's read ACL)
refresh_mirror() {
  local m; m="$(mirror_path "$1")"
  [ -f "$1/config.toml" ] || return 1
  if [ -f "$m" ]; then atomic_write "$1/config.toml" "$m" || return 1   # owner, mode and ACL carried over
  else install -m 640 -o root -g "$DAEMON_GROUP" "$1/config.toml" "$m" || return 1; fi
  [ -n "${2:-}" ] && command -v setfacl >/dev/null && setfacl -m "u:$2:r" "$m" 2>/dev/null
  return 0
}
# write_service_units <lib> <service>: the service's own unit files, written the same way by "Install service"
# (setup-daemon.sh) and by every package upgrade (after-install.sh), so an upgraded machine runs the restart
# policy and PATH of the version it has, not of the version it was first set up with (the Windows app 8deb2d4: Windows wrote
# its restart policy at first install only). 1. cb33's template unit + socket (`service install`; it registers
# the instance, so a unit the user had disabled is disabled again), 2. the service PATH, 3. our drop-in.
# The socket drop-in (one login's ACL) stays with setup-daemon.sh: only it knows the login.
write_service_units() {
  local lib="$1" svc="$2" was d path sd backoff drop
  was=$(systemctl is-enabled "$svc.service" 2>/dev/null)
  "$lib/sentinel-dvpnd" service install --instance "${svc#*@}" >/dev/null || { echo 'sentinel-dvpnd service install failed' >&2; return 1; }
  [ "$was" = disabled ] && systemctl disable "$svc.service" >/dev/null 2>&1
  # PATH for the service (EnvironmentFile in cb33's unit): our tool copies FIRST, so a same-named
  # program elsewhere on the PATH never runs as root in their place.
  path=""
  for d in v2ray xray hysteria2; do [ -d "$lib/$d" ] && path="$path$lib/$d:"; done
  path="${path}/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  install -d -m 755 /etc/sentinel-dvpn || return 1
  printf '# Written by Devnet dVPN (setup-daemon.sh)\nPATH=%s\n' "$path" > /etc/sentinel-dvpn/c0.env.new &&
    chmod 644 /etc/sentinel-dvpn/c0.env.new && mv -f /etc/sentinel-dvpn/c0.env.new /etc/sentinel-dvpn/c0.env || return 1
  # Backoff: cb33 restarts every 5 s forever, and each failed preflight (a device without its grant, a
  # busy RPC) spends RPC calls: Rocky 9 hit 118 restarts and the public RPC throttled it. systemd ≥ 254
  # grows the gap 5 s → 5 min; older systemd (EL9 252, Ubuntu 22.04 249) ignores that, so a flat 20 s.
  sd=$(systemctl --version 2>/dev/null | awk 'NR==1{print $2+0}')
  backoff='RestartSteps=8
RestartMaxDelaySec=300'
  [ "${sd:-0}" -lt 254 ] && backoff='RestartSec=20'
  drop="/etc/systemd/system/$svc.service.d"
  install -d -m 755 "$drop" || return 1
  # '+' = outside the unit's ProtectSystem=strict sandbox: host-firewall.sh changes ufw / firewalld.
  # data.db needs no chmod any more: sentinel-dvpnd runs with umask 077, so it and -wal/-shm are 0600.
  printf '# Written by Devnet dVPN (setup-daemon.sh). Removed by its uninstaller.\n[Service]\nExecStartPre=-+/bin/bash %s/host-firewall.sh allow\n%s\n' "$lib" "$backoff" > "$drop/50-devnet-dvpn.conf.new" &&
    mv -f "$drop/50-devnet-dvpn.conf.new" "$drop/50-devnet-dvpn.conf"
}
