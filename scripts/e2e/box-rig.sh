#!/bin/bash
# ─── box-rig — every node type + a plan provider on a real Linux host ─────────
# Proves the app/CLI end to end against real nodes of all six protocols and a
# plan provider. The host is shared (BOX_HOST, required): everything this script
# creates is prefixed ddv-, lives under /home/ubuntu/ddvpn-test, and is removed by
# `teardown`; `check` diffs the host against the snapshot taken before `up`.
#
#   host        : 6 node daemons (ddv-node@<n>) + 1 provider daemon (ddv-provider)
#                 owned by a FRESH operator key made on the host (the laptop's
#                 devnet wallet key never leaves the laptop)
#   netns ddvapp: the client daemon. Its full tunnel and kill switch stay in the
#                 namespace, so the host's own routes/SSH are never touched.
#   laptop      : CLI/app over `ssh -L` (gRPC bridge + every node/provider API)
#
# Laptop:  bash scripts/e2e/box-rig.sh <verb>
#   snapshot <name>  record host state (baseline before anything, after at the end)
#   ship             copy binaries + RPC URL to the host (no host changes beyond the dir)
#   operator         create the operator key on the host, print its address
#   nodes            init + open_node + start all six (operator must be funded)
#   provider         init + open_provider + start the provider daemon
#   plan             open_plan + list + every node on the provider roster
#   client [nocheck] netns + client daemon + gRPC bridge (+ dead-man timer); nocheck skips the egress precheck (restart into a blocked netns)
#   tunnel           laptop-side ssh -L for gRPC and every API (background)
#   env              print the env exports for the laptop CLI (source it)
#   wind-down        stop provider, start-close its leases, delist + close the plan
#   loopback <n…>    move node(s) to api 127.0.0.1 (on-chain uri too) so a LAPTOP client
#                    reaches them through `tunnel` — V2Ray/Xray only (TCP); `public <n…>` undoes it
#   mss              clamp TCP MSS on the WG/AWG interfaces to the uplink MTU (also run by `nodes`)
#   status | logs <n> | stop | close | withdraw | teardown | check
set -uo pipefail
HOST=${BOX_HOST:?set BOX_HOST to the shared box (an SSH alias)}
B=${BOX_DIR:-/home/ubuntu/ddvpn-test}   # working folder on the box (BOX_DIR overrides)
SSH="ssh -o BatchMode=yes -o ServerAliveInterval=20 $HOST"

# name  service    bit  api    iface      subnet          tunnel ports            internal ports
NODES="wg    wireguard  1   18711  ddv-wg0    10.212.1.1/24   udp:18721               -
awg   amneziawg  32  18712  ddv-awg0   10.212.2.1/24   udp:18722               -
v2ray v2ray      2   18713  -          -               tcp:18723,tcp:18724     api:18741
xray  xray       4   18714  -          -               tcp:18726,tcp:18727     api:18742
ovpn  openvpn    8   18715  ddv-ovpn0  10.212.5.1/24   udp:18729               mgmt:18743
hy2   hysteria2  16  18716  -          -               udp:18730               auth:18744,stats:18745"
PROV_API=18719
GRPC_PORT=50071

