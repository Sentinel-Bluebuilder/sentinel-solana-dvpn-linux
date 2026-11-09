#!/usr/bin/env bash
# ─── split-ui: the Split tunnelling and Kill switch PAGES driven like a person, proven by real exit IPs ───
# Linux version of #31 scripts/e2e/vm-split-ui.ps1 (owner standard S7). Run ON a test VM, detached:
#   nohup bash split-ui.sh split wireguard > ~/ui/split-wireguard.out 2>&1 &
#   nohup bash split-ui.sh ks xray [on|persist] > ~/ui/ks-xray.out 2>&1 &
# split (wireguard|amneziawg|openvpn|hysteria2): the page adds api.ipify.org's addresses as ranges,
#   include → Apply → connect → system curl exits at the node; exclude → Apply → connect → direct;
#   then ranges removed + split off. Linux splits by address range (apps = Windows only).
# ks (openvpn|hysteria2|v2ray|xray): Kill switch page mode On/Always + Apply, connect, the protocol
#   process is killed (sudo pkill): no sample may exit direct, the page shows "Blocking internet",
#   Restore network on the page, direct again, mode Off.
# SPENDS small per-GB deposits. Env: DVPN_KEYFILE, DVPN_DATA_DIR. PASS/FAIL lines, exit 1 on FAIL.
set -u
export PATH="$PATH:/usr/sbin:/sbin"
CASE=${1:-split}; P=${2:-wireguard}; KSMODE=${3:-on}
: "${DVPN_KEYFILE:?set DVPN_KEYFILE}"
export DVPN_DATA_DIR="${DVPN_DATA_DIR:-$HOME/ddv-data}"
declare -A NODE=(
  [hysteria2]=E8nefMLBuBzG1CrA4dSDU9mqq6ZNpv69Bt3w9QEtzvPf [v2ray]=Di5V9K2Vt5uptJUk7oVVnkDRXt9qWy5HhLbkEJMxEuM2
  [xray]=E9RG1iZJjsLfEuLfDYTHM4yXCjyFE21jBbJLFvGoL2FD [wireguard]=SLVJNn38s5RfqcVW7a7A4hGKqjY7Y1bKkUpG7wrGX5D
  [amneziawg]=1PwMkSjnyugAZHdHvDsddETzPUAubPkeyWymT7Ercn6 [openvpn]=9EQJ7dBwneFUse9yy8Hg56u2wPiGF5qkjAaA1ZAr64nP
)
NODE_IP=192.0.2.2
. "$(dirname "$0")/nodes.sh"; nodeset_apply   # NODE_SET=node4 → that node set (nodes.sh)
OUT=$HOME/ui/${CASE}ui-$P$([ "$CASE" = ks ] && echo "-$KSMODE"); mkdir -p "$HOME/ui"
FAILS=0
FIRED=() VERIFIED=()   # ABW evidence (2026-10-29): "INFO fired:", "INFO effect:", "INFO restore:" at the end
check() { if [ "$2" = 1 ]; then echo "PASS  $1${3:+  ($3)}"; else echo "FAIL  $1${3:+  ($3)}"; FAILS=$((FAILS + 1)); fi; }
cli() { devnet-dvpn "$@" 2>&1 | grep -v '^\[rpc\]'; }
hold() { sudo touch /run/ddv-deadman.hold 2>/dev/null; true; }
# Q0381: dvpnd's data-path watch (dafb4a1+) can heal a killed protocol before the page ever shows
# "Blocking internet" (ddv2-u22: reconnected in ~8 s, page straight back to armed). That also passes
# the two blocking steps, but only with ALL of: kill-proc killed it with 0 leaked (the leak check stays
# the oracle); dvpnd's own reconnect in the journal, in order (session ended with the kill switch kept,
# reconnecting, connected to server); the page armed again; and for system-routed protocols a later
# sample exits at the node (proxy protocols: plain traffic is blocked while armed, so no sample can).
recovered() { # <kill-proc ok> <kill-proc detail> <ks-state detail> <dvpnd journal since the start>
  [ "$1" = 1 ] || { echo 'kill-proc step failed'; return 1; }
  echo "$2" | grep -qE '\| 0 leaked$' || { echo "leak count is not 0 ($2)"; return 1; }
  echo "$3" | grep -qE '^armed \|' || { echo 'page is not armed again'; return 1; }
  printf '%s\n' "$4" | awk '
    s == 0 && /"kill_switch":"kept"/ && /"message":"session ended"/ { s = 1; next }
    s == 1 && /"message":"reconnecting"/ { s = 2; next }
    s == 2 && /connected to server/ { s = 3 }
    END { exit s == 3 ? 0 : 1 }' || { echo 'no dvpnd reconnect in the journal (session ended, kill switch kept -> reconnecting -> connected)'; return 1; }
  if [ "$PROXY" = false ]; then
    echo "$2" | grep -qE "samples ([^|]*,)?$NODE_IP(,| )" || { echo "no sample back on the node $NODE_IP"; return 1; }
  fi
  echo "dvpnd reconnected (session ended with the kill switch kept -> reconnecting -> connected), 0 leaked$([ "$PROXY" = false ] && echo ", a sample back on the node $NODE_IP")"
}

