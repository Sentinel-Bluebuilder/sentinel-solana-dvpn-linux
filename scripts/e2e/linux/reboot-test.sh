#!/usr/bin/env bash
# ─── Reboot in the middle of a session (power loss / crash of the whole machine) ───
# Run ON a disposable test VM, one step per call, driven from the laptop:
#   bash reboot-test.sh pre <protocol> <node>   connect per GB, prove the tunnel, reboot NOW
#   bash reboot-test.sh post <protocol> <node>  after boot: service up, nothing left, direct
#                                               egress, status sane, and a NEW session works
# Results append to ~/reboot/reboot.tsv (PASS/FAIL <tab> check). Env: DVPN_KEYFILE, DVPN_DATA_DIR.
# Before ddv10.1 a WireGuard/AmneziaWG reboot left dvpnd unable to start (wgcore cleanup).
set -u
STEP=${1:?pre|post}; PROTO=${2:?protocol}; NODE=${3:?node}
OUT=~/reboot; mkdir -p "$OUT"; TSV="$OUT/reboot.tsv"
CLI=devnet-dvpn
cli() { $CLI "$@" 2>&1 | grep -v '^\[rpc\]'; return "${PIPESTATUS[0]}"; }
rec() { printf '%s\t%s\t%s\n' "$1" "$PROTO: $2" "$(printf '%s' "${3:-}" | tr '\n\t' '  ' | cut -c1-200)" >> "$TSV"; echo "$1 $PROTO: $2"; }
check() { local d=$1; shift; local o; if o=$("$@" 2>&1); then rec PASS "$d" "$o"; else rec FAIL "$d" "$o"; fi; }
egress() { curl -s -m 12 https://api.ipify.org; }
# F-C1-2: one probe 5 s after Connected was too strict (the sweeps retry 3x; this did not), and a
# failure logged nothing. Retry with backoff (~60 s), return the first answer.
probe() { local v=$1 i ip; for i in 1 2 3 4 5 6; do ip=$(curl -s -m 12 $v https://api.ipify.org); [ -n "$ip" ] && { echo "$ip"; return 0; }; sleep $((i*2)); done; return 1; }
# On a failed probe keep the evidence: route, DNS, resolver, link, dvpnd state and a verbose curl.
snap() { local f="$OUT/fail-$PROTO-$1.log"; {
  echo "== $(date -u +%FT%TZ) $PROTO $1"; ip route; ip -4 addr; resolvectl status 2>&1 | head -30
  cat /etc/resolv.conf; $CLI status 2>&1 | grep -v '^\[rpc\]'; systemctl is-active network-online.target
  curl -sv -m 12 $(via) https://api.ipify.org 2>&1 | tail -20
  sudo journalctl -u dvpnd-client --no-pager -n 40 2>&1; } >> "$f" 2>&1; }
via() { case $PROTO in v2ray|xray) echo "--socks5-hostname $($CLI proxy status --json 2>/dev/null | grep -oE '127\.0\.0\.1:[0-9]+' | head -1)" ;; esac; }
leftovers() { # our links, nft tables, protocol processes
  ip -o link | grep -oE ' (dvpn-[a-z0-9-]+|hy2-client|ovpn-client)[:@]' | tr -d ' :@'
  sudo nft list tables 2>/dev/null | grep -E 'dvpnd|quick-dvpn'
  # not `pgrep -ax 'a|b|c'`: procps 4 checks the WHOLE pattern against the 15-char name limit -> always zero matches
  # (warning on stdout = a blind check that passed whatever ran)
  ps -eo pid=,comm= | awk '$2 ~ /^(hysteria2|v2ray|xray|openvpn)$/'
}

if [ "$STEP" = pre ]; then
  # A full tunnel can cut the SSH session that runs this (Hysteria2 on u2404-arm: the reply to the
  # admin IP goes into the TUN's own table and strict rp_filter drops it). Then SIGHUP killed this
  # script before the reboot and the VM sat in the session. So: ignore HUP, log to a file, and arm
  # a fallback reboot before connecting.
  trap '' HUP PIPE
  exec >> "$OUT/pre.log" 2>&1
  sudo systemd-run --on-active=180 --unit "ddv-reboot-fallback-$RANDOM" /usr/bin/systemctl reboot --force >/dev/null 2>&1
  egress > "$OUT/direct-ip"
  sudo touch /run/ddv-deadman.hold
  if ! cli connect "$NODE" --units 1 --yes; then rec FAIL 'connect before reboot'; exit 1; fi
  sleep 5
  ip=$(probe "$(via)")
  if [ -n "$ip" ] && [ "$ip" != "$(cat "$OUT/direct-ip")" ]; then rec PASS "tunnel up before reboot ($ip)"; else snap pre; rec FAIL 'tunnel up before reboot' "$ip (see ~/reboot/fail-$PROTO-pre.log)"; fi
  sync
  sudo systemctl reboot --force   # no clean stop of dvpnd: like a power cut for the service
  exit 0
fi

# post
DIRECT=$(cat "$OUT/direct-ip" 2>/dev/null)
check 'dvpnd running after boot' bash -c 'for i in $(seq 1 30); do systemctl is-active -q dvpnd-client && exit 0; sleep 2; done; systemctl status dvpnd-client --no-pager | tail -5; exit 1'
check 'dvpnd not restart-looping' bash -c '[ "$(systemctl show dvpnd-client -p NRestarts --value)" -le 1 ]'
check 'status answers, no session' bash -c "$CLI status 2>&1 | grep -E '^Session +Not connected'"
check 'nothing of the old session left' bash -c "$(declare -f leftovers); [ -z \"\$(leftovers)\" ]"
check "egress direct ($DIRECT)" bash -c "[ \"\$(curl -s -m 12 https://api.ipify.org)\" = '$DIRECT' ]"
sleep 7
# wait for the network to be online (bounded) so a product race is told apart from a harness race
timeout 60 bash -c 'until systemctl is-active -q network-online.target; do sleep 2; done' || echo "network-online.target not active after 60 s" >> "$OUT/post.log"
sudo touch /run/ddv-deadman.hold
if co=$(cli connect "$NODE" --units 1 --yes); then
  sleep 5
  ip=$(probe "$(via)")
  if [ -n "$ip" ] && [ "$ip" != "$DIRECT" ]; then rec PASS "new session after reboot works ($ip)"; else snap post; rec FAIL 'new session after reboot works' "$ip (see ~/reboot/fail-$PROTO-post.log)"; fi
  sleep 7
  cli disconnect >/dev/null; sleep 3
  check 'disconnect: direct again, nothing left' bash -c "$(declare -f leftovers); [ -z \"\$(leftovers)\" ] && [ \"\$(curl -s -m 12 https://api.ipify.org)\" = '$DIRECT' ]"
else
  snap post; rec FAIL 'new session after reboot works' "connect failed: $co"   # the error, not just "failed"
fi