# ─── Laptop-only verbs ───
# The laptop runs this under Git Bash; every host (the shared box, GCP test VM) is Linux.
if [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* || "$(uname -s)" == CYGWIN* ]]; then
  HERE=$(cd "$(dirname "$0")/../.." && pwd)
  # Git Bash has no pkill: match our exact forward in /proc/<pid>/cmdline and kill only that PID
  # (other projects keep their own ssh tunnels open).
  kill_tunnel() {
    local p
    for p in /proc/[0-9]*; do
      tr '\0' ' ' < "$p/cmdline" 2>/dev/null | grep -q "^ssh .*-L $GRPC_PORT:127.0.0.1:$GRPC_PORT .*$HOST" || continue
      kill "${p#/proc/}" && echo "ok   tunnel down (pid ${p#/proc/})"
    done
  }
  case "${1:-status}" in
    ship)
      U="$HOME/work/sentinel-solana/upstream"
      $SSH "mkdir -p $B/bin && chmod 700 $B"
      for f in "$U/sentinel-dvpnd/bin/dvpnd" "$U/sentinel-dvpnctl/bin/dvpnctl" //wsl.localhost/Ubuntu/usr/local/bin/v2ray //wsl.localhost/Ubuntu/usr/local/bin/xray //wsl.localhost/Ubuntu/usr/local/bin/hysteria2; do
        n=$(basename "$f"); gzip -1c "$f" | $SSH "gunzip > $B/bin/$n && chmod 755 $B/bin/$n" || { echo "FAIL ship $n"; exit 1; }
      done
      # Per-host settings for the host half (it runs remotely and can't see laptop env).
      # Defaults below are the shared box's; another host sets BOX_IP / BOX_WAN / BOX_COUNTRY.
      if [ -n "${BOX_IP:-}" ]; then
        printf 'IP=%s\nWAN=%s\nCOUNTRY=%s\n' "$BOX_IP" "${BOX_WAN:-ens4}" "${BOX_COUNTRY:-US}" | $SSH "cat > $B/host.env"
      fi
      $SSH "cat > $B/tcp-bridge.py" < "$HERE/scripts/e2e/tcp-bridge.py"
      $SSH "cat > $B/box-rig.sh && chmod 700 $B/box-rig.sh" < "$0"   # the dead-man timer runs this copy
      # RPC URL (holds an API key): piped straight through, never printed.
      RPC=$(grep -E '^SOLANA_RPC_URLS=' "$HOME/work/sentinel-node-tester-solana/.env" | head -1 | cut -d= -f2- | cut -d, -f1)
      [ -n "$RPC" ] || { echo "FAIL no RPC URL"; exit 1; }
      printf '%s' "$RPC" | $SSH "umask 077; cat > $B/rpc.txt"
      $SSH "$B/bin/dvpnd version; ls $B/bin" ; exit 0 ;;
    push)   # scripts only: binaries are busy while daemons run
      $SSH "cat > $B/tcp-bridge.py" < "$HERE/scripts/e2e/tcp-bridge.py"
      $SSH "cat > $B/box-rig.sh && chmod 700 $B/box-rig.sh" < "$0" && echo "ok   scripts pushed"; exit $? ;;
    tunnel)
      kill_tunnel
      L="-L $GRPC_PORT:127.0.0.1:$GRPC_PORT -L $PROV_API:127.0.0.1:$PROV_API"
      # Node APIs + the V2Ray/Xray TCP tunnel ports (used once a node is moved to `loopback`).
      for p in 18711 18712 18713 18714 18715 18716 18723 18724 18726 18727; do L="$L -L $p:127.0.0.1:$p"; done
      ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=20 -f -N $L "$HOST" && echo "ok   tunnel up" ; exit $? ;;
    untunnel) kill_tunnel; exit 0 ;;
    env)
      $SSH "cat $B/nodes.tsv $B/provider.tsv 2>/dev/null" | awk -F'\t' -v g=$GRPC_PORT '
        $1=="provider" { prov=$2"=https://127.0.0.1:"$3 }
        $1!="provider" { nodes = nodes (nodes?",":"") $2"=https://127.0.0.1:"$5 }
        END { print "export DVPN_DAEMON_TARGET=127.0.0.1:" g; print "export DVPN_NODE_API_OVERRIDES=" nodes; print "export DVPN_PROVIDER_API_OVERRIDES=" prov; print "unset DVPN_DAEMON_HOME" }'
      exit 0 ;;
    snapshot|operator|nodes|provider|plan|wind-down|client|loopback|public|status|logs|stop|close|withdraw|teardown|check|pull|ip|mss)
      exec $SSH "bash -s -- $*" < "$0" ;;
    *) sed -n '2,26p' "$0"; exit 2 ;;
  esac
fi

# ─── Host side ───
export PATH=$B/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
MINT=Hen2LVP6KooGaXEvdSyCHWghsEY4gLLn7wix8z6zHFSa
VAULT=EQJyAyWLGZSye3BMfDQVdhrfp1QKEByNX9q2J9TzFmfy
CLIENT_OWNER=11111111111111111111111111111111
IP=192.0.2.1
WAN=ens3
COUNTRY=IN
# Another host (e.g. the GCP test VM) overrides these via host.env written by `ship`.
[ -f "$B/host.env" ] && . "$B/host.env"
CTL=$B/ctl
STATE=$B/nodes.tsv
PSTATE=$B/provider.tsv
S="sudo -n"
NS=ddvapp; VETH_H=veth-ddvh; VETH_C=veth-ddvc; NS_HOST=10.213.0.1; NS_IP=10.213.0.2; NAT_TABLE=ddvapp_nat
CH=$B/client
RPC=$(cat $B/rpc.txt 2>/dev/null)

ctl() { $S $B/bin/dvpnctl --home "$CTL" "$@"; }
opaddr() { $S python3 -c "import json;print(json.load(open('$B/operator.addr.json'))['public_key'])" 2>/dev/null; }
wait_ready() { local i; for i in $(seq 1 60); do $S grep -q '"message":"ready"' "$1" 2>/dev/null && return 0; sleep 2; done; return 1; }

ensure_ctl() {
  $S mkdir -p "$CTL/keys"; $S chmod 700 "$CTL" "$CTL/keys"
  $S tee "$CTL/config.toml" >/dev/null <<EOF
key = 'owner'
output = 'json'
[daemon]
socket = ''
[log]
format = 'console'
level = 'warn'
[rpc]
commitment = 'confirmed'
timeout = 30000000000
url = '$RPC'
ws_url = '${RPC/https/wss}'
[tx]
commitment = 'confirmed'
compute_unit_margin = 20
confirm_timeout = 90000000000
loaded_data_limit = 8388608
max_priority_fee = 100000
priority_fee = 0
EOF
  $S chmod 600 "$CTL/config.toml"
}