DIRECT=$(curl -4 -s -m 12 https://api.ipify.org)
echo "INFO  $CASE $P on $(. /etc/os-release; echo "$PRETTY_NAME") $(uname -r), direct $DIRECT"
echo "INFO  before: $(cli split status | head -1)"
s=$(cli daemon settings); echo "$s" | grep -qiE 'kill.?switch +(on|persist)' && { echo 'INFO  kill switch on before: turning it off'; cli daemon set --kill-switch off --yes >/dev/null; sleep 5; }
# V2Ray/Xray are proxies: the system only uses the node through the system proxy, so keep it on
# for them (with it off, system curl goes direct and the kill switch blocks it: Debian 12 run 1).
case $P in v2ray|xray) PROXY=true ;; *) PROXY=false ;; esac
cli settings set proxyOnConnect=$PROXY >/dev/null 2>&1

N=${NODE[$P]:?unknown protocol $P}
if [ "$CASE" = split ]; then
  case $P in wireguard|amneziawg|openvpn|hysteria2) ;; *) echo "FAIL  $P has no route split on Linux (proxy only)"; exit 1 ;; esac
  # The page gets api.ipify.org's addresses as ranges, so the system IP check shows which way it went.
  mapfile -t IPS < <(getent ahostsv4 api.ipify.org | awk '{print $1}' | sort -u)
  [ ${#IPS[@]} -gt 0 ] || { echo 'FAIL  api.ipify.org did not resolve'; exit 1; }
  ON=''; OFF=''; for ip in "${IPS[@]}"; do ON+="split-route=$ip/32:on;"; OFF+="split-route=$ip/32:off;"; done
  STEPS="nav=Split tunnelling;sleep=${UI_SETTLE:-5};split-mode=include;${ON}shot=include-chosen;split-apply;count=[data-split-protocol=$P][data-split-ok=yes]:1;\
connect=$N:per_gb;coverage=split-include;sleep=4;egress=node;nav=Split tunnelling;count=[data-split-live=live]:1;shot=include-live;disconnect;\
split-mode=exclude;split-apply;connect=$N:per_gb;coverage=split-exclude;sleep=4;egress=direct;nav=Split tunnelling;shot=exclude-live;disconnect;\
${OFF}split-mode=off;split-apply;sleep=4;egress=direct"
else
  case $P in openvpn|hysteria2|v2ray|xray) ;; *) echo "FAIL  $P has no protocol process to kill (kernel tunnel; matrix ks-on covers it)"; exit 1 ;; esac
  # V2Ray/Xray are proxy-only on Linux: the node is reached through the SOCKS on screen, and with
  # the kill switch armed plain system traffic gets nothing out (that IS the block working).
  if [ "$PROXY" = true ]; then ARMED='egress-socks=node;egress=none'; else ARMED='egress=node'; fi
  STEPS="nav=Kill switch;count=[data-ks-protocol] [data-protocol-mark]:6;ks-mode=$KSMODE;ks-state=standby;shot=ks-standby;\
connect=$N:per_gb;ks-state=armed;$ARMED;shot=ks-armed;kill-proc=$P;ks-state=blocking;expect=Blocking internet;shot=ks-after-kill;\
restore;egress=direct;ks-mode=off;ks-state=off;shot=ks-off;egress=direct"
fi

T0=$(date +%s)
hold
( while sleep 60; do sudo touch /run/ddv-deadman.hold 2>/dev/null; done ) & HOLDER=$!
DVPN_UI_SCENARIO="$STEPS" DVPN_UI_EXPECT_NODE_IP=$NODE_IP DVPN_UI_DIRECT_IP=$DIRECT DVPN_UI_SMOKE_WAIT_MS=6000 \
  UI_TIMEOUT=1200 bash "$(dirname "$0")/ui-smoke.sh" dark "$OUT" > "$OUT.launch" 2>&1
kill $HOLDER 2>/dev/null

