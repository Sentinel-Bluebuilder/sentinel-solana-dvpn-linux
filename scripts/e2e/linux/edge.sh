#!/usr/bin/env bash
# ─── Adversarial / edge cases: the Linux versions of #31's Windows cases (run ON a disposable VM) ───
#   nohup bash edge.sh <case> [protocols…] > ~/edge/<case>.out 2>&1 < /dev/null &
# Windows source → case here:
#   vm-ks-edge   refusal connfail nicflap rpcdown switch allowlan laninbound leaks  (+ rpcstart: Q0323, localnet: #32 0014, ufw: host firewall, lanv6: #32 0016)   (svcrestart/protokill = matrix ks-on,
#                reboot-a/b = reboot-test.sh)
#   vm-safety    killdaemon doctor drivers dnspresets
#   vm-split-dyn proxydyn porttaken
#   Phase 9      netem udpblock mtu races fuzz
#   #31 COSMOS-LESSONS  idle (CF6) confwipe (T13) dnsgone (rule 39) ownvpn (D6)
# Every case: network (no leak during, direct after, nothing left), money (refusals spend nothing:
# channel count unchanged), message (exit code + plain copy, never a stack trace), health
# (no panic/error lines in dvpnd). Results: ~/edge/<case>.tsv. Env: DVPN_KEYFILE, DVPN_DATA_DIR.
set -u
. "$(dirname "$0")/lib.sh"
CASE=${1:?case}; shift
PROTOS=${*:-$ALL_PROTOCOLS}
suite_init edge "$CASE"
P=setup
check "direct egress $DIRECT, NIC $NIC" bash -c "[ -n '$DIRECT' ] && [ '$DIRECT' != '$NODE_IP' ] && [ -n '$NIC' ]"
has_awg() { modinfo amneziawg >/dev/null 2>&1 || command -v awg >/dev/null; }
channels_n() { $CLI channels --json 2>/dev/null | node -e "let t='';process.stdin.on('data',d=>t+=d).on('end',()=>{try{const j=JSON.parse(t);const a=Array.isArray(j)?j:(j.channels||[]);console.log(a.length)}catch(e){console.log('?')}})"; }
no_trace() { ! printf '%s' "$LAST" | grep -Eq 'TypeError|ReferenceError|at [A-Za-z.]+ \(|node:internal|Something went wrong|undefined'; }
msg_ok() { if no_trace; then record PASS "$1: plain message, no stack trace" "$(printf '%s' "$LAST" | head -2)"; else record FAIL "$1: raw error shown" "$LAST"; fi; }
block_node() { sudo nft add table inet ddvtest && sudo nft "add chain inet ddvtest out { type filter hook output priority -10; }" && sudo nft add rule inet ddvtest out ip daddr "$NODE_IP" "${1:-}" drop; }
unblock() { sudo nft delete table inet ddvtest 2>/dev/null; true; }
# firewalld (fedora44: default zone public) rejects new inbound on the probe port, so the LAN peer could not reach
# our listener even with NO tunnel (fedora laninbound 10-29 19:24Z, held, 7 SHUT). Open it for the case only
# (runtime, removed after). dvpnd's kill switch is its own nft table: firewalld accepting the port does not weaken it.
fw_open() { FW_OPENED=''; command -v firewall-cmd >/dev/null 2>&1 && sudo firewall-cmd -q --state 2>/dev/null || return 0
  local z; z=$(sudo firewall-cmd --get-zone-of-interface="$NIC" 2>/dev/null) || z=$(sudo firewall-cmd --get-default-zone)
  sudo firewall-cmd -q --zone="$z" --query-port="$1/tcp" && return 0
  sudo firewall-cmd -q --zone="$z" --add-port="$1/tcp" && FW_OPENED="$z $1" && info "firewalld: $1/tcp opened in zone $z for this case (runtime)" ''; }