ensure_units() {
  $S tee /etc/systemd/system/ddv-node@.service >/dev/null <<EOF
[Unit]
Description=ddv-test dVPN node %i (temporary, devnet-dvpn e2e)
After=network-online.target
[Service]
Environment=PATH=$B/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=$B/bin/dvpnd start --home $B/node-%i
KillSignal=SIGTERM
TimeoutStopSec=40
Restart=no
StandardOutput=append:$B/node-%i/daemon.log
StandardError=append:$B/node-%i/daemon.log
EOF
  $S systemctl daemon-reload
}

snapshot() {
  local D=$B/snap-$1; mkdir -p "$D"
  $S ufw status numbered > "$D/ufw.txt" 2>&1
  $S nft list tables > "$D/nft-tables.txt" 2>&1
  ip route show table all | grep -vE 'veth|linkdown' > "$D/ip-route.txt" 2>&1
  ip rule > "$D/ip-rule.txt" 2>&1
  ip -o link | awk -F': ' '{print $2}' | sed 's/@.*//' | grep -v '^veth' | sort > "$D/ip-links.txt"
  ip netns list > "$D/netns.txt" 2>&1
  ss -lntu | awk 'NR>1{print $1, $5}' | grep -vE ':(68|546|323) ' | sort -u > "$D/listening.txt"
  systemctl list-units --type=service --state=running --no-legend | awk '{print $1}' | sort > "$D/services.txt"
  pgrep -f "dvpnd start" -a | sort > "$D/dvpnd-procs.txt"
  dpkg -l | awk '/^ii/{print $2}' | sort > "$D/packages.txt"
  date -u +%FT%TZ > "$D/taken-at.txt"
  echo "snapshot $1 → $D ($(cat "$D"/*.txt | wc -l) lines)"
}

operator() {
  ensure_ctl
  if ! $S test -f "$CTL/keys/owner.json"; then
    $S $B/bin/dvpnctl --home "$CTL" keys new owner --plain >/dev/null 2>&1 || { echo "FAIL keys new"; return 1; }
  fi
  $S $B/bin/dvpnctl --home "$CTL" keys show owner 2>/dev/null | $S tee "$B/operator.addr.json" >/dev/null
  echo "operator $(opaddr)"
  $S python3 -c "import json;print(json.load(open('$B/operator.addr.json')))" >/dev/null 2>&1 || cat "$B/operator.addr.json"
}

patch_cfg() {  # pin interface / subnet / ports; drop REALITY inbounds
  local H=$1 SVC=$2 IFACE=$3 SUBNET=$4 TPORTS=$5 IPORTS=$6
  $S python3 - "$H/node/$SVC/config.toml" "$SVC" "$IFACE" "$SUBNET" "$TPORTS" "$IPORTS" <<'PY'
import re, sys
p, svc, iface, subnet, tports, iports = sys.argv[1:]
s = open(p).read()
def setkey(s, k, v):
    return re.sub(rf"(?m)^{k} = .*$", f"{k} = {v}", s, count=1)
tp = [int(x.split(':')[1]) for x in tports.split(',')]
ip = {} if iports == '-' else {x.split(':')[0]: int(x.split(':')[1]) for x in iports.split(',')}
if svc in ('wireguard', 'amneziawg', 'openvpn'):
    s = setkey(s, 'interface', f"'{iface}'")
    s = setkey(s, 'addresses', f"['{subnet}']")
    s = setkey(s, 'listen_port', str(tp[0]))
    if svc == 'openvpn': s = setkey(s, 'management_port', str(ip['mgmt']))
elif svc in ('v2ray', 'xray'):
    s = setkey(s, 'api_port', str(ip['api']))
    blocks = re.split(r'(?=^\[\[inbounds\]\])', s, flags=re.M)
    head, inb = blocks[0], [b for b in blocks[1:] if "security = 'reality'" not in b]
    for i, b in enumerate(inb):
        inb[i] = re.sub(r'(?m)^port = \d+$', f'port = {tp[i]}', b, count=1)
    s = head + ''.join(inb)
elif svc == 'hysteria2':
    s = setkey(s, 'listen_port', str(tp[0]))
    s = setkey(s, 'auth_port', str(ip['auth']))
    s = setkey(s, 'stats_port', str(ip['stats']))
open(p, 'w').write(s)
PY
}

# Only our own netns may reach our ports (the provider's security group blocks the internet anyway).
fw_ns() {
  $S ufw status | grep -q "on $VETH_H.*ddv-test" && return 0
  $S ufw allow in on "$VETH_H" comment ddv-test >/dev/null
  $S ufw route allow in on "$VETH_H" out on "$WAN" comment ddv-test >/dev/null
}
fw_iface() { [ "$1" != "-" ] && $S ufw route allow in on "$1" out on "$WAN" comment ddv-test >/dev/null; return 0; }

key_name() { $S python3 -c "import json;print(json.load(open('$1'))['key'])"; }

