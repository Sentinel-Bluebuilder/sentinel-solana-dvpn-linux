#!/usr/bin/env bash
# ─── Clean-machine proof (run ON a fresh distro VM, sudo -n, detached with nohup) ───
# From a stock image with nothing of ours: apt resolves the package's dependencies, first run
# (service install, driver repair, spending permission), all six protocols, uninstall DURING a
# live kill-switch session, purge, autoremove of the pulled dependencies, reinstall after purge.
# Results: ~/clean/clean.tsv + clean.log. Usage: bash clean-install-test.sh <deb|rpm>
# Debian/Ubuntu (.deb, apt) and Fedora/EL9 (.rpm, dnf): see the package shim below.
# Env: DVPN_KEYFILE (test owner wallet). Chain txs sequential, 7 s apart.
set -u
# Debian keeps /usr/sbin off a normal user's PATH; openvpn and nft live there
export PATH="$PATH:/usr/sbin:/sbin"
DEB=$(readlink -f "${1:?deb}")
: "${DVPN_KEYFILE:?set DVPN_KEYFILE}"; export DVPN_DATA_DIR=${DVPN_DATA_DIR:-$HOME/ddv-data}
OUT=~/clean; mkdir -p "$OUT"; TSV="$OUT/clean.tsv"; : > "$TSV"; : > "$OUT/clean.log"
PASS=0; FAIL=0
NODE_IP=192.0.2.2
declare -A NODES=(
  [wireguard]=SLVJNn38s5RfqcVW7a7A4hGKqjY7Y1bKkUpG7wrGX5D [amneziawg]=1PwMkSjnyugAZHdHvDsddETzPUAubPkeyWymT7Ercn6
  [openvpn]=9EQJ7dBwneFUse9yy8Hg56u2wPiGF5qkjAaA1ZAr64nP [hysteria2]=E8nefMLBuBzG1CrA4dSDU9mqq6ZNpv69Bt3w9QEtzvPf
  [v2ray]=Di5V9K2Vt5uptJUk7oVVnkDRXt9qWy5HhLbkEJMxEuM2 [xray]=E9RG1iZJjsLfEuLfDYTHM4yXCjyFE21jBbJLFvGoL2FD
)
. "$(dirname "$0")/nodes.sh"; nodeset_apply   # NODE_SET=node4 → that node set (nodes.sh)
APT="sudo DEBIAN_FRONTEND=noninteractive apt-get"
. /etc/os-release
# ─── package shim: the same steps on Debian/Ubuntu (.deb, apt) and Fedora/EL (.rpm, dnf) ───
PKG=devnet-dvpn-linux
if command -v apt-get >/dev/null; then PM=apt; else PM=dnf; fi
# EL9 (Rocky/Alma/RHEL): openvpn is EPEL-only, so the package only recommends it and
# "repair drivers" installs it (EPEL first)
EL=0; [[ " $ID ${ID_LIKE:-} " == *' rhel '* ]] && [ "$ID" != fedora ] && EL=1
pkg_update() { if [ $PM = apt ]; then $APT update -y; else sudo dnf -y makecache; fi; }
pkg_install() { if [ $PM = apt ]; then $APT install -y "$1"; else sudo dnf -y install "$1"; fi; }
pkg_remove() { if [ $PM = apt ]; then $APT remove -y $PKG; else sudo dnf -y remove $PKG; fi; }
pkg_purge() { if [ $PM = apt ]; then $APT purge -y $PKG; else sudo dnf -y remove $PKG; fi; }
pkg_ok() { if [ $PM = apt ]; then dpkg -s $PKG | grep -q 'Status: install ok installed'; else rpm -q $PKG; fi; }
pkg_absent() { if [ $PM = apt ]; then ! dpkg -s $PKG >/dev/null 2>&1; else ! rpm -q $PKG >/dev/null 2>&1; fi; }
# after remove: dpkg keeps an rc record until purge; rpm keeps nothing
pkg_removed() { if [ $PM = apt ]; then dpkg -l $PKG | grep -qE '^(rc|un) '; else ! rpm -q $PKG >/dev/null 2>&1; fi; }
pkg_no_record() { if [ $PM = apt ]; then ! dpkg -l $PKG 2>/dev/null | grep -qE '^(ii|rc) '; else ! rpm -q $PKG >/dev/null 2>&1; fi; }
# a dependency pulled in for us is removable later (apt: marked auto; dnf: not user-installed)
pkg_dep_auto() { if [ $PM = apt ]; then apt-mark showauto 2>/dev/null | grep -qx "$1"; else ! dnf repoquery --userinstalled --qf '%{name}\n' 2>/dev/null | grep -qx "$1"; fi; }
pkg_autoremove() { if [ $PM = apt ]; then $APT autoremove -y --purge; else sudo dnf -y autoremove; fi; }
pkg_sane() { if [ $PM = apt ]; then sudo apt-get check >/dev/null; else sudo dnf -q check; fi; }
# Arch (.pkg.tar.zst, pacman): -U installs a local package and pulls its deps from the repos; -R
# removes, -Rn also drops saved configs (no rc record, like rpm); orphans = the autoremove set
if command -v pacman >/dev/null && ! command -v apt-get >/dev/null && ! command -v dnf >/dev/null; then
  PM=pacman
  pkg_update() { sudo pacman -Sy --noconfirm; }
  pkg_install() { sudo pacman -U --noconfirm "$1"; }
  pkg_remove() { sudo pacman -R --noconfirm $PKG; }
  pkg_purge() { sudo pacman -Rn --noconfirm $PKG; }
  pkg_ok() { pacman -Q $PKG; }
  pkg_absent() { ! pacman -Q $PKG >/dev/null 2>&1; }
  pkg_removed() { ! pacman -Q $PKG >/dev/null 2>&1; }
  pkg_no_record() { ! pacman -Q $PKG >/dev/null 2>&1; }
  pkg_dep_auto() { pacman -Qi "$1" 2>/dev/null | grep -q '^Install Reason *: Installed as a dependency'; }
  pkg_autoremove() { local o; o=$(pacman -Qdtq 2>/dev/null); [ -z "$o" ] || sudo pacman -Rns --noconfirm $o; }
  pkg_sane() { pacman -Dk >/dev/null; }
