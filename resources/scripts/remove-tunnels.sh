#!/bin/bash
# ─── Restore network: remove what a dead or failed dvpnd session left holding the network ───
# Run as root by "Restore network" (src/main/system/tunnels.ts), only when the daemon has no
# live session. Only ours, never `nft flush ruleset`, never a user's own tunnels:
#   - the client's nft tables (CLIENT_TABLES): `inet sentinel-dvpn-c0` (kill switch, cb33; `inet dvpnd` before), `inet dvpnd_v6guard` (IPv6
#     guard: IPv6 is off while a session runs), `inet dvpnd_hy2` (Hysteria2 datagram meter, dvpnd Q0189;
#     a SIGKILLed dvpnd left it behind, Q0239), and wg-quick tables of dvpn-* links. Never a wildcard
#     `inet dvpnd_*`: a dvpnd NODE on the same machine owns `inet dvpnd_<iface>` egress tables.
#   - links (LINKS): dvpn-c0 (cb33: one link for every protocol); dvpn-wg-client / dvpn-awg-client / dvpn-hy2-client / dvpn-ovp-client (ddv16 names;
#     hy2-client / ovpn-client = older dvpnd builds)
#   - wg-quick policy rules for table 51820, only when no other WireGuard link is up
#   - the inbound-reply source routing (pref 8990 rules + tables 8990..8997, dvpnd 0022) and the
#     pref 8989 rules sending the metadata server / OpenVPN server to those tables (0024)
#   - hysteria2 / v2ray / xray run from the app's own folder; openvpn run with dvpnd's config
# Args: [--BinRoot <app bin dir>] --Result
set -uo pipefail
source "$(dirname "$(readlink -f "$0")")/_lib.sh"
parse_args "$@"
BIN_ROOT="${ARG[BinRoot]:-}"
removed=()
# table:what (dvpnd client side only; see the header for why this is a list, not a wildcard)
CLIENT_TABLES=('sentinel-dvpn-c0:kill switch' 'dvpnd:kill switch (before cb33)' 'dvpnd_v6guard:IPv6 guard' 'dvpnd_hy2:Hysteria2 meter')
# cb33 names its one tunnel link after the instance (dvpn-c0); the rest are pre-cb33 names an upgrade may leave
LINKS=(dvpn-c0 dvpn-wg-client dvpn-awg-client dvpn-hy2-client dvpn-ovp-client hy2-client ovpn-client)

# processes first: a live protocol process re-creates its link
for pid in $(pgrep -x 'hysteria2|v2ray|xray' 2>/dev/null); do
  exe="$(readlink -f "/proc/$pid/exe" 2>/dev/null)"
  if { [ -n "$BIN_ROOT" ] && [[ "$exe" == "$BIN_ROOT"/* ]]; } || [[ "$exe" == /opt/Devnet\ dVPN/* ]] || [[ "$exe" == /usr/local/lib/devnet-dvpn/* ]]; then
    kill -TERM "$pid" 2>/dev/null && removed+=("$(basename "$exe"):$pid")
  fi
done
for pid in $(pgrep -x openvpn 2>/dev/null); do
  if tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -qE '/var/lib/(sentinel-dvpn|dvpnd)/'; then
    kill -TERM "$pid" 2>/dev/null && removed+=("openvpn:$pid")
  fi
done
[ ${#removed[@]} -gt 0 ] && sleep 2

for l in "${LINKS[@]}"; do
  ip link show "$l" >/dev/null 2>&1 && ip link del "$l" 2>/dev/null && removed+=("link $l")
done
for ct in "${CLIENT_TABLES[@]}"; do
  t=${ct%%:*}
  if nft list table inet "$t" >/dev/null 2>&1; then nft delete table inet "$t" && removed+=("${ct#*:} (nft inet $t)"); fi
done
# inbound replies keep the card (dvpnd 0022): rules at pref 8990 + their tables 8990..8997
while ip -4 rule show pref 8989 2>/dev/null | grep -q .; do ip -4 rule del pref 8989 2>/dev/null && removed+=('rule 8989 (metadata / server on the card)') || break; done
while ip -4 rule show pref 8990 2>/dev/null | grep -q .; do ip -4 rule del pref 8990 2>/dev/null && removed+=('rule 8990 (inbound replies)') || break; done
# dvpnd 0023 (ddv16.26 only): the metadata route it added (route protocol 241 only; the system's own is never touched)
[ -n "$(ip -4 route show table main proto 241 2>/dev/null)" ] && ip -4 route flush table main proto 241 2>/dev/null && removed+=('metadata route (proto 241)')
for tb in 8990 8991 8992 8993 8994 8995 8996 8997; do [ -n "$(ip -4 route show table $tb 2>/dev/null)" ] && ip -4 route flush table $tb 2>/dev/null && removed+=("table $tb"); done
for t in $(nft list tables 2>/dev/null | awk '$3 ~ /^(wg|awg)-quick-dvpn-/ {print $2":"$3}'); do
  nft delete table "${t%%:*}" "${t#*:}" && removed+=("nft ${t#*:}")
done
other_wg="$(ip -o link show type wireguard 2>/dev/null | awk -F': ' '{print $2}' | grep -v '^dvpn-' || true)"
if [ -z "$other_wg" ]; then
  for fam in -4 -6; do
    while read -r pref; do
      [ -n "$pref" ] && ip "$fam" rule del pref "$pref" 2>/dev/null && removed+=("rule$fam $pref")
    done < <(ip "$fam" rule show 2>/dev/null | awk -F: '/lookup 51820|suppress_prefixlength 0/ {print $1}')
  done
fi

left=()
for l in "${LINKS[@]}"; do ip link show "$l" >/dev/null 2>&1 && left+=("$l"); done
for ct in "${CLIENT_TABLES[@]}"; do nft list table inet "${ct%%:*}" >/dev/null 2>&1 && left+=("nft inet ${ct%%:*}"); done
if [ ${#left[@]} -gt 0 ]; then die "still present: ${left[*]}"; fi
if [ ${#removed[@]} -gt 0 ]; then write_result ok "removed: $(IFS=', '; echo "${removed[*]}")"; else write_result ok 'none left'; fi