up_node() {
  local N=$1 SVC=$2 BIT=$3 API=$4 IFACE=$5 SUBNET=$6 TPORTS=$7 IPORTS=$8 H=$B/node-$1 OP; OP=$(opaddr)
  if ! $S test -f "$H/node/config.toml"; then
    $S $B/bin/dvpnd init --role node --home "$H" --owner "$OP" --country "$COUNTRY" --api-addrs "$IP" --api-port "$API" \
      --prices.channel-price-per-gb 1000 --prices.channel-price-per-hour 1000 --prices.lease-price-per-hour 1000 \
      --service "$SVC" --plain-key 2>"$B/init-$N.err" | $S tee "$H.init.json" >/dev/null || { echo "$N: init FAILED: $(tail -2 "$B/init-$N.err")"; return 1; }
    $S install -m 600 "$CTL/keys/owner.json" "$H/node/keys/$(key_name "$H.init.json").json"   # node signs as the operator
    $S sed -i "s#^url = .*#url = '$RPC'#; s#^ws_url = .*#ws_url = '${RPC/https/wss}'#" "$H/config.toml"
    $S sed -i "s#^threshold = .*#threshold = 1#" "$H/node/config.toml"
    patch_cfg "$H" "$SVC" "$IFACE" "$SUBNET" "$TPORTS" "$IPORTS"
    echo "$N: initialised"
  fi
  local NID; NID=$($S python3 -c "import json;print(json.load(open('$H.init.json'))['id'])")
  if ! $S grep -q "^$N	" "$STATE" 2>/dev/null; then
    local OUT; OUT=$(ctl node open-node --node-id "$NID" --bond 1000000 --country "$COUNTRY" --protocols "$BIT" --uri "https://$IP:$API" \
      --prices.channel-price-per-gb 1000 --prices.channel-price-per-hour 1000 --prices.lease-price-per-hour 1000 \
      --mint "$MINT" --vault "$VAULT" --rent-payer "$OP" 2>&1)
    grep -q '"signature"' <<<"$OUT" || { echo "$N: open-node FAILED: $(echo "$OUT" | tail -3)"; return 1; }
    sleep 7
    local PDA; PDA=$(ctl node search | python3 -c "
import sys,json
a=[x['address'] for x in json.load(sys.stdin) if bytes(x['value'].get('nodeId') or []).hex()=='$NID']
print(a[0] if a else '')")
    [ -n "$PDA" ] || { echo "$N: open-node landed but the node account was not found"; return 1; }
    printf '%s\t%s\t%s\t%s\t%s\n' "$N" "$PDA" "$NID" "$SVC" "$API" | $S tee -a "$STATE" >/dev/null
    echo "$N: open_node → $PDA"
  fi
  fw_iface "$IFACE"
  systemctl is-active -q "ddv-node@$N" && { echo "$N: already running"; return 0; }
  $S truncate -s 0 "$H/daemon.log" 2>/dev/null
  $S systemctl start "ddv-node@$N"
  if wait_ready "$H/daemon.log"; then echo "$N: ready"; else echo "$N: NOT ready: $($S grep -E '"level":"(error|fatal)"' "$H/daemon.log" | tail -2 | cut -c1-300)"; fi
  sleep 7
}

up_provider() {
  local H=$B/provider OP; OP=$(opaddr)
  if ! $S test -f "$H/provider/config.toml"; then
    $S $B/bin/dvpnd init --role provider --home "$H" --owner "$OP" --api-addrs "$IP" --api-port "$PROV_API" --plain-key 2>"$B/init-provider.err" \
      | $S tee "$H.init.json" >/dev/null || { echo "provider: init FAILED: $(tail -2 "$B/init-provider.err")"; return 1; }
    $S install -m 600 "$CTL/keys/owner.json" "$H/provider/keys/$(key_name "$H.init.json").json"
    $S sed -i "s#^url = .*#url = '$RPC'#; s#^ws_url = .*#ws_url = '${RPC/https/wss}'#" "$H/config.toml"
    # 1 GB per ticket, so one subscription can be used more than once (FINDINGS 2026-10-05)
    $S sed -i "s#^data_cap_bytes = .*#data_cap_bytes = 1000000000#" "$H/provider/config.toml"
    echo "provider: initialised"
  fi
  if ! $S test -s "$PSTATE"; then
    local PID; PID=$($S python3 -c "import json;print(json.load(open('$H.init.json'))['id'])")
    local OUT; OUT=$(ctl provider open-provider --provider-id "$PID" --bond 1000000 --uri "https://$IP:$PROV_API" --mint "$MINT" --vault "$VAULT" --rent-payer "$OP" 2>&1)
    grep -q '"signature"' <<<"$OUT" || { echo "provider: open FAILED: $(echo "$OUT" | tail -3)"; return 1; }
    sleep 7
    local PDA; PDA=$(ctl provider search | python3 -c "
import sys,json
a=[x['address'] for x in json.load(sys.stdin) if bytes(x['value'].get('providerId') or []).hex()=='$PID']
print(a[0] if a else '')")
    [ -n "$PDA" ] || { echo "provider: open landed but account not found"; return 1; }
    printf 'provider\t%s\t%s\t%s\n' "$PDA" "$PROV_API" "$PID" | $S tee "$PSTATE" >/dev/null
    echo "provider: open_provider → $PDA"
  fi
  # open_provider leaves it unlisted; the lease keeper then fails ProviderNotListed (6020).
  local PP; PP=$(cut -f2 "$PSTATE")
  if [ "$(ctl provider show "$PP" | python3 -c "import sys,json;print(json.load(sys.stdin)['value']['status'])")" != 1 ]; then
    ctl provider list-provider --provider "$PP" 2>&1 | grep -q '"signature"' && echo "provider: listed" || echo "provider: list FAILED"
    sleep 7
  fi
  $S tee /etc/systemd/system/ddv-provider.service >/dev/null <<EOF
[Unit]
Description=ddv-test plan provider (temporary, devnet-dvpn e2e)
[Service]
ExecStart=$B/bin/dvpnd start --home $H
KillSignal=SIGTERM
TimeoutStopSec=40
Restart=no
StandardOutput=append:$H/daemon.log
StandardError=append:$H/daemon.log
EOF
  $S systemctl daemon-reload
  systemctl is-active -q ddv-provider && { echo "provider: already running"; return 0; }
  $S systemctl start ddv-provider
  wait_ready "$H/daemon.log" && echo "provider: ready" || echo "provider: NOT ready: $($S grep -E '"level":"(error|fatal)"' "$H/daemon.log" | tail -2 | cut -c1-300)"
}

# A plan of the provider with every node on its roster (roster = provider gRPC, not chain).
PLSTATE=$B/plan.tsv
pctl() { $S $B/bin/dvpnctl --home "$CTL" --daemon.socket "$B/provider/daemon.sock" "$@"; }
up_plan() {
  local PROV; PROV=$(cut -f2 "$PSTATE" 2>/dev/null); [ -n "$PROV" ] || { echo "plan: run provider first"; return 1; }
  if ! $S test -s "$PLSTATE"; then
    local PID; PID=$(python3 -c "import secrets;print(secrets.token_hex(32))")
    # 1 tDVPN-thousandth, 1 day, 5 GB, 2 connections: cheap, and long enough for the whole run.
    local OUT; OUT=$(ctl plan open-plan --provider "$PROV" --plan-id "$PID" --price 1000 --duration-seconds 86400 \
      --data-cap-gb 5 --max-connections 2 --rent-payer "$(opaddr)" 2>&1)
    grep -q '"signature"' <<<"$OUT" || { echo "plan: open FAILED: $(echo "$OUT" | tail -3)"; return 1; }
    sleep 7
    local PL; PL=$(ctl plan search | python3 -c "
import sys,json
a=[x['address'] for x in json.load(sys.stdin) if bytes(x['value'].get('planId') or []).hex()=='$PID']
print(a[0] if a else '')")
    [ -n "$PL" ] || { echo "plan: open landed but account not found"; return 1; }
    printf 'plan\t%s\t%s\n' "$PL" "$PID" | $S tee "$PLSTATE" >/dev/null
    echo "plan: open_plan → $PL"
  fi
  local PL; PL=$(cut -f2 "$PLSTATE")
  if [ "$(ctl plan show "$PL" | python3 -c "import sys,json;print(json.load(sys.stdin)['value']['status'])")" != 1 ]; then
    ctl plan list-plan --plan "$PL" >/dev/null 2>&1 && echo "plan: listed"; sleep 7
  fi
  while IFS=$'\t' read -r N PDA _; do
    pctl provider nodes list 2>/dev/null | grep -q "$PDA" && { echo "roster: $N already on"; continue; }
    local o; o=$(pctl provider nodes add --plan "$PL" "$PDA" 2>&1)
    grep -qi error <<<"$o" && echo "roster: $N FAILED: $(head -c 200 <<<"$o")" || echo "roster: $N added"
  done < "$STATE"
  pctl provider nodes list 2>&1 | head -20
}

inns() { $S ip netns exec "$NS" "$@"; }

client() {
  if ! ip netns list | grep -qw "$NS"; then
    $S ip netns add "$NS" && $S ip link add "$VETH_H" type veth peer name "$VETH_C" || { echo "FAIL netns"; return 1; }
    $S ip link set "$VETH_C" netns "$NS"
    $S ip addr add "$NS_HOST/24" dev "$VETH_H"; $S ip link set "$VETH_H" up
    inns ip addr add "$NS_IP/24" dev "$VETH_C"; inns ip link set "$VETH_C" up; inns ip link set lo up
    inns ip route add default via "$NS_HOST"
    $S nft add table ip "$NAT_TABLE"
    $S nft "add chain ip $NAT_TABLE post { type nat hook postrouting priority 100 ; }"
    $S nft add rule ip "$NAT_TABLE" post ip saddr 10.213.0.0/24 oifname "$WAN" masquerade
    $S mkdir -p "/etc/netns/$NS"; echo "nameserver 1.1.1.1" | $S tee "/etc/netns/$NS/resolv.conf" >/dev/null
  fi
  fw_ns
  # The netns must reach our public IP (hairpin) — route it via the veth.
  inns ip route replace "$IP/32" via "$NS_HOST"
  # Host daemons' UDP replies to the netns must come from the public IP the client dialled
  # (dvpnd's OpenVPN server does not use multihome). A preferred source on the route does it
  # natively; an SNAT rule instead remaps the reply PORT on a conntrack clash and OpenVPN
  # drops it ("Incoming packet rejected ... expected peer address").
  $S ip route replace "$NS_IP/32" dev "$VETH_H" src "$IP"
  # `client nocheck` restarts the daemon into a namespace a leftover kill switch is blocking (T14).
  if [ "${1:-}" != nocheck ]; then
    local code; code=$(inns curl -s -o /dev/null -w '%{http_code}' --max-time 12 'https://speed.cloudflare.com/__down?bytes=1000')
    [ "$code" = 200 ] && echo "ok   netns egress" || { echo "FAIL netns egress http=$code"; return 1; }
  fi
  if ! $S test -f "$CH/config.toml"; then
    $S $B/bin/dvpnd init --home "$CH" --role client --owner "$CLIENT_OWNER" --plain-key 2>"$B/init-client.err" | $S tee "$CH.init.json" >/dev/null || { echo "FAIL client init: $(cat "$B/init-client.err")"; return 1; }
    $S sed -i "s#^url = .*#url = '$RPC'#; s#^ws_url = .*#ws_url = '${RPC/https/wss}'#" "$CH/config.toml"
  fi
  $S sed -i "s/^dns = .*/dns = 'none'/" "$CH/client/config.toml"
  if ! pgrep -f "dvpnd start --home $CH\$" >/dev/null; then
    $S truncate -s 0 "$B/client.log" 2>/dev/null
    inns bash -c "PATH=$PATH nohup $B/bin/dvpnd start --home $CH >>$B/client.log 2>&1 &"
    wait_ready "$B/client.log" && echo "ok   client daemon ready in netns $NS" || { echo "FAIL client: $($S tail -3 "$B/client.log")"; return 1; }
  fi
  if ! pgrep -f "tcp-bridge.py $GRPC_PORT " >/dev/null; then
    $S bash -c "nohup python3 $B/tcp-bridge.py $GRPC_PORT unix:$CH/daemon.sock >$B/bridge.log 2>&1 &"; sleep 1
  fi
  pgrep -f "tcp-bridge.py $GRPC_PORT " >/dev/null && echo "ok   127.0.0.1:$GRPC_PORT -> client gRPC" || echo "FAIL grpc bridge"
  # Dead-man: if nobody re-arms it, the client and its namespace go away in 30 min.
  $S systemctl stop ddv-deadman.timer 2>/dev/null; $S systemctl reset-failed ddv-deadman.service ddv-deadman.timer 2>/dev/null
  $S systemd-run --quiet --unit ddv-deadman --on-active=1800 /bin/bash "$B/box-rig.sh" client-down >/dev/null 2>&1 && echo "ok   dead-man armed (30 min)"
  echo "device $($S python3 -c "import json;print(json.load(open('$CH.init.json'))['public_key'])")"
}

# Move node(s)' API (listen + on-chain uri) to $1. The daemon dials a V2Ray/Xray tunnel at the
# API's address, so 127.0.0.1 + the laptop `tunnel` forwards carry both over SSH (TCP only).
set_api() {
  local A=$1 N CF PDA; shift
  ensure_ctl
  for N in "$@"; do
    CF=$B/node-$N/node/config.toml
    $S test -f "$CF" || { echo "FAIL no node $N"; continue; }
    $S sed -i "/^\[api\]/,/^\[/ s/^addrs = .*/addrs = ['$A']/" "$CF"
    $S systemctl restart "ddv-node@$N"
    PDA=$(awk -v n="$N" '$1==n {print $2}' "$STATE")
    local U=''
    for _ in $(seq 1 20); do
      sleep 6
      # uri is stored as bytes + uriLen
      U=$(ctl node show "$PDA" 2>/dev/null | python3 -c 'import sys,json;v=json.load(sys.stdin);v=v.get("value",v);print(bytes(v["uri"][:v["uriLen"]]).decode())' 2>&1)
      case $U in "https://$A:"*) echo "ok   $N api + on-chain uri -> $U"; continue 2 ;; esac
    done
    echo "WARN $N: on-chain uri still $U"
  done
}

client_down() {
  pkill -f "tcp-bridge.py $GRPC_PORT " 2>/dev/null
  $S pkill -TERM -f "dvpnd start --home $CH\$" 2>/dev/null
  for _ in $(seq 1 15); do pgrep -f "dvpnd start --home $CH\$" >/dev/null || break; sleep 1; done
  $S pkill -KILL -f "dvpnd start --home $CH\$" 2>/dev/null
  $S ip netns del "$NS" 2>/dev/null; $S ip link del "$VETH_H" 2>/dev/null
  $S nft delete table ip "$NAT_TABLE" 2>/dev/null
  $S rm -rf "/etc/netns/$NS"
  echo "client down"
}

status() {
  echo "operator $(opaddr)"
  [ -f "$STATE" ] && while IFS=$'\t' read -r N PDA NID SVC API; do
    printf 'NODE %-6s %-10s %s api %s %s\n' "$N" "$SVC" "$PDA" "$API" "$(systemctl is-active "ddv-node@$N")"
  done < "$STATE"
  [ -f "$PSTATE" ] && printf 'PROVIDER %s api %s %s\n' "$(cut -f2 "$PSTATE")" "$PROV_API" "$(systemctl is-active ddv-provider)"
  printf 'CLIENT %s  bridge %s  netns %s\n' "$(pgrep -f "dvpnd start --home $CH\$" >/dev/null && echo up || echo down)" \
    "$(pgrep -f "tcp-bridge.py $GRPC_PORT " >/dev/null && echo up || echo down)" "$(ip netns list | grep -qw $NS && echo yes || echo no)"
}

# dvpnd hard-codes the WireGuard/AmneziaWG MTU at 1420 (UPSTREAM-GAPS #26). On a host whose
# uplink MTU is below 1500 (GCP: 1460) full-size packets leave as UDP fragments that the
# cloud drops: TLS handshakes hang while small requests work. Clamp TCP MSS on the tunnel
# interfaces so every encrypted packet fits: uplink MTU - 120 (outer IP 20 + UDP 8 + WG 32 +
# padding 16 + inner IP/TCP 40 + slack 4). 1460 → 1340 (proven on the GCP rig 2026-10-20).
# OpenVPN (ddv-ovpn0) needs it too: same fragment drops; its UDP data-channel overhead (~52 B)
# fits inside the same 120 B budget. Without it, chain reads through an OpenVPN session fail
# with "fetch failed" (VM matrix 2026-10-21, openvpn switch cell).
mss_clamp() {
  local mtu mss
  mtu=$($S cat "/sys/class/net/$WAN/mtu" 2>/dev/null || echo 1500)
  mss=$((mtu - 120))
  $S nft delete table inet ddv_mss 2>/dev/null
  printf 'table inet ddv_mss {\n chain forward {\n  type filter hook forward priority mangle; policy accept;\n  iifname { "ddv-wg0", "ddv-awg0", "ddv-ovpn0" } tcp flags syn tcp option maxseg size set %s\n  oifname { "ddv-wg0", "ddv-awg0", "ddv-ovpn0" } tcp flags syn tcp option maxseg size set %s\n }\n}\n' "$mss" "$mss" | $S nft -f -
  echo "mss clamp: $WAN mtu $mtu → tunnel MSS $mss"
}

case "${1:-status}" in
  snapshot) snapshot "${2:-baseline}" ;;
  operator) operator ;;
  nodes)
    ensure_ctl; ensure_units
    if ! command -v openvpn >/dev/null; then   # purged again by teardown
      $S DEBIAN_FRONTEND=noninteractive apt-get install -y -q openvpn >/dev/null 2>&1 && echo openvpn > "$B/apt-installed.txt" && echo "installed openvpn (temporary)"
    fi
    $S systemctl disable --now openvpn >/dev/null 2>&1
    while read -r N SVC BIT API IFACE SUBNET TPORTS IPORTS; do
      [ -n "${2:-}" ] && [ "$2" != "$N" ] && continue
      up_node "$N" "$SVC" "$BIT" "$API" "$IFACE" "$SUBNET" "$TPORTS" "$IPORTS"
    done <<< "$NODES"
    mss_clamp
    status ;;
  mss) mss_clamp ;;
  provider) ensure_ctl; up_provider ;;
  plan) ensure_ctl; up_plan ;;
  client) client "${2:-}" ;;
  client-down) client_down ;;
  loopback) shift; set_api 127.0.0.1 "$@" ;;
  public) shift; set_api "$IP" "$@" ;;
  status) status ;;
  logs) $S tail -n "${3:-40}" "$B/${2:-client}$( [ "${2:-client}" = client ] && echo .log || echo /daemon.log)" | cut -c1-400 ;;
  pull) inns curl -s -o /dev/null -w 'pulled %{size_download} B\n' --max-time 90 "https://speed.cloudflare.com/__down?bytes=${2:-2000000}" ;;
  ip) inns curl -s --max-time 15 https://api.ipify.org; echo ;;
  stop) for N in $(cut -f1 "$STATE" 2>/dev/null); do $S systemctl stop "ddv-node@$N"; done; $S systemctl stop ddv-provider 2>/dev/null; status ;;
  wind-down)   # provider side first: leases need a 2 h grace before close
    ensure_ctl
    $S systemctl stop ddv-provider 2>/dev/null   # its lease keeper would reopen what we close
    P=$(cut -f2 "$PSTATE" 2>/dev/null)
    # Re-runnable: open leases start closing; closing leases past the 7200 s grace close.
    [ -n "$P" ] && ctl lease search | python3 -c "