fi
export PM PKG APT EL
export -f pkg_update pkg_install pkg_remove pkg_purge pkg_ok pkg_absent pkg_removed pkg_no_record pkg_dep_auto pkg_autoremove pkg_sane
PRE_TOOLS='wg openvpn nft secret-tool setfacl pkexec'; [ $EL = 1 ] && PRE_TOOLS='wg nft secret-tool setfacl pkexec'
note() { printf '%s\n' "$*"; }
check() {
  local desc=$1; shift
  local out; out=$("$@" 2>&1); local code=$?
  printf '\n### %s\n$ %s\n%s\n(exit %s)\n' "$desc" "$*" "$out" "$code" >> "$OUT/clean.log"
  if [ $code = 0 ]; then PASS=$((PASS + 1)); printf 'PASS\t%s\n' "$desc" >> "$TSV"; note "ok   $desc"
  else FAIL=$((FAIL + 1)); printf 'FAIL\t%s\t%s\n' "$desc" "$(printf '%s' "$out" | tr '\n\t' '  ' | cut -c1-300)" >> "$TSV"; note "FAIL $desc :: $(printf '%s' "$out" | tail -3 | tr '\n' ' ' | cut -c1-240)"; fi
}
cli() { devnet-dvpn "$@" 2>&1 | grep -v '^\[rpc\]'; return "${PIPESTATUS[0]}"; }
gap() { sleep 7; }
egress() { curl -s -m 12 https://api.ipify.org; }
no_leftovers() {
  local t l p=0
  t=$(sudo nft list tables 2>/dev/null | grep -c 'inet dvpnd')
  l=$(ip -o link | grep -cE ' (dvpn-[a-z0-9-]+|hy2-client|ovpn-client|tun[0-9]+)[:@]')
  for pid in $(ps -eo pid=,comm= | awk '$2 ~ /^(v2ray|xray|hysteria2)$/{print $1}'); do sudo readlink "/proc/$pid/exe" 2>/dev/null | grep -q '^/usr/local/lib/devnet-dvpn/' && p=$((p + 1)); done
  for pid in $(pgrep -x openvpn); do sudo tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q '/var/lib/dvpnd/' && p=$((p + 1)); done
  echo "nft=$t links=$l procs=$p"
  [ "$t" = 0 ] && [ "$l" = 0 ] && [ "$p" = 0 ]
}
hold() { sudo touch /run/ddv-deadman.hold 2>/dev/null; }

note "== $PRETTY_NAME, kernel $(uname -r)"
DIRECT=$(egress); note "direct egress $DIRECT"

# 1. clean baseline: nothing of ours, and the tools the package depends on are missing
check 'baseline: package not installed' pkg_absent
check 'baseline: no service, no group, no CLI' bash -c "[ \"\$(systemctl show -p LoadState --value dvpnd-client)\" != loaded ] && ! getent group dvpn && ! command -v devnet-dvpn"
MISSING=$(for b in wg openvpn nft secret-tool setfacl pkexec; do command -v $b >/dev/null || printf '%s ' $b; done)
note "missing before install: ${MISSING:-none}"
printf 'INFO\tmissing before install: %s\n' "${MISSING:-none}" >> "$TSV"

# 2. install from the package: apt / dnf pulls every dependency
pkg_update >> "$OUT/clean.log" 2>&1
check "install: $PM installs the package and its dependencies" bash -c "pkg_install '$DEB' 2>&1 | tail -3; pkg_ok"
check "install: $PRE_TOOLS now present" bash -c "for b in $PRE_TOOLS; do command -v \$b >/dev/null || { echo \"missing \$b\"; exit 1; }; done"
check 'install: CLI + desktop launcher on PATH' bash -c 'command -v devnet-dvpn && command -v devnet-dvpn-desktop && test -f /usr/share/applications/devnet-dvpn-desktop.desktop'
check 'install: polkit action + dvpn group' bash -c 'test -f /usr/share/polkit-1/actions/network.sentinel.devnet-dvpn.policy && getent group dvpn'
if [ -f /proc/sys/kernel/apparmor_restrict_unprivileged_userns ] && [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)" = 1 ]; then
  check 'install: AppArmor profile loaded (userns restricted here)' bash -c 'sudo aa-status | grep -q devnet-dvpn'
fi
check 'install: CLI answers (version)' cli version

# 3. first run, in the documented order: wallet → daemon init → drivers → device setup → daemon install.
#    Out of order, every refusal must name the step that is missing (no loop).
check 'order: device setup before init names "daemon init"' bash -c 'out=$(devnet-dvpn device setup --yes 2>&1); echo "$out"; echo "$out" | grep -q "daemon init"'
check 'order: daemon install before setup names "device setup"' bash -c 'out=$(devnet-dvpn daemon install --yes 2>&1); echo "$out"; echo "$out" | grep -q "device setup"'
check 'first run: daemon init (device key, no admin)' cli daemon init
# init stages the key in the user's own folder; daemon install moves it into /var/lib/dvpnd
check 'first run: device recorded for this wallet' bash -c 'devnet-dvpn device show 2>&1 | grep -E "^Device +[1-9A-HJ-NP-Za-km-z]{32,44}"'
cli daemon drivers > "$OUT/drivers-before.txt" 2>&1; note "$(cat "$OUT/drivers-before.txt")"
KMAJ=$(uname -r | cut -d. -f1)
export KMAJ
KCORE_BEFORE=$(rpm -q kernel-core 2>/dev/null | sort | tr '\n' ' '); export KCORE_BEFORE
check 'drivers: repair-drivers (AmneziaWG via PPA + DKMS; kernel 7.x = gap L2)' bash -c 'out=$(devnet-dvpn daemon repair-drivers --yes 2>&1); c=$?; echo "$out"; [ $c = 0 ] || { [ "$KMAJ" -ge 7 ] && ! echo "$out" | grep -iE "missing|failed|incompatible" | grep -viq amnezia; }'
cli daemon drivers > "$OUT/drivers-after.txt" 2>&1; note "$(cat "$OUT/drivers-after.txt")"
AWG_OK=0; grep -qiE 'amneziawg.*(present|installed|upgraded|ready)' "$OUT/drivers-after.txt" && AWG_OK=1
export AWG_OK
printf 'INFO\tamneziawg driver after repair: %s (kernel %s)\n' "$AWG_OK" "$(uname -r)" >> "$TSV"
# dkms's kernel-devel-matched must not bring a newer kernel (Rocky 10-24: 687.59.1 added, booted next start)
# "AWG for the running kernel" = it LOADS on uname -r: built for it, or (EL9) an older kernel's module the
# kernel accepts via weak-updates (kABI match; rocky9 10-30: the 687.56.1 module loaded on 687.60.1 and the
# AWG sessions passed). A module that cannot load on this kernel (Q0308) still fails.
command -v rpm >/dev/null && [ -n "$KCORE_BEFORE" ] && check 'drivers: no new kernel installed (kernel-core unchanged), AWG loads on the running kernel' \
  bash -c 'now=$(rpm -q kernel-core | sort | tr "\n" " "); echo "before: $KCORE_BEFORE | after: $now | running: $(uname -r) | awg_ok: $AWG_OK | awg vermagic: $(modinfo -F vermagic amneziawg 2>&1 | head -1) | dkms: $(dkms status amneziawg 2>&1 | tr "\n" ";")"; [ "$AWG_OK" = 0 ] || modinfo -F vermagic amneziawg | grep -q "^$(uname -r) " || sudo -n modprobe amneziawg; echo "loaded: $(lsmod | grep -c "^amneziawg ")"; [ "$now" = "$KCORE_BEFORE" ] && { [ $AWG_OK = 0 ] || modinfo -F vermagic amneziawg | grep -q "^$(uname -r) " || lsmod | grep -q "^amneziawg "; }'
[ $EL = 1 ] && check 'drivers: openvpn installed by repair-drivers (EPEL on EL9)' bash -c 'command -v openvpn && dnf repolist --enabled | grep -qi "^epel "'
check 'drivers: wireguard + openvpn + nftables ready' bash -c "grep -iE 'wireguard|openvpn|nftables' '$OUT/drivers-after.txt' | grep -viE 'missing|failed|incompatible' | grep -c . | grep -qE '^[3-9]'"
check 'device setup: grant + fee SOL' cli device setup --allowance 50 --yes
gap
check 'first run: daemon install (service up)' cli daemon install --yes
check 'first run: service active + enabled' bash -c 'for i in $(seq 1 20); do systemctl is-active -q dvpnd-client && systemctl is-enabled -q dvpnd-client && exit 0; sleep 2; done; systemctl status dvpnd-client --no-pager | tail -5; exit 1'
check 'first run: device key published in the service home (device.pub)' bash -c 'test -s /var/lib/dvpnd/client/device.pub'
check 'first run: user can reach the socket (ACL)' bash -c 'getfacl -p /var/lib/dvpnd/client/daemon.sock 2>/dev/null | grep -q "^user:$USER:rw" || getfacl -p /var/lib/dvpnd/client 2>/dev/null | grep -q "^user:$USER:"'
check 'doctor: no FAIL' bash -c 'out=$(devnet-dvpn daemon doctor 2>&1) || { echo "$out"; exit 1; }; echo "$out"; echo "$out" | grep -qi "^ok" && ! echo "$out" | grep -qi "^fail"'
check 'status: device ready' bash -c 'devnet-dvpn device show 2>&1 | grep -q "Ready      yes"'

# 4. every protocol, per GB: egress = node, then nothing left and direct IP back
for name in wireguard amneziawg openvpn hysteria2 v2ray xray; do
  if [ $name = amneziawg ] && [ $AWG_OK = 0 ]; then printf 'SKIP\tamneziawg: driver not available on this kernel (see drivers-after.txt)\n' >> "$TSV"; note "skip amneziawg (driver)"; continue; fi
  hold
  check "$name: connect (per GB)" cli connect "${NODES[$name]}" --units 1 --yes
  via=''; case $name in v2ray|xray) via="--socks5-hostname $(devnet-dvpn proxy status --json 2>/dev/null | grep -oE '127\.0\.0\.1:[0-9]+' | head -1)" ;; esac
  check "$name: egress = node" bash -c "for i in 1 2 3; do [ \"\$(curl -s -m 12 $via https://api.ipify.org)\" = '$NODE_IP' ] && exit 0; sleep 3; done; exit 1"
  gap
  check "$name: disconnect" cli disconnect
  sleep 3
  check "$name: nothing left, direct IP back" bash -c "$(declare -f no_leftovers egress); for i in 1 2 3; do no_leftovers && [ \"\$(egress)\" = '$DIRECT' ] && exit 0; sleep 4; done; exit 1"
  gap
