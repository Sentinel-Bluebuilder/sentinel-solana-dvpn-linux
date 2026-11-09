#!/usr/bin/env bash
# ─── Split tunnelling by address range, live (dvpnd ddv12+ on WireGuard/AmneziaWG/OpenVPN/Hysteria2) ───
# Run DETACHED on a disposable test VM (exclude mode sends the SSH replies into the tunnel):
#   nohup bash split-test.sh > ~/split/run.out 2>&1 &
# Chosen routes = api.ipify.org's IPv4 addresses; control = checkip.amazonaws.com (not chosen).
#   include: ipify exits at the node, amazonaws exits direct
#   exclude: ipify exits direct, amazonaws exits at the node
# Also: `daemon set --split-apps` is refused on Linux, V2Ray/Xray keep the whole proxy session, and
# split is off again at the end. Kill switch off (dvpnd keeps the full tunnel with it on).
# Results: ~/split/split.tsv (PASS/FAIL <tab> check <tab> detail). Env: DVPN_KEYFILE, DVPN_DATA_DIR.
set -u
OUT=~/split; mkdir -p "$OUT"; TSV="$OUT/split.tsv"; : > "$TSV"
CLI=devnet-dvpn
declare -A NODE=(
  [wireguard]=SLVJNn38s5RfqcVW7a7A4hGKqjY7Y1bKkUpG7wrGX5D
  [amneziawg]=1PwMkSjnyugAZHdHvDsddETzPUAubPkeyWymT7Ercn6
  [openvpn]=9EQJ7dBwneFUse9yy8Hg56u2wPiGF5qkjAaA1ZAr64nP
  [hysteria2]=E8nefMLBuBzG1CrA4dSDU9mqq6ZNpv69Bt3w9QEtzvPf
  [v2ray]=Di5V9K2Vt5uptJUk7oVVnkDRXt9qWy5HhLbkEJMxEuM2
)
NODE_IP=192.0.2.2
. "$(dirname "$0")/nodes.sh"; nodeset_apply   # NODE_SET=node4 → that node set (nodes.sh)
cli() { $CLI "$@" 2>&1 | grep -v '^\[rpc\]'; return "${PIPESTATUS[0]}"; }
# the detail goes to the log too (only the TSV had it, so a cell log FAIL said nothing: c1-arch-split 10-29)
rec() { local d; d=$(printf '%s' "${3:-}" | tr '\n\t' '  ' | cut -c1-240); printf '%s\t%s\t%s\n' "$1" "$2" "$d" >> "$TSV"; echo "$1 $2${d:+ :: $d}"; }
# an empty answer says why (curl's own error: timeout, resolve, reset), so a wrong exit and a dead probe differ
probe() { local o; o=$(curl -4 -sS -m 12 "$1" 2>&1); case $o in *[0-9].*[0-9].*[0-9].*[0-9]*) printf '%s' "$o" | tr -d '\n' ;; *) printf 'none (%s)' "$(printf '%s' "$o" | tr '\n' ' ' | cut -c1-100)" ;; esac; }
ipify() { probe https://api.ipify.org; }
aws() { probe https://checkip.amazonaws.com; }
retry() { local want=$1 f=$2 got=''; for _ in 1 2 3; do got=$($f); [ "$got" = "$want" ] && break; sleep 3; done; printf '%s' "$got"; }
setsplit() { cli daemon set "$@" --yes; local rc=$?; sleep 6; return $rc; }

DIRECT=$(ipify)
ROUTES=$(getent ahostsv4 api.ipify.org | awk '{print $1"/32"}' | sort -u | paste -sd,)
rec INFO "direct $DIRECT, ipify routes $ROUTES" ''
[[ $DIRECT != none* ]] && [ -n "$DIRECT" ] && [ -n "$ROUTES" ] || { rec FAIL 'setup: direct IP and ipify routes known' "$DIRECT / $ROUTES"; exit 1; }
sudo touch /run/ddv-deadman.hold

# Apps are Windows-only: refused before anything is written.
o=$(cli daemon set --split-mode include --split-apps /usr/bin/firefox --yes); rc=$?
# Only the 'Windows only' copy passes (F-C1-3 fix 87f23b67). 'unknown option --split-apps' is the bug itself,
# so it must fail; accepting it (6bf13f4f) left the cell with no negative control.
[ $rc -ne 0 ] && grep -q 'Windows only' <<<"$o" && rec PASS 'split by app refused on Linux (clear message)' "$o" || rec FAIL 'split by app refused on Linux' "rc=$rc $o"

for mode in include exclude; do
  if ! o=$(setsplit --kill-switch off --split-mode "$mode" --split-routes "$ROUTES"); then rec FAIL "[$mode] daemon set" "$o"; continue; fi
  o=$(cli daemon settings)
  grep -qE "split +$mode" <<<"$o" && rec PASS "[$mode] settings read back" "$(grep -E '^split' <<<"$o")" || rec FAIL "[$mode] settings read back" "$o"
  for p in wireguard amneziawg openvpn hysteria2; do
    sudo touch /run/ddv-deadman.hold
    if ! o=$(cli connect "${NODE[$p]}" --units 1 --yes); then rec FAIL "$p [$mode] connect" "$o"; sleep 7; continue; fi
    sleep 5
    if [ "$mode" = include ]; then wi=$NODE_IP; wa=$DIRECT; else wi=$DIRECT; wa=$NODE_IP; fi
    e1=$(retry "$wi" ipify); e2=$(retry "$wa" aws)
    [ "$e1" = "$wi" ] && rec PASS "$p [$mode] chosen route (ipify) exits $([ "$mode" = include ] && echo node || echo direct)" "egress $e1" || rec FAIL "$p [$mode] chosen route (ipify)" "got $e1 want $wi; $(ip route get "${ROUTES%%/*}" | head -1)"
    [ "$e2" = "$wa" ] && rec PASS "$p [$mode] other sites (amazonaws) exit $([ "$mode" = include ] && echo direct || echo node)" "egress $e2" || rec FAIL "$p [$mode] other sites (amazonaws)" "got $e2 want $wa"
    st=$(cli status | grep -E '^(Session|Covers|Coverage|Protection)' | head -3)
    rec INFO "$p [$mode] status" "$st"
    # the title must match what the session does (exclude: the IP check skips left-out services)
    if [ "$mode" = include ]; then want='Protected for the apps you chose'; else want='Protected, except what you left out'; fi
    st=''; for _ in 1 2 3 4; do st=$(cli status | grep -E '^Session' | head -1); grep -qF "$want" <<<"$st" && break; sleep 8; done
    grep -qF "$want" <<<"$st" && rec PASS "$p [$mode] status says \"$want\"" "$st" || rec FAIL "$p [$mode] status title" "$st"
    sleep 7
    cli disconnect >/dev/null; sleep 3
    [ "$(ipify)" = "$DIRECT" ] && [ "$(aws)" = "$DIRECT" ] && rec PASS "$p [$mode] direct again after disconnect" "egress $DIRECT" || rec FAIL "$p [$mode] direct again after disconnect" "$(ipify) $(aws)"
    sleep 7
  done
done

# V2Ray (proxy): the split does not apply; the proxy session is unchanged.
sudo touch /run/ddv-deadman.hold
if cli connect "${NODE[v2ray]}" --units 1 --yes >/dev/null; then
  sleep 5
  sp=$($CLI proxy status --json 2>/dev/null | grep -oE '127\.0\.0\.1:[0-9]+' | head -1)
  e=$(curl -4 -s -m 12 --socks5-hostname "$sp" https://api.ipify.org)
  [ "$e" = "$NODE_IP" ] && rec PASS 'v2ray with split set: proxy still exits at the node' "egress $e" || rec FAIL 'v2ray with split set: proxy exits at the node' "$e via $sp"
  sleep 7; cli disconnect >/dev/null; sleep 3
else
  rec FAIL 'v2ray connect with split set' ''
fi

o=$(setsplit --split-mode off --split-routes none)
o2=$(cli daemon settings)
grep -qE '^split +off' <<<"$o2" && rec PASS 'split off again' "$(grep -E '^split' <<<"$o2")" || rec FAIL 'split off again' "$o $o2"
echo DONE >> "$OUT/run.out"
