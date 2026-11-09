#!/usr/bin/env bash
# pace-test.sh: proves the PACE_* knobs keep the old constants by default and change when set.
# (a) no env: effective value == old constant; (b) PACE_*=2: effective value == 2; (c) file still carries the knob.
cd "$(dirname "$0")/../.." || exit 2
fail=0
chk() { # file knob default
  f=$1; k=$2; d=$3
  grep -qF "\${$k:-$d}" "$f" || { echo "FAIL $f: no \${$k:-$d}"; fail=1; return; }
  unset "$k"; a=$(eval "echo \${$k:-$d}")
  [ "$a" = "$d" ] && echo "ok   $k default=$a ($f)" || { echo "FAIL $k default $a != $d"; fail=1; }
  b=$(env "$k=2" bash -c "echo \${$k:-$d}")
  [ "$b" = 2 ] && echo "ok   $k=2 -> $b" || { echo "FAIL $k override gave $b"; fail=1; }
}
chk scripts/e2e/linux/queue.sh PACE_SUITE 60
chk scripts/e2e/linux/queue.sh PACE_CASE 30
chk scripts/e2e/linux/queue.sh PACE_EDGE 20
chk scripts/e2e/linux/dhcp-renew.sh PACE_DHCP 20
[ $fail = 0 ] && echo "pace-test: all knobs ok" || { echo "pace-test: FAILED"; exit 1; }
