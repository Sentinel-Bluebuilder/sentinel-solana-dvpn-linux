#!/usr/bin/env bash
# ─── Test-node sets for the Linux live suites. Source it, then call nodeset_apply ───
# Every suite keeps its own ddv-node-3 block (the default). nodeset_apply rewrites whatever that
# suite uses (assoc arrays NODE / NODES, WG AWG OV HY V2 XR, NODE_IP, PLAN_ADDR) when NODE_SET
# names another set. NODE_SET unset or node3 = no change. NODE_SET=sg is handled in lib.sh.
# An unknown set, or a set whose addresses are not filled in yet, stops the suite (exit 2):
# a run against the wrong nodes must never start.
nodeset_apply() {
  local ip wg awg ov hy v2 xr plan
  case "${NODE_SET:-node3}" in
    node3|sg) return 0 ;;
    node4) # ddv-node-4 (#31, Node Manager deploy; dvpnd 18.37-rc2 since 10-28 = the RC2 proof node, node-3 = rc1 control): the SOLO node for speed/soak/latency cells (board
      # 15:25), stopped between windows. On-chain records match node-3 (memory/matrix-tools/nodecmp.sh, 13:2xZ 10-24).
      ip=192.0.2.4   # since 2026-10-28 (dvpnd 18.37-rc2, DIR FS36); was 192.0.2.5, dead
      wg=85UXF7JoeojwCe3vBEQsu8A3iBhqtggi1n828Lq84K3q; awg=6ZCHcPjGR5BRS3UdiUBasUWhDB1tueTuPWNSjuhSguWc
      ov=3d5MqELstqLGMBYSQ9bHJAvs4yxiNuWSbFaEpdez7Dwx; hy=9CtDe6P9Wt8a766R19KMFGAxTgRD2ScJfe6JZHk5NPvG
      v2=6UvrbK4pg3yuhDgd7Hf89VYqDzakDzxN63uWdncCdnQS; xr=4jpxu8c9nSc56WhfAdLZ2h3k4znmRThdxroZovmpJFuB
      plan=55yEYsyUd87AFEhLg9PuL39cfaDMktjEg74CSw8PdRzc ;;
    *) echo "nodes.sh: unknown NODE_SET '$NODE_SET' (node3 | node4 | sg)" >&2; exit 2 ;;
  esac
  if [ -z "$ip" ] || [ -z "$wg" ] || [ -z "$awg" ] || [ -z "$ov" ] || [ -z "$hy" ] || [ -z "$v2" ] || [ -z "$xr" ]; then
    echo "nodes.sh: NODE_SET=$NODE_SET has no addresses yet (scripts/e2e/linux/nodes.sh)" >&2; exit 2
  fi
  NODE_IP=$ip
  WG=$wg; AWG=$awg; OV=$ov; HY=$hy; V2=$v2; XR=$xr
  local a
  for a in NODE NODES; do
    if declare -p "$a" 2>/dev/null | grep -q '^declare -A'; then
      eval "$a[wireguard]=\$wg $a[amneziawg]=\$awg $a[openvpn]=\$ov $a[hysteria2]=\$hy $a[v2ray]=\$v2 $a[xray]=\$xr"
    fi
  done
  # a plan of that node set, unless the caller chose one
  if [ -n "$plan" ] && [ -z "${PLAN_ADDR_SET:-}" ]; then PLAN_ADDR=$plan; fi
  return 0
}
