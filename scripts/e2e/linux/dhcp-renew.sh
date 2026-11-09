#!/usr/bin/env bash
# ─── DHCP renewal mid-session (run ON the VM): the network's own resolv.conf writer must not undo
# the session's DNS ───
# Where dvpnd writes /etc/resolv.conf itself (dns_backend 'resolvconf': no systemd-resolved), the
# DHCP client or NetworkManager rewrites that file at every lease renewal (~24 min on GCE). Before
# dvpnd 0015 the session silently fell back to the network's resolver (ddv-plat-arch 2026-10-22);
# 0015 re-asserts the session's servers and makes the writer's newest file the restore target.
# Per protocol, kill switch on: connect → force a renewal → session DNS back within 5 s, names
# resolve, no DNS on the real NIC → disconnect → resolv.conf = what the writer produces now.
# Results: ~/edge/dhcprenew.tsv + .log. Usage: bash dhcp-renew.sh [protocol…]
set -u
export PATH="$PATH:/usr/sbin:/sbin"
: "${DVPN_KEYFILE:?set DVPN_KEYFILE}"; export DVPN_DATA_DIR=${DVPN_DATA_DIR:-$HOME/ddv-data}
OUT=~/edge; mkdir -p "$OUT"; TSV="$OUT/dhcprenew.tsv"; LOG="$OUT/dhcprenew.log"; : > "$TSV"; : > "$LOG"
declare -A NODES=([wireguard]=SLVJNn38s5RfqcVW7a7A4hGKqjY7Y1bKkUpG7wrGX5D [hysteria2]=E8nefMLBuBzG1CrA4dSDU9mqq6ZNpv69Bt3w9QEtzvPf
  [amneziawg]=1PwMkSjnyugAZHdHvDsddETzPUAubPkeyWymT7Ercn6 [openvpn]=9EQJ7dBwneFUse9yy8Hg56u2wPiGF5qkjAaA1ZAr64nP
  [v2ray]=Di5V9K2Vt5uptJUk7oVVnkDRXt9qWy5HhLbkEJMxEuM2 [xray]=E9RG1iZJjsLfEuLfDYTHM4yXCjyFE21jBbJLFvGoL2FD)
. "$(dirname "$0")/nodes.sh"; nodeset_apply   # NODE_SET=node4 → that node set (nodes.sh)
PROTOS=${*:-wireguard hysteria2}
PASS=0; FAIL=0
rec() { printf '%s\t%s\t%s\n' "$1" "$2" "$(printf '%s' "${3:-}" | tr '\n\t' '  ' | cut -c1-300)" >> "$TSV"; echo "$1 $2" | tee -a "$LOG"; [ "$1" = PASS ] && PASS=$((PASS + 1)); [ "$1" = FAIL ] && FAIL=$((FAIL + 1)); true; }
cli() { devnet-dvpn "$@" 2>&1 | grep -v '^\[rpc\]'; return "${PIPESTATUS[0]}"; }
hold() { sudo touch /run/ddv-deadman.hold 2>/dev/null; true; }
ns() { grep -E '^nameserver' /etc/resolv.conf | awk '{print $2}' | tr '\n' ' '; }

BACKEND=$(sudo grep -h '^dns_backend' /var/lib/dvpnd/client/client/config.toml 2>/dev/null | sed "s/.*= *'\{0,1\}\([a-z]*\).*/\1/")
DEV=$(ip -4 route show default | awk '{print $5; exit}')

