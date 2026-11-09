#!/usr/bin/env bash
# ─── route-proof.sh — 0024 + 0027 routing proof (dvpnd ≥ ddv16.30), run ON the test VM, detached ───
# For WireGuard, AmneziaWG, OpenVPN: during a session the metadata server and the node leave by the
# card (pref 8989 → table 8990), everything else by the tunnel (/1 halves in main), no fwmark/51820
# rules; after disconnect nothing of it is left. Expected lines from the matrix session (2026-10-23).
#   setsid nohup bash ~/route-proof.sh > ~/route-proof.out 2>&1 < /dev/null &
# Results: ~/route/route.tsv (PASS/FAIL lines) + ~/route/route.log (every command and its output).
# Cloud metadata oracle: GCP (Metadata-Flavor) or Azure IMDS (Metadata: true), whichever answers.
set -u
export PATH="$PATH:/usr/sbin:/sbin"
. ~/ddvl/scripts/e2e/linux/lib.sh
suite_init route route
CARD=$NIC; GW=$(ip -4 route show default | awk '{print $3; exit}')
ADDR=$(ip -4 -o addr show dev "$CARD" | awk '{print $4}' | cut -d/ -f1 | head -1)
md_host() { if curl -s -m 3 -o /dev/null -H 'Metadata-Flavor: Google' http://169.254.169.254/computeMetadata/v1/ 2>/dev/null; then curl -s -m 8 -H 'Metadata-Flavor: Google' http://169.254.169.254/computeMetadata/v1/instance/hostname; else curl -s -m 8 -H 'Metadata: true' 'http://169.254.169.254/metadata/instance/compute/name?api-version=2021-02-01&format=text'; fi; }   # GCP, else Azure IMDS
SELF=$(md_host)
note "card=$CARD gw=$GW addr=$ADDR node=$NODE_IP self=$SELF direct=$DIRECT"
[ -n "$SELF" ] || { record FAIL "baseline: metadata hostname readable before any session" ''; }

rules() { ip -4 rule show; }

during() { # <protocol>
  local p=$1 r; r=$(rules)
  check "$p: rule 8989 to 169.254.169.254 lookup 8990" grep -qE '^8989:[[:space:]]+from all to 169\.254\.169\.254 lookup 8990' <<<"$r"
  check "$p: rule 8989 to node $NODE_IP lookup 8990" grep -qE "^8989:[[:space:]]+from all to ${NODE_IP//./\\.} lookup 8990" <<<"$r"
  check "$p: rule 8990 from card address $ADDR" grep -qE "^8990:[[:space:]]+from ${ADDR//./\\.} lookup 8990" <<<"$r"
  check "$p: no fwmark / 51820 / suppress_prefixlength rule" bash -c "! grep -qE 'fwmark|51820|suppress_prefixlength' <<<\"\$1\"" _ "$r"
  check "$p: no rule pref 1–8988" bash -c "! awk -F: '\$1+0>=1 && \$1+0<=8988' <<<\"\$1\" | grep -q ." _ "$r"
  check "$p: no table 51820" bash -c "! ip -4 route show table 51820 2>/dev/null | grep -q ."
  local tun; tun=$(tunnel_link)
  check "$p: /1 halves in main via the tunnel ($tun)" bash -c "ip -4 route show table main | grep -qE '^0\.0\.0\.0/1 .*dev $tun' && ip -4 route show table main | grep -qE '^128\.0\.0\.0/1 .*dev $tun'"
  check "$p: original default via $GW dev $CARD still in main" bash -c "ip -4 route show table main | grep -qE '^default via ${GW//./\\.} dev $CARD'"
  check "$p: route get 169.254.169.254 → dev $CARD" bash -c "ip route get 169.254.169.254 | grep -q 'dev $CARD'"
  check "$p: route get node → via $GW dev $CARD table 8990" bash -c "ip route get $NODE_IP | grep -qE 'via ${GW//./\\.} dev $CARD.*table 8990'"
  check "$p: route get 1.1.1.1 → dev $tun" bash -c "ip route get 1.1.1.1 | grep -q 'dev $tun'"
  local h; h=$(md_host)
  check "$p: metadata answers this VM ($SELF), not the node" test -n "$h" -a "$h" = "$SELF"
  check "$p: egress is the node" egress_is_node "$p"
  { echo "## $p during $(date -u +%TZ)"; ip -4 rule show; ip -4 route show table main; ip -4 route show table 8990; ip -6 route show 2>/dev/null | head -8; } >> "$LOG"
}
after() { # <protocol>
  local p=$1
  check "$p: after: no pref 8989/8990 rules" bash -c "! ip -4 rule show | grep -qE '^89(89|90):'"
  check "$p: after: no /1 routes in main" bash -c "! ip -4 route show table main | grep -qE '^(0\.0\.0\.0|128\.0\.0\.0)/1 '"
  check "$p: after: table 8990 empty" bash -c "! ip -4 route show table 8990 2>/dev/null | grep -q ."
  local h; h=$(md_host)
  check "$p: after: metadata still answers this VM" test -n "$h" -a "$h" = "$SELF"
  back_clean "$p"
}

for P in wireguard amneziawg openvpn; do
  mark
  # positive control: before connecting, there must be NO 8989 rule (a check that can't see would pass)
  check "$P: before: no pref 8989 rule yet (control)" bash -c "! ip -4 rule show | grep -q '^8989:'"
  if connect_p "$P"; then
    sleep 5; hold; during "$P"
    if [ "$P" != openvpn ] && ip -6 addr show scope global 2>/dev/null | grep -q inet6; then
      check "$P: IPv6 ::/1 + 8000::/1 via the tunnel" bash -c "ip -6 route | grep -q '^::/1 ' && ip -6 route | grep -q '^8000::/1 '"
    fi
    gap; run 0 '-' "disconnect" -- disconnect; sleep 5
  fi
  restore; after "$P"; health "$P"
  gap; sleep 30
done
note "route-proof: passed $PASS  failed $FAIL"
printf 'route-proof: passed %s  failed %s\n' "$PASS" "$FAIL"
