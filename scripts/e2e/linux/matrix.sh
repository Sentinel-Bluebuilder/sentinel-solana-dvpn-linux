#!/usr/bin/env bash
# ─── Every feature × every protocol, live (run ON a disposable VM, detached) ───
#   nohup bash matrix.sh <case> [protocols…] > ~/matrix/<case>.out 2>&1 < /dev/null &
# Cases: pay-gb pay-hour plan topup adopt dns ks-on ks-persist split-ks reconnect   (plan: env PLAN_ADDR)
# (split by route = split-test.sh; reboot mid-session = reboot-test.sh)
# Results: ~/matrix/<case>.tsv  PASS/FAIL/INFO <tab> protocol <tab> check <tab> detail
# Env: DVPN_KEYFILE, DVPN_DATA_DIR. Sequential; 7 s between chain transactions.
set -u
. "$(dirname "$0")/lib.sh"
CASE=${1:?case}; shift
PROTOS=${*:-$ALL_PROTOCOLS}
suite_init matrix "$CASE"
P=setup
check "direct egress $DIRECT, NIC $NIC" bash -c "[ -n '$DIRECT' ] && [ '$DIRECT' != '$NODE_IP' ] && [ -n '$NIC' ]"
has_awg() { modinfo amneziawg >/dev/null 2>&1 || command -v awg >/dev/null; }

dns_on_nic() { # <resolver command…> → number of bare-name queries seen on the NIC
  local f n names=() bare=0; f=$(mktemp)
  sudo timeout 14 tcpdump -ni "$NIC" -l 'udp port 53 or tcp port 53' > "$f" 2>/dev/null & local tp=$!
  sleep 2
  for i in 1 2 3; do n="ddv-leak-$RANDOM$RANDOM.example.com"; names+=("$n"); "$@" "$n" >/dev/null 2>&1; done
  wait $tp 2>/dev/null
  for n in "${names[@]}"; do bare=$((bare + $(grep -cF "? $n. (" "$f"))); done
  echo "$bare"; rm -f "$f"
}
# Q0388: dvpnd dafb4a1+ (Q0365) puts a DNS forwarder on the tunnel IPv4:53 that races the session's servers,
# so the link names the forwarder, not 1.1.1.1. Forwarder ("dns forwarder racing the session's servers"):
# the system resolver = its addr AND its servers include <want>. No forwarder ("not started; applying the
# servers directly", RC3): <want> itself. resolvectl mode: the link is also the default route for names (~.).
# Neither journal line = FAIL. Same oracle as edge.sh dns_on_tunnel (1c4e01b0).
vpn_dns_on() { # <want server> <since 'YYYY-MM-DD HH:MM:SS' UTC> <dns mode> <link>
  local want=$1 since=$2 mode=$3 link=$4 j line ip srv got
  j=$(sudo journalctl -u dvpnd-client --since "$since" --no-pager -o cat 2>&1)
  if [ "$mode" = resolvconf ]; then got=$(grep -E '^nameserver' /etc/resolv.conf | head -1 | awk '{print $2}')
  else
    got=$(resolvectl dns "$link" 2>&1)
    resolvectl domain "$link" 2>&1 | grep -q '~\.' || { echo "$link is not the default route for names: $(resolvectl domain "$link" 2>&1)"; return 1; }
  fi
  line=$(grep "dns forwarder racing the session's servers" <<< "$j" | tail -1)
  if [ -n "$line" ]; then
    ip=$(grep -oE '"addr":"[0-9.]+' <<< "$line" | cut -d'"' -f4); srv=$(grep -oE '"servers":\[[^]]*\]' <<< "$line")
    echo "forwarder $ip, $srv; system resolver: $got"
    [ -n "$ip" ] && grep -qwF -- "$ip" <<< "$got" && grep -q "\"$want\"" <<< "$srv"; return
  fi
  if grep -q 'dns forwarder not started; applying the servers directly' <<< "$j"; then
    echo "no forwarder (servers applied directly); system resolver: $got"; grep -qwF -- "$want" <<< "$got"; return
  fi
  echo "dvpnd logged neither 'dns forwarder racing' nor 'dns forwarder not started' since $since; system resolver: $got"; return 1
}
never_direct() { check "$1 → never the direct IP" bash -c "[ \"\$(curl -4 -s -m 10 https://api.ipify.org)\" != '$DIRECT' ]"; }