# ─── systemd-resolved variant (DIR 2026-10-29): the MORE common leak risk ───
# A renewal hands the uplink its DHCP DNS again; if it also gets a routing domain (~.) or wins the
# default route, names leave on the real NIC beside the tunnel. Kill switch OFF on purpose (the app's
# default): with it on, nft drops a leaked query before tcpdump can see it, which would hide the bug.
# Per protocol: connect → find the session's link (the one carrying ~.) → renew the uplink lease →
# resolved still routes every name to the session link only, no DNS packet on the uplink, names resolve
# → disconnect → the uplink has its own DNS back and names resolve direct.
if [ "$BACKEND" = resolvectl ]; then
  rlinks() { # one line per link: iface|dns servers|domains|default-route
    resolvectl status --no-pager 2>/dev/null | awk '
      function out() { if (n != "") print n "|" d "|" m "|" r }
      /^Link [0-9]+ \(/ { out(); n = $3; gsub(/[()]/, "", n); d = ""; m = ""; r = ""; next }
      /^Global/ { out(); n = ""; next }
      n != "" && /DNS Servers?:/ { s = $0; sub(/.*DNS Servers?: */, "", s); d = s }
      n != "" && /DNS Domain:/ { s = $0; sub(/.*DNS Domain: */, "", s); m = s }
      n != "" && /(DefaultRoute setting|Default Route):/ { r = $NF }
      END { out() }'
  }
  tunlink() { rlinks | awk -F'|' '$3 ~ /(^| )~\.( |$)/ {print $1; exit}'; }
  # the renewer: networkd, NetworkManager or a dhclient unit, whichever manages the uplink
  if networkctl status "$DEV" 2>/dev/null | grep -qE 'State: .*(configured|configuring)'; then WRITER=networkd; renew() { sudo networkctl renew "$DEV"; }
  elif systemctl is-active -q NetworkManager 2>/dev/null; then WRITER=NetworkManager; renew() { sudo nmcli device reapply "$DEV" >/dev/null; }
  elif DHC=$(systemctl list-units --state=running --no-legend 'dhclient@*.service' 2>/dev/null | awk '{print $1}' | head -1) && [ -n "$DHC" ]; then WRITER=$DHC; renew() { sudo systemctl restart "$DHC"; }
  else WRITER=none; fi
  echo "backend resolvectl, renewer $WRITER, uplink $DEV" | tee -a "$LOG"
  [ "$WRITER" = none ] && { echo "dhcprenew: passed 0  failed 0"; echo "BLOCK n/a: no DHCP client manages $DEV (static address), nothing to renew"; exit 0; }
  command -v tcpdump >/dev/null || { rec FAIL 'tcpdump present (needed for the leak check)' ''; echo "dhcprenew: passed $PASS  failed $FAIL"; exit 1; }
  KS0=$(cli daemon settings --json | grep -oE '"killSwitch" *: *"[a-z]+"' | head -1 | grep -oE '"[a-z]+"$' | tr -d '"')
  echo "kill switch before: ${KS0:-unknown (restored to off)}" >> "$LOG"
  hold; cli daemon set --kill-switch off --yes >> "$LOG"; sleep 4
  U0=$(rlinks | awk -F'|' -v u="$DEV" '$1 == u {print $2}'); echo "uplink DNS before: ${U0:-none}" >> "$LOG"
  for p in $PROTOS; do
    hold
    if ! cli connect "${NODES[$p]}" --units 1 --yes >> "$LOG"; then rec FAIL "[$p] connect" "$(tail -2 "$LOG")"; sleep "${PACE_DHCP:-20}"; continue; fi
    sleep 8
    T=$(tunlink); { echo "[$p] resolved before the renewal:"; rlinks; } >> "$LOG"
    if [ -z "$T" ] || [ "$T" = "$DEV" ]; then rec FAIL "[$p] session DNS routed via resolved (a tunnel link with ~.)" "$(rlinks | tr '\n' ';')"; hold; cli disconnect >> "$LOG"; sleep "${PACE_DHCP:-20}"; continue; fi
    rec PASS "[$p] session DNS on link $T (~.)" "$(rlinks | awk -F'|' -v t="$T" '$1 == t' )"
    # baseline BEFORE the renewal: a leak here is not the renewal's doing (failed names retried with the
    # uplink's DHCP search domains go to the uplink resolver: TLX 17:27Z arm-u2404, ...google.internal)
    sudo timeout 10 tcpdump -ni "$DEV" -c 6 'udp port 53 or tcp port 53 or tcp port 853' > "$OUT/dhcprenew-$p-before.pcap.txt" 2>&1 &
    sleep 1; for i in 1 2 3; do getent hosts "ddv-$RANDOM$RANDOM.example.com" >/dev/null; done; getent hosts wikipedia.org >/dev/null; wait
    lb=$(grep -cE ' > [0-9a-f.:]+\.(53|853|domain): ' "$OUT/dhcprenew-$p-before.pcap.txt")
    [ "$lb" = 0 ] && rec PASS "[$p] before the renewal: no DNS on $DEV" '' \
      || rec FAIL "[$p] before the renewal: DNS already leaves on $DEV (not caused by the renewal)" "$(grep -oE '> [0-9a-f.:]+\.(53|domain): .*\? [^ ]+' "$OUT/dhcprenew-$p-before.pcap.txt" | head -2 | tr '\n' ';')"
    hold; renew || rec FAIL "[$p] trigger a renewal ($WRITER)" ''
    sleep 6; { echo "[$p] resolved after the $WRITER renewal:"; rlinks; } >> "$LOG"
    T2=$(tunlink)
    [ "$T2" = "$T" ] && rec PASS "[$p] after a $WRITER renewal ~. is still on $T only" '' || rec FAIL "[$p] after the renewal the ~. route moved" "was $T, now ${T2:-none}: $(rlinks | tr '\n' ';')"
    up=$(rlinks | awk -F'|' -v u="$DEV" '$1 == u'); echo "[$p] uplink after renewal: $up" >> "$LOG"
    awk -F'|' '{exit !($3 ~ /(^| )~\.( |$)/)}' <<< "$up" && rec FAIL "[$p] the uplink got a ~. routing domain back" "$up" || rec PASS "[$p] the uplink has no ~. routing domain after the renewal" "$up"
    # the wire: random names, then a real one; not one DNS packet may leave on the uplink
    sudo timeout 14 tcpdump -ni "$DEV" -c 6 'udp port 53 or tcp port 53 or tcp port 853' > "$OUT/dhcprenew-$p.pcap.txt" 2>&1 &
    sleep 1
    for i in 1 2 3; do getent hosts "ddv-$RANDOM$RANDOM.example.com" >/dev/null; done
    q=$(resolvectl query --cache=no wikipedia.org 2>&1); r=$(getent hosts wikipedia.org | head -1)
    wait
    echo "[$p] resolvectl query: $(tr '\n' ' ' <<< "$q" | cut -c1-240)" >> "$LOG"
    [ -n "$r" ] && rec PASS "[$p] names resolve after the renewal" "$r" || rec FAIL "[$p] names do not resolve after the renewal" "$q"
    ql=$(grep -oE 'link: [A-Za-z0-9_.-]+' <<< "$q" | awk '{print $2}' | sort -u | tr '\n' ' ')
    [ -z "$ql" ] || [ "$ql" = "$T " ] && rec PASS "[$p] resolved answered via ${ql:-the session link}" '' || rec FAIL "[$p] resolved answered via another link" "$ql (session link $T)"
    leak=$(grep -cE ' > [0-9a-f.:]+\.(53|853|domain): ' "$OUT/dhcprenew-$p.pcap.txt")
    [ "$leak" = 0 ] && rec PASS "[$p] no DNS on $DEV outside the tunnel after the renewal" '' || rec FAIL "[$p] after the renewal: DNS left on $DEV outside the tunnel" "$(grep -oE '> [0-9a-f.:]+\.(53|domain): .*\? [^ ]+' "$OUT/dhcprenew-$p.pcap.txt" | head -2 | tr '\n' ';')"
    hold; cli disconnect >> "$LOG"; sleep 5
    U1=$(rlinks | awk -F'|' -v u="$DEV" '$1 == u {print $2}'); r=$(getent hosts wikipedia.org | head -1)
    [ -n "$U1" ] && [ -z "$(tunlink | grep -vx "$DEV")" ] && [ -n "$r" ] && rec PASS "[$p] disconnect: uplink DNS back ($U1), names resolve direct" '' \
      || rec FAIL "[$p] after disconnect the uplink DNS is not back" "uplink '${U1:-none}' (before '${U0:-none}'), ~. on '$(tunlink)', resolve '${r:-none}'"
    sleep "${PACE_DHCP:-20}"
  done
  hold; cli daemon set --kill-switch "${KS0:-off}" --yes >> "$LOG" 2>&1; sleep 4
  e=$(curl -4 -s -m 12 https://api.ipify.org)
  [ -n "$e" ] && rec PASS "restored (kill switch ${KS0:-off}): direct internet, egress $e" '' || rec FAIL 'no direct internet after restore' ''
  echo "dhcprenew: passed $PASS  failed $FAIL  (details $LOG)"
  [ $FAIL = 0 ]; exit
fi
if [ "$BACKEND" != resolvconf ]; then
  echo "dhcprenew: passed 0  failed 0"
  echo "BLOCK n/a: dns_backend '${BACKEND:-?}' (neither resolvectl nor resolvconf), nothing tested"; exit 0
fi
# the writer: ISC dhclient (unit or bare), dhcpcd, NetworkManager
DHC=$(systemctl list-units --state=running --no-legend 'dhclient@*.service' 2>/dev/null | awk '{print $1}' | head -1)
DEV=$(ip -4 route show default | awk '{print $5; exit}')
renew() {
  if [ -n "$DHC" ]; then sudo systemctl restart "$DHC"
  elif systemctl is-active -q NetworkManager 2>/dev/null; then sudo nmcli device reapply "$DEV" >/dev/null
  elif pgrep -x dhcpcd >/dev/null; then sudo dhcpcd -n "$DEV" >/dev/null 2>&1
  else return 1; fi
}
WRITER=${DHC:-$(systemctl is-active -q NetworkManager 2>/dev/null && echo NetworkManager || (pgrep -x dhcpcd >/dev/null && echo dhcpcd) || echo none)}
echo "backend $BACKEND, writer $WRITER, uplink $DEV" | tee -a "$LOG"
[ "$WRITER" = none ] && { rec SKIP 'no resolv.conf writer on this host (static resolv.conf)' ''; echo "dhcprenew: passed 0  failed 0  (skipped: no writer)"; echo 'BLOCK n/a: no resolv.conf writer (static resolv.conf), nothing tested'; exit 0; }
command -v tcpdump >/dev/null || rec FAIL 'tcpdump present (needed for the leak check)' ''

hold; cli daemon set --kill-switch on --yes >> "$LOG"; sleep 6
for p in $PROTOS; do
  hold
  if ! cli connect "${NODES[$p]}" --units 1 --yes >> "$LOG"; then rec FAIL "[$p] connect" "$(tail -2 "$LOG")"; sleep "${PACE_DHCP:-20}"; continue; fi
  sleep 8
  SESSION_NS=$(ns); echo "[$p] session DNS: $SESSION_NS" >> "$LOG"
  hold; renew || rec FAIL "[$p] trigger a renewal ($WRITER)" ''
  back=0; for i in $(seq 1 10); do sleep 0.5; [ "$(ns)" = "$SESSION_NS" ] && { back=1; break; }; done
  [ $back = 1 ] && rec PASS "[$p] session DNS back within 5 s of a $WRITER renewal ($SESSION_NS)" '' \
                || rec FAIL "[$p] session DNS not restored after a $WRITER renewal" "now: $(ns) want: $SESSION_NS"
  sleep 2
  [ "$(ns)" = "$SESSION_NS" ] && rec PASS "[$p] still the session DNS 2 s later (no flapping)" '' || rec FAIL "[$p] DNS changed again" "$(ns)"
  sudo timeout 10 tcpdump -ni "$DEV" -c 4 'udp port 53 or tcp port 53' > "$OUT/dhcprenew-$p.pcap.txt" 2>&1 &
  sleep 1
  getent hosts "ddv-$RANDOM.example.com" >/dev/null; r=$(getent hosts wikipedia.org | head -1)
  wait
  [ -n "$r" ] && rec PASS "[$p] names resolve after the renewal" '' || rec FAIL "[$p] names do not resolve after the renewal" ''
  leak=$(grep -cE ' > [0-9a-f.:]+\.53: | > [0-9a-f.:]+\.domain: ' "$OUT/dhcprenew-$p.pcap.txt")
  [ "$leak" = 0 ] && rec PASS "[$p] no DNS on $DEV outside the tunnel" '' || rec FAIL "[$p] DNS left on $DEV outside the tunnel" "$(grep -E '\.53:|domain:' "$OUT/dhcprenew-$p.pcap.txt" | head -2)"
  hold; cli disconnect >> "$LOG"; sleep 4
  R1=$(cat /etc/resolv.conf); renew; sleep 5; R2=$(cat /etc/resolv.conf)
  [ "$R1" = "$R2" ] && [ "$(ns)" != "$SESSION_NS" ] && rec PASS "[$p] disconnect restored the network's newest resolver ($(ns))" '' \
                    || rec FAIL "[$p] after disconnect resolv.conf is not what $WRITER writes" "$(diff <(echo "$R1") <(echo "$R2") | head -4)"
  sleep "${PACE_DHCP:-20}"
done
hold; cli daemon set --kill-switch off --yes >> "$LOG"; sleep 5
e=$(curl -4 -s -m 12 https://api.ipify.org)
[ -n "$e" ] && rec PASS "kill switch off: direct internet ($e)" '' || rec FAIL 'no direct internet after kill switch off' ''
echo "dhcprenew: passed $PASS  failed $FAIL  (details $LOG)"
[ $FAIL = 0 ]
