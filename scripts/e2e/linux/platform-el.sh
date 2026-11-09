#!/usr/bin/env bash
# ─── Fedora / EL extras, live: firewalld, SELinux and NetworkManager during real sessions ───
# Run ON a Fedora/EL test VM after the queue (service installed, device ready), detached:
#   setsid nohup bash platform-el.sh [protocols…] > ~/plat/run.out 2>&1 < /dev/null &
# Per protocol, kill switch ON: connect → egress = node → firewall-cmd --reload → systemctl restart
# firewalld → (no systemd-resolved) NetworkManager re-applies the uplink → after each: our nft table
# still there, egress still the node → disconnect → nothing left, direct IP + resolv.conf back.
# Then: SELinux labels + domain, and NO AVC denial during the whole run.
# Results: ~/plat/plat.tsv (PASS/FAIL/INFO <tab> protocol <tab> check <tab> detail)
# Env: DVPN_KEYFILE, DVPN_DATA_DIR. Sequential; 7 s between chain transactions.
set -u
export PATH="$PATH:/usr/sbin:/sbin"
: "${DVPN_KEYFILE:?set DVPN_KEYFILE}"; export DVPN_DATA_DIR=${DVPN_DATA_DIR:-$HOME/ddv-data}
OUT=~/plat; mkdir -p "$OUT"; TSV="$OUT/plat.tsv"; : > "$TSV"; LOG="$OUT/plat.log"; : > "$LOG"
NODE_IP=192.0.2.2
declare -A NODES=(
  [wireguard]=SLVJNn38s5RfqcVW7a7A4hGKqjY7Y1bKkUpG7wrGX5D [amneziawg]=1PwMkSjnyugAZHdHvDsddETzPUAubPkeyWymT7Ercn6
  [openvpn]=9EQJ7dBwneFUse9yy8Hg56u2wPiGF5qkjAaA1ZAr64nP [hysteria2]=E8nefMLBuBzG1CrA4dSDU9mqq6ZNpv69Bt3w9QEtzvPf
  [v2ray]=Di5V9K2Vt5uptJUk7oVVnkDRXt9qWy5HhLbkEJMxEuM2 [xray]=E9RG1iZJjsLfEuLfDYTHM4yXCjyFE21jBbJLFvGoL2FD
)
. "$(dirname "$0")/nodes.sh"; nodeset_apply   # NODE_SET=node4 → that node set (nodes.sh)
PROTOS=${*:-wireguard amneziawg openvpn hysteria2 v2ray xray}
PASS=0; FAIL=0
rec() { printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$(printf '%s' "${4:-}" | tr '\n\t' '  ' | cut -c1-300)" >> "$TSV"; echo "$1 $2 $3"; [ "$1" = PASS ] && PASS=$((PASS + 1)); [ "$1" = FAIL ] && FAIL=$((FAIL + 1)); true; }
check() { # <protocol> <description> <command…>
  local p=$1 d=$2; shift 2
  local out; out=$("$@" 2>&1); local c=$?
  printf '\n### %s %s\n%s\n(exit %s)\n' "$p" "$d" "$out" "$c" >> "$LOG"
  if [ $c = 0 ]; then rec PASS "$p" "$d"; else rec FAIL "$p" "$d" "$out"; fi
}
cli() { devnet-dvpn "$@" 2>&1 | grep -v '^\[rpc\]'; return "${PIPESTATUS[0]}"; }
hold() { sudo touch /run/ddv-deadman.hold 2>/dev/null; true; }
socks() { devnet-dvpn proxy status --json 2>/dev/null | grep -oE '127\.0\.0\.1:[0-9]+' | head -1; }
egress() { local v=''; case $1 in v2ray|xray) v="--socks5-hostname $(socks)" ;; esac; curl -s -m 12 $v https://api.ipify.org; }
via_node() { local i; for i in 1 2 3; do [ "$(egress "$1")" = "$NODE_IP" ] && return 0; sleep 3; done; echo "egress $(egress "$1")"; return 1; }
table_up() { sudo nft list table inet dvpnd >/dev/null; }
nothing_left() {
  local t l
  t=$(sudo nft list tables 2>/dev/null | grep -c 'inet dvpnd')
  l=$(ip -o link | grep -cE ' (dvpn-[a-z0-9-]+|hy2-client|ovpn-client|tun[0-9]+)[:@]')
  echo "nft=$t links=$l"; [ "$t" = 0 ] && [ "$l" = 0 ]
}
export -f egress socks via_node table_up nothing_left; export NODE_IP

. /etc/os-release
START=$(date '+%m/%d/%Y %H:%M:%S')
FWD=0; systemctl is-active -q firewalld && FWD=1
RESOLVED=0; systemctl is-active -q systemd-resolved && RESOLVED=1
MAINCON=$(nmcli -t -f NAME,DEVICE con show --active 2>/dev/null | grep -vE ':(lo|dvpn|hy2|tun|ovpn)' | head -1 | cut -d: -f1)
DIRECT=$(curl -s -m 12 https://api.ipify.org)
RESOLV0=$(cat /etc/resolv.conf); export RESOLV0
rec INFO all platform "$PRETTY_NAME, kernel $(uname -r), SELinux $(getenforce 2>/dev/null), firewalld=$FWD, resolved=$RESOLVED, NM connection '$MAINCON', direct $DIRECT"

# ─── SELinux: labels and the service domain ───
check all 'SELinux enforcing' bash -c '[ "$(getenforce)" = Enforcing ]'
check all 'service binaries labelled bin_t' bash -c 'ls -Z /usr/local/lib/devnet-dvpn/dvpnd | grep -q ":bin_t:"'
check all 'service home labelled var_lib_t (not the staging user_home_t)' bash -c '! sudo find /var/lib/dvpnd -context "*user_home_t*" | grep -q .'
check all 'dvpnd runs as unconfined_service_t' bash -c 'ps -eZ | grep -E " dvpnd$" | grep -q unconfined_service_t'

# ─── Cloud metadata stays this machine's (L23 / dvpnd 0023) ───
# NetworkManager installs no DHCP /32 route to 169.254.169.254 (Ubuntu's dhcp client does), so before
# 0023 WireGuard/AmneziaWG/OpenVPN sent metadata requests to the NODE's cloud: the guest agent renamed
# this VM after the node. A watcher asks for the instance name every second for the whole run.
SELF=$(curl -s -m 4 -H 'Metadata-Flavor: Google' http://169.254.169.254/computeMetadata/v1/instance/name)
HOST0=$(hostname -s)
META="$OUT/metadata.txt"; : > "$META"
if [ -n "$SELF" ]; then
  ( while :; do printf '%s %s %s\n' "$(date +%s)" "$(curl -s -m 2 -H 'Metadata-Flavor: Google' http://169.254.169.254/computeMetadata/v1/instance/name || true)" "$(hostname -s)" >> "$META"; sleep 1; done ) &
  METAPID=$!
  rec INFO all 'metadata watcher' "instance $SELF, hostname $HOST0"
fi
# The 1 s watcher can miss a short rename: GCE's NM dispatcher hook asks the metadata server the instant a
# tunnel link comes `up`, before dvpnd's rule may exist (L23 race, Rocky 9.8 ddv16.29). A dispatcher
# probe that runs at that same instant records which machine answered.
PROBE=/etc/NetworkManager/dispatcher.d/90-ddv-meta-probe
if [ -n "$SELF" ] && [ -d /etc/NetworkManager/dispatcher.d ]; then
  sudo install -m 755 -o root -g root "$(dirname "$(readlink -f "$0")")/ddv-meta-probe.dispatcher" "$PROBE"
  sudo restorecon "$PROBE" 2>/dev/null
  rec INFO all 'link-up metadata probe' "$PROBE ($(ls -Z "$PROBE" 2>/dev/null | awk '{print $1}'))"
fi
probe_window() { # <protocol> <from epoch>: every tunnel link-up during the session must get this VM's own answer
  [ -n "$SELF" ] && [ -x "$PROBE" ] || return 0
  local ev bad
  ev=$(sudo journalctl -q --since "@$2" -t ddv-meta-probe -o cat 2>/dev/null)
  if [ -z "$ev" ]; then rec INFO "$1" 'link-up probe: no tunnel link-up event (proxy protocol or NM did not see the link)'; return 0; fi
  bad=$(printf '%s\n' "$ev" | grep -v " name=$SELF " | head -3)
  if [ -z "$bad" ]; then rec PASS "$1" "metadata at tunnel link-up answered as $SELF ($(printf '%s\n' "$ev" | wc -l) events)"
  else rec FAIL "$1" 'metadata at tunnel link-up answered as another machine (rename race)' "$bad"; fi
}
meta_window() { # <protocol> <from epoch> <to epoch>
  [ -n "$SELF" ] || return 0
  local n bad miss host
  n=$(awk -v a="$2" -v b="$3" '$1>=a && $1<=b' "$META" | wc -l)
  bad=$(awk -v a="$2" -v b="$3" -v s="$SELF" '$1>=a && $1<=b && NF>=3 && $2!=s' "$META" | head -3 | tr '\n' ' ')
  miss=$(awk -v a="$2" -v b="$3" '$1>=a && $1<=b && NF<3' "$META" | wc -l)
  host=$(awk -v a="$2" -v b="$3" -v h="$HOST0" '$1>=a && $1<=b && $NF!=h' "$META" | head -2 | tr '\n' ' ')
  if [ "$n" -gt 0 ] && [ -z "$bad" ]; then rec PASS "$1" "metadata answered as $SELF for the whole session ($n samples, $miss timeouts)"; else rec FAIL "$1" "metadata answered as another machine ($n samples)" "$bad"; fi
  if [ -z "$host" ]; then rec PASS "$1" "hostname stayed $HOST0"; else rec FAIL "$1" "hostname changed" "$host"; fi
}

cli daemon set --kill-switch on --yes > /dev/null; sleep 6
for p in $PROTOS; do
  hold
  T0=$(date +%s)
  if ! cli connect "${NODES[$p]}" --units 1 --yes > "$OUT/connect-$p.txt"; then rec FAIL "$p" connect "$(tail -3 "$OUT/connect-$p.txt")"; sleep 7; continue; fi
  check "$p" 'connected: egress = node' via_node "$p"
  check "$p" 'kill switch table up' table_up
  # V2Ray/Xray are proxies (no default route through a tunnel): only the four tunnels need the card route
  TUN=0; case $p in wireguard|amneziawg|openvpn|hysteria2) TUN=1 ;; esac
  # dvpnd 0024 (ddv16.27): ip rule pref 8989 to 169.254.169.254 (+ OpenVPN's server /32) → the card's own
  # table, which NetworkManager never flushes (0023's main-table proto 241 route did not survive NM re-apply)
  meta_route() { ip -4 rule show pref 8989 | grep -q 'to 169.254.169.254' || { ip -4 rule show pref 8989; return 1; }
    [ "$1" != openvpn ] || ip -4 rule show pref 8989 | grep -q "to $NODE_IP" || { echo "no rule to the server $NODE_IP"; return 1; }
    ip route get 169.254.169.254 | grep -q "dev $(ip route show default | awk '{print $5; exit}')" || { ip route get 169.254.169.254; return 1; }; }
  export -f meta_route
  [ -n "$SELF" ] && [ $TUN = 1 ] && check "$p" 'metadata (and OpenVPN server) kept on the card (0024: rule pref 8989)' meta_route "$p"
  if [ $FWD = 1 ]; then
    hold; sudo firewall-cmd -q --reload; sleep 3
    check "$p" 'firewall-cmd --reload: kill switch table still up' table_up
    check "$p" 'firewall-cmd --reload: egress still the node' via_node "$p"
    hold; sudo systemctl restart firewalld; sleep 4
    check "$p" 'firewalld restart: kill switch table still up' table_up
    check "$p" 'firewalld restart: egress still the node' via_node "$p"
  fi
  if [ $RESOLVED = 0 ] && [ -n "$MAINCON" ]; then
    rec INFO "$p" 'resolv.conf during the session' "$(grep -v '^#' /etc/resolv.conf | tr '\n' ' ')"
    sudo cp /etc/resolv.conf /etc/resolv.conf.ddv-during
    hold; sudo nmcli con up "$MAINCON" >/dev/null 2>&1; sleep 6
    rec INFO "$p" 'resolv.conf after NetworkManager re-applied the uplink' "$(grep -v '^#' /etc/resolv.conf | tr '\n' ' ')"
    # resolvconf mode writes the file once; NM rewrites it on re-apply / DHCP renew (a test VM saw the
    # same on Arch with dhclient). The VPN's resolvers must still be the ones in use mid-session.
    export NS_DURING="$(grep '^nameserver' /etc/resolv.conf.ddv-during 2>/dev/null)"
    check "$p" 'NM re-apply: resolv.conf still has the VPN resolvers (not the uplink DNS)' bash -c "[ -n \"\$NS_DURING\" ] && [ \"\$(grep '^nameserver' /etc/resolv.conf)\" = \"\$NS_DURING\" ]"
    check "$p" 'NM re-apply: egress still the node' via_node "$p"
    check "$p" 'NM re-apply: kill switch table still up' table_up
    # NM re-apply deletes eth0 routes it does not own (Rocky 9, ddv16.26: 0023's proto 241 route went, metadata answered as the node)
    [ -n "$SELF" ] && [ $TUN = 1 ] && check "$p" 'NM re-apply: metadata (and OpenVPN server) still on the card' meta_route "$p"
  fi
  sleep 7; hold
  check "$p" 'disconnect' cli disconnect
  sleep 3
  check "$p" 'nothing left, direct IP back' bash -c "for i in 1 2 3 4; do nothing_left && [ \"\$(curl -s -m 12 https://api.ipify.org)\" = '$DIRECT' ] && exit 0; sleep 4; done; nothing_left; exit 1"
  if [ $RESOLVED = 0 ]; then
    check "$p" 'resolv.conf back to the pre-session file' bash -c "[ \"\$(cat /etc/resolv.conf)\" = \"\$RESOLV0\" ] || { diff <(printf '%s\n' \"\$RESOLV0\") /etc/resolv.conf; exit 1; }"
  fi
  sleep 5
  [ -n "$SELF" ] && check "$p" 'our card rules removed after the session (pref 8989 + proto 241 gone)' bash -c "! ip -4 rule show pref 8989 | grep -q . && ! ip route show proto 241 | grep -q ."
  meta_window "$p" "$T0" "$(date +%s)"
  probe_window "$p" "$T0"
  sleep 2
done
[ -n "${METAPID:-}" ] && kill "$METAPID" 2>/dev/null
sudo rm -f "$PROBE"
sudo rm -f /etc/resolv.conf.ddv-during
cli daemon set --kill-switch off --yes > /dev/null; sleep 6

# ─── SELinux: nothing was denied during the run (dontaudit rules on, as shipped) ───
# --input-logs: without it ausearch reads events from stdin whenever stdin is not a terminal (SSH,
# nohup, the queue) and finds nothing, which turned this check into a silent pass. -ts takes date
# and time as TWO arguments. Positive control: sudo itself logs USER_START during the run.
sudo ausearch --input-logs -m avc,user_avc,selinux_err -ts $START > "$OUT/avc.txt" 2>&1
check all 'audit log is readable (control: sudo USER_START events of this run found)' bash -c "sudo ausearch --input-logs -m USER_START -ts $START 2>/dev/null | grep -q type=USER_START"
# OS-side, not ours: Fedora's sshd runs sshd_auth_t permissive and logs a signal denial on logout
OS_AVC='comm="sshd-session" .*tcontext=system_u:system_r:sshd_auth_t'
check all "no SELinux denial since $START" bash -c "! grep 'denied' '$OUT/avc.txt' | grep -vqE '$OS_AVC' || { grep 'denied' '$OUT/avc.txt' | grep -vE '$OS_AVC' | grep -oE 'denied .*' | sed -E 's/pid=[0-9]+ //' | sort | uniq -c | head; exit 1; }"
rec INFO all "SELinux errors (policy, not denials) since $START: $(grep -c SELINUX_ERR "$OUT/avc.txt")"
echo; echo "platform-el ($ID $VERSION_ID): passed $PASS  failed $FAIL  (details $LOG)"