import sys,json,time
for x in json.load(sys.stdin):
    v=x['value']
    if v['provider']!='$P': continue
    if v['status']==0: print('start', x['address'], v['node'], v['rentPayer'])
    elif v['status']==1:
        left=int(v['closeStartedAt'])+7200-int(time.time())
        print('close' if left<=0 else 'wait', x['address'], v['node'], v['rentPayer'] if left<=0 else left)" | while read -r ACT L N R; do
      case $ACT in
        start) OUT=$(ctl lease start-close-lease --lease "$L" --provider "$P" 2>&1)
               grep -q '"signature"' <<<"$OUT" && echo "lease $L: closing" || echo "lease $L: start-close FAILED: $(echo "$OUT" | tail -1 | cut -c1-160)" ;;
        close) OUT=$(ctl lease close-lease --lease "$L" --node "$N" --provider "$P" --rent-payer "$R" 2>&1)
               grep -q '"signature"' <<<"$OUT" && echo "lease $L: closed" || echo "lease $L: close FAILED: $(echo "$OUT" | tail -1 | cut -c1-160)" ;;
        wait)  echo "lease $L: grace, $((R / 60)) min left"; continue ;;
      esac
      sleep 7
    done
    if [ -s "$PLSTATE" ]; then
      PL=$(cut -f2 "$PLSTATE")
      ctl plan delist-plan --plan "$PL" --provider "$P" >/dev/null 2>&1 && echo "plan: delisted"; sleep 7
      OUT=$(ctl plan close-plan --plan "$PL" --provider "$P" --rent-payer "$(opaddr)" 2>&1)
      if grep -q '"signature"' <<<"$OUT"; then echo "plan: closed"; $S mv -f "$PLSTATE" "$PLSTATE.closed"
      else echo "plan: close FAILED: $(echo "$OUT" | tail -1 | cut -c1-160)"; fi
    fi ;;
  close)
    ensure_ctl
    while IFS=$'\t' read -r N PDA NID SVC API; do
      $S systemctl stop "ddv-node@$N"
      ctl node delist-node --node "$PDA" >/dev/null 2>&1; sleep 7
      OUT=$(ctl node close-node --node "$PDA" --rent-payer "$(opaddr)" 2>&1)
      grep -q '"signature"' <<<"$OUT" && echo "$N: closed (bond unbonding)" || echo "$N: close FAILED: $(echo "$OUT" | tail -1)"
      sleep 7
    done < "$STATE"
    if [ -s "$PSTATE" ]; then
      $S systemctl stop ddv-provider
      P=$(cut -f2 "$PSTATE"); ctl provider delist-provider --provider "$P" >/dev/null 2>&1; sleep 7
      OUT=$(ctl provider close-provider --provider "$P" --rent-payer "$(opaddr)" 2>&1)
      grep -q '"signature"' <<<"$OUT" && echo "provider: closed" || echo "provider: close FAILED: $(echo "$OUT" | tail -1)"
    fi ;;
  withdraw)
    ensure_ctl
    ctl node unbonding search | python3 -c "