fw_close() { [ -n "${FW_OPENED:-}" ] || return 0; sudo firewall-cmd -q --zone="${FW_OPENED% *}" --remove-port="${FW_OPENED#* }/tcp"; FW_OPENED=''; }
# dhcp_kick: after the NIC comes back up, make the host's own DHCP client fetch the lease and routes
# again. 'ip link set down' drops the default + link routes; networkctl alone is a no-op without
# networkd (Arch dhclient@: dead ~70 min, a test VM). Same logic as queue.sh net_guard (4d281dd).
DHCP_KICK='if systemctl is-active -q systemd-networkd; then networkctl reconfigure "$0"; elif systemctl is-active -q NetworkManager; then nmcli device reapply "$0"; else systemctl restart "dhclient@$0" 2>/dev/null || dhcpcd -n "$0" 2>/dev/null || dhclient "$0" 2>/dev/null; fi'
dhcp_kick() { sudo sh -c "$DHCP_KICK" "$NIC" >/dev/null 2>&1; }
default_back() { local i; for i in $(seq 1 30); do ip -4 route show default | grep -q . && return 0; [ $((i % 10)) = 0 ] && dhcp_kick; sleep 2; done; return 1; }
# lan_route add|del <ip>: the subnet route a home LAN has on the NIC (GCE has none, see allowlan).
lan_route() {
  local gwip; gwip=$(ip -4 route show default dev "$NIC" | awk '{print $3}' | head -1)
  if [ "$1" = add ]; then sudo ip route replace "$2/32" via "$gwip" dev "$NIC"; else sudo ip route del "$2/32" 2>/dev/null || true; fi
}
never_direct() { check "$1 → never the direct IP" bash -c "[ \"\$(curl -4 -s -m 10 https://api.ipify.org)\" != '$DIRECT' ]"; }
ks() { run 0 '-' "kill switch $1${2:+ $2}" -- daemon set --kill-switch "$1" ${2:-} --yes; }
# a background sampler: writes every exit IP seen (every 0.5 s) until stopped; DIRECT in it = a leak
# Stop flag is its own file: the curl >> SAMPLE append re-created a deleted SAMPLE, so a loop keyed
# on SAMPLE never ended and wait hung for hours (u2404 switch case, 2026-10-22).
sample_start() { SAMPLE=$(mktemp); SAMPLE_RUN="$SAMPLE.run"; touch "$SAMPLE_RUN"; ( while [ -e "$SAMPLE_RUN" ]; do curl -4 -s -m 3 https://api.ipify.org >> "$SAMPLE" 2>/dev/null; echo >> "$SAMPLE"; sleep 0.5; done ) & SAMPLER=$!; }
sample_stop() { local f=$SAMPLE; rm -f "$SAMPLE_RUN"; wait "$SAMPLER" 2>/dev/null; cp "$f" "$f.done"; rm -f "$f"; SAMPLED=$(sort "$f.done" | uniq -c | tr '\n' ' '); grep -qx "$DIRECT" "$f.done" && { rm -f "$f.done"; return 1; }; rm -f "$f.done"; return 0; }
# Q0404: put back the MTU the mtu case found, never a fixed value. A hard-coded 1460 (GCP's default) left Azure
# NICs (1500) at 1460 after every edge run, and Docker containers there (bridge 1500) then stalled on HTTPS.
trap 'unblock; sudo tc qdisc del dev "$NIC" root 2>/dev/null; [ -n "${MTU_WAS:-}" ] && sudo ip link set dev "$NIC" mtu "$MTU_WAS" 2>/dev/null' EXIT

case_one() {
  local p=$1
  case $CASE in
    refusal) # nothing here may spend: bad inputs are refused before a deposit
      undo() { $CLI disconnect >/dev/null 2>&1; sleep 2; true; }  # a wrongly accepted connect must not poison the next checks
      local before; before=$(channels_n)
      run 3 '-' 'connect with no node' -- connect --yes; msg_ok 'no node'
      run 1 '-' 'connect to an address that is no node' -- connect 11111111111111111111111111111111 --units 1 --yes; msg_ok 'not a node'
      run 3 '-' 'connect --units 0' -- connect "${NODE[$p]}" --units 0 --yes; msg_ok 'units 0'; undo
      run 3 '-' 'connect --units -5' -- connect "${NODE[$p]}" --units -5 --yes; msg_ok 'units negative'; undo
      run 3 '-' 'connect --basis weekly' -- connect "${NODE[$p]}" --basis weekly --yes; msg_ok 'bad basis'
      run 2 '-' 'connect without --yes asks first' -- connect "${NODE[$p]}" --units 1; msg_ok 'needs --yes'
      run 1 '-' 'connect with a plan that does not exist' -- connect "${NODE[$p]}" --plan 11111111111111111111111111111111 --yes; msg_ok 'bad plan'
      check "money: no deposit was opened by any refusal (channels $before → $(channels_n))" bash -c "[ '$before' = \"\$($(declare -f channels_n); CLI=$CLI; channels_n)\" ]"
      check 'network untouched' bash -c "$(declare -f no_leftovers egress); no_leftovers"
      return ;;
    connfail) # node unreachable at connect, kill switch on: fails clearly, nothing held after, no leak
      ks on
      hold; block_node
      local t0=$SECONDS
      run 1 '-' 'connect while the node is unreachable fails' -- connect "${NODE[$p]}" --units 1 --yes; msg_ok 'node unreachable'
      info "connect failed after $((SECONDS - t0)) s" "$LAST"
      # Windows vm-ks-edge connfail: a failed connect leaves no half-armed kill switch. Mode "on"
      # blocks only while a session is up, so the internet is direct again and no table is left.
      check 'right after the failed connect: internet direct (no half-armed kill switch)' bash -c "[ \"$(curl -4 -s -m 10 https://api.ipify.org)\" = '$DIRECT' ]"
      check 'right after the failed connect: no nft table left' bash -c '! sudo nft list table inet dvpnd >/dev/null 2>&1'
      unblock
      run 0 '-' 'restore network' -- daemon restore-network; sleep 3
      ks off
      ;;
    noderoute) # Q0247: the network is reconfigured mid-session and OpenVPN's host route to the node goes away
      # (networkd drops foreign routes). Fixed build: dvpnd restores it within ~2 s. RC3 = negative control (none -> direct).
      [ "$p" = openvpn ] || { record PASS "noderoute: openvpn only, skip $p" '-'; return; }
      connect_p "$p" || return
      sleep 4; check 'egress = node before the route loss' egress_is_node "$p"
      local since; since=$(date -u '+%F %T')
      sudo ip route del "$NODE_IP/32" >> "$LOG" 2>&1; info 'host route to the node deleted' "$(ip -4 route show "$NODE_IP/32" | head -1)"
      sleep 5; check 'egress = node after the route loss (restored)' egress_is_node "$p"
      check 'dvpnd logged the route restore' bash -c "sudo journalctl -u dvpnd-client --since '$since' --no-pager | grep -q 'route to the node disappeared'"
      check '2 MiB download after the restore' bash -c "[ \"\$(curl -s -m 90 -r 0-2097151 -o /dev/null -w '%{size_download}' https://speed.cloudflare.com/__down?bytes=2097152)\" = 2097152 ]"
      run 0 '-' 'disconnect' -- disconnect
      ;;
    nicflap) # the machine's network goes away and comes back mid-session (kill switch on)
      # the NIC is down on purpose: the node cannot answer then. dvpnd logs the error field BEFORE the message.
      # The session poll fails the same way while the card is down (u2404 R7: OpenVPN "no admitted address answered", Hysteria2 "TLS handshake timeout").
      HEALTH_ALLOW='(Client.Timeout|deadline exceeded|request canceled).*issuing voucher failed|issuing voucher failed.*(Client.Timeout|deadline exceeded|request canceled)|getting session: .*(no admitted address answered|TLS handshake timeout|Client.Timeout|deadline exceeded|network is unreachable|i/o timeout)'
      # Q0354: the session CLOSE attempted while the NIC is down cannot reach the node either (u24b wireguard + xray 10-30).
      # Only network-class reasons are allowed: a close the node refused (4xx/5xx) still trips health.
      HEALTH_ALLOW+='|Delete .*/v1/sessions/.*(no admitted address answered|network is unreachable|i/o timeout|connection refused|Client.Timeout|deadline exceeded)'
      # a reboot fallback fired in an earlier run (marker < 3 h old): record it, never flap again into another reboot
      local mk=/var/tmp/ddv-nicflap-reboot
      if [ -f $mk ] && [ -n "$(find $mk -mmin -180 2>/dev/null)" ]; then
        record FAIL 'NIC back: no default route; the reboot fallback fired (earlier run, flap not repeated)' "$(cat $mk)"; return
      fi
      sudo rm -f $mk
      ks on
      connect_p "$p" || { restore; ks off; return; }
      sleep 4; check 'egress = node' egress_is_node "$p"
      hold
      # Safety net, ALL armed BEFORE the flap so it runs whatever happens to this script. Azure netvsc + accelerated-
      # networking VF (mlx5): after eth0 down/up the default route never came back by itself (u24b x3 10-29, 2.5 h dark).
      #  +90 s link up + DHCP kick · +120 s restart the network service (+ netplan apply) · +200 s still no default
      #  route = reboot, leaving the marker above so the resumed cell records the FAIL instead of flapping again.
      local nu="ddv-nicup-$RANDOM" nr="ddv-nicnet-$RANDOM" nb="ddv-nicboot-$RANDOM"
      local net_restart='ip -4 route show default | grep -q . && exit 0; if systemctl is-active -q systemd-networkd; then systemctl restart systemd-networkd; elif systemctl is-active -q NetworkManager; then systemctl restart NetworkManager; fi; command -v netplan >/dev/null 2>&1 && netplan apply; true'
      sudo systemd-run --on-active=90 --unit "$nu" /bin/sh -c "ip link set dev $NIC up; sleep 2; $DHCP_KICK" "$NIC" >/dev/null 2>&1
      sudo systemd-run --on-active=120 --unit "$nr" /bin/sh -c "$net_restart" >/dev/null 2>&1
      sudo systemd-run --on-active=200 --unit "$nb" /bin/sh -c "ip -4 route show default | grep -q . || { echo \"\$(date -u +%FT%TZ) $NIC: no default route 200 s after the flap, rebooting\" > $mk; sync; systemctl reboot --force; }" >/dev/null 2>&1
      local flap_since; flap_since=$(date -u '+%F %T')
      sudo ip link set dev "$NIC" down; sleep 20; sudo ip link set dev "$NIC" up
      dhcp_kick
      local back=0 how='host DHCP client'
      if default_back; then back=1
      else # do the network-service restart now rather than waiting for the timer
        sudo sh -c "$net_restart" >/dev/null 2>&1; how='network service restart'
        default_back && back=1
      fi
      if [ $back = 1 ]; then
        sudo systemctl stop "$nu.timer" "$nr.timer" "$nb.timer" >/dev/null 2>&1   # route is back: cancel the whole net (Q0247)
        record PASS "NIC back: default route restored ($how)" "$(ip -4 route show default | head -1)"
      else
        record FAIL 'NIC back: no default route after DHCP kick + network restart (reboot fallback armed; later cases void)' "$(ip -4 route | head -3 | tr '\n' ' '); links $(ip -br link | tr -s ' ' | tr '\n' ' ' | cut -c1-200)"
      fi
      sleep 10; hold
      never_direct 'after the NIC came back'
      # product (DIR 10-30): the APP must reconnect after a NIC flap, not just the VM get its route back
      # Q0397: if dvpnd already gave up reconnecting, the session is over and the kill switch blocks everything, so
      # the egress=node waits (~15 min) only kept the VM dark (u22 10-31, rebooted by Azure). Record the reconnect as
      # FAILED with dvpnd's own line (the product oracle stays) and go straight to disconnect + restore.
      local gaveup; gaveup=$(sudo journalctl -u dvpnd-client --since "$flap_since" --no-pager -o cat 2>/dev/null | grep -m1 -E '"message":"(reconnecting gave up|reconnect attempts exhausted)')
      if [ -n "$gaveup" ]; then
        record FAIL 'session reconnected after the NIC came back (egress = node)' "dvpnd gave up reconnecting during the flap; no egress wait (Q0397): $(grep -oE '"time":"[^"]*"' <<<"$gaveup") $(grep -oE '"message":"[^"]*"' <<<"$gaveup")"
      elif [ $back = 1 ]; then
        local rc_i; for rc_i in 1 2 3 4 5 6; do egress_is_node "$p" >/dev/null 2>&1 && break; sleep 10; done
        check 'session reconnected after the NIC came back (egress = node)' egress_is_node "$p"
      fi
      run 0 '-' 'status after the NIC came back (recorded)' -- status; info 'status' "$LAST"
      check 'kill switch still in the kernel' sudo nft list table inet dvpnd
      check 'session usable again or ended (egress node, or blocked, never direct)' bash -c "e=\$(curl -4 -s -m 12 $(is_proxy "$p" && echo "--socks5-hostname $(socks)") https://api.ipify.org); [ \"\$e\" != '$DIRECT' ]"
      run 0 '-' 'disconnect' -- disconnect; sleep 3
      run 0 '-' 'restore network' -- daemon restore-network; sleep 3
      ks off
      ;;
    rpcdown) # the Solana RPC goes away mid-session: the session keeps running, disconnect still works
      # A connect that fails BEFORE the RPC block is node-3 / public-RPC noise, not this case (Q0027):
      # retry once after 30 s and record attempt 1 as info. The recorded connect is the one that counts.
      hold
      local pre; pre=$($CLI connect "${NODE[$p]}" --units 1 --yes 2>&1)
      if grep -qE 'Connected|connected' <<<"$pre"; then
        check 'connect (before the RPC block)' true
      else
        info 'connect attempt 1 failed before the RPC block (retrying in 30 s)' "$pre"
        $CLI disconnect >/dev/null 2>&1; sleep 30
        connect_p "$p" || { restore; return; }
      fi
      sleep 4
      local ips; ips=$(getent ahostsv4 api.devnet.solana.com | awk '{print $1}' | sort -u | paste -sd,)
      sudo nft add table inet ddvtest && sudo nft "add chain inet ddvtest out { type filter hook output priority -10; }" && sudo nft add rule inet ddvtest out ip daddr "{ $ips }" drop
      sleep 45
      check 'RPC down 45 s: session still carries traffic (egress = node)' egress_is_node "$p"
      run 0 '-' 'status with the RPC down (recorded)' -- status; info 'status' "$LAST"; msg_ok 'status, RPC down'
      run 0 '-' 'disconnect with the RPC down' -- disconnect; msg_ok 'disconnect, RPC down'
      unblock; sleep 3
      ;;
    switch) # --switch to every other protocol with the kill switch on: no direct gap at any moment
      ks on
      connect_p "$p" || { restore; ks off; return; }
      sleep 4
      local q
      for q in $ALL_PROTOCOLS; do
        [ "$q" = "$p" ] && continue
        [ "$q" = amneziawg ] && ! has_awg && continue
        hold; sample_start
        run 0 'Connected|connected' "--switch $p → $q" -- connect "${NODE[$q]}" --units 1 --switch --yes
        sleep 4
        if sample_stop; then record PASS "$p → $q: no direct exit during the switch" "$SAMPLED"; else record FAIL "$p → $q: direct exit seen during the switch" "$SAMPLED"; fi
        check "after the switch: egress = node via $q" egress_is_node "$q"
        p=$q; gap
      done
      run 0 '-' 'disconnect' -- disconnect; sleep 3
      run 0 '-' 'restore network' -- daemon restore-network; sleep 3
      ks off
      ;;
    allowlan) # kill switch on: a LAN peer answers iff allow-lan true
      # GCE gives a VM no subnet route (only "default via the gateway"), so without help the peer is
      # reached THROUGH a full tunnel via #31's node (same VPC): reachable, but not a LAN path. A home
      # LAN has a subnet route on the NIC; lan_route adds that (a /32 to the peer via the gateway).
      # no peer on this VM: skip here (not abort the whole suite); the case has its own cell (needs=lanpeer)
      [ -n "${LAN_PEER:-}" ] || { echo "skip  allowlan: no LAN peer on this VM (cell ed-allowlan, needs=lanpeer)"; return 0; }
      local gw=$LAN_PEER
      lan_up() { timeout 4 bash -c "exec 3<>/dev/tcp/${gw%:*}/${gw#*:}" 2>/dev/null; }
      lan_route add "${gw%:*}"
      if lan_up; then record PASS "control: LAN peer $gw answers with the kill switch off" ''; else record FAIL "control: LAN peer $gw does not answer even without the kill switch (probe invalid)" ''; [ "${EDGE_SINGLE:-}" = 1 ] && note "BLOCK allowlan: LAN peer $gw down with the kill switch off (env, not a product result)"; lan_route del "${gw%:*}"; return; fi
      for lan in true false; do
        ks on "--allow-lan $lan"
        connect_p "$p" || { restore; continue; }
        sleep 4; hold
        check "the LAN route stays on $NIC during the session" bash -c "ip route get '${gw%:*}' | grep -q 'dev $NIC'"
        if lan_up; then r=reachable; else r=blocked; fi
        if [ "$lan" = true ]; then want=reachable; else want=blocked; fi
        if [ "$r" = "$want" ]; then record PASS "allow-lan $lan: LAN peer $gw $r" ''; else record FAIL "allow-lan $lan: LAN peer $gw $r (want $want)" ''; fi
        never_direct "allow-lan $lan"
        run 0 '-' 'disconnect' -- disconnect; sleep 3
        run 0 '-' 'restore network' -- daemon restore-network; sleep 3
        gap
      done
      ks off "--allow-lan false"
      lan_route del "${gw%:*}"
      ;;
    outsidein) # UPSTREAM-GAPS L21 / #32 0021: kill switch OFF, a host NOT on the local network (the peer VM
      # via the GCE gateway = how any internet host reaches us) opens connections IN during the session.
      # Hysteria2 sent the replies into its TUN and strict rp_filter dropped the inbound packets (remote SSH died).
      [ -n "${LAN_PEER_SSH:-}" ] || { echo "skip  LAN-peer case: no LAN_PEER_SSH on this VM (own cell, needs=lanpeer)"; return 0; }
      local peer=$LAN_PEER_SSH me port=18081 rlog
      local pssh=(ssh -i ~/.ssh/ddv_lan -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 "$peer")
      me=$(ip -4 -o addr show dev "$NIC" | awk '{print $4}' | cut -d/ -f1 | head -1); rlog="/tmp/outin-$(hostname -s)-$p.log"
      python3 -m http.server $port --bind 0.0.0.0 >/dev/null 2>&1 & local srv=$!; fw_open $port
      "${pssh[@]}" "rm -f $rlog; setsid nohup bash -c 'for i in \$(seq 1 200); do if timeout 3 bash -c \"exec 3<>/dev/tcp/$me/$port\" 2>/dev/null; then echo \"\$(date +%s) OPEN\"; else echo \"\$(date +%s) SHUT\"; fi; sleep 2; done' > $rlog 2>&1 < /dev/null & echo started" 2>&1 | grep -q started \
        || { record FAIL "peer $peer unreachable over ssh: probe not started (peer busy in its own tunnel cell?)" ''; [ "${EDGE_SINGLE:-}" = 1 ] && note "BLOCK outsidein: peer $peer unreachable over ssh, probe not started (env)"; }
      local -a win=()
      window() { local a; a=$(date +%s); sleep 14; win+=("$1 $a $(date +%s)"); }
      # the case is defined with the kill switch OFF: set it, never inherit it. A VM left with killSwitch on
      # (u24d after a hard restart, 10-29) blocked the inbound probe by design and read as a product FAIL (Q0298)
      ks off "--allow-lan false"
      sleep 4; window control
      if connect_p "$p"; then
        sleep 4; hold
        window during
        check 'egress = node while the outside host connects in' egress_is_node "$p"
        run 0 '-' 'disconnect' -- disconnect; sleep 3
        window after
      fi
      local log; log=$(mktemp); "${pssh[@]}" "pkill -f '[s]eq 1 200' ; cat $rlog" > "$log" 2>/dev/null
      local w name a b cnt
      for w in "${win[@]}"; do
        read -r name a b <<< "$w"
        cnt=$(awk -v a="$a" -v b="$b" '$1 ~ /^[0-9]+$/ && $1>=a && $1<=b {print $2}' "$log" | sort | uniq -c | tr '\n' ' ' | tr -s ' ')
        # control = kill switch off, no session: a dead or silent peer here is env, not a product result
        [ "${EDGE_SINGLE:-}" = 1 ] && [ "$name" = control ] && { [ -z "$cnt" ] || echo "$cnt" | grep -q SHUT; } && note "BLOCK outsidein: peer $peer cannot reach us even before the session (env) :: ${cnt:-no probe lines}"
        if [ -z "$cnt" ]; then record FAIL "$name: no probe lines in the window (probe invalid)" "$(tail -2 "$log" | tr '\n' ' ')"; continue; fi
        if echo "$cnt" | grep -q SHUT; then record FAIL "$name: an outside host cannot connect in" "$cnt"; else record PASS "$name: an outside host connects in" "$cnt"; fi
      done
      rm -f "$log"; kill $srv 2>/dev/null; wait $srv 2>/dev/null; fw_close
      ;;
    laninbound) # #31 lanin (ed6f012 / #32 0013): kill switch on → a LAN host cannot open a connection IN, unless allow-lan
      # The peer probes our listener every 2 s from a DETACHED loop on the peer (log on the peer), read
      # back after the case: an SSH session from here dies with allow-lan false (outbound LAN dropped),
      # and a dead probe must never look like "blocked". Every window needs probe lines of its own.
      # Env: LAN_PEER_SSH=<user@internal ip> reachable with ~/.ssh/ddv_lan.
      [ -n "${LAN_PEER_SSH:-}" ] || { echo "skip  LAN-peer case: no LAN_PEER_SSH on this VM (own cell, needs=lanpeer)"; return 0; }
      local peer=$LAN_PEER_SSH me port=18080 rlog
      local pssh=(ssh -i ~/.ssh/ddv_lan -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 "$peer")
      me=$(ip -4 -o addr show dev "$NIC" | awk '{print $4}' | cut -d/ -f1 | head -1); rlog="/tmp/lanin-$(hostname -s)-$p.log"
      lan_route add "${peer#*@}"
      python3 -m http.server $port --bind 0.0.0.0 >/dev/null 2>&1 & local srv=$!; fw_open $port
      "${pssh[@]}" "rm -f $rlog; setsid nohup bash -c 'for i in \$(seq 1 450); do if timeout 3 bash -c \"exec 3<>/dev/tcp/$me/$port\" 2>/dev/null; then echo \"\$(date +%s) OPEN\"; else echo \"\$(date +%s) SHUT\"; fi; sleep 2; done' > $rlog 2>&1 < /dev/null & echo started" 2>&1 | grep -q started \
        || { record FAIL "LAN peer unreachable over ssh: probe not started (peer busy in its own tunnel cell?)" ''; [ "${EDGE_SINGLE:-}" = 1 ] && note "BLOCK laninbound: LAN peer unreachable over ssh, probe not started (env)"; }
      local -a win=()
      window() { local a; a=$(date +%s); sleep 12; win+=("$1 $a $(date +%s)"); }
      sleep 4; window control
      for lan in false true; do
        ks on "--allow-lan $lan"
        connect_p "$p" || { restore; continue; }
        sleep 4; hold
        window "during-$lan"
        never_direct "allow-lan $lan"
        run 0 '-' 'disconnect' -- disconnect; sleep 3
        run 0 '-' 'restore network' -- daemon restore-network; sleep 3
        window "after-$lan"
        gap
      done
      ks off "--allow-lan false"
      local log; log=$(mktemp); "${pssh[@]}" "pkill -f '[s]eq 1 450' ; cat $rlog" > "$log" 2>/dev/null
      local w name a b c
      for w in "${win[@]}"; do
        read -r name a b <<< "$w"
        c=$(awk -v a="$a" -v b="$b" '$1 ~ /^[0-9]+$/ && $1>=a && $1<=b {print $2}' "$log" | sort | uniq -c | tr '\n' ' ' | tr -s ' ')
        [ "${EDGE_SINGLE:-}" = 1 ] && [ "$name" = control ] && { [ -z "$c" ] || ! echo "$c" | grep -q OPEN; } && note "BLOCK laninbound: LAN peer cannot reach us even before the session (env) :: ${c:-no probe lines}"
        if [ -z "$c" ]; then record FAIL "$name: no probe lines in the window (probe invalid)" "$(tail -2 "$log" | tr '\n' ' ')"; continue; fi
        case $name in
          control|after-*) if echo "$c" | grep -q OPEN; then record PASS "$name: LAN peer connects in" "$c"; else record FAIL "$name: LAN peer cannot connect in" "$c"; fi ;;
          during-false) if echo "$c" | grep -q OPEN; then record FAIL "allow-lan false: LAN peer opened a connection in" "$c"; else record PASS "allow-lan false: LAN peer cannot connect in" "$c"; fi ;;
          during-true) if echo "$c" | grep -q SHUT; then record FAIL "allow-lan true: LAN peer blocked" "$c"; else record PASS "allow-lan true: LAN peer connects in" "$c"; fi ;;
        esac
      done
      rm -f "$log"; kill $srv 2>/dev/null; wait $srv 2>/dev/null; fw_close
      lan_route del "${peer#*@}"
      ;;
    lanv6) # #32 0016 / #31 gap #76: allow-LAN covers IPv6 unique-local (fc00::/7), out and in. GCE has no
      # IPv6 LAN, so a network namespace on a veth pair plays the LAN host: fd00:ddd::/64 plus an IPv4
      # 192.168.77.0/24 control. Kill switch on: both families reachable (both ways) iff allow-lan.
      local ns=ddvlan6 h=ddvl6a n=ddvl6b
      # nsenter, not "ip netns exec": that remounts /sys in a new mount namespace, which fedora44 refuses from the runner
      # service ("mount of /sys failed: Permission denied"), so the namespace servers never started (10-29 17:0xZ)
      nsx() { sudo nsenter --net=/run/netns/$ns "$@"; }
      # a run that died half way left its servers behind: clear them before the namespace is rebuilt
      sudo ip netns pids $ns 2>/dev/null | xargs -r sudo kill 2>/dev/null; pkill -f "http.server 18082 --bind ::" 2>/dev/null
      sudo ip netns del $ns 2>/dev/null; sudo ip link del $h 2>/dev/null
      sudo ip netns add $ns && sudo ip link add $h type veth peer name $n && sudo ip link set $n netns $ns
      sudo ip addr add 192.168.77.1/24 dev $h && sudo ip -6 addr add fd00:ddd::1/64 dev $h nodad && sudo ip link set $h up
      # firewalld (Fedora: default zone public) rejects new inbound on an interface it does not know,
      # so the "in" probes failed with the kill switch off (probe invalid). A home LAN's inbound is the
      # user's own firewall choice; this test LAN is trusted for the case only (runtime, removed below).
      local fwd=0; command -v firewall-cmd >/dev/null && sudo firewall-cmd -q --state 2>/dev/null && fwd=1
      # NetworkManager may claim the new veth and give it a zone first: then --add-interface refuses (quietly, -q)
      # and the default zone drops the test LAN (rocky9/fedora44 never passed, Q0025). Unmanage it, then
      # --change-interface (works with or without a current zone), and log where it really landed.
      command -v nmcli >/dev/null && sudo nmcli device set $h managed no 2>/dev/null
      if [ $fwd = 1 ]; then
        sleep 1; sudo firewall-cmd -q --zone=trusted --change-interface=$h || note "diag lanv6: firewalld refused to put $h in zone trusted"
        info "firewalld zone of $h" "$(sudo firewall-cmd --get-zone-of-interface=$h 2>&1) (default $(sudo firewall-cmd --get-default-zone 2>&1))"
      fi
      nsx sh -c "ip addr add 192.168.77.2/24 dev $n && ip -6 addr add fd00:ddd::2/64 dev $n nodad && ip link set $n up && ip link set lo up"
      nsx python3 -m http.server 18081 --bind :: >/dev/null 2>&1 & local nsrv=$!
      python3 -m http.server 18082 --bind :: >/dev/null 2>&1 & local hsrv=$!
      sleep 2
      out4() { curl -4 -s -o /dev/null -m 4 http://192.168.77.2:18081/; }
      out6() { curl -6 -s -o /dev/null -m 4 'http://[fd00:ddd::2]:18081/'; }
      in4() { nsx curl -4 -s -o /dev/null -m 4 http://192.168.77.1:18082/; }
      in6() { nsx curl -6 -s -o /dev/null -m 4 'http://[fd00:ddd::1]:18082/'; }
      local d ok=1
      # a failed control says why: the probe again with its error text, then (once) the state that decides it
      why() { local e; case $1 in
        out4) e=$(curl -4 -sS -o /dev/null -m 4 http://192.168.77.2:18081/ 2>&1) ;;
        out6) e=$(curl -6 -sS -o /dev/null -m 4 'http://[fd00:ddd::2]:18081/' 2>&1) ;;
        in4) e=$(nsx curl -4 -sS -o /dev/null -m 4 http://192.168.77.1:18082/ 2>&1) ;;
        in6) e=$(nsx curl -6 -sS -o /dev/null -m 4 'http://[fd00:ddd::1]:18082/' 2>&1) ;;
      esac; echo "${e:-no error text}"; }
      for d in out4 out6 in4 in6; do $d || { ok=0; record FAIL "control: $d fails with the kill switch off (probe invalid)" "$(why $d)"; }; done
      [ $ok = 1 ] || {
        note "diag lanv6: host $(ip -br addr show dev $h 2>&1 | tr -s ' ') | ns $(nsx ip -br addr 2>&1 | tr -s ' ' | tr '\n' ' ')"
        note "diag lanv6: servers ns=$(kill -0 $nsrv 2>/dev/null && echo up || echo DEAD) host=$(kill -0 $hsrv 2>/dev/null && echo up || echo DEAD) | firewalld=$fwd zone($h)=$(sudo firewall-cmd --get-zone-of-interface=$h 2>&1) default=$(sudo firewall-cmd --get-default-zone 2>&1)"
        note "diag lanv6: nft tables $(sudo nft list tables 2>&1 | tr '\n' ' ') | rp_filter all=$(sysctl -n net.ipv4.conf.all.rp_filter) $h=$(sysctl -n net.ipv4.conf.$h.rp_filter 2>&1) | session '$($CLI status 2>/dev/null | grep -m1 '^Session')'"
      }
      if [ $ok = 1 ]; then
        record PASS 'control: IPv4 + IPv6 ULA LAN reachable both ways with the kill switch off' ''
        for lan in true false; do
          ks on "--allow-lan $lan"
          connect_p "$p" || { restore; continue; }
          sleep 4; hold
          for d in out4 out6 in4 in6; do
            if $d; then r=reachable; else r=blocked; fi
            if [ "$lan" = true ]; then want=reachable; else want=blocked; fi
            if [ "$r" = "$want" ]; then record PASS "allow-lan $lan: $d $r" ''; else record FAIL "allow-lan $lan: $d $r (want $want)" "$(ip -6 route get fd00:ddd::2 2>&1 | head -1)"; fi
          done
          never_direct "allow-lan $lan"
          run 0 '-' 'disconnect' -- disconnect; sleep 3
          run 0 '-' 'restore network' -- daemon restore-network; sleep 3
          gap
        done
        ks off "--allow-lan false"
        for d in out4 out6 in4 in6; do check "after: $d works again" $d; done
      fi
      # every process INSIDE the namespace (sudo kill $nsrv hit only the sudo wrapper: the python server lived on with
      # port 18081 and inherited fds, fedora 10-29 18:01Z)
      kill $hsrv 2>/dev/null; sudo ip netns pids $ns 2>/dev/null | xargs -r sudo kill 2>/dev/null; sudo kill $nsrv 2>/dev/null; wait $hsrv 2>/dev/null
      [ $fwd = 1 ] && sudo firewall-cmd -q --zone="$(sudo firewall-cmd --get-zone-of-interface=$h 2>/dev/null || echo trusted)" --remove-interface=$h 2>/dev/null
      sudo ip netns del $ns 2>/dev/null; sudo ip link del $h 2>/dev/null; true
      ;;
    localnet) # kill switch off: a full tunnel keeps the machine's own network (#32 0014: Hysteria2 took the gateway)
      local gw; gw=$(ip -4 route show default | awk '{print $3}' | head -1)
      sudo dmesg -C
      # control: the LAN peer must answer BEFORE the tunnel, or "answers during the tunnel" proves nothing (peer busy
      # in its own tunnel cell: c4-fedora44-ed-localnet 10-29 17:0xZ). Dead peer = env in a one-case cell.
      if [ -n "${LAN_PEER:-}" ] && ! timeout 4 bash -c "exec 3<>/dev/tcp/${LAN_PEER%:*}/${LAN_PEER#*:}" 2>/dev/null; then
        record FAIL "control: LAN peer $LAN_PEER down before the tunnel (probe invalid)" ''
        [ "${EDGE_SINGLE:-}" = 1 ] && note "BLOCK localnet: LAN peer $LAN_PEER down before the tunnel (busy in its own tunnel cell?)"
        return
      fi
      connect_p "$p" || { restore; return; }
      sleep 4; hold
      check 'egress = node (V2Ray/Xray: through the system proxy)' egress_is_node "$p"
      check "gateway $gw still routed on $NIC" bash -c "ip route get '$gw' | grep -q 'dev $NIC'"
      # GCP metadata answers the instance name; Azure IMDS (Metadata: true) answers compute/name
      check 'cloud metadata answers as this machine (not the node side)' bash -c "n=\$(curl -sf -m 6 -H 'Metadata-Flavor: Google' http://169.254.169.254/computeMetadata/v1/instance/name); [ -n \"\$n\" ] || n=\$(curl -s -m 6 -H 'Metadata: true' 'http://169.254.169.254/metadata/instance/compute/name?api-version=2021-02-01&format=text'); [ \"\$n\" = \"\$(hostname -s)\" ]"
      if [ -n "${LAN_PEER:-}" ]; then check "LAN peer $LAN_PEER answers during the tunnel" bash -c "timeout 4 bash -c 'exec 3<>/dev/tcp/${LAN_PEER%:*}/${LAN_PEER#*:}'"; fi
      # internet-sourced packets (an SSH session from outside) are martians under ANY full tunnel: their
      # replies leave through the node. Only the gateway, the LAN or link-local as source is the bug.
      check 'no martian packets from the gateway, LAN or link-local' bash -c "! sudo dmesg | grep 'martian source' | grep -Eq 'from (10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.)'"
      run 0 '-' 'disconnect' -- disconnect; sleep 3
      ;;
    ufw) # host firewall "deny incoming" on: every protocol still carries TCP (Hysteria2's TUN hands
      # connections to a local listener = new inbound; setup adds `ufw allow in on dvpn-hy2-client`)
      # ufw is the Debian/Ubuntu firewall; Fedora/EL/Arch use firewalld or none (platform-el.sh covers firewalld)
      command -v apt-get >/dev/null || { info 'ufw case: not an apt distro (firewalld hosts: platform-el.sh)' ''; return; }
      local had=no; dpkg -s ufw >/dev/null 2>&1 && had=yes
      [ $had = yes ] || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ufw >/dev/null 2>&1
      sudo ufw allow 22/tcp >/dev/null; sudo ufw default deny incoming >/dev/null; sudo ufw --force enable >/dev/null
      check 'ufw active, deny incoming' bash -c "sudo ufw status verbose | grep -q 'deny (incoming)'"
      # ufw arrived AFTER the app here: devnet-dvpn-firewall.path must have added the rule on its own
      sleep 2; check 'ufw rule for the Hysteria2 interface added by the watcher (ufw came after the app)' bash -c "sudo ufw status | grep -q dvpn-hy2-client"
      sudo dmesg -C
      if connect_p "$p"; then
        sleep 5; hold
        check 'egress = node with ufw denying incoming' egress_is_node "$p"
        # multicast the machine itself sends on the tunnel link (LLMNR 224.0.0.252 / ff02::1:3) is not traffic;
        # neither are TCP stragglers after a close (bare ACK / FIN / RST: conntrack calls them INVALID and
        # ufw drops those before any allow rule; deb12 R6: node API ACKs on WG, FIN ACKs from the Hy2 TUN).
        # What counts: SYN, data (PSH) or anything not TCP.
        check 'no UFW BLOCK of unicast traffic on a dvpn tunnel interface' bash -c '
          b=$(sudo dmesg | grep "UFW BLOCK" | grep "IN=dvpn-" | grep -Ev "DST=(22[4-9]|23[0-9])\.|DST=ff0" | grep -Ev "PROTO=TCP .*RES=0x00 ((ACK|FIN|RST) )+URGP")
          [ -z "$b" ] || { echo "$b" | head -2 | cut -c1-220; false; }'
        info 'teardown stragglers ufw dropped (bare ACK/FIN/RST, not traffic)' "$(sudo dmesg | grep 'UFW BLOCK' | grep -c 'IN=dvpn-')"
        run 0 '-' 'disconnect' -- disconnect; sleep 3
      fi
      sudo ufw --force disable >/dev/null
      [ $had = yes ] || sudo DEBIAN_FRONTEND=noninteractive apt-get purge -y ufw >/dev/null 2>&1
      ;;
    leaks) # kill switch on: every way around the tunnel is closed
      ks on
      connect_p "$p" || { restore; ks off; return; }
      sleep 4; hold
      check 'curl bound to the NIC is blocked' bash -c "! curl -4 -s -m 8 --interface '$NIC' https://api.ipify.org"
      # Oracle = the wire, not the answer: Hysteria2's TUN can answer DNS itself through the tunnel, so an
      # answer alone is not a leak (edge 2026-10-22). FAIL only if a query to 8.8.8.8:53 leaves the NIC.
      check 'raw UDP DNS to 8.8.8.8 from the NIC: no packet leaves the NIC' bash -c 'nic=$1; src=$(ip -4 -o addr show dev "$nic" | awk "{print \$4}" | cut -d/ -f1); cap=$(mktemp); sudo timeout 9 tcpdump -n -l -i "$nic" "udp port 53 and host 8.8.8.8" > "$cap" 2>&1 & sleep 1; timeout 6 dig +tries=1 +time=3 -b "$src" @8.8.8.8 example.com >/dev/null 2>&1; sleep 2; sudo pkill -x tcpdump; sleep 1; n=$(grep -c 8.8.8.8 "$cap"); echo "packets on NIC: $n"; grep -q "listening on" "$cap" && [ "$n" = 0 ]' _ "$NIC"
      check 'ICMP out of the NIC is blocked' bash -c "! ping -c 2 -W 2 -I '$NIC' 1.1.1.1 >/dev/null"
      check 'IPv6 never leaves directly' bash -c "! curl -6 -s -m 8 https://api64.ipify.org | grep -q ':'"
      is_proxy "$p" && check 'unproxied request blocked' bash -c '! curl -4 -s -m 8 https://api.ipify.org'
      run 0 '-' 'disconnect' -- disconnect; sleep 3
      run 0 '-' 'restore network' -- daemon restore-network; sleep 3
      ks off
      ;;
    killdaemon) # dvpnd killed and left down: status says so, restore-network cleans up, service starts again
      # the restarted dvpnd tries to close the old remote session while the dead tunnel's routes are still
      # up: that close may time out (the deposit still settles; settle-killdaemon checks the money)
      HEALTH_ALLOW='(deadline exceeded|Client.Timeout).*closing remote session failed'
      connect_p "$p" || { restore; return; }
      sleep 4
      sudo systemctl kill -s KILL dvpnd-client; sudo systemctl stop dvpnd-client; sleep 3
      # status is an at-a-glance report (exit 0, as on Windows); it must say the service is down
      run 0 'not reachable' 'status says the service is down' -- status; msg_ok 'service down'
      # it starts the service itself (polkit rule for the dvpn group) and finishes the restore
      run 0 '-' 'restore network with the service down' -- daemon restore-network; msg_ok 'restore, service down'
      check 'restore network started the service again' systemctl is-active -q dvpnd-client
      sleep 3
      check 'nothing left after restore (service still down)' bash -c "$(declare -f no_leftovers egress); no_leftovers"
      sudo systemctl start dvpnd-client; sleep 8
      check 'service back' systemctl is-active -q dvpnd-client
      ;;
    v6guard) # node over IPv4: IPv6 is refused at once while connected (dvpnd 0018), never left behind
      HEALTH_ALLOW='(deadline exceeded|Client.Timeout).*closing remote session failed'
      check 'before: no IPv6 guard' bash -c '! sudo nft list table inet dvpnd_v6guard >/dev/null 2>&1'
      connect_p "$p" || { restore; return; }
      sleep 4
      check 'egress = node' egress_is_node "$p"
      check 'IPv6 guard up while connected' sudo nft list table inet dvpnd_v6guard
      check 'IPv6 refused at once (curl -6 exit 7 in < 3 s, no fake connect)' v6_fails_fast
      check 'dual-stack site loads (www.google.com, plain client)' dualstack_ok "$p"
      check 'IPv6 on this machine itself still works (ping ::1)' ping -6 -c1 -W2 ::1
      run 0 '-' 'disconnect' -- disconnect; sleep 3
      check 'after disconnect: IPv6 guard removed' bash -c '! sudo nft list table inet dvpnd_v6guard >/dev/null 2>&1'
      # a dvpnd killed mid-session: the systemd restart (recovery) or restore-network removes the guard
      connect_p "$p" || { restore; return; }
      sleep 4; check 'guard up again' sudo nft list table inet dvpnd_v6guard
      sudo systemctl kill -s KILL dvpnd-client; sleep 5
      # systemd's restart delay grows with every kill (up to 5 min on systemd 254+; the 5th and 6th
      # protocol hit it in R7): wait for the service instead of a fixed 25 s
      local w=0; until systemctl is-active -q dvpnd-client || [ $w -ge 330 ]; do sleep 5; w=$((w + 5)); done
      if systemctl is-active -q dvpnd-client; then record PASS 'service back after the kill' "after $((w + 5)) s"; else record FAIL 'service not back 335 s after the kill' "$(systemctl show -p ActiveState,SubState --value dvpnd-client | tr '\n' ' ')"; fi
      sleep 5
      run 0 '-' 'disconnect after dvpnd was killed' -- disconnect; sleep 3
      run 0 '-' 'restore network' -- daemon restore-network; sleep 3
      check 'after kill + restart + restore: no IPv6 guard left' bash -c '! sudo nft list table inet dvpnd_v6guard >/dev/null 2>&1'
      ;;
    doctor)
      run 0 '-' 'doctor on a healthy install' -- daemon doctor
      check 'doctor: no FAIL rows' bash -c "! grep -q '^FAIL' <<< '$(printf '%s' "$LAST" | tr "'" ' ')'"
      run 0 'ready' 'drivers ready' -- daemon drivers
      if has_awg; then connect_p amneziawg && { sleep 4; run 0 '-' 'disconnect AWG' -- disconnect; sleep 3; gap; }; fi
      connect_p openvpn && { sleep 4; check 'OpenVPN works after an AmneziaWG session' egress_is_node openvpn; run 0 '-' 'disconnect' -- disconnect; sleep 3; }
      run 0 '-' 'doctor after sessions' -- daemon doctor
      check 'doctor after sessions: no FAIL rows' bash -c "! grep -q '^FAIL' <<< '$(printf '%s' "$LAST" | tr "'" ' ')'"
      ;;
    drivers) # a tool goes missing: drivers notices, repair-drivers brings it back
      # dpkg/rpm/pacman without dependency checks, not apt/dnf: the app package depends on the tools, and
      # `apt remove` took devnet-dvpn with it (u2404 2026-10-22: every later step "devnet-dvpn: command
      # not found"). A user deleting the tools by hand is what this case is about. On dnf/pacman
      # AmneziaWG is a source build (no package), so wireguard-tools is the one removed there.
      local pkg=wireguard-tools
      if command -v dpkg >/dev/null && command -v apt-get >/dev/null; then
        dpkg -s amneziawg-tools >/dev/null 2>&1 && pkg=amneziawg-tools
        pkq() { dpkg -s "$1" 2>/dev/null | grep -q 'Status: install ok installed'; }
        sudo dpkg --remove --force-depends "$pkg" >/dev/null 2>&1
      elif command -v rpm >/dev/null && command -v dnf >/dev/null; then
        pkq() { rpm -q "$1" >/dev/null 2>&1; }
        sudo rpm -e --nodeps "$pkg" >/dev/null 2>&1
      else
        pkq() { pacman -Q "$1" >/dev/null 2>&1; }
        sudo pacman -Rdd --noconfirm "$pkg" >/dev/null 2>&1
      fi
      check "$pkg is gone (the case is valid)" bash -c "$(declare -f pkq); ! pkq '$pkg'"
      check "the app is still installed after removing $pkg" command -v devnet-dvpn
      run 0 'missing' "drivers notices $pkg removed" -- daemon drivers
      run 0 'ready' 'repair-drivers' -- daemon repair-drivers --yes
      run 0 'ready' 'drivers ready again' -- daemon drivers
      check "$pkg installed again" bash -c "$(declare -f pkq); pkq '$pkg'"
      ;;
    dnspresets) # every preset + custom on the tunnel link, reverted after
      [ "$p" = wireguard ] || { info 'dnspresets runs on wireguard (DNS is set per link by dvpnd for every route protocol: matrix dns)' ''; return; }
      local d first dm=resolvectl
      # the mode setup picks: resolvconf where systemd-resolved is not running (EL9: dvpnd writes /etc/resolv.conf)
      systemctl is-active -q systemd-resolved || dm=resolvconf
      # Q0365: a dvpnd with the DNS forwarder puts its own tunnel address on the link and races the preset's
      # servers behind it. Pass = the system resolver points at the forwarder AND dvpnd's journal names the
      # preset's first server for THIS session (link == forwarder alone passes even if the preset is ignored).
      # A dvpnd without the forwarder ("not started; applying the servers directly", RC3) = the preset on the link.
      # Neither journal line = FAIL.
      dns_on_tunnel() { # <first server> <since 'YYYY-MM-DD HH:MM:SS' UTC> <dns mode>
        local want=$1 since=$2 mode=$3 j line ip srv got
        j=$(sudo journalctl -u dvpnd-client --since "$since" --no-pager -o cat 2>&1)
        if [ "$mode" = resolvconf ]; then got=$(grep -E '^nameserver' /etc/resolv.conf | head -1 | awk '{print $2}')
        else got=$(resolvectl dns "$(ip -o link | grep -oE ' dvpn-[a-z0-9-]+:' | tr -d ' :' | head -1)" 2>&1); fi
        line=$(grep "dns forwarder racing the session's servers" <<< "$j" | tail -1)
        if [ -n "$line" ]; then
          ip=$(grep -oE '"addr":"[0-9.]+' <<< "$line" | cut -d'"' -f4); srv=$(grep -oE '"servers":\[[^]]*\]' <<< "$line")
          echo "forwarder $ip, $srv; system resolver: $got"
          [ -n "$ip" ] && grep -qwF -- "$ip" <<< "$got" && grep -q "\"$want\"" <<< "$srv"; return
        fi
        if grep -q 'dns forwarder not started; applying the servers directly' <<< "$j"; then
          echo "no forwarder (servers applied directly); system resolver: $got"; grep -qwF -- "$want" <<< "$got"; return
        fi
        echo "FAIL: dvpnd logged neither 'dns forwarder racing' nor 'dns forwarder not started' since $since"; return 1
      }
      for d in handshake cloudflare google quad9 9.9.9.10,149.112.112.10; do
        first=${d%%,*}; case $d in handshake) first=103.196.38.38 ;; cloudflare) first=1.1.1.1 ;; google) first=8.8.8.8 ;; quad9) first=9.9.9.9 ;; esac
        run 0 '-' "DNS $d" -- daemon set --dns "$d" --dns-mode "$dm" --yes
        local since; since=$(date -u '+%F %T')
        connect_p "$p" || { restore; continue; }
        sleep 4
        check "DNS $d: the system resolver uses $first for the session ($dm)" dns_on_tunnel "$first" "$since" "$dm"
        check "DNS $d: names resolve" getent hosts example.com
        run 0 '-' 'disconnect' -- disconnect; sleep 3
        if [ "$dm" = resolvconf ]; then
          check "DNS $d: reverted (/etc/resolv.conf has no $first)" bash -c "! grep -q '^nameserver $first' /etc/resolv.conf"
        else
          check "DNS $d: reverted (no $first on any link)" bash -c "! resolvectl dns | grep -q '$first'"
        fi
        gap
      done
      run 0 '-' 'DNS back to Cloudflare' -- daemon set --dns cloudflare --yes
      ;;
    proxydyn) # V2Ray/Xray: the user's own proxy settings are always put back exactly
      is_proxy "$p" || { info 'proxy only (V2Ray/Xray)' ''; return; }
      # one session bus for the CLI AND the checks: the user's own (an SSH login with a systemd user
      # session has /run/user/<uid>/bus), else a private one for this case. Without any bus GSettings
      # cannot write, so 'proxy on' rightly refuses (a test VM, u2404-arm had no user session).
      local own_bus=''
      if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
        if [ -S "/run/user/$(id -u)/bus" ]; then export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u)/bus"
        else DBUS_SESSION_BUS_ADDRESS=$(dbus-daemon --session --fork --print-address=1 --print-pid=3 3>/tmp/ddv-bus.pid | head -1); export DBUS_SESSION_BUS_ADDRESS; own_bus=$(cat /tmp/ddv-bus.pid); fi
      fi
      local G="gsettings"
      $G set org.gnome.system.proxy mode manual; $G set org.gnome.system.proxy.http host 'user.proxy.test'; $G set org.gnome.system.proxy.http port 3128
      local before; before=$($G get org.gnome.system.proxy mode)/$($G get org.gnome.system.proxy.http host)
      connect_p "$p" || { restore; return; }
      sleep 4
      for i in 1 2 3; do run 0 '-' "proxy on ($i)" -- proxy on --yes; run 0 '-' "proxy off ($i)" -- proxy off; done
      # on a FAIL, print before/now plus port and SOCKS so the log shows what changed (Q0299)
      check 'toggled 3×: user proxy exactly as before' bash -c "now=\"\$($G get org.gnome.system.proxy mode)/\$($G get org.gnome.system.proxy.http host)\"; [ \"\$now\" = \"$before\" ] || { echo \"before [$before:3128] now [\$now:\$($G get org.gnome.system.proxy.http port)] socks [\$($G get org.gnome.system.proxy.socks host):\$($G get org.gnome.system.proxy.socks port)] pac [\$($G get org.gnome.system.proxy autoconfig-url)]\"; exit 1; }"
      run 0 '-' 'proxy on' -- proxy on --yes
      check 'proxy on: SOCKS = session' bash -c "$G get org.gnome.system.proxy.socks port | grep -q \"\$(echo $(socks) | cut -d: -f2)\""
      # the user changes their own proxy while ours is on: ours must not overwrite theirs at the end
      $G set org.gnome.system.proxy mode auto; $G set org.gnome.system.proxy autoconfig-url 'http://wpad.user.test/proxy.pac'
      run 0 '-' 'disconnect after the user changed the proxy' -- disconnect; sleep 3
      check 'user PAC kept (not overwritten by a restore)' bash -c "m=\$($G get org.gnome.system.proxy mode); u=\$($G get org.gnome.system.proxy autoconfig-url); { echo \"\$m\" | grep -q auto && echo \"\$u\" | grep -q wpad.user.test; } || { echo \"want mode ['auto'] pac ['http://wpad.user.test/proxy.pac'] now mode [\$m] pac [\$u] http [\$($G get org.gnome.system.proxy.http host):\$($G get org.gnome.system.proxy.http port)] socks [\$($G get org.gnome.system.proxy.socks host):\$($G get org.gnome.system.proxy.socks port)]\"; exit 1; }"
      $G set org.gnome.system.proxy mode none
      [ -n "$own_bus" ] && { kill "$own_bus" 2>/dev/null; unset DBUS_SESSION_BUS_ADDRESS; }
      ;;
    porttaken) # the SOCKS port is already in use
      is_proxy "$p" || { info 'proxy only (V2Ray/Xray)' ''; return; }
      connect_p "$p" || { restore; return; }
      local port; port=$(socks | cut -d: -f2); sleep 3
      run 0 '-' 'disconnect' -- disconnect; sleep 3; gap
      python3 -c "import socket,time;s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);s.bind(('127.0.0.1',$port));s.listen();time.sleep(120)" & local holder=$!
      sleep 1
      # either outcome is right (Windows port-taken too): another port that carries the VPN, or a
      # refusal that names the busy port. A raw run, so a clean refusal is not counted as a failure.
      if $CLI connect "${NODE[$p]}" --units 1 --yes > /tmp/porttaken.out 2>&1; then
        sleep 4; check "port $port taken: session uses another port and works" bash -c "[ \"\$(echo $(socks) | cut -d: -f2)\" != '$port' ]" && check 'egress = node' egress_is_node "$p"
        run 0 '-' 'disconnect' -- disconnect; sleep 3
      else
        LAST=$(cat /tmp/porttaken.out); msg_ok "port $port taken: connect refused"
        if grep -q "port $port" /tmp/porttaken.out; then record PASS "port $port taken: the refusal names the busy port" "$LAST"; else record FAIL "port $port taken: the refusal does not name the busy port" "$LAST"; fi
        check 'port taken: nothing half-set after the refusal (no v2ray/xray left)' bash -c '! pgrep -x v2ray && ! pgrep -x xray'
        $CLI disconnect >/dev/null 2>&1; sleep 3
      fi
      kill $holder 2>/dev/null
      ;;
    netem) # bad paths: loss, latency + jitter, reorder, duplicate, 1 Mbit
      local q
      for q in 'loss 5%' 'delay 300ms 50ms' 'delay 20ms reorder 25% 50%' 'duplicate 5%' 'rate 1mbit'; do
        sudo tc qdisc replace dev "$NIC" root netem $q
        if connect_p "$p"; then
          sleep 6
          local via=''; is_proxy "$p" && via="--socks5-hostname $(socks)"
          check "[$q] egress = node" egress_is_node "$p"
          check "[$q] 2 MiB download completes" bash -c "curl -s -m 90 $via -r 0-2097151 -o /dev/null -w '%{size_download}' https://ash-speed.hetzner.com/100MB.bin | grep -q '^2097152$'"
          run 0 '-' "[$q] disconnect" -- disconnect; sleep 3
        fi
        sudo tc qdisc del dev "$NIC" root 2>/dev/null
        back_clean "[$q]"; gap
      done
      return ;;
    udpblock) # all UDP to the node blocked: UDP protocols fail fast and clearly, TCP ones work
      hold; block_node 'meta l4proto udp'
      local t0=$SECONDS
      # a raw connect: a refusal is the expected outcome for UDP protocols and is judged below, not by
      # connect_p (which records every failed connect as a FAIL; a test VM, u2404-arm)
      if $CLI connect "${NODE[$p]}" --units 1 --yes > /tmp/udpblock.out 2>&1; then
        sleep 5; local via=''; is_proxy "$p" && via="--socks5-hostname $(socks)"
        local e; e=$(curl -4 -s -m 12 $via https://api.ipify.org)
        info "connected with UDP blocked after $((SECONDS - t0)) s; egress '$e'" ''
        case $p in v2ray|xray) [ "$e" = "$NODE_IP" ] && record PASS 'TCP protocol keeps working with UDP blocked' "$e" || record FAIL 'TCP protocol with UDP blocked' "$e" ;;
                   *) [ "$e" = "$NODE_IP" ] && record PASS 'works with UDP blocked (TCP transport)' "$e" || record FAIL 'UDP protocol said Connected but carries nothing' "egress '$e'" ;; esac
        run 0 '-' 'disconnect' -- disconnect; sleep 3
      else
        LAST=$(cat /tmp/udpblock.out); msg_ok 'UDP blocked: connect failed'
        case $p in v2ray|xray) record FAIL 'TCP protocol refused although only UDP is blocked' "$LAST" ;; esac
        $CLI disconnect >/dev/null 2>&1; sleep 3
        info "failed after $((SECONDS - t0)) s" "$LAST"
        [ $((SECONDS - t0)) -le 120 ] && record PASS 'fails within 2 min' '' || record FAIL 'took over 2 min to fail' "$((SECONDS - t0)) s"
      fi
      unblock; sleep 2
      ;;
    mtu) # path MTU 1280 on the NIC
      # changing the MTU resets a virtio NIC for a moment (a small nicflap): voucher calls may time out then
      HEALTH_ALLOW='(Client.Timeout|deadline exceeded|request canceled|TLS handshake timeout).*issuing voucher failed|issuing voucher failed.*(Client.Timeout|deadline exceeded|request canceled|TLS handshake timeout)'
      MTU_WAS=$(cat "/sys/class/net/$NIC/mtu" 2>/dev/null); info "MTU before the case" "${MTU_WAS:-unknown} on $NIC"
      sudo ip link set dev "$NIC" mtu 1280
      if [ "$p" = hysteria2 ]; then
        # QUIC needs more than 1280 on the path once the NIC's own headers are counted: Hysteria2 cannot
        # come up there (#31 gap #80, Windows mtu-a188). The user must be told to switch protocol, fast.
        local t0=$SECONDS
        run 1 'Hysteria2' 'MTU 1280: Hysteria2 fails and names itself (gap #80)' -- connect "${NODE[$p]}" --units 1 --yes
        [ $((SECONDS - t0)) -le 120 ] && record PASS 'MTU 1280: Hysteria2 fails within 2 min' '' || record FAIL 'MTU 1280: Hysteria2 took over 2 min to fail' "$((SECONDS - t0)) s"
        $CLI disconnect >/dev/null 2>&1; sleep 3
      elif connect_p "$p"; then
        sleep 5; local via=''; is_proxy "$p" && via="--socks5-hostname $(socks)"
        # an exact 5 MiB range (speed.cloudflare.com answers 429 to the shared node IP since 10-22)
        check 'MTU 1280: 5 MiB download completes (no stall)' bash -c "curl -s -m 90 $via -r 0-5242879 -o /dev/null -w '%{size_download}' https://ash-speed.hetzner.com/100MB.bin | grep -q '^5242880$'"
        run 0 '-' 'disconnect' -- disconnect; sleep 3
      fi
      if [ -n "$MTU_WAS" ]; then sudo ip link set dev "$NIC" mtu "$MTU_WAS"; fi
      check "MTU restored to $MTU_WAS on $NIC" bash -c "[ \"\$(cat /sys/class/net/$NIC/mtu)\" = '$MTU_WAS' ]"
      MTU_WAS=
      ;;
    races) # rapid connect/disconnect, disconnect while connecting, two commands at once
      local i
      for i in 1 2 3; do
        hold; ( $CLI connect "${NODE[$p]}" --units 1 --yes > "/tmp/race-$i.out" 2>&1 ) & local cp=$!
        sleep $((i * 2)); run 0 '-' "disconnect ${i}x2 s into a connect" -- disconnect
        wait $cp; LAST=$(cat "/tmp/race-$i.out"); msg_ok "connect interrupted by disconnect ($i)"
        sleep 4; $CLI disconnect >/dev/null 2>&1; sleep 3
        check "race $i: nothing left" bash -c "$(declare -f no_leftovers egress); for k in 1 2 3; do no_leftovers && exit 0; sleep 5; done; no_leftovers; exit 1"
        gap
      done
      connect_p "$p" || { restore; return; }
      sleep 3
      ( $CLI status > /tmp/race-a.out 2>&1 ) & ( $CLI status > /tmp/race-b.out 2>&1 ) & wait
      check 'two status calls at once both answer' bash -c "grep -q '$p' /tmp/race-a.out && grep -q '$p' /tmp/race-b.out"
      run 1 '-' 'second connect while connected (no --switch) is refused' -- connect "${NODE[$p]}" --units 1 --yes; msg_ok 'already connected'
      check 'session unharmed by the refused connect' egress_is_node "$p"
      run 0 '-' 'disconnect' -- disconnect; sleep 3
      ;;
    idle) # Cosmos CF6: 5 min with no traffic, then traffic still goes through (keepalive held)
      connect_p "$p" || { restore; return; }
      sleep 4
      check 'egress = node before the idle' egress_is_node "$p"
      local i
      for i in 1 2 3 4 5; do hold; sleep 60; done   # no traffic of ours for 5 min
      local t0=$SECONDS
      check 'after 5 min idle: egress = node' egress_is_node "$p"
      info "first request after the idle took $((SECONDS - t0)) s" ''
      check 'after idle: answered within 15 s' bash -c "[ $((SECONDS - t0)) -le 15 ]"
      run 0 '-' 'disconnect' -- disconnect; sleep 3
      ;;
    confwipe) # Cosmos T13: per-session files (keys, auth, passwords) are gone after disconnect
      local dir=/var/lib/dvpnd/client/client/$p
      connect_p "$p" || { restore; return; }
      sleep 4
      info "files during the session in $dir" "$(sudo find "$dir" -type f -printf '%m %f\n' 2>/dev/null | sort | tr '\n' ' ')"
      check 'during: no session file readable by other users' bash -c "[ -z \"\$(sudo find '$dir' -type f -perm -004 ! -name config.toml 2>/dev/null)\" ]"
      run 0 '-' 'disconnect' -- disconnect; sleep 4
      local left; left=$(sudo find "$dir" -type f ! -name config.toml -printf '%f ' 2>/dev/null)
      check "after disconnect: only config.toml left in $p/ (${left:-none})" bash -c "[ -z '$left' ]"
      ;;
    dnsgone) # Cosmos rule 39: the tunnel link vanishes under the session; DNS still comes back exactly
      case $p in v2ray|xray) info 'proxy only: no tunnel link, no DNS change' ''; return ;; esac
      # the link is deleted on purpose: usage reads for vouchers fail until the session ends
      HEALTH_ALLOW='(No such device|Link not found).*issuing voucher failed'
      local rc_before link; rc_before=$(readlink -f /etc/resolv.conf; sudo cat /etc/resolv.conf | md5sum)
      connect_p "$p" || { restore; return; }
      sleep 4; link=$(tunnel_link)
      check "tunnel link present ($link)" bash -c "[ -n '$link' ]"
      hold; sudo ip link del "$link" 2>/dev/null; sleep 5
      info 'status after the link was deleted' "$($CLI status 2>&1 | head -4)"
      run 0 '-' 'disconnect after the link is gone' -- disconnect; msg_ok 'link gone'; sleep 4
      $CLI daemon restore-network >/dev/null 2>&1; sleep 3
      check 'resolv.conf exactly as before' bash -c "[ \"\$(readlink -f /etc/resolv.conf; sudo cat /etc/resolv.conf | md5sum)\" = '$rc_before' ]"
      check 'no VPN DNS left on any link' bash -c "! resolvectl dns 2>/dev/null | grep -qE '(dvpn-|hy2-client|ovpn-client|tun[0-9])'"
      check 'names resolve within 3 s' bash -c 'timeout 3 getent hosts example.com >/dev/null'
      ;;
    ownvpn) # Cosmos D6: another VPN already owns the default route (OpenVPN-style def1 routes)
      case $p in wireguard|openvpn) ;; *) return ;; esac
      local before; before=$(channels_n)
      hold
      sudo ip link add ownvpn0 type dummy && sudo ip addr add 10.99.0.2/24 dev ownvpn0 && sudo ip link set ownvpn0 up
      sudo ip route add 0.0.0.0/1 dev ownvpn0 && sudo ip route add 128.0.0.0/1 dev ownvpn0
      local routes_before; routes_before=$(ip -4 route show dev ownvpn0 | sort | md5sum)
      run 1 '-' 'connect while another VPN owns the default route fails' -- connect "${NODE[$p]}" --units 1 --yes; msg_ok 'other VPN'
      info 'connect message' "$LAST"
      check 'the other VPN''s routes untouched' bash -c "[ \"\$(ip -4 route show dev ownvpn0 | sort | md5sum)\" = '$routes_before' ]"
      check 'the other VPN''s link still up' bash -c 'ip link show ownvpn0 | grep -q UP'
      sudo ip link del ownvpn0; sleep 3
      check "money: no deposit opened ($before → $(channels_n))" bash -c "[ '$before' = \"\$($(declare -f channels_n); CLI=$CLI; channels_n)\" ]"
      $CLI disconnect >/dev/null 2>&1; sleep 2
      ;;
    fuzz) # protocol-independent: run once
      [ "$p" = wireguard ] || return
      local a out code bad=0 keep=/tmp/ddv-fuzz-config.toml
      # an accepted bad `daemon set` must not poison the cases after this one (u2404 batch H: a dead RPC
      # left the service stopped for every later connect): put the config back and restart
      sudo cp /var/lib/dvpnd/client/config.toml "$keep"
      while IFS= read -r a; do
        out=$(eval "$CLI $a" 2>&1 < /dev/null); code=$?
        if printf '%s' "$out" | grep -Eq 'TypeError|ReferenceError|node:internal|at [A-Za-z.]+ \('; then bad=1; record FAIL "fuzz: stack trace for: $a" "$out"; fi
        case "$a" in *--yes*) [ $code = 0 ] && { bad=1; record FAIL "fuzz: accepted nonsense: $a" "$out"
          case "$a" in "daemon set"*) sudo cp "$keep" /var/lib/dvpnd/client/config.toml && sudo systemctl restart dvpnd-client; sleep 8 ;; esac; } ;; esac
        printf '\n### fuzz %s\n%s\n(exit %s)\n' "$a" "$out" "$code" >> "$LOG"
      done <<'EOF'
