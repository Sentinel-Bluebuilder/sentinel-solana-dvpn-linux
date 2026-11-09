#!/usr/bin/env bash
# ─── Soak (#31 vm-soak.ps1): connect / fault / disconnect across all six, for N minutes ───
#   nohup bash soak.sh [minutes=120] > ~/soak/run.out 2>&1 < /dev/null &
# Each cycle: next protocol, connect (per GB), 2 MiB download, one fault (none, NIC flap, service
# restart, --switch to the next protocol), disconnect, then the network MUST be direct again.
# Every minute: dvpnd RSS + open fds → ~/soak/mem.csv; at the end growth after warm-up < 10 %.
set -u
. "$(dirname "$0")/lib.sh"
MIN=${1:-120}
suite_init soak soak
P=setup
# Every try is logged to $OUT/dl-diag.tsv (cycle, host, curl exit, bytes, dns s, connect s, total s) so DNS
# (exit 6, large namelookup) can be told apart from throughput (exit 28, small bytes) - FLX ask on Q0028.
dl2mib() { local u w rc; for u in 'https://speed.cloudflare.com/__down?bytes=2097152' 'https://ash-speed.hetzner.com/100MB.bin' 'https://proof.ovh.net/files/10Mb.dat' 'https://fsn1-speed.hetzner.com/100MB.bin'; do w=$(curl -s -m 20 $1 -r 0-2097151 -o /dev/null -w '%{size_download}\t%{time_namelookup}\t%{time_connect}\t%{time_total}' "$u"); rc=$?; [ -n "${OUT:-}" ] && printf '%s\t%s\t%s\t%s\n' "${P:-?}" "${u#https://}" "$rc" "$w" >> "$OUT/dl-diag.tsv"; [ "${w%%$'\t'*}" = 2097152 ] && return 0; sleep 2; done; return 1; }
# system-resolver timing for one uncached-ish name per cycle (getent goes through resolved, not the proxy)
dnstime() { local t0 t1 rc; t0=$(date +%s.%N); timeout 25 getent ahostsv4 "c$RANDOM.speed.cloudflare.com" >/dev/null; rc=$?; t1=$(date +%s.%N); printf '%s\tgetent\t%s\t-\t%s\n' "${P:-?}" "$rc" "$(awk -v a="$t0" -v b="$t1" 'BEGIN{printf "%.3f", b-a}')" >> "$OUT/dl-diag.tsv"; }   # rc 2 = NXDOMAIN answered (fine); 124 = no answer in 25 s
END=$((SECONDS + MIN * 60))
dpid() { systemctl show -p MainPID --value dvpnd-client; }
( echo 'utc,pid,rss_kb,fds'; while [ $SECONDS -lt $END ]; do pid=$(dpid); echo "$(date -u +%H:%M:%S),$pid,$(awk '/VmRSS/{print $2}' /proc/$pid/status 2>/dev/null),$(sudo ls /proc/$pid/fd 2>/dev/null | wc -l)"; sleep 60; done ) > "$OUT/mem.csv" &
MEMP=$!
# ─── money + reconnect oracles (SOAK-PLAN.md 'Added checks', DIR 2026-10-29) ───
# tools ship with the runner bundle in SOAK_TOOLS (default ~/cr/soak-tools); missing tools = the soak FAILS, never a silent skip
ST=${SOAK_TOOLS:-$HOME/cr/soak-tools}; T0=$(date -u +%FT%TZ)
money() { node "$ST/soak-money.mjs" sample --cli devnet-dvpn --out "$OUT/money.jsonl" >> "$OUT/money.log" 2>&1; }
money
( while [ $SECONDS -lt $END ]; do sleep 600; [ $SECONDS -lt $END ] && money; done ) &
MONP=$!
echo 'cycle,start,fault' > "$OUT/cycles.csv"
mark
# negative control: the same download through a dead proxy must FAIL, or the check proves nothing
check 'negative control: download via a dead proxy fails' bash -c "$(declare -f dl2mib); ! dl2mib '--socks5-hostname 127.0.0.1:1'"
PROTOS=($ALL_PROTOCOLS); modinfo amneziawg >/dev/null 2>&1 || command -v awg >/dev/null || PROTOS=(wireguard openvpn hysteria2 v2ray xray)
FAULTS=(none nicflap svcrestart switch)
i=0
while [ $SECONDS -lt $END ]; do
  p=${PROTOS[$((i % ${#PROTOS[@]}))]}; f=${FAULTS[$((i % ${#FAULTS[@]}))]}; P="$p#$i:$f"
  echo "$i,$(date -u +%FT%TZ),$f" >> "$OUT/cycles.csv"
  if connect_p "$p"; then
    sleep 4
    via=''; is_proxy "$p" && via="--socks5-hostname $(socks)"
    check 'egress = node' egress_is_node "$p"
    # 2 MiB through the tunnel: the external hosts are not ours (non-443 ports are filtered on our test host
    # and Azure hosts), so four independent hosts, 20 s each (one host failed 33 of 516 checks in the
    # 0.1.8 RC soaks with no product fault)
    dnstime
    check '2 MiB download' dl2mib "$via"
    hold
    case $f in
      # after the link is back the host's own DHCP client must fetch routes again (Arch dhclient@:
      # `networkctl reconfigure` alone is a no-op there and the soak ran 1 h with no network); same
      # kick as edge.sh nicflap, also from the 60 s safety net
      nicflap) KICK='ip link set dev "$0" up; if systemctl is-active -q systemd-networkd; then networkctl reconfigure "$0"; elif systemctl is-active -q NetworkManager; then nmcli device reapply "$0"; else systemctl restart "dhclient@$0" 2>/dev/null || dhcpcd -n "$0" 2>/dev/null || dhclient "$0" 2>/dev/null; fi'
               nu="ddv-nicup-$RANDOM"; sudo systemd-run --on-active=60 --unit "$nu" /bin/sh -c "$KICK" "$NIC" >/dev/null 2>&1
               sudo ip link set dev "$NIC" down; sleep 10; sudo sh -c "$KICK" "$NIC" >/dev/null 2>&1
               for j in $(seq 1 30); do ip -4 route show default | grep -q . && break; [ $((j % 10)) = 0 ] && sudo sh -c "$KICK" "$NIC" >/dev/null 2>&1; sleep 2; done
               check 'default route back after the NIC flap' bash -c 'ip -4 route show default | grep -q .'
               # the safety net is for a dead link only: once the route is back, cancel it, or it fires ~60 s later into the
               # NEXT cycle and networkctl reconfigure drops that session's foreign routes (Q0247: openvpn host route -> direct)
               ip -4 route show default | grep -q . && sudo systemctl stop "$nu.timer" >/dev/null 2>&1
               sleep 10 ;;
      svcrestart) sudo systemctl restart dvpnd-client; sleep 15 ;;
      switch) q=${PROTOS[$(((i + 1) % ${#PROTOS[@]}))]}; run 0 'Connected|connected' "--switch → $q" -- connect "${NODE[$q]}" --units 1 --switch --yes; sleep 4 ;;
    esac
    run 0 '-' 'status after the fault (recorded)' -- status
    run 0 '-' 'disconnect' -- disconnect; sleep 3
  fi
  restore
  back_clean 'cycle'
  gap
  i=$((i + 1))
done
kill $MEMP $MONP 2>/dev/null
P=final
money   # after the last disconnect (the oracle FAILs a last sample taken connected)
check 'money oracle: tDVPN balances against history spend (soak-money.mjs)' bash -c "node '$ST/soak-money.mjs' check '$OUT/money.jsonl' 2>&1 | tee '$OUT/money-check.txt'; ! grep -q '^FAIL' '$OUT/money-check.txt' && grep -q '^PASS' '$OUT/money-check.txt'"
sudo journalctl -u dvpnd-client --since "$T0" --no-pager -o cat > "$OUT/dvpnd.log" 2>/dev/null
check 'reconnects inside cycles within caps (soak-reconnects.mjs)' bash -c "node '$ST/soak-reconnects.mjs' '$OUT/dvpnd.log' '$OUT/cycles.csv' 2>&1 | tee '$OUT/reconnects.txt'; ! grep -q 'FAIL' '$OUT/reconnects.txt' && [ -s '$OUT/dvpnd.log' ]"
info "cycles $i" ''
# growth: average of the last 10 samples vs samples 10-20 (after warm-up)
check 'dvpnd RSS growth after warm-up < 10 %' bash -c "awk -F, 'NR>1&&\$3!=\"\"{r[n++]=\$3} END{if(n<25){print \"too few samples \" n; exit 0} for(i=10;i<20;i++)a+=r[i]; for(i=n-10;i<n;i++)b+=r[i]; printf \"warm %d end %d\n\",a/10,b/10; exit (b>a*1.1)}' '$OUT/mem.csv'"
check 'dvpnd fd growth after warm-up < 10 % (+4 fds slack: the live protocol at the end opens a few)' bash -c "awk -F, 'NR>1&&\$4!=\"\"{r[n++]=\$4} END{if(n<25)exit 0; for(i=10;i<20;i++)a+=r[i]; for(i=n-10;i<n;i++)b+=r[i]; printf \"warm %d end %d\n\",a/10,b/10; exit (b>a*1.1+40)}' '$OUT/mem.csv'"
# the soak injects NIC flaps and service restarts: voucher/close warnings during those are expected (errors still fail)
health 'soak' '"level":"warn".*(issuing voucher failed|closing remote session failed)'
summary