# ─── one case on one protocol ───
case_one() {
  local p=$1
  case $CASE in
    pay-gb|pay-hour)
      local basis=per_gb word='per GB'; [ "$CASE" = pay-hour ] && { basis=per_hour; word='per hour'; }
      connect_p "$p" --basis "$basis" || { restore; return; }
      sleep 4
      check "egress = node" egress_is_node "$p"
      check "dual-stack site loads (www.google.com, plain client)" dualstack_ok "$p"
      check "IPv6 refused at once while connected (no fake connect; apps fall back to IPv4)" v6_fails_fast
      run 0 "$word" "status shows $word" -- status
      run 0 "$p" 'status names the protocol' -- status
      sleep 20 # a few voucher rounds
      run 0 '-' 'disconnect' -- disconnect
      sleep 3
      check 'after disconnect: IPv6 guard removed' bash -c '! sudo nft list table inet dvpnd_v6guard >/dev/null 2>&1'
      ;;
    plan) # connect on a subscription (a fresh one of this wallet, PLAN_ADDR = #31's plan over the six nodes)
      # The plan's max_connections (ddv-node-3: 2) counts this WALLET's unexpired tickets (24 h), and
      # the subscription address is fixed per wallet + plan, so a new subscription does not reset it.
      # Past it the app refuses on purpose ("you already use them"). Cover six protocols with one
      # wallet per 2 of them: run "matrix.sh plan <p1> <p2>" per wallet (final 16.30 T2/T2b).
      if [ -z "${SUB:-}" ]; then
        run 0 '-' "plans subscribe $PLAN_ADDR" -- plans subscribe "$PLAN_ADDR" --yes; gap
        SUB=$($CLI plans subscriptions --json 2>/dev/null | node -e "let t='';process.stdin.on('data',d=>t+=d).on('end',()=>{try{const j=JSON.parse(t);const a=(Array.isArray(j)?j:j.subscriptions||[]).filter(s=>s.plan==='$PLAN_ADDR'&&s.active!==false).sort((x,y)=>(x.openedAt||0)-(y.openedAt||0));const s=a[a.length-1];console.log(s?(s.address||s.subscription||''):'')}catch{console.log('')}})")
        if [ -z "$SUB" ]; then record FAIL 'subscription found after subscribe' "$($CLI plans subscriptions 2>&1 | head -5)"; return; fi
        info 'subscription' "$SUB"
      fi
      hold
      run 0 'Connected|connected' "connect on the subscription" -- connect "${NODE[$p]}" --plan "$SUB" --yes || { restore; return; }
      sleep 4
      check 'egress = node' egress_is_node "$p"
      run 0 "$p" 'status names the protocol' -- status
      info 'status' "$LAST"
      sleep 20 # a few voucher rounds on the plan ledger
      run 0 '-' 'disconnect' -- disconnect
      sleep 3
      ;;
    topup)
      connect_p "$p" || { restore; return; }
      sleep 4
      local ch; ch=$($CLI status --json 2>/dev/null | node -e "let t='';process.stdin.on('data',d=>t+=d).on('end',()=>{const m=t.match(/\"channel[A-Za-z]*\"\s*:\s*\"([1-9A-HJ-NP-Za-km-z]{32,44})\"/);console.log(m?m[1]:'')})")
      if [ -z "$ch" ]; then record FAIL 'channel in status --json' "$($CLI status --json 2>&1 | head -c 300)"; restore; return; fi
      gap
      run 0 '-' "channels fund $ch +1 tDVPN mid-session" -- channels fund "$ch" --tdvpn 1 --yes
      sleep 6
      check 'session still up after the top-up, egress = node' egress_is_node "$p"
      run 0 "$p" 'status still connected' -- status
      run 0 '-' 'disconnect' -- disconnect
      sleep 3
      ;;
    adopt)
      connect_p "$p" || { restore; return; }
      sleep 4
      # a fresh process (the CLI = a restarted app) finds the running session and controls it
      run 0 "$p" 'new process: status adopts the running session' -- status
      if is_proxy "$p"; then run 0 '127\.0\.0\.1:[0-9]+' 'new process: proxy status shows the SOCKS endpoint' -- proxy status; fi
      check 'adopted session: egress = node' egress_is_node "$p"
      sudo systemctl restart dvpnd-client; sleep 12
      run 0 '-' 'after a service restart: status (recorded)' -- status
      run 0 '-' 'after a service restart: disconnect still works' -- disconnect
      sleep 3
      ;;
    dns)
      # the DNS mode setup picks: resolvectl where systemd-resolved runs, resolvconf where it does not (EL9)
      local dm=resolvectl; systemctl is-active -q systemd-resolved || dm=resolvconf
      run 0 '-' "kill switch off, Cloudflare DNS, $dm" -- daemon set --kill-switch off --dns cloudflare --dns-mode "$dm" --yes
      local since; since=$(date -u '+%F %T')
      connect_p "$p" || { restore; return; }
      sleep 4
      if is_proxy "$p"; then
        local s; s=$(socks)
        check "SOCKS-resolved names never hit $NIC port 53" bash -c "$(declare -f dns_on_nic); NIC=$NIC; c() { curl -s -m 8 --socks5-hostname $s -o /dev/null https://\$1; }; [ \"\$(dns_on_nic c)\" = 0 ]"
      else
        local link; link=$(tunnel_link)
        if [ "$dm" = resolvconf ]; then
          check 'VPN DNS 1.1.1.1 for the session: first resolver in /etc/resolv.conf (resolvconf mode)' vpn_dns_on 1.1.1.1 "$since" "$dm" "$link"
        else
          check "VPN DNS 1.1.1.1 for the session on $link, default route for names" vpn_dns_on 1.1.1.1 "$since" "$dm" "$link"
        fi
        check "no lookup leaves on $NIC" bash -c "$(declare -f dns_on_nic); NIC=$NIC; [ \"\$(dns_on_nic getent hosts)\" = 0 ]"
      fi
      run 0 '-' 'disconnect' -- disconnect
      sleep 3
      if [ "$dm" = resolvconf ]; then
        check 'system DNS back (/etc/resolv.conf has no 1.1.1.1)' bash -c "! grep -q '^nameserver 1.1.1.1' /etc/resolv.conf"
      else
        check 'system DNS back (no 1.1.1.1 left on any link)' bash -c "! resolvectl dns | grep -E 'dvpn|hy2|ovpn|tun' | grep -q 1.1.1.1"
      fi
      ;;
    ks-on|ks-persist)
      local mode=on; [ "$CASE" = ks-persist ] && mode=persist
      run 0 '-' "kill switch $mode" -- daemon set --kill-switch "$mode" --yes
      connect_p "$p" || { restore; return; }
      sleep 4
      check 'egress = node' egress_is_node "$p"
      check 'nft table inet dvpnd up' sudo nft list table inet dvpnd
      is_proxy "$p" && check 'a direct (non-proxied) request is blocked' bash -c '! curl -4 -s -m 8 https://api.ipify.org'
      hold
      sudo nft add table inet ddvtest && sudo nft 'add chain inet ddvtest out { type filter hook output priority -10; }' && sudo nft add rule inet ddvtest out ip daddr "$NODE_IP" drop
      sleep 8; never_direct 'path to the server lost'
      sudo nft delete table inet ddvtest; sleep 3
      # Unexpected: the tunnel dies under the user → blocked in both modes (gap #41 fixed upstream).
      hold
      # the kill must hit something, or the no-leak checks below pass without testing anything (#33 harness bug)
      local hit='' w
      # after "path to the server lost" dvpnd may be between two attempts with no process up yet
      # (Rocky 9 run 5, Hysteria2 persist): wait up to 15 s for the tunnel to be back before killing it
      for w in $(seq 1 15); do
        case $p in wireguard|amneziawg) [ -n "$(tunnel_link)" ] && break ;; *) pgrep -x "$p" >/dev/null && break ;; esac
        sleep 1
      done
      case $p in
        wireguard|amneziawg) local l; l=$(tunnel_link); [ -n "$l" ] && sudo ip link set dev "$l" down && hit="link $l down" ;;
        *) local pids; pids=$(pgrep -x "$p" | tr '
' ' '); [ -n "$pids" ] && sudo kill -9 $pids && hit="killed $p ($pids)" ;;
      esac
      if [ -n "$hit" ]; then record PASS 'the tunnel was really taken down' "$hit"; else record FAIL 'nothing to kill: no tunnel link / protocol process found' "$(pgrep -a -f 'v2ray|xray|hysteria|openvpn' | head -3)"; fi
      sleep 3; never_direct 'tunnel process / link killed'
      sleep 25; never_direct 'tunnel dead 25 s later'
      hold; run 0 '-' 'disconnect after the tunnel died' -- disconnect; sleep 3
      run 0 '-' 'restore network' -- daemon restore-network; sleep 3
      # Unexpected: dvpnd killed with a live session → the block stays in the kernel, and after
      # systemd brings dvpnd back it still holds (Held mark) until the user disconnects.
      connect_p "$p" || { restore; return; }
      sleep 4; check 'reconnected: egress = node' egress_is_node "$p"
      hold; sudo systemctl kill -s KILL dvpnd-client; sleep 2
      never_direct 'dvpnd SIGKILLed'
      check 'systemd brings dvpnd back' bash -c 'for i in $(seq 1 20); do systemctl is-active -q dvpnd-client && exit 0; sleep 2; done; exit 1'
      sleep 10
      check 'after SIGKILL + restart: kill switch in the kernel' sudo nft list table inet dvpnd
      never_direct 'after SIGKILL + restart'
      hold; run 0 '-' 'disconnect after SIGKILL' -- disconnect; sleep 3
      run 0 '-' 'restore network' -- daemon restore-network; sleep 3
      # Deliberate: the service is restarted. "On" = blocks only when the VPN drops, so a service stop
      # ends the session and releases the block (app copy); "Always" keeps it after a restart (#31 #53).
      connect_p "$p" || { restore; return; }
      sleep 4; check 'reconnected: egress = node' egress_is_node "$p"
      hold; sudo systemctl restart dvpnd-client; sleep 2
      if [ "$mode" = persist ]; then
        never_direct 'Always: during a service restart'
        sleep 15
        check 'Always: after the restart, kill switch in the kernel (#31 #53)' sudo nft list table inet dvpnd
        never_direct 'Always: after the restart'
      else
        sleep 15
        check 'On: a service restart ends the session and releases the block (by design; Always keeps it)' bash -c '! sudo nft list table inet dvpnd >/dev/null 2>&1 && [ "$(curl -4 -s -m 10 https://api.ipify.org)" = "'"$DIRECT"'" ]'
      fi
      run 0 '-' 'status after the restart' -- status
      hold
      run 0 '-' 'disconnect' -- disconnect; sleep 3
      if [ "$mode" = persist ] && echo "$LAST" | grep -q 'No active session'; then
        # The restart ended the session: Always keeps the block until reconnect or Restore network
        # (#31 kdp173), and both disconnect and status say so.
        check 'Always: disconnect with no session says the block stays' bash -c 'grep -q restore-network <<< "$1"' _ "$LAST"
        run 0 'restore-network' 'Always: status names restore-network' -- status
        run 0 '-' 'restore network' -- daemon restore-network; sleep 3
      fi
      # Then the internet is direct in both modes (#31 vm-safety-test.ps1:322).
      check "$mode: direct internet after disconnect" bash -c '[ "$(curl -4 -s -m 10 https://api.ipify.org)" = "'"$DIRECT"'" ]'
      run 0 '-' 'restore network' -- daemon restore-network; sleep 3
      ;;
    split-ks)
      local routes; routes=$(getent ahostsv4 api.ipify.org | awk '{print $1"/32"}' | sort -u | paste -sd,)
      run 0 '-' 'split include (ipify) + kill switch on' -- daemon set --kill-switch on --split-mode include --split-routes "$routes" --yes
      connect_p "$p" || { restore; return; }
      sleep 4
      check 'chosen route exits at the node' egress_is_node "$p"
      if ! is_proxy "$p"; then
        check 'kill switch on → full tunnel kept: other sites (amazonaws) also exit at the node' bash -c "for i in 1 2 3; do [ \"\$(curl -4 -s -m 12 https://checkip.amazonaws.com | tr -d '\n')\" = '$NODE_IP' ] && exit 0; sleep 3; done; exit 1"
      fi
      run 0 '-' 'status (recorded: says why the split is not applied)' -- status
      info 'status text' "$LAST"
      run 0 '-' 'disconnect' -- disconnect; sleep 3
      run 0 '-' 'restore network' -- daemon restore-network; sleep 3
      run 0 '-' 'split off, kill switch off' -- daemon set --kill-switch off --split-mode off --split-routes none --yes
      ;;
    reconnect)
      connect_p "$p" || { restore; return; }
      sleep 4
      local sid; sid=$($CLI status --json 2>/dev/null | grep -oE '"(sessionId|id)"\s*:\s*"?[0-9]+' | head -1 | grep -oE '[0-9]+$')
      info 'session id before' "$sid"
      hold
      sudo nft add table inet ddvtest && sudo nft 'add chain inet ddvtest out { type filter hook output priority -10; }' && sudo nft add rule inet ddvtest out ip daddr "$NODE_IP" drop
      sleep 75 # node unreachable long enough for dvpnd to give the session up and retry
      sudo nft delete table inet ddvtest
      sleep 40
      run 0 '-' 'status after the node came back (recorded)' -- status
      info 'status after' "$LAST"
      run 0 '-' 'disconnect stops whatever session is live' -- disconnect; sleep 3
      check 'no session left in status' bash -c "! $CLI status --json 2>/dev/null | grep -qE '\"state\"\s*:\s*\"(connected|connecting)\"'"
      ;;
    *) record FAIL "unknown case $CASE" ''; return ;;
  esac
  back_clean "$CASE"
  # Fault cases cut the path to the node on purpose: voucher and close warnings are expected there
  # (errors, fatals and panics still fail). Everywhere else they are bugs (gaps 0005/0006/0008).
  case $CASE in ks-on|ks-persist|reconnect) health "$CASE" '"level":"warn".*(issuing voucher failed|closing remote session failed)' ;; *) health "$CASE" ;; esac
  gap
}

for p in $PROTOS; do
  P=$p
  if [ "$p" = amneziawg ] && ! has_awg; then info 'skipped: no AmneziaWG on this kernel' ''; continue; fi
  mark
  case_one "$p"
done
P=final
if [ "$CASE" = plan ] && [ -n "${SUB:-}" ]; then gap; run 0 '-' 'plans close the subscription' -- plans close "$SUB" --yes; fi
case $CASE in dns|ks-on|ks-persist|split-ks) run 0 '-' 'kill switch off again' -- daemon set --kill-switch off --yes ;; esac
check 'final: nothing left, direct egress' bash -c "$(declare -f no_leftovers egress); no_leftovers && [ \"\$(egress)\" = '$DIRECT' ]"
summary