done

# 5. uninstall DURING a live WireGuard session with the kill switch on: networking must come back
# (switched on here: the default is off, so the table only existed where an earlier run left it on)
hold
check 'uninstall-live: WireGuard connected, kill switch table up' bash -c "devnet-dvpn daemon set --kill-switch on --yes 2>&1 | tail -1; sleep 5; devnet-dvpn connect ${NODES[wireguard]} --units 1 --yes 2>&1 | tail -1 && sudo nft list table inet dvpnd >/dev/null"
check "uninstall-live: $PM remove while connected" bash -c "pkg_remove 2>&1 | tail -3"
check 'uninstall-live: direct egress, no table/link/process left' bash -c "$(declare -f no_leftovers egress); for i in 1 2 3 4; do no_leftovers && [ \"\$(egress)\" = '$DIRECT' ] && exit 0; sleep 4; done; no_leftovers; exit 1"
check 'remove: service unit, binaries, CLI, polkit, AppArmor gone' bash -c '[ "$(systemctl show -p LoadState --value dvpnd-client)" != loaded ] && ! test -e /usr/local/lib/devnet-dvpn && ! command -v devnet-dvpn && ! test -e /usr/share/polkit-1/actions/network.sentinel.devnet-dvpn.policy && ! test -e /etc/polkit-1/rules.d/50-devnet-dvpn.rules && ! test -e /etc/apparmor.d/devnet-dvpn'
check 'remove: device key home kept' bash -c 'sudo test -s /var/lib/dvpnd/client/device.pub'
check 'remove: package removed (dpkg: rc state until purge)' pkg_removed