connect '' --yes
connect "$(printf 'x%.0s' {1..5000})" --yes
connect SLVJNn38s5RfqcVW7a7A4hGKqjY7Y1bKkUpG7wrGX5D --units 99999999999999999999 --yes
connect SLVJNn38s5RfqcVW7a7A4hGKqjY7Y1bKkUpG7wrGX5D --units 1e3 --yes
connect SLVJNn38s5RfqcVW7a7A4hGKqjY7Y1bKkUpG7wrGX5D --units '１' --yes
daemon set --dns "1.1.1.1'; rm -rf /" --yes
daemon set --dns '1.1.1.1"]\n[evil]' --yes
daemon set --rpc 'https://x.test/"\n kill_switch = "off' --yes
daemon set --rpc 'javascript:alert(1)' --yes
daemon set --split-mode include --split-routes '0.0.0.0/0; rm' --yes
daemon set --split-mode include --split-routes '999.1.1.1/40' --yes
daemon set --split-mode sideways --yes
daemon set --escrow -1 --yes
daemon set --escrow 1e99 --yes
daemon set --prepay-mb -1 --yes
daemon set --kill-switch 'on;off' --yes
daemon set --allow-lan maybe --yes
channels fund ZZZ --tdvpn -1 --yes
wallet send 11111111111111111111111111111111 --tdvpn NaN --yes
nodes fav 'not an address'
settings set nosuchkey 1
--definitely-not-a-flag
EOF
      check 'fuzz: config unchanged by every attempt (no injected keys)' bash -c "! sudo grep -nE 'evil|rm -rf|javascript|kill_switch = \"off\"\$' /var/lib/dvpnd/client/config.toml /var/lib/dvpnd/config.toml"
      [ $bad = 0 ] && record PASS 'fuzz: every bad input refused with a plain message' ''
      return ;;
    rpcstart) # Q0323 / Q0232 (dvpnd 7b2af32): the daemon STARTS while the Solana RPC is unreachable. It must serve its
      # socket, refuse new sessions with 'waiting for network', and become ready once the RPC is back; never exit and
      # restart in a loop (u24b 10-29: 139 restarts, socket never served, only a reboot freed the box). Once per run.
      [ "$p" = "${PROTOS%% *}" ] || { info 'rpcstart: protocol-independent, ran with the first protocol' ''; return; }
      hold
      $CLI disconnect >/dev/null 2>&1; ks off >/dev/null; sleep 3
      # every RPC host the daemon may use: its config + the devnet default, v4 and v6
      local hosts h v4='' v6='' n0 n1 st i ok=0
      hosts=$( { sudo grep -hoE 'https?://[^"/:]+' /var/lib/dvpnd/client/config.toml 2>/dev/null | sed -E 's#https?://##'; echo api.devnet.solana.com; } | sort -u)
      for h in $hosts; do
        v4+=$(getent ahostsv4 "$h" | awk '{print $1}' | sort -u | paste -sd, -),
        v6+=$(getent ahostsv6 "$h" | awk '$1 ~ /:/ {print $1}' | sort -u | paste -sd, -),
      done
      v4=$(tr ',' '\n' <<<"$v4" | grep . | sort -u | paste -sd, -); v6=$(tr ',' '\n' <<<"$v6" | grep . | sort -u | paste -sd, -)
      info 'RPC hosts blocked' "$(echo $hosts) → v4 ${v4:-none} v6 ${v6:-none}"
      [ -n "$v4" ] || { record FAIL 'rpcstart: no RPC address resolved (cannot block it)' "$hosts"; return; }
      sudo nft add table inet ddvtest && sudo nft "add chain inet ddvtest out { type filter hook output priority -10; }" \
        && sudo nft add rule inet ddvtest out ip daddr "{ $v4 }" drop \
        && { [ -z "$v6" ] || sudo nft add rule inet ddvtest out ip6 daddr "{ $v6 }" drop; }
      n0=$(systemctl show dvpnd-client -p NRestarts --value)
      sudo systemctl restart dvpnd-client; sleep 30; hold
      n1=$(systemctl show dvpnd-client -p NRestarts --value)
      check 'RPC blocked at start: service stays up (no exit/restart loop)' bash -c "systemctl is-active -q dvpnd-client && [ '$n1' = '$n0' ]"
      info 'service restarts during the block' "NRestarts $n0 → $n1; last lines: $(sudo journalctl -u dvpnd-client -n 4 -o cat --no-pager 2>&1 | grep -v grpc.method | tr '\n' ' ' | cut -c1-300)"
      check 'RPC blocked at start: daemon socket served' sudo test -S /var/lib/dvpnd/client/daemon.sock
      run 0 '-' 'status with the RPC blocked since start' -- status; info 'status' "$LAST"; msg_ok 'status, RPC blocked at start'
      check "status says it is waiting for the network" bash -c "printf '%s' \"\$1\" | grep -qiE 'waiting for (the )?network'" _ "$LAST"
      LAST=$(timeout 90 $CLI connect "${NODE[$p]}" --units 1 --yes 2>&1); info 'connect with the RPC blocked' "$LAST"
      check 'connect refused while waiting for the network (no session)' bash -c "! $CLI status 2>/dev/null | grep -qE '^Session +[^N ]'"
      msg_ok 'connect, RPC blocked at start'
      unblock
      for i in $(seq 1 24); do st=$($CLI status 2>&1); grep -qiE 'waiting for (the )?network' <<<"$st" || { ok=1; break; }; sleep 5; done
      check 'RPC back: daemon leaves "waiting for network" within 120 s' test $ok = 1
      info 'status after the RPC came back' "$(head -4 <<<"$st" | tr '\n' ' ')"
      check 'RPC back: service never restarted' bash -c "[ \"\$(systemctl show dvpnd-client -p NRestarts --value)\" = '$n0' ]"
      HEALTH_ALLOW='preflight|rpc|waiting for (the )?network|getHealth|getLatestBlockhash'   # the block makes these on purpose
      ;;
    *) record FAIL "unknown case $CASE" ''; return ;;
  esac
  back_clean "$CASE"
  health "$CASE" "${HEALTH_ALLOW:-^$}"
  gap
}

for p in $PROTOS; do
  P=$p
  if [ "$p" = amneziawg ] && ! has_awg; then info 'skipped: no AmneziaWG on this kernel' ''; continue; fi
  mark
  case_one "$p"
done
P=final
check 'final: nothing left, direct egress' bash -c "$(declare -f no_leftovers egress); no_leftovers && [ \"\$(egress)\" = '$DIRECT' ]"
summary
