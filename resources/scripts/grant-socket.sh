#!/bin/bash
# ─── grant-socket: give the account that asked the right to talk to the VPN service, no sign-out ───
# Linux side of the Windows app's grantPipeAccess (a2edc22, owner 2026-11-12) and the fix for Q0491: a second account on
# this machine (not the one that ran setup) got EACCES on the service socket and was told "The VPN service is
# not running." while it ran.
# Grants ONLY the account that asked: pkexec → PKEXEC_UID, sudo → SUDO_UID. A user name on the command line is
# never read, so an administrator prompt can not be used to open the service to some other account.
# The same rights setup-daemon.sh gives the setup login:
#   group sentinel-dvpn (from the next login), x on the two 0750 folders, r on the settings copy,
#   rw on the socket now, and an ExecStartPost line in our socket drop-in so systemd gives it again each
#   time it makes the socket (a service restart keeps the socket; a socket restart remakes it).
# Args: [--Result <file>]
set -uo pipefail
HERE="$(dirname "$(readlink -f "$0")")"
source "$HERE/_lib.sh"
parse_args "$@"
HOME_DIR="$STATE_ROOT/c0"
SERVICE=sentinel-dvpnd@c0
SOCK="$HOME_DIR/daemon.sock"
SDROP="/etc/systemd/system/$SERVICE.socket.d"
DROPF="$SDROP/50-devnet-dvpn.conf"

UID_ASKED="${PKEXEC_UID:-${SUDO_UID:-}}"
if [ -z "$UID_ASKED" ]; then
  # Root at a root shell: root already reaches the socket; nothing to grant.
  write_result ok 'run as root: nothing to grant'; exit 0
fi
[[ "$UID_ASKED" =~ ^[0-9]+$ ]] || die 'bad caller uid'
[ "$UID_ASKED" -ne 0 ] || { write_result ok 'root: nothing to grant'; exit 0; }
NAME="$(getent passwd "$UID_ASKED" | cut -d: -f1)"
[ -n "$NAME" ] || die "no account with uid $UID_ASKED"
# The name goes into a unit file line: only plain account names (no %, spaces or quotes).
[[ "$NAME" =~ ^[a-z_][a-z0-9_.-]*\$?$ ]] || die "account name $NAME can not be written into the service settings"
[ -d "$HOME_DIR" ] || die 'the VPN service is not installed on this computer'
SETFACL="$(command -v setfacl)" || die 'setfacl is missing (package acl)'

getent group "$DAEMON_GROUP" >/dev/null && usermod -aG "$DAEMON_GROUP" "$NAME"
"$SETFACL" -m "u:$NAME:x" "$STATE_ROOT" "$HOME_DIR" || die 'could not open the service folders to this account'
M="$(mirror_path "$HOME_DIR")"
[ -f "$M" ] && "$SETFACL" -m "u:$NAME:r" "$M"
[ -S "$SOCK" ] && "$SETFACL" -m "u:$NAME:rw" "$SOCK"

LINE="ExecStartPost=-$SETFACL -m u:$NAME:rw $SOCK"
install -d -m 755 "$SDROP"
if [ ! -f "$DROPF" ]; then
  printf '# Written by Devnet dVPN (setup-daemon.sh). Removed by its uninstaller.\n[Socket]\n' > "$DROPF"
fi
grep -qxF "$LINE" "$DROPF" || printf '%s\n' "$LINE" >> "$DROPF"
chmod 644 "$DROPF"
systemctl daemon-reload
write_result ok "granted $NAME"
