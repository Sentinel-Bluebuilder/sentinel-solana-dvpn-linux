#!/usr/bin/env bash
# ─── Kill switch at a session that ENDS BY ITSELF (Q0353; DIR 10-29). Run ON the VM. Usage: ks-end.sh <protocol> ───
# rc3 (cf4c372) removed the WHOLE kill switch when a per-GB deposit ran out with KS on: inet dvpnd + dvpnd_v6guard
# gone, IPv4 left direct, 91 IPv6 packets reached a test peer in 30 s (u24d 10-29 22:35Z). The contract with KS on is
# "blocked, never direct" until the user turns it off or connects again.
# IPv6 without a dual-stack host: a netns peer (fd53::2) on a veth is the VM's ONLY v6 default route, so every v6
# packet to the internet reaches it, where an nft counter (prerouting, before any drop) counts it.
#   1  positive control: KS off, no session -> the v6 probe MUST reach the peer (else BLOCK: the counter proves nothing)
#   2  KS on, session up -> 0 v6 at the peer, egress = node
#   3  the deposit runs out on its own (a bulk download through the tunnel) -> for 30 s after the end:
#      inet dvpnd present in every sample, IPv4 never the direct IP, 0 v6 at the peer, and dvpnd logs WHY it ended
# The box has no management path while the block holds: a root timer (+RESCUE_MIN) undoes everything if this dies.
. "$(dirname "$0")/lib.sh"
P=${1:?protocol}
[ -n "${NODE[$P]:-}" ] || { echo "BLOCK ks-end: unknown protocol $P (node set ${NODE_SET:-node3})"; exit 3; }
suite_init ks-end "$P"
NS=ddvks; H=ddvks-h; PEER=ddvks-p; DST=2606:4700:4700::1111
# a 1-GB deposit at a few hundred Mbit/s: the bulk host must not refuse VPN/cloud IPs (speed.cloudflare.com answers 403)
BULK=${KS_END_BULK:-https://proof.ovh.net/files/10Gb.dat}
# manifest max_min 15 (DIR): the deposit is the smallest the CLI sells (per_gb x1; --units is a whole number), which
# runs out in ~1 min at cloud speed (u24d 10-29: 40 s), so wait at most 8 min for the end; the rescue fires after the
# cell's own 15-min cap, so a cell killed by cellrun mid-block still gets its network back.
RESCUE_MIN=${RESCUE_MIN:-20}; END_WAIT=${END_WAIT:-480}
U=$(id -un)
cnt() { sudo ip netns exec $NS nft list counter ip6 ddvks hits 2>/dev/null | awk '/packets/ {print $2}'; }
tables() { sudo nft list tables 2>/dev/null | awk '$3 ~ /^dvpnd/ {printf "%s,", $3}'; }
probe() { ping -6 -c1 -W1 $DST >/dev/null 2>&1; curl -6 -s -m 1 -o /dev/null "http://[$DST]/" 2>/dev/null; timeout 1 bash -c "echo x > /dev/udp/$DST/53" 2>/dev/null; true; }
v6delta() { local a b; a=$(cnt); probe; sleep 0.5; b=$(cnt); echo $(( ${b:-0} - ${a:-0} )); }
sess() { $CLI status 2>/dev/null | grep -m1 '^Session' | tr -s ' ' | cut -c1-80; }
peer_down() {
  sudo ip -6 route del default via fd53::2 dev $H 2>/dev/null; sudo ip link del $H 2>/dev/null; sudo ip netns del $NS 2>/dev/null
  sudo systemctl stop "$RT.timer" >/dev/null 2>&1; sudo rm -f "/tmp/$RT.sh"; true
}

# ─── management path ───
RT="ddvks-rescue-$$"
# FWX (ac102d8 code): while dvpnd runs, its 1 s guard reloads `inet dvpnd` whatever the setting says, so an
# `nft delete` with dvpnd up is undone within 1 s (u24d stayed dark 10-29 23:xx). Order: the user path first;
# if a block is still there, STOP dvpnd (that stops the guard, the block stays), drop the tables, start it again.
cat > "/tmp/$RT.sh" <<EOF
#!/bin/sh
for c in disconnect 'daemon restore-network' 'daemon set --kill-switch off --yes'; do runuser -u $U -- env DVPN_KEYFILE=$DVPN_KEYFILE HOME=$HOME timeout 60 $CLI \$c; done
sleep 5
if nft list tables | grep -q 'inet dvpnd\$'; then
  logger "$RT: kill switch still in the kernel after the user path; stopping dvpnd-client first"
  { nft list tables; ip rule; ip -4 route; } > /var/tmp/$RT-state.txt 2>&1
  systemctl stop dvpnd-client
  nft list tables | awk '\$3 ~ /^dvpnd/ {print \$2, \$3}' | while read f t; do nft delete table "\$f" "\$t"; done
  systemctl start dvpnd-client
fi
ip -6 route del default via fd53::2 dev $H; ip link del $H; ip netns del $NS
pkill -f 'curl -4 -s -o /dev/null -m 1200'
logger "$RT ran"
EOF
chmod 755 "/tmp/$RT.sh"
sudo systemd-run --on-active=$((RESCUE_MIN * 60)) --unit "$RT" "/tmp/$RT.sh" >/dev/null 2>&1
info "rescue timer" "$RT (+$RESCUE_MIN min: disconnect, restore-network, KS off, drop dvpnd tables + the test peer)"
info "deposit" "per_gb x1 (the smallest the CLI sells); bulk download from $BULK until it runs out"

# ─── the v6 peer ───
restore; $CLI daemon set --kill-switch off --yes >/dev/null 2>&1; sleep 5
if ip -6 route show default | grep -q .; then
  info "dual-stack host" "$(ip -6 route show default | head -1): the netns peer would not be the only v6 path"; echo "BLOCK ks-end: host has its own IPv6 default route"; peer_down; exit 3
fi
sudo ip netns add $NS && sudo ip link add $H type veth peer name $PEER && sudo ip link set $PEER netns $NS
sudo ip -6 addr add fd53::1/64 dev $H nodad; sudo ip link set $H up
sudo ip netns exec $NS ip -6 addr add fd53::2/64 dev $PEER nodad; sudo ip netns exec $NS ip link set $PEER up; sudo ip netns exec $NS ip link set lo up
sudo ip netns exec $NS nft -f - <<'EOF'
table ip6 ddvks {
  counter hits {
  }
  chain pre {
    type filter hook prerouting priority -300; policy accept;
    ip6 daddr 2606:4700:4700::1111 counter name "hits"
  }
}
EOF
sudo ip -6 route add default via fd53::2 dev $H metric 50
sleep 2

# ─── 1: positive control ───
c=0; for i in 1 2 3; do c=$(( c + $(v6delta) )); done
if [ "$c" -lt 1 ]; then info "positive control" "0 v6 packets reached the peer with KS off: the counter proves nothing"; echo "BLOCK ks-end: positive control failed"; peer_down; exit 3; fi
record PASS "positive control: KS off, v6 to the internet reaches the test peer" "$c packets in 3 probes"

# ─── 2: KS on, session up ───
mark
run 0 'Applied' "kill switch on" -- daemon set --kill-switch on --yes; sleep 8
connect_p "$P" || { restore; $CLI daemon set --kill-switch off --yes >/dev/null 2>&1; peer_down; summary; exit 1; }
sleep 6
check "egress = node with KS on" egress_is_node "$P"
d=$(v6delta); [ "$d" = 0 ] && record PASS "KS on, session up: no IPv6 reaches the peer" "tables $(tables)" || record FAIL "KS on, session up: IPv6 reached the peer" "$d packets; tables $(tables)"

# ─── 3: the deposit runs out ───
pxa=(); is_proxy "$P" && pxa=(--socks5-hostname "$(socks)")
BMARK=$(date -u '+%Y-%m-%d %H:%M:%S')
( curl -4 -s -o /dev/null -m 1200 "${pxa[@]}" "$BULK" ) & bulk=$!
s=$SECONDS; ended=''
while [ $((SECONDS - s)) -lt "$END_WAIT" ]; do
  hold
  $CLI status 2>/dev/null | grep -qE '^Session +(Protected|Connected)' || { ended=$(date -u '+%F %T'); break; }
  sleep 3
done
kill $bulk 2>/dev/null; pkill -f 'curl -4 -s -o /dev/null -m 1200' 2>/dev/null
if [ -z "$ended" ]; then
  info "session end" "the deposit did not run out within ${END_WAIT}s ($(sess)); bulk host $BULK"; echo "BLOCK ks-end: the session never ended by itself"
else
  info "session ended by itself" "$ended: $(sess)"
  # ONE root shell for the 30 samples: on a host whose name is not in /etc/hosts every `sudo` resolves it through
  # DNS, which the kill switch blocks, so each sudo waited out the lookup: 30 samples took 25 min (u24d 10-29 on the
  # lab build: the run was killed by a reboot before it could report hysteria2)
  res=$(sudo bash -s "$NS" "$DST" "$DIRECT" <<'ROOT'
NS=$1 DST=$2 DIRECT=$3; miss=0 direct=0 v6=0 first=''
cnt() { ip netns exec "$NS" nft list counter ip6 ddvks hits 2>/dev/null | awk '/packets/ {print $2}'; }
for i in $(seq 1 30); do
  touch /run/ddv-deadman.hold
  nft list table inet dvpnd >/dev/null 2>&1 || miss=$((miss + 1))
  e=$(curl -4 -s -m 1 https://api.ipify.org | tr -d '[:space:]'); [ -n "$e" ] && [ "$e" = "$DIRECT" ] && direct=$((direct + 1))
  a=$(cnt); ping -6 -c1 -W1 "$DST" >/dev/null 2>&1; curl -6 -s -m 1 -o /dev/null "http://[$DST]/" 2>/dev/null
  timeout 1 bash -c "echo x > /dev/udp/$DST/53" 2>/dev/null; sleep 0.3; b=$(cnt); v6=$(( v6 + ${b:-0} - ${a:-0} ))
  [ "$i" = 1 ] && first="tables $(nft list tables | awk '$3 ~ /^dvpnd/ {printf "%s,", $3}') v4 ${e:-none}"
done
echo "$miss $direct $v6 $first"
ROOT
)
  read -r miss direct v6 seen <<<"$res"; seen="first sample: $seen"
  [ "${miss:-x}" = 0 ] && record PASS "after the end: inet dvpnd in the kernel 30/30 s" "$seen" || record FAIL "after the end: inet dvpnd missing in ${miss:-?} of 30 samples" "$seen; now: $(tables)"
  [ "${direct:-x}" = 0 ] && record PASS "after the end: IPv4 never leaves direct (30 s)" '' || record FAIL "after the end: IPv4 left DIRECT ($DIRECT) in ${direct:-?} of 30 samples" "$seen"
  [ "${v6:-x}" = 0 ] && record PASS "after the end: no IPv6 reaches the peer (30 s)" "$seen" || record FAIL "after the end: ${v6:-?} IPv6 packets reached the peer in 30 s" "$seen"
  # the END's reason: lines since the bulk download began, not the kill-switch bookkeeping of the restarts before it
  why=$(sudo journalctl -u dvpnd-client --since "$BMARK" --no-pager -o cat 2>/dev/null | grep -v 'grpc.method' | grep -v 'kill switch removed' | grep -iE 'exhaust|escrow|deposit|allowance|session (ended|closed|over)|ended|reason' | tail -2)
  [ -n "$why" ] && record PASS "dvpnd logs why the session ended" "$why" || record FAIL "dvpnd logs why the session ended" "no line with the reason after $BMARK (only: $(sudo journalctl -u dvpnd-client --since "$BMARK" --no-pager -o cat | grep -v grpc.method | grep -vE 'TUN (UDP|TCP)' | tail -2 | tr '\n' ' ' | cut -c1-240))"
fi

# ─── back to normal, the way a user does it (FWX: disconnect with no live session releases a kept block) ───
restore; $CLI daemon set --kill-switch off --yes >/dev/null 2>&1; sleep 5
if [ -n "$ended" ]; then
  if sudo nft list table inet dvpnd >/dev/null 2>&1; then
    record FAIL "the user path (disconnect, restore-network, kill switch off) releases the kept block" "inet dvpnd still in the kernel: $(sudo journalctl -u dvpnd-client --since "$MARK" --no-pager -o cat | grep -iE 'kill switch|guard|restor' | tail -3 | tr '\n' ' ')"
    # the harness must still get its network back: stop dvpnd (stops its 1 s guard), drop the tables, start it again
    { sudo nft list tables; ip rule; ip -4 route; } >> "${EGRESS_DIAG:-$HOME/egress-diag.log}" 2>&1
    sudo systemctl stop dvpnd-client; sudo nft list tables | awk '$3 ~ /^dvpnd/ {print $2, $3}' | while read -r f t; do sudo nft delete table "$f" "$t"; done; sudo systemctl start dvpnd-client; sleep 5
  else
    record PASS "the user path (disconnect, restore-network, kill switch off) releases the kept block" "$(sudo journalctl -u dvpnd-client --since "$MARK" --no-pager -o cat | grep -i 'kill switch removed' | tail -1 | cut -c1-200)"
  fi
fi
peer_down
health "ks-end"
back_clean "ks-end"
summary
