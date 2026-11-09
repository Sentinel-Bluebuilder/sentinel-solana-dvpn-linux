#!/usr/bin/env bash
# ─── RC2 proof cells for queue rows that have no manifest cell (TLX). Run ON a fleet VM, never the laptop ───
# Usage: bash rc2-proof.sh <case>    cases: rpcblocked p3 q134 q139 l7install
# Results: ~/rc2proof/<case>.tsv + .log (lib.sh format), last line "<case>: passed N  failed M".
# Every case has a negative control: the same script on RC 0.1.8 (or 0.1.7) must FAIL where the row says so.
#   rpcblocked  Q0024 F-C4-2: with every tcp 80/443 out except the node dropped, connect to each node-3 server
#               must print the plain RPC copy, never dvpnd's raw "all RPC endpoints failed" dump (port of FLX
#               fc42-selftest.sh). Negative: RC 0.1.8 shows the raw dump.
set -u
CASE=${1:?case}
. "$(dirname "$0")/lib.sh"
suite_init rc2proof "$CASE"
P=setup
info 'package' "$( (dpkg-query -W -f='${Version}' devnet-dvpn-linux || rpm -q devnet-dvpn-linux || pacman -Q devnet-dvpn-linux) 2>/dev/null | head -1)"
case $CASE in
  rpcblocked)
    unblock_rpc() { sudo -n nft delete table inet rc2rpc 2>/dev/null; return 0; }
    trap unblock_rpc EXIT
    $CLI disconnect >/dev/null 2>&1; unblock_rpc
    sudo -n nft add table inet rc2rpc && sudo -n nft "add chain inet rc2rpc out { type filter hook output priority -10; }" \
      && sudo -n nft add rule inet rc2rpc out ip daddr != "$NODE_IP" tcp dport '{ 80, 443 }' drop \
      || { record FAIL 'install the RPC block' 'nft failed'; summary; exit 1; }
    for p in $ALL_PROTOCOLS; do
      P=$p; hold
      o=$(timeout 180 $CLI connect "${NODE[$p]}" --units 1 --yes 2>&1); rc=$?
      printf '\n### [%s] connect with the RPC blocked\n%s\n(exit %s)\n' "$p" "$o" "$rc" >> "$LOG"
      if [ $rc -eq 0 ]; then record FAIL 'connect refused with the RPC blocked' 'it connected'; $CLI disconnect >/dev/null 2>&1
      elif grep -q 'all RPC endpoints failed' <<<"$o"; then record FAIL 'no raw dvpnd dump' "$o"
      elif grep -qiE 'Solana network endpoint|network could not be reached' <<<"$o"; then record PASS 'plain RPC copy, no raw dump' "$o"
      else record FAIL 'plain RPC copy' "other message: $o"; fi
      sleep 7
    done
    unblock_rpc; P=after; sleep 5
    check 'direct internet back after the block is lifted' bash -c '[ -n "$(curl -4 -s -m 12 https://api.ipify.org)" ]'
    ;;
  p3) # Q0015 F-C1-1 / Q0023 F-C4-1 (port of FLX p3.sh): kill switch on, switches from a proxy protocol; after
      # every step a FRESH process must read the wallet (rpc-pin keeps Solana reachable under the held kill switch).
      # Negative: 0.1.7 fails (2/8 on FLX's run).
    ks_off() { $CLI disconnect >/dev/null 2>&1; $CLI daemon set --kill-switch off --yes >/dev/null 2>&1; }
    trap ks_off EXIT
    $CLI disconnect >/dev/null 2>&1; sleep 3
    run 0 - 'kill switch on' -- daemon set --kill-switch on --yes; sleep 7
    p3step() { # <label> <protocol> [--switch]
      P=$2; hold
      # ${3:-}: under set -u a bare $3 aborted the substitution before the CLI ran (exit 1, no output) = Q0185
      local o rc w; o=$(timeout 180 $CLI connect "${NODE[$2]}" --units 1 --yes ${3:-} 2>&1); rc=$?
      printf '\n### [%s] %s\n%s\n(exit %s)\n' "$P" "$1" "$o" "$rc" >> "$LOG"
      if [ $rc = 0 ] && ! grep -q 'could not be reached' <<<"$o"; then record PASS "$1" "$o"; else record FAIL "$1 (exit $rc)" "$o"; fi
      sleep 7
      w=$($CLI wallet show 2>&1); grep -qE '^tDVPN +[0-9]' <<<"$w" && record PASS "$1: wallet show (fresh process) has balances" "" || record FAIL "$1: wallet show" "$w"
      sleep 7
    }
    p3step 'connect v2ray (kill switch on)' v2ray
    p3step 'v2ray -> wireguard --switch' wireguard --switch
    $CLI disconnect >/dev/null 2>&1; sleep 7
    p3step 'connect v2ray again' v2ray
    p3step 'v2ray -> xray --switch' xray --switch
    p3step 'xray -> v2ray --switch' v2ray --switch
    P=after; run 0 - 'disconnect' -- disconnect; sleep 5
    # kill switch 'on' blocks only WHILE a session runs ('persist' = always), so direct egress here is expected
    info 'after disconnect, kill switch on (blocks only during a session): egress' "$(curl -4 -s -m 10 https://api.ipify.org)"
    ks_off; sleep 5
    check 'kill switch off: direct internet back' bash -c '[ -n "$(curl -4 -s -m 12 https://api.ipify.org)" ]'
    ;;
  q134|q139) # Q0134 F-C2-1 (port of FLX q134.sh): daemon set during a live session says the session ended.
      # q139 = the same with the kill switch ON first, over SSH (no desktop): Q0139's root steps must go
      # through sudo, never fall back to pkexec. Negative: RC 0.1.8 says only "Applied and restarted." (q134)
      # and fails the apply with "permission prompt was declined or closed" on a slow sudo -n (q139).
    ks_off() { $CLI disconnect >/dev/null 2>&1; $CLI daemon set --kill-switch off --yes >/dev/null 2>&1; }
    trap ks_off EXIT
    t0=$(date +%s.%N); sudo -n true; info 'sudo -n latency (s)' "$(awk -v a="$t0" -v b="$(date +%s.%N)" 'BEGIN{printf "%.2f", b-a}')"
    $CLI disconnect >/dev/null 2>&1; sleep 3
    if [ "$CASE" = q139 ]; then run 0 - 'kill switch on' -- daemon set --kill-switch on --yes; sleep 7; fi
    mark; T0=$(date -u +%Y-%m-%dT%H:%M:%S)
    P=nosession
    run 0 '"sessionEnded": *false' 'no session: --json sessionEnded false' -- daemon set --allow-lan true --yes --json; sleep 7
    P=wireguard; hold
    connect_p wireguard || { summary; exit 1; }
    sleep 5
    o=$($CLI daemon set --allow-lan false 2>&1 </dev/null); printf '\n### confirm\n%s\n' "$o" >> "$LOG"
    grep -q 'This ENDS the current VPN session' <<<"$o" && record PASS 'live: confirm text says the session ends' "$o" || record FAIL 'live: confirm text says the session ends' "$o"
    hold
    run 0 'The VPN session ended with the restart: connect again\.' 'live: result says the session ended' -- daemon set --allow-lan false --yes
    sleep 5
    run 0 'Not connected' 'after: status Not connected (matches the message)' -- status
    if [ "$CASE" = q139 ]; then
      P=elevation
      # only THIS case's lines (log files hold earlier runs too), app.log writes JSON: {"step":"…","via":"sudo"}
      lines=$(grep -rh 'elevated step' "$HOME/.config/Devnet dVPN" 2>/dev/null | sort | awk -v t="[$T0" '$1 >= t')
      grep -q '"via":"sudo"' <<<"$lines" && record PASS 'root steps went through sudo' "$(grep -c '"via":"sudo"' <<<"$lines") steps via sudo" || record FAIL 'root steps went through sudo' "${lines:-no 'elevated step' line in app.log since the case started}"
      grep -q '"via":"pkexec"' <<<"$lines" && record FAIL 'no pkexec fallback over SSH' "$(grep '"via":"pkexec"' <<<"$lines" | tail -1)" || record PASS 'no pkexec fallback over SSH' ''
      ks_off; sleep 5
      check 'kill switch off: direct internet back' bash -c '[ -n "$(curl -4 -s -m 12 https://api.ipify.org)" ]'
    fi
    ;;
  l7install) # Q0037 L7: dvpnd's FIRST start meets a busy/unreachable RPC -> daemon install must wait/retry and
      # report success once the RPC answers, and name the busy RPC only if it never does. The RPC is rejected
      # (tcp reset) for 20 s, then opened. Guard: the journal must show the RPC failure, or the case FAILS as
      # "block not exercised" (a vacuous pass is not a pass). Negative: 0.1.7 reports the install failed.
    reopen() { sudo -n nft delete table inet rc2l7 2>/dev/null; return 0; }
    trap reopen EXIT
    $CLI disconnect >/dev/null 2>&1; reopen
    ips=$(getent ahostsv4 api.devnet.solana.com | awk '{print $1}' | sort -u | paste -sd,)
    [ -n "$ips" ] || { record FAIL 'resolve api.devnet.solana.com' ''; summary; exit 1; }
    sudo -n systemctl stop dvpnd-client
    J0=$(date '+%Y-%m-%d %H:%M:%S')
    sudo -n nft add table inet rc2l7 && sudo -n nft "add chain inet rc2l7 out { type filter hook output priority -10; }" \
      && sudo -n nft add rule inet rc2l7 out ip daddr "{ $ips }" tcp dport 443 reject with tcp reset \
      || { record FAIL 'install the RPC reject' 'nft failed'; summary; exit 1; }
    ( sleep 20; sudo -n nft delete table inet rc2l7 2>/dev/null ) &
    P=install
    run 0 - 'daemon install with the RPC rejected for its first 20 s reports success' -- daemon install --yes
    wait; reopen
    check 'service active after install' systemctl is-active dvpnd-client
    j=$(sudo -n journalctl -u dvpnd-client --since "$J0" --no-pager 2>&1)
    printf '\n### journal since %s\n%s\n' "$J0" "$j" >> "$LOG"
    grep -qiE 'preflight failed: rpc|connecting rpc|429|connection refused|connection reset' <<<"$j" \
      && record PASS 'the RPC failure was really hit during the first start' "$(grep -iE 'preflight|rpc' <<<"$j" | head -2)" \
      || record FAIL 'block not exercised (no RPC failure in the journal)' "$(tail -5 <<<"$j")"
    ;;
  *) echo "unknown case $CASE"; exit 2 ;;
esac
summary