# 6. reinstall after remove: same device, starts without a new permission
check "reinstall: $PM install" bash -c "pkg_install '$DEB' 2>&1 | tail -2; pkg_ok"
check 'reinstall: daemon install' cli daemon install --yes
# the kill switch was switched on for the uninstall-live session and survives in the device home
check 'reinstall: kill switch back off' cli daemon set --kill-switch off --yes
check 'reinstall: service active with the same device' bash -c 'for i in $(seq 1 20); do systemctl is-active -q dvpnd-client && break; sleep 2; done; systemctl is-active -q dvpnd-client && devnet-dvpn device show 2>&1 | grep -q "Ready      yes"'

# 7. purge + autoremove: package fully gone, pulled dependencies removable, nothing broken
check "purge: $PM purge" bash -c "pkg_purge 2>&1 | tail -3"
check 'purge: no package record at all' pkg_no_record
check 'purge: nothing of ours left except the device key home' bash -c '! test -e /opt/devnet-dvpn && [ "$(systemctl show -p LoadState --value dvpnd-client)" != loaded ] && ! test -e /usr/local/lib/devnet-dvpn && ! sudo nft list table inet dvpnd >/dev/null 2>&1 && sudo test -s /var/lib/dvpnd/client/device.pub'
check 'autoremove: dependencies pulled for us are marked automatic' bash -c "pkg_dep_auto wireguard-tools || ! printf '%s' '$MISSING' | grep -q wg"
check "autoremove: $PM autoremove succeeds" bash -c "pkg_autoremove 2>&1 | tail -2"
check "autoremove: system still has a working network + $PM" bash -c "[ \"\$(curl -s -m 12 https://api.ipify.org)\" = '$DIRECT' ] && pkg_sane"

