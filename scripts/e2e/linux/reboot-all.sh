#!/usr/bin/env bash
# ─── Reboot mid-session on every protocol, driven from the laptop ───
# Usage: bash reboot-all.sh <ssh-host> [protocol…]   (the VM must be idle: no queue running)
# Per protocol: reboot-test.sh pre (connect, prove the tunnel, hard reboot) → wait for SSH →
# reboot-test.sh post (service up, nothing left, direct egress, new session works).
# Results: ~/reboot/reboot.tsv on the VM. Sequential; 60 s between protocols (chain spacing).
set -u
HOST=${1:?ssh host}; shift
PROTOS=${*:-wireguard amneziawg openvpn hysteria2 v2ray xray}
declare -A NODES=(
  [wireguard]=SLVJNn38s5RfqcVW7a7A4hGKqjY7Y1bKkUpG7wrGX5D [amneziawg]=1PwMkSjnyugAZHdHvDsddETzPUAubPkeyWymT7Ercn6
  [openvpn]=9EQJ7dBwneFUse9yy8Hg56u2wPiGF5qkjAaA1ZAr64nP [hysteria2]=E8nefMLBuBzG1CrA4dSDU9mqq6ZNpv69Bt3w9QEtzvPf
  [v2ray]=Di5V9K2Vt5uptJUk7oVVnkDRXt9qWy5HhLbkEJMxEuM2 [xray]=E9RG1iZJjsLfEuLfDYTHM4yXCjyFE21jBbJLFvGoL2FD
)
. "$(dirname "$0")/nodes.sh"; nodeset_apply   # NODE_SET=node4 → that node set (nodes.sh)
ENV='export DVPN_KEYFILE=~/keys/wallet.json DVPN_DATA_DIR=~/ddv-data;'
run() { ssh -o ConnectTimeout=15 -o BatchMode=yes "$HOST" "$@" 2>&1 | grep -viE 'quantum|store now|pq\.html'; }
ssh_up() { local i; for i in $(seq 1 60); do ssh -o ConnectTimeout=8 -o BatchMode=yes "$HOST" true 2>/dev/null && return 0; sleep 5; done; return 1; }

for p in $PROTOS; do
  echo "== $p: pre"
  run "$ENV bash ~/ddvl/scripts/e2e/linux/reboot-test.sh pre $p ${NODES[$p]}"
  sleep 20   # the VM is going down
  if ! ssh_up; then echo "== $p: VM did not come back within 5 min"; exit 1; fi
  sleep 20   # let the service start
  echo "== $p: post"
  run "$ENV bash ~/ddvl/scripts/e2e/linux/reboot-test.sh post $p ${NODES[$p]}"
  # a VM renamed by a tunnelled GCE metadata reply (see handoff) gets its own name back
  run "h=\$(hostname); [ \"\$h\" = '$HOST' ] || sudo hostnamectl set-hostname '$HOST'"
  sleep 60
done
run 'cat ~/reboot/reboot.tsv'
