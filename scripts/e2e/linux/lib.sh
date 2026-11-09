#!/usr/bin/env bash
# ─── Shared helpers for the Linux live suites (matrix.sh, edge.sh). Source it; run ON the VM ───
# Every check records PASS/FAIL <tab> protocol <tab> check <tab> detail in $TSV and a transcript
# in $LOG. Four oracles per case (RELEASE-TEST-PLAN 9.2): network (egress during / direct after,
# nothing left), money (chain reads through the CLI), message (exit code + copy), health (no
# panic / error lines in dvpnd's journal since the case started).
CLI=devnet-dvpn
# NODE_SET=sg: the Singapore nodes on 192.0.2.3 (another operator's, public listing) when the
# rig's ddv-node-1 is down (2026-10-23: its RPC fallback ran out of credit). Their Xray uses REALITY,
# which the client does not support, so that set has no Xray.
if [ "${NODE_SET:-}" = sg ]; then
  NODE_IP=192.0.2.3
  declare -A NODE=(
    [wireguard]=2XsoF6GqcGW6CBjUtXnrfuTSBJUZdo2VJ1ngDv7E8Eyq
    [amneziawg]=7qEe4HAtfuUJmCnp2AU45zGEMbCPR5LYU3FhWVgiHXsN
    [openvpn]=HNTVbsK8SYBgJLjxwnrXQjo9ytHim16Y6rVMSpQm6tKo
    [hysteria2]=EMDjZ9qtUaKiyFcbHMjpDnuU8tiRRuZ1sgAUbkvYQdRt
    [v2ray]=6M2KTWf9daLV1hXwJHYiMi3Qtq64DfEbnMQb314FPfwM
  )
  ALL_PROTOCOLS="wireguard amneziawg openvpn hysteria2 v2ray"
else
  NODE_IP=${NODE_IP:-192.0.2.2}
  declare -A NODE=(
    [wireguard]=SLVJNn38s5RfqcVW7a7A4hGKqjY7Y1bKkUpG7wrGX5D
    [amneziawg]=1PwMkSjnyugAZHdHvDsddETzPUAubPkeyWymT7Ercn6
    [openvpn]=9EQJ7dBwneFUse9yy8Hg56u2wPiGF5qkjAaA1ZAr64nP
    [hysteria2]=E8nefMLBuBzG1CrA4dSDU9mqq6ZNpv69Bt3w9QEtzvPf
    [v2ray]=Di5V9K2Vt5uptJUk7oVVnkDRXt9qWy5HhLbkEJMxEuM2
    [xray]=E9RG1iZJjsLfEuLfDYTHM4yXCjyFE21jBbJLFvGoL2FD
  )
  ALL_PROTOCOLS="wireguard amneziawg openvpn hysteria2 v2ray xray"
fi
# BASH_SOURCE, not $0: under `bash -c ". lib.sh"` $0 is "bash", nodes.sh was not found and NODE_SET was silently ignored
. "$(dirname "${BASH_SOURCE[0]}")/nodes.sh" || exit 2; nodeset_apply   # NODE_SET=node4 → that node set (nodes.sh)
PASS=0; FAIL=0; P=-