import sys,json
for x in json.load(sys.stdin):
    v=x['value']
    if v['owner']=='$(opaddr)': print(x['address'], v['amount'], v['closedAt'])" | while read -r ADDR AMOUNT CLOSED; do
      OUT=$(ctl node withdraw-node-bond --node-unbonding "$ADDR" --mint "$MINT" --vault "$VAULT" --rent-payer "$(opaddr)" 2>&1)
      grep -q '"signature"' <<<"$OUT" && echo "OK    $ADDR $AMOUNT returned" || echo "WAIT/FAIL $ADDR $(echo "$OUT" | tail -1 | cut -c1-160)"
      sleep 7
    done ;;
  teardown)
    client_down
    for N in $(cut -f1 "$STATE" 2>/dev/null); do $S systemctl stop "ddv-node@$N" 2>/dev/null; done
    $S systemctl stop ddv-provider ddv-deadman.timer 2>/dev/null
    $S rm -f /etc/systemd/system/ddv-node@.service /etc/systemd/system/ddv-provider.service; $S systemctl daemon-reload
    $S systemctl reset-failed 'ddv-*' 2>/dev/null
    for n in $($S ufw status numbered | grep "# ddv-test" | sed -E 's/^\[ *([0-9]+)\].*/\1/' | sort -rn); do $S ufw --force delete "$n" >/dev/null; done
    for i in ddv-wg0 ddv-awg0 ddv-ovpn0; do ip link show "$i" >/dev/null 2>&1 && $S ip link del "$i"; done
    for t in $($S nft list tables | awk '/dvpnd_ddv-/{print $2":"$3}'); do $S nft delete table "${t%%:*}" "${t#*:}"; done
    $S nft delete table inet ddv_mss 2>/dev/null
    if [ -f "$B/apt-installed.txt" ]; then $S DEBIAN_FRONTEND=noninteractive apt-get purge -y -q $(cat "$B/apt-installed.txt") >/dev/null 2>&1 && $S apt-get autoremove -y -q >/dev/null 2>&1; echo "purged $(cat "$B/apt-installed.txt")"; fi
    echo "teardown done (keys kept until bonds are withdrawn; then: rm -rf $B except snapshots)" ;;
  check)
    snapshot after >/dev/null; cd "$B" || exit 1; bad=0
    for f in ufw.txt nft-tables.txt ip-route.txt ip-rule.txt ip-links.txt netns.txt listening.txt services.txt dvpnd-procs.txt packages.txt; do
      if diff "snap-baseline/$f" "snap-after/$f" >/dev/null; then echo "same  $f"; else echo "DIFF  $f"; diff "snap-baseline/$f" "snap-after/$f" | head -8; bad=1; fi
    done
    [ $bad -eq 0 ] && echo "RESTORE CHECK: CLEAN" || echo "RESTORE CHECK: DIFFERENCES ABOVE" ;;
  *) echo "unknown verb $1"; exit 2 ;;
esac