if [ -f "$OUT/scenario.json" ]; then
  JR=''; [ "$CASE" = ks ] && JR=$(sudo -n journalctl -u dvpnd-client --since "@$T0" -o cat --no-pager 2>&1)
  KP_OK=0 KP_D='' RECOV=0
  while IFS=$'\t' read -r ok step detail; do
    case $step in   # Q0381: see recovered()
      kill-proc=*) KP_OK=$ok; KP_D=$detail ;;
      ks-state=blocking*) if [ "$ok" = 0 ] && [ "$CASE" = ks ]; then
          if why=$(recovered "$KP_OK" "$KP_D" "$detail" "$JR"); then ok=1; RECOV=1; detail="recovered, not blocked: $why | page $detail"
          else detail="$detail | not recovered either: $why"; fi
        fi ;;
      expect=Blocking*) [ "$ok" = 0 ] && [ "$RECOV" = 1 ] && { ok=1; detail="recovered (see ks-state=blocking), page protecting again | ${detail:0:120}"; } ;;
    esac
    check "app: $step" "$ok" "$detail"
    [ "$ok" = 1 ] || continue
    case $step in   # ABW evidence: a control on the page vs a state read back (kill-proc is the harness, not a control)
      ks-mode=*|split-mode=*|split-route=*|split-apply|connect=*|disconnect|restore) FIRED+=("$step") ;;
      egress*|ks-state=*|expect=*|coverage=*) VERIFIED+=("$step${detail:+ ($detail)}") ;;
    esac
  done < <(node -e '
    for (const s of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")))
      console.log([s.ok ? 1 : 0, s.step, String(s.detail ?? "").replace(/\s+/g, " ").slice(0, 220)].join("\t"));' "$OUT/scenario.json")
else
  check 'scenario.json written' 0 "$(tail -3 "$OUT.launch" | tr '\n' ' ')"
fi
e=$(cat "$OUT/errors.json" 2>/dev/null || echo missing)
# Q0381: ui-smoke also lists each failed scenario step as an error ("scenario <step>: <detail>"). On the
# recovered path drop only those two steps' entries (already judged above); every other entry still counts.
if [ "${RECOV:-0}" = 1 ] && [ "$e" != missing ]; then
  e=$(node -e '
    const a = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const drop = (s) => /^scenario (ks-state=blocking[^:]*|expect=Blocking internet): /.test(s);
    a.filter(drop).forEach((s) => console.error("INFO  recovered, not a UI error: " + s.replace(/\s+/g, " ").slice(0, 160)));
    console.log(JSON.stringify(a.filter((s) => !drop(s)), null, 2));' "$OUT/errors.json" 2>"$OUT.recov") || e=missing
  cat "$OUT.recov" 2>/dev/null
fi
check 'no UI errors' "$([ "$(echo "$e" | tr -d ' \n')" = '[]' ] && echo 1 || echo 0)" "${e:0:200}"

# After: the CLI reads what the page saved; leave the VM clean even if the scenario stopped half way.
st=$(cli split status | head -1)
if ! echo "$st" | grep -qE '^Mode +off'; then echo 'INFO  split still on: turning it off'; cli daemon set --split-mode off --split-routes none --yes >/dev/null; sleep 5; st=$(cli split status | head -1); fi
check 'CLI split status: off after' "$(echo "$st" | grep -qE '^Mode +off' && echo 1 || echo 0)" "$st"
s=$(cli daemon settings)
if echo "$s" | grep -qiE 'kill.?switch +(on|persist)'; then echo 'INFO  kill switch still on: turning it off'; cli disconnect >/dev/null; cli daemon set --kill-switch off --yes >/dev/null; cli daemon restore-network >/dev/null; sleep 5; s=$(cli daemon settings); fi
check 'CLI: kill switch off after' "$(echo "$s" | grep -qiE 'kill.?switch +(on|persist)' && echo 0 || echo 1)"
line=$(cli status | grep -m1 '^Session')
check 'CLI status: no session' "$(echo "$line" | grep -q ' node ' && echo 0 || echo 1)" "$line"
now=$(curl -4 -s -m 12 https://api.ipify.org)
check 'internet direct after' "$([ "$now" = "$DIRECT" ] && echo 1 || echo 0)" "$now"

# ─── ABW evidence lines: fired / effect / restore ───
j() { local s; s=$(printf '%s; ' "$@"); s=${s%; }; echo "${s:0:600}"; }
echo "INFO fired: ${#FIRED[@]} control(s) activated on the page: $( [ ${#FIRED[@]} -gt 0 ] && j "${FIRED[@]}" || echo none)"
echo "INFO effect: $( [ ${#VERIFIED[@]} -gt 0 ] && j "${VERIFIED[@]}" || echo 'no state check passed')"
echo "INFO restore: split '$st'; kill switch $(echo "$s" | grep -qiE 'kill.?switch +(on|persist)' && echo STILL-ON || echo off); session '${line:-none}'; egress $now (direct $DIRECT)"
check 'FIRED: at least one control activated on the page' "$([ ${#FIRED[@]} -gt 0 ] && echo 1 || echo 0)"
check 'EFFECT CHECK RAN: a state read back (egress / kill switch state / text)' "$([ ${#VERIFIED[@]} -gt 0 ] && echo 1 || echo 0)"
echo "RESULT ${CASE}ui $P: $FAILS FAIL"
exit $([ $FAILS = 0 ] && echo 0 || echo 1)