# 8. reinstall after purge: dependencies come back, service + device return
check "reinstall-after-purge: $PM install" bash -c "pkg_install '$DEB' 2>&1 | tail -2; pkg_ok"
check 'reinstall-after-purge: daemon install, same device ready' bash -c 'devnet-dvpn daemon install --yes >/dev/null 2>&1; for i in $(seq 1 20); do systemctl is-active -q dvpnd-client && break; sleep 2; done; devnet-dvpn device show 2>&1 | grep -q "Ready      yes"'
check 'reinstall-after-purge: WireGuard session works' bash -c "devnet-dvpn connect ${NODES[wireguard]} --units 1 --yes >/dev/null 2>&1; r=1; for i in 1 2 3; do [ \"\$(curl -s -m 12 https://api.ipify.org)\" = '$NODE_IP' ] && { r=0; break; }; sleep 3; done; sleep 7; devnet-dvpn disconnect >/dev/null 2>&1; exit \$r"

# 8b. optional: a plan on this fresh install (PLAN_ADDR, PLAN_PROTOCOLS), one connect per node
if [ -n "${PLAN_ADDR:-}" ]; then
  gap
  check 'plan: subscribe' cli plans subscribe "$PLAN_ADDR" --yes
  gap
  SUB=$(devnet-dvpn plans subscriptions --json 2>/dev/null | python3 -c 'import json,sys
j=json.load(sys.stdin); a=j if isinstance(j,list) else j.get("subscriptions",[])
print((a[-1].get("address") or a[-1].get("subscription")) if a else "")' 2>/dev/null)
  check 'plan: subscription listed' test -n "$SUB"
  # The plan allows PLAN_MAX servers per wallet (#31's rig plans: 2, counted over the wallet's 24 h
  # tickets). A connect past that must be REFUSED by the app with the limit message: that is the check.
  n=0
  for name in ${PLAN_PROTOCOLS:-hysteria2 v2ray xray}; do
    n=$((n + 1))
    hold
    if [ "$n" -gt "${PLAN_MAX:-2}" ]; then
      check "plan $name: server past the plan's limit is refused, with the reason" bash -c "out=\$(devnet-dvpn connect '${NODES[$name]}' --plan '$SUB' --yes 2>&1); c=\$?; echo \"\$out\"; [ \$c != 0 ] && echo \"\$out\" | grep -q 'This plan gives access on'"
      check "plan $name: refused connect left nothing behind" bash -c "$(declare -f no_leftovers egress); no_leftovers && [ \"\$(egress)\" = '$DIRECT' ]"
      gap; continue
    fi
    check "plan $name: connect --plan" cli connect "${NODES[$name]}" --plan "$SUB" --yes
    via=''; case $name in v2ray|xray) via="--socks5-hostname $(devnet-dvpn proxy status --json 2>/dev/null | grep -oE '127\.0\.0\.1:[0-9]+' | head -1)" ;; esac
    check "plan $name: egress = node" bash -c "for i in 1 2 3; do [ \"\$(curl -s -m 12 $via https://api.ipify.org)\" = '$NODE_IP' ] && exit 0; sleep 3; done; exit 1"
    gap
    check "plan $name: disconnect, nothing left, direct IP back" bash -c "devnet-dvpn disconnect >/dev/null 2>&1; sleep 3; $(declare -f no_leftovers egress); for i in 1 2 3; do no_leftovers && [ \"\$(egress)\" = '$DIRECT' ] && exit 0; sleep 4; done; exit 1"
    gap
  done
  check 'plan: close subscription' cli plans close "$SUB" --yes
fi

# 9. leave nothing on chain for this device: deposits closing (withdrawn later by the owner from
#    any machine), then the device's spending permission removed
gap
check 'teardown: settle run (deposits start closing)' cli settle run --yes
gap
check 'teardown: device revoke' cli device revoke --yes

note ''; note "clean ($ID ${VERSION_ID:-rolling}): passed $PASS  failed $FAIL  (details $OUT/clean.log)"
