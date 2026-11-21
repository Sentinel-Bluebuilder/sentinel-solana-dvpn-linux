#!/bin/bash
# ─── Start / stop / restart the VPN service (root) ───
# Args: --Action start|stop|restart [--Service] --Result
set -uo pipefail
source "$(dirname "$(readlink -f "$0")")/_lib.sh"
parse_args "$@"
A="${ARG[Action]:-}"; SERVICE="${ARG[Service]:-sentinel-dvpnd@c0}"
[[ "$A" =~ ^(start|stop|restart)$ ]] || die "bad action $A"
# D5 (AUDIT-FINAL the Linux app): root for any process in the polkit keep window, so only our own unit (not ssh, firewalld, …)
[ "$SERVICE" = sentinel-dvpnd@c0 ] || die "bad service name $SERVICE"
systemctl "$A" "$SERVICE" || die "systemctl $A $SERVICE failed: $(journalctl -u "$SERVICE" -n 3 --no-pager -o cat 2>/dev/null | tail -2)"
write_result ok "$A done: $(systemctl is-active "$SERVICE")"