suite_init() { # <suite> <case>
  OUT=~/$1; mkdir -p "$OUT"; TSV="$OUT/$2.tsv"; LOG="$OUT/$2.log"; : > "$TSV"; : > "$LOG"
  NIC=$(ip route show default | awk '{print $5; exit}')
  DIRECT=; for _u in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com https://api.ipify.org; do DIRECT=$(curl -4 -s -m 10 "$_u" | tr -d "[:space:]"); [ -n "$DIRECT" ] && break; done
}
note() { printf '%s\n' "$*" | tee -a "$LOG"; }
record() { # PASS|FAIL check detail
  printf '%s\t%s\t%s\t%s\n' "$1" "$P" "$2" "$(printf '%s' "${3:-}" | tr '\n\t' '  ' | cut -c1-300)" >> "$TSV"
  # a PASS line carries its detail (final-pass effect spec: the egress IP / chain numbers must be in the log, not only "ok")
  local d; d=$(printf '%s' "${3:-}" | head -3 | tr '\n\t' '  ' | cut -c1-200)
  if [ "$1" = PASS ]; then PASS=$((PASS + 1)); note "ok   [$P] $2${d:+  :: $d}"; else FAIL=$((FAIL + 1)); note "FAIL [$P] $2 :: $(printf '%s' "${3:-}" | head -3 | tr '\n' ' ' | cut -c1-240)"; fi
}
info() { printf 'INFO\t%s\t%s\t%s\n' "$P" "$1" "$(printf '%s' "${2:-}" | tr '\n\t' '  ' | cut -c1-300)" >> "$TSV"; note "info [$P] $1: $(printf '%s' "${2:-}" | head -2 | tr '\n' ' ' | cut -c1-200)"; }
# run <expected-exit> <regex|-> <check> -- <cli args…>   (LAST = output)
LAST=''
run() {
  local want=$1 re=$2 desc=$3; shift 4
  local out code
  out=$($CLI "$@" 2>&1); code=$?
  out=$(printf '%s\n' "$out" | grep -v '^\[rpc\]' | sed -E '/shown once:/{n;s/.*/<24 words redacted>/}')
  LAST=$out
  printf '\n### [%s] %s\n$ devnet-dvpn %s\n%s\n(exit %s)\n' "$P" "$desc" "$*" "$out" "$code" >> "$LOG"
  if [ "$code" != "$want" ]; then record FAIL "$desc (exit $code, want $want)" "$out"; return 1; fi
  if [ "$re" != - ] && ! printf '%s' "$out" | grep -Eq -- "$re"; then record FAIL "$desc: no /$re/" "$out"; return 1; fi
  if printf '%s' "$out" | grep -Eq 'api-key=[A-Za-z0-9]'; then record FAIL "$desc: printed an RPC API key" '<secret>'; return 1; fi
  record PASS "$desc" "$(printf '%s' "$out" | head -2)"
}
check() { # <check> <command…>
  local desc=$1; shift
  local out; out=$("$@" 2>&1); local code=$?
  printf '\n### [%s] %s\n$ %s\n%s\n(exit %s)\n' "$P" "$desc" "$*" "$out" "$code" >> "$LOG"
  if [ $code = 0 ]; then record PASS "$desc" "$out"; else record FAIL "$desc" "$out"; fi
  return $code
}
gap() { sleep 7; }
hold() { sudo touch /run/ddv-deadman.hold; }
egress() { local u r; for u in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com; do r=$(curl -4 -s -m 8 "$u" | tr -d "[:space:]"); [ -n "$r" ] && { echo "$r"; return; }; done; }   # three lookup hosts: one slow host is a harness fault, not a tunnel fault
socks() { $CLI proxy status --json 2>/dev/null | grep -oE '127\.0\.0\.1:[0-9]+' | head -1; }
is_proxy() { case $1 in v2ray|xray) return 0 ;; *) return 1 ;; esac; }
# what a VPN user sees: through the SOCKS port for V2Ray/Xray (Linux: proxy only), direct otherwise
egress_p() { local u r; if is_proxy "$1"; then for u in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com; do r=$(curl -4 -s -m 8 --socks5-hostname "$(socks)" "$u" | tr -d "[:space:]"); [ -n "$r" ] && { echo "$r"; return; }; done; else egress; fi; }
# dual-stack name with an IPv4-only node (#31 gap #66: Xray TUN broke www.google.com): a plain client loads it
# One retry after 5 s: a single 20 s path stall to Google (Q0288, arm-u2404 10:24-10:38, no client fault)
# reads as info; a real fault fails both tries. The timings name which step stalled.
dualstack_ok() {
  local c first='' try px=()
  is_proxy "$1" && px=(--socks5-hostname "$(socks)")
  for try in 1 2; do
    c=$(curl -s -m 20 -o /dev/null -w '%{http_code} ip=%{remote_ip} dns=%{time_namelookup} conn=%{time_connect}' "${px[@]}" https://www.google.com/generate_204)
    [ "${c%% *}" = 204 ] && { [ -n "$first" ] && echo "retry ok after: www.google.com http $first"; return 0; }
    first=$c; [ "$try" = 1 ] && sleep 5
  done
  echo "www.google.com http $first; retry http $c"; return 1
}
# v6_fails_fast: a direct IPv6 connect during a session (node over IPv4) is refused at once, so apps
# fall back to IPv4 (dvpnd 0018 IPv6 guard). A fake connect (exit 35/28, TLS stall) is the bug; >3 s is too slow.
# Debian 12's curl 7.88 paces its tries across Google's 6+ AAAA addresses (happy eyeballs), so the
# total passes 3 s even when every try is refused at once (a test VM, arm deb12: 4.2 s with no VPN
# at all). Then "every try refused at once" counts as fast too.
v6_fails_fast() {
  local v out rc tried imm
  v=$(curl -6 -v -s -o /dev/null -m 10 -w 'T=%{time_total} N=%{time_namelookup}\n' https://www.google.com/generate_204 2>&1); rc=$?
  out=$(sed -n 's/^T=\([^ ]*\).*/\1/p' <<<"$v"); dns=$(sed -n 's/.* N=//p' <<<"$v")
  tried=$(grep -c '^\*   Trying \[' <<<"$v"); imm=$(grep -cE 'Immediate connect fail|failed: Connection refused' <<<"$v")
  echo "curl -6 exit $rc in ${out}s (name lookup ${dns}s); attempts $tried, refused at once $imm; guard table: $(sudo nft list tables 2>/dev/null | grep -c dvpnd_v6guard); v6 default route: $(ip -6 route show default | grep -c .)"
  # No attempt at all (exit 6 = no AAAA, or exit 28 = the AAAA lookup itself timed out, Q0168 on an Azure host
  # with link-local IPv6 only): no IPv6 byte left the host, which is what the guard is for. The lookup time is
  # printed above, and a slow host DNS is tracked by the DNS cells (Q0028/Q0140), not here.
  if [ "$tried" = 0 ] && { [ "$rc" = 6 ] || [ "$rc" = 28 ]; }; then sudo nft list table inet dvpnd_v6guard >/dev/null 2>&1; return; fi
  [ "$rc" = 7 ] && { awk -v s="$out" 'BEGIN{exit !(s < 3)}' || { [ "$tried" -gt 0 ] && [ "$imm" -ge "$tried" ]; }; } && sudo nft list table inet dvpnd_v6guard >/dev/null 2>&1
}
# 5 tries, each one's answer kept: a tunnel slow to pass its first packets read "FAIL egress <node ip>"
# (the 4th call, made only for the detail, was already right; u2404 R7 nicflap OpenVPN)
egress_is_node() { local i e seen=''; for i in 1 2 3 4 5; do e=$(egress_p "$1"); [ "$e" = "$NODE_IP" ] && { echo "egress $e = node $NODE_IP (direct ${DIRECT:-?})"; return 0; }; seen+="${e:-none} "; sleep 3; done; echo "egress tries: $seen"
  # Q0247: OpenVPN had its /1 routes in at that moment yet traffic left direct -> keep the routing state that decided it
  { echo "== $(date -u +%FT%TZ) egress not via the node ($1): $seen"; ip -4 rule; ip -4 route show table all | grep -v '^local\|^broadcast' | head -40
    ip -br link; ip -4 route get 1.1.1.1; sudo -n nft list tables 2>&1; } >> "${EGRESS_DIAG:-$HOME/egress-diag.log}" 2>&1
  return 1; }
tunnel_link() { ip -o link | grep -oE ' (dvpn-[a-z0-9-]+|hy2-client|ovpn-client|tun[0-9]+):' | tr -d ' :' | head -1; }
no_leftovers() {
  local t l p=0 pid
  t=$(sudo nft list tables 2>/dev/null | grep -c 'inet dvpnd')
  l=$(ip -o link | grep -cE ' (dvpn-[a-z0-9-]+|hy2-client|ovpn-client)[:@]')
  for pid in $(ps -eo pid=,comm= | awk '$2 ~ /^(v2ray|xray|hysteria2)$/{print $1}'); do sudo readlink "/proc/$pid/exe" 2>/dev/null | grep -q '^/usr/local/lib/devnet-dvpn/' && p=$((p + 1)); done
  for pid in $(pgrep -x openvpn); do sudo tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q '/var/lib/dvpnd/' && p=$((p + 1)); done
  local r; r=$(( $(ip -4 rule show pref 8990 2>/dev/null | grep -c .) + $(ip -4 rule show pref 8989 2>/dev/null | grep -c .) + $(ip -4 route show table main proto 241 2>/dev/null | grep -c .) ))   # dvpnd 0022 rules + 0024 rules + 0023 metadata route
  echo "nft=$t links=$l procs=$p rules8990=$r egress=$(egress)"
  # a left table: show what is in it (kill switch? which chains?) so the log can tell a leak from a stale setting
  # name EVERY table counted (inet dvpnd = kill switch, dvpnd_hy2 = hysteria2 meter Q0239, dvpnd_v6guard ...):
  # only 'inet dvpnd' was dumped, so a left dvpnd_hy2 read "No such file" (fedora killdaemon 10-29)
  if [ "$t" != 0 ]; then
    local tb; for tb in $(sudo nft list tables 2>/dev/null | awk '$2 == "inet" && $3 ~ /^dvpnd/ {print $3}'); do
      echo "--- left: table inet $tb"; sudo nft list table inet "$tb" 2>&1 | head -20
    done
    echo "--- killswitch setting: $(devnet-dvpn daemon settings 2>/dev/null | grep -iE 'kill' | tr -s ' ' | head -2 | tr '\n' ' ')"
  fi
  [ "$t" = 0 ] && [ "$l" = 0 ] && [ "$p" = 0 ] && [ "$r" = 0 ]
}
restore() { $CLI disconnect >/dev/null 2>&1; sleep 2; $CLI daemon restore-network >/dev/null 2>&1; sleep 3; }
back_clean() { # network oracle after a case
  check "$1: after: nothing left, direct egress" bash -c "$(declare -f no_leftovers egress); for i in 1 2 3 4; do no_leftovers && [ \"\$(egress)\" = '$DIRECT' ] && exit 0; sleep 5; done; no_leftovers; exit 1"
}
connect_p() { # <protocol> [extra connect args…]: per GB unless args say otherwise
  local p=$1; shift
  hold
  run 0 'Connected|connected' "connect${*:+ $*}" -- connect "${NODE[$p]}" --units 1 --yes "$@"
}
# health oracle: dvpnd journal lines since MARK that must never appear
mark() { MARK=$(date -u '+%Y-%m-%d %H:%M:%S'); }
health() { # <check> [extra allowed regex]
  local bad
  bad=$(sudo journalctl -u dvpnd-client --since "$MARK" --no-pager -o cat 2>/dev/null \
    | grep -E 'panic|"level":"(error|fatal)"|closing remote session failed|issuing voucher failed' \
    | grep -Ev "${2:-^$}" | head -5)
  if [ -z "$bad" ]; then record PASS "$1: health (no panic/error/voucher/close failures in dvpnd)" ''; else record FAIL "$1: health" "$bad"; fi
}
summary() { note ''; note "$(basename "$TSV" .tsv): passed $PASS  failed $FAIL"; echo DONE >> "$LOG"; [ "$FAIL" = 0 ]; }
