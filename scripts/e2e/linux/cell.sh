#!/usr/bin/env bash
# ─── Unattended cell wrapper for the fleet runner (cellrun.sh): one cell type -> the right script + args ───
# Usage: bash cell.sh <installer|local|dirty|matrix|split|splitui|splitui0|uifire-ks-<openvpn|hysteria2|v2ray|xray>[-persist]|uifire-<topup|settle|restore-defaults|switch|browser>|edge|dhcprenew|pkexec|route-proof|reboot|soak|ui-smoke|clean-install>
# Resolves the package from ~/rc (this VM's arch), the wallet from ~/keys/wallet.json, then runs the
# script and prints ONE verdict line the manifest regex matches: `ok <type>` or `FAIL <type> ...`.
# A script passes when its exit code is 0 and its output has no `failed N` with N>0 / no `FAIL ` line.
# `reboot` needs an external driver (pre -> reboot -> post): it reports BLOCK, never a fake pass.
set -u
T=${1:?cell type}
CASE=${2:-}; PROTO=${3:-}
# ─── A D-Bus session for every cell ───
# cellrun-sup runs with no user bus (no linger): every gsettings/dconf write (system proxy, the app's own and the
# harness's) failed "Cannot autolaunch D-Bus without X11 $DISPLAY", silently, unless someone was logged in over SSH
# at that moment (fedora44 proxydyn 10-29 18:40Z). Re-run this cell inside its own session bus; dconf still writes
# ~/.config/dconf/user, so what one cell sets the next cell reads.
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ] && [ -z "${CELL_DBUS:-}" ]; then
  if command -v dbus-run-session >/dev/null 2>&1; then exec env CELL_DBUS=1 dbus-run-session -- bash "$0" "$@"; fi
  echo "cell: no session bus and no dbus-run-session: gsettings writes will fail (install dbus / dbus-daemon)"
fi
D=$(dirname "$(readlink -f "$0")")
RC=${CELL_RC_DIR:-$HOME/rc}
# ─── Node set: the RC node (node-4) unless the caller names another ───
# The suites default to node-3 (rc1 control) when NODE_SET is unset, and no runner ever set it, so the whole RC2
# fleet run tested against node-3 (DIR 02:4xZ). Default it HERE, in the cell, so no runner-side push can drop it.
export NODE_SET=${NODE_SET:-node4}
export DVPN_KEYFILE=${DVPN_KEYFILE:-$HOME/keys/wallet.json}
# The suites parse JSON with `node -e`. Reimaged runners have no system node, so every parse printed ''
# and topup failed "channel in status --json" (Q0291). Fall back to the app's own runtime, as its CLI does.
if ! command -v node >/dev/null 2>&1; then
  mkdir -p "$HOME/.ddv-node/bin"
  printf '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 NODE_NO_WARNINGS=1 exec /opt/devnet-dvpn/devnet-dvpn-desktop "$@"\n' > "$HOME/.ddv-node/bin/node"
  chmod +x "$HOME/.ddv-node/bin/node"
  export PATH="$HOME/.ddv-node/bin:$PATH"
  echo "cell: no system node; using the app runtime ($(node -e 'process.stdout.write(process.version)' 2>&1))"
fi
# per-VM settings that differ by host (LAN peer for the edge LAN cases); not in the repo, never overwritten by a push
[ -f "$HOME/cr/cell.env" ] && . "$HOME/cr/cell.env"
# NEWEST version, not the first name: `ls | head -1` picked 0.1.8 over 0.1.9 on lnx1, so every reinstall and
# AppImage cell there tested 0.1.8 under a 0.1.9 label (Q0222)
PKG=$(ls "$RC"/*.deb "$RC"/*.rpm "$RC"/*.pkg.tar.zst 2>/dev/null | sort -V | tail -1); APPIMG=$(ls "$RC"/*.AppImage 2>/dev/null | sort -V | tail -1)
# cells/BUILD (linux-X.Y.Z-sha) must name the package under test, or every result is mislabelled
BV=$(grep -oE '[0-9]+\.[0-9]+\.[0-9]+' "$HOME/cr/cells/BUILD" 2>/dev/null | head -1)
if [ -n "$BV" ] && [ -n "$PKG" ]; then
  case $(basename "$PKG") in *"$BV"[_.-]*) ;; *) echo "BLOCK package $(basename "$PKG") does not match BUILD $BV"; exit 3 ;; esac
fi
LOG=$(mktemp); rc=0
T0MARK=$(mktemp)   # Q0174: artifacts newer than this belong to this cell
echo "# node set: $NODE_SET" >> "$LOG"
[ -f "$DVPN_KEYFILE" ] || { echo "BLOCK no wallet at $DVPN_KEYFILE"; exit 0; }
run() { echo "# $*"; "$@" >> "$LOG" 2>&1 < /dev/null; local r=$?; [ $r -ne 0 ] && rc=$r; return 0; }
need_pkg() { [ -n "$PKG" ] || { echo "BLOCK no package in $RC"; exit 0; }; }
# dirty / clean-install / installer purge the package: every cell that needs a live daemon re-provisions first
ensure_ready() {
  if ! command -v devnet-dvpn >/dev/null 2>&1; then
    need_pkg
    if [[ $PKG == *.deb ]]; then sudo -n env DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=1200 install -y "$PKG" >> "$LOG" 2>&1; elif [[ $PKG == *.pkg.tar.zst ]]; then sudo -n pacman -U --noconfirm "$PKG" >> "$LOG" 2>&1; else sudo -n dnf -y install "$PKG" >> "$LOG" 2>&1; fi
  fi
  if ! systemctl is-active -q dvpnd-client; then
    { devnet-dvpn daemon init; devnet-dvpn daemon repair-drivers --yes; devnet-dvpn device setup --allowance 50 --yes; sleep 7; devnet-dvpn daemon install --yes; sleep 5; } >> "$LOG" 2>&1 < /dev/null
  fi
  systemctl is-active -q dvpnd-client || { echo "BLOCK dvpnd-client not active after provisioning"; exit 0; }
  # a running service is not enough: dirty/clean-install/installer revoke or replace the device, and every later
  # connect then fails 'Finish device setup first' (burned whole matrix groups on arm-deb12/fedora, Q0218)
  if ! timeout 60 devnet-dvpn device show 2>/dev/null < /dev/null | grep -qE '^Ready +yes'; then
    # clean-install/dirty wipe /var/lib/dvpnd: no device KEY either ("Device none") -> "daemon init" first, only then
    if timeout 60 devnet-dvpn device show 2>/dev/null < /dev/null | grep -qE '^Device +none'; then
      { devnet-dvpn daemon init; devnet-dvpn daemon repair-drivers --yes; } >> "$LOG" 2>&1 < /dev/null
    fi
    { devnet-dvpn device setup --allowance 50 --yes; sleep 7; devnet-dvpn daemon install --yes; sleep 5; } >> "$LOG" 2>&1 < /dev/null
    timeout 60 devnet-dvpn device show 2>/dev/null < /dev/null | grep -qE '^Ready +yes' || { echo "BLOCK device not ready after device setup"; exit 0; }
  fi
  # start every cell clean: an earlier cell's session (killed run) or the Q0239 hy2 meter table (left by a dvpnd
  # SIGKILL until 0.1.11) made the NEXT cells fail ("Disconnect the current session first", "nothing left: nft=1")
  if timeout 60 devnet-dvpn status 2>/dev/null < /dev/null | grep -qE '^Session +[^N ]'; then
    echo "# leftover session from an earlier cell: disconnecting before this cell" >> "$LOG"
    timeout 90 devnet-dvpn disconnect >> "$LOG" 2>&1 < /dev/null; sleep 3
  fi
  if sudo -n nft list table inet dvpnd_hy2 >/dev/null 2>&1; then
    echo "# Q0239 leftover 'inet dvpnd_hy2' with no session: removed before this cell" >> "$LOG"
    sudo -n nft delete table inet dvpnd_hy2 >> "$LOG" 2>&1
  fi
}
# clean-install asserts a pristine host (no package, service, dvpn group or device home): reset a provisioned VM first
fresh_state() {
  if ! command -v devnet-dvpn >/dev/null 2>&1; then
    if [[ $PKG == *.deb ]]; then sudo -n env DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=1200 install -y "$PKG" >> "$LOG" 2>&1
    elif [[ $PKG == *.rpm ]]; then sudo -n dnf -y install "$PKG" >> "$LOG" 2>&1
    else sudo -n pacman -U --noconfirm "$PKG" >> "$LOG" 2>&1; fi
  fi
  command -v devnet-dvpn >/dev/null 2>&1 && { timeout 120 devnet-dvpn device revoke --yes >> "$LOG" 2>&1 < /dev/null; sleep 7; }   # the wallet's on-chain device grant, or "device setup" says already set up
  sudo -n systemctl stop dvpnd-client >> "$LOG" 2>&1
  if command -v apt-get >/dev/null 2>&1; then sudo -n env DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=1200 purge -y devnet-dvpn-linux >> "$LOG" 2>&1
  elif command -v dnf >/dev/null 2>&1; then sudo -n dnf -y remove devnet-dvpn-linux >> "$LOG" 2>&1
  else sudo -n pacman -Rn --noconfirm devnet-dvpn-linux >> "$LOG" 2>&1; fi
  sudo -n rm -rf /var/lib/dvpnd >> "$LOG" 2>&1   # throwaway fleet VM: device key home left by earlier cells
  # staged device key + device record from an earlier init (a stale device.json made "device setup" succeed before "daemon init");
  # clean-install-test.sh runs with DVPN_DATA_DIR=~/ddv-data, other cells use the default ~/.config/Devnet dVPN
  rm -rf "${DVPN_DATA_DIR:-$HOME/ddv-data}/daemon-staging" "${DVPN_DATA_DIR:-$HOME/ddv-data}/device.json" "$HOME/.config/Devnet dVPN/device.json" "$HOME/.config/Devnet dVPN/daemon-staging" >> "$LOG" 2>&1
  if getent group dvpn >/dev/null; then sudo -n groupdel dvpn >> "$LOG" 2>&1; fi
  return 0
}
case $T in
  installer|local|matrix|matrix1|edge1|ksend|split|splitui|splitui0|uifire-*|edge|dhcprenew|pkexec|route-proof|soak|ui-smoke|reboot|archcheck) ensure_ready ;;
esac
# ─── Host guard: the cell id's distro + arch must be THIS machine's (c1-arch-reboot ran on Debian arm64, 03:56Z) ───
# Active once cellrun exports CELLRUN_CELL. c1-/c4-<distro>[-arm64]-… ; distro = arch|deb12|u2204|u2404|fedora44|rocky9
if [ -n "${CELLRUN_CELL:-}" ]; then
  . /etc/os-release 2>/dev/null
  case "${ID:-}:${VERSION_ID:-}" in
    arch:*) me=arch ;; debian:12*) me=deb12 ;; ubuntu:22.04) me=u2204 ;; ubuntu:24.04) me=u2404 ;;
    fedora:44) me=fedora44 ;; rocky:9*) me=rocky9 ;; *) me="${ID:-unknown}${VERSION_ID:-}" ;;
  esac
  [ "$(uname -m)" = aarch64 ] && me="$me-arm64"
  want=$(sed -E 's/^c[0-9]+-//; s/^((arch|deb12|u2204|u2404|fedora44|rocky9)(-arm64)?)-.*/\1/' <<<"$CELLRUN_CELL")
  [ "$want" = "$me" ] || { echo "BLOCK cell $CELLRUN_CELL is for $want, this host is $me"; exit 3; }
fi
# ─── Build guard (DIR, after Q0216/Q0224) ───
# The INSTALLED version must be the one cells/BUILD names, or the cell refuses to run (env, rc 3): no wrong-package
# result can reach the ledger. No BUILD label = refuse too. Cells that purge the package check the package file above.
installed_version() { # only an INSTALLED package counts (dpkg keeps the version of a removed one: status "rc")
  if command -v dpkg-query >/dev/null 2>&1; then dpkg-query -W -f='${db:Status-Abbrev} ${Version}\n' devnet-dvpn-linux 2>/dev/null | awk '$1 == "ii" {print $2}'
  elif command -v rpm >/dev/null 2>&1; then rpm -q --qf '%{VERSION}\n' devnet-dvpn-linux 2>/dev/null
  else pacman -Q devnet-dvpn-linux 2>/dev/null | awk '{print $2}'; fi
}
IV=$(installed_version | grep -oE '^[0-9]+\.[0-9]+\.[0-9]+' | head -1)
[ -n "$BV" ] || { echo "BLOCK no cells/BUILD label (installed ${IV:-none})"; exit 3; }
if [ -n "$IV" ] && [ "$IV" != "$BV" ]; then echo "BLOCK installed devnet-dvpn-linux $IV != BUILD $BV"; exit 3; fi
# ─── Network-cutting cells (the internal network-cutting test runbook (not published), owner: VM-only + dead-man) ───
# The dead-man must exist before the cell may cut the network; the cell keeps /run/ddv-deadman.hold fresh
# every 30 s while it lives, for at most CELL_MAX_MIN (manifest max_min, default 60). A dead or hung cell
# stops renewing, so the dead-man gives the VM its network back.
netcut=0
case "$T:$CASE" in
  matrix:*|edge:*|reboot:*|soak:*|ksend:*|matrix1:ks-on|matrix1:ks-persist|matrix1:split-ks|edge1:killdaemon|edge1:leaks|edge1:v6guard|edge1:nicflap|edge1:switch) netcut=1 ;;
esac
if [ $netcut = 1 ]; then
  systemctl is-active -q ddv-deadman.timer || sudo -n bash "$D/deadman-install.sh" >> "$LOG" 2>&1
  systemctl is-active -q ddv-deadman.timer || { echo "BLOCK ddv-deadman.timer not active (network-cutting cell refused without the dead-man)"; exit 0; }
  # Q0397: renew only while the cell makes progress: this cell's log or a suite log/tsv (~/<suite>/, written by
  # check/record) changed in the last CELL_STALL_MIN (default 8; the longest planned quiet step is the 5 min idle).
  # A cell stuck behind the kill switch writes nothing, so the hold goes stale and the dead-man frees the VM
  # (u22 10-31: renewed for 26 min while ssh was dead). The stall note goes to the journal: writing it to $LOG
  # would count as progress.
  ( cap=$(( ${CELL_MAX_MIN:-60} * 60 )); stall=${CELL_STALL_MIN:-8}; t=0; quiet=0
    while kill -0 $$ 2>/dev/null && [ $t -lt $cap ]; do
      if [ -n "$(find "$LOG" -mmin "-$stall" 2>/dev/null)$(find "$HOME" -mindepth 2 -maxdepth 2 \( -name '*.log' -o -name '*.tsv' \) -mmin "-$stall" 2>/dev/null | head -1)" ]; then
        sudo -n touch /run/ddv-deadman.hold; quiet=0
      elif [ $quiet = 0 ]; then
        logger -t ddv-cell "Q0397: no cell output for $stall min; dead-man hold no longer renewed ($T)"; quiet=1
      fi
      sleep 30; t=$((t + 30))
    done ) &
  RENEW=$!
  trap 'kill $RENEW 2>/dev/null; sudo -n rm -f /run/ddv-deadman.hold' EXIT
fi
# ─── reboot: one protocol per boot, resumed after each boot ───
# State /var/lib/ddv-cell/reboot.state = "<index> <pre|post>". The runner must re-invoke `cell.sh reboot`
# after boot while that file exists (cellrun-sup, DIR item 4). Verdict only after the last protocol.
reboot_cell() {
  local SD=${CELL_STATE_DIR:-/var/lib/ddv-cell} i stage p node protos; local SF=$SD/reboot.state
  protos=($(bash -c ". '$D/lib.sh' >/dev/null 2>&1; echo \$ALL_PROTOCOLS"))
  modinfo amneziawg >/dev/null 2>&1 || command -v awg >/dev/null || protos=(${protos[@]/amneziawg})
  sudo -n mkdir -p "$SD"
  # resume only a run of THIS build that is still fresh (a reboot takes minutes): a stale state from an older run made
  # the 03:06Z u24d cell start halfway, on another build and node (Q0235)
  local sb st; if [ -f "$SF" ]; then read -r i stage sb st < "$SF"; [ "${sb:-}" = "${BV:-none}" ] && [ $(( $(date +%s) - ${st:-0} )) -lt 1800 ] || { sudo -n rm -f "$SF"; echo "# reboot: stale state ($i $stage ${sb:-?}) ignored, fresh run" >> "$LOG"; }; fi
  if [ -f "$SF" ]; then :; else i=0; stage=pre; mkdir -p ~/reboot; [ -f ~/reboot/reboot.tsv ] && mv ~/reboot/reboot.tsv ~/reboot/reboot.tsv.$(date +%s); fi
  while [ "$i" -lt "${#protos[@]}" ]; do
    p=${protos[$i]}; node=$(bash -c ". '$D/lib.sh' >/dev/null 2>&1; echo \${NODE[$p]}")
    if [ "$stage" = post ]; then
      bash "$D/reboot-test.sh" post "$p" "$node" >> "$LOG" 2>&1; i=$((i + 1)); stage=pre
      echo "$i pre ${BV:-none} $(date +%s)" | sudo -n tee "$SF" >/dev/null; sleep 7; continue
    fi
    echo "$i post ${BV:-none} $(date +%s)" | sudo -n tee "$SF" >/dev/null; sync
    bash "$D/reboot-test.sh" pre "$p" "$node"   # asks for a reboot; 'systemctl reboot' returns before the VM goes down
    sleep 300                                   # the reboot kills us here; still alive after 5 min = it never happened
    rec_fail="pre step returned without a reboot ($p)"; echo "FAIL $rec_fail" >> "$LOG"; sudo -n rm -f "$SF"; return
  done
  sudo -n rm -f "$SF"
  cat ~/reboot/reboot.tsv >> "$LOG"
  grep -q '^PASS' ~/reboot/reboot.tsv && ! grep -q '^FAIL' ~/reboot/reboot.tsv || rc=96
}
# the app data folder whose device.json records the daemon's CURRENT device. VMs differ: deba had it only in the
# default folder, lane-A VMs in ~/ddv-data with a stale record in the default one -> 'Run "device setup --yes" first'.
# GUI cells need it too: with the wrong folder the app sees no device and stays on setup ("step: permission").
app_data_dir() {
  local dev c; dev=$(sudo -n cat /var/lib/dvpnd/client/device.pub 2>/dev/null)
  for c in "${DVPN_DATA_DIR:-}" "$HOME/.config/Devnet dVPN" "$HOME/ddv-data"; do
    [ -n "$c" ] && [ -n "$dev" ] && grep -q "\"device\": *\"$dev\"" "$c/device.json" 2>/dev/null && { echo "$c"; return; }
  done
  echo "$HOME/.config/Devnet dVPN"
}
case $T in
  installer) need_pkg; [ -n "$APPIMG" ] || { echo "BLOCK no AppImage in $RC"; exit 0; }
    dd=$(app_data_dir); echo "# installer data folder: $dd" >> "$LOG"
    DVPN_DATA_DIR=$dd run bash "$D/installer-test.sh" "$PKG" "$APPIMG" ;;
  local) run bash "$D/cli-sweep.sh" local ;;
  dirty) need_pkg; run bash "$D/dirty-test.sh" "$PKG" ;;
  clean-install) need_pkg; fresh_state; run bash "$D/clean-install-test.sh" "$PKG" ;;
  matrix) for c in pay-gb pay-hour topup adopt dns ks-on ks-persist split-ks reconnect; do run bash "$D/matrix.sh" "$c"; sleep 7; done ;;
  matrix1) # ONE matrix case x ONE protocol; unknown case/protocol is a FAIL, never a vacuous pass
    [[ " pay-gb pay-hour topup adopt dns ks-on ks-persist split-ks reconnect " == *" $CASE "* && " wireguard amneziawg openvpn hysteria2 v2ray xray " == *" $PROTO "* ]] || { echo "FAIL $T:$CASE:$PROTO (unknown case/protocol)"; exit 0; }
    run bash "$D/matrix.sh" "$CASE" "$PROTO" ;;
  edge1) # ONE edge case (all its protocols); unknown case is a FAIL
    grep -qE "^    $CASE\)" "$D/edge.sh" || { echo "FAIL $T:$CASE (unknown case)"; exit 0; }
    # LAN cases need a second VM on this VM's private network (~/cr/cell.env): none configured = env, not a product FAIL
    case $CASE in
      allowlan) [ -n "${LAN_PEER:-}" ] || { echo "BLOCK $T:$CASE needs LAN_PEER (set it in ~/cr/cell.env)"; exit 3; } ;;
      outsidein|laninbound) [ -n "${LAN_PEER_SSH:-}" ] && [ -f ~/.ssh/ddv_lan ] || { echo "BLOCK $T:$CASE needs LAN_PEER_SSH + ~/.ssh/ddv_lan (~/cr/cell.env)"; exit 3; } ;;
    esac
    # EDGE_SINGLE=1: a dead LAN peer may mark this one-case cell env (BLOCK); the full edge suite never does
    run env EDGE_SINGLE=1 bash "$D/edge.sh" "$CASE" ;;
  ksend) # Q0353: KS on, the deposit runs out by itself -> inet dvpnd stays, no v4/v6 egress for 30 s, reason logged
    [ -n "$CASE" ] || { echo "BLOCK ksend needs a protocol (cell args: ksend <protocol>)"; exit 3; }
    run bash "$D/ks-end.sh" "$CASE" ;;
  split) run bash "$D/split-test.sh" ;;
  splitui0) # Q0271 proof (combined build only): edit the Split page with NO settle wait; RC3 drops the edits
    dd=$(app_data_dir); echo "# app data folder: $dd (no settle wait)" >> "$LOG"; UI_SETTLE=0 DVPN_DATA_DIR=$dd run bash "$D/split-ui.sh" split wireguard ;;
  splitui) dd=$(app_data_dir); echo "# app data folder: $dd" >> "$LOG"; DVPN_DATA_DIR=$dd run bash "$D/split-ui.sh" split wireguard ;;
  edge) for c in refusal connfail nicflap rpcdown switch allowlan laninbound leaks localnet; do run bash "$D/edge.sh" "$c"; sleep 7; done ;;
  # dhcp-renew.sh defaults to ~/ddv-data; right after the installer cell (device set up again in the default
  # folder) that record is stale and both connects fail (c4-rocky9-dhcprenew 10-29 12:46, 61 s after installer)
  dhcprenew) dd=$(app_data_dir); echo "# app data folder: $dd" >> "$LOG"; DVPN_DATA_DIR=$dd run bash "$D/dhcp-renew.sh" ;;
  pkexec) run bash "$D/pkexec-gui.sh" ;;
  uifire-ks-dead-*) # FLX's Q0304 proof (uifire.sh), NOT split-ui.sh: must come before uifire-ks-* or "dead-xray" lands there as a protocol
    c=${T#uifire-}; dd=$(app_data_dir); echo "# app data folder: $dd; uifire $c" >> "$LOG"; DVPN_DATA_DIR=$dd run bash "$D/uifire.sh" "$c" ;;
  uifire-ks-*) # owner order: the Kill switch page FIRED end to end (mode + Apply/confirm, connect, protocol killed
    # -> "Blocking internet", Restore network on the page -> direct, mode Off). Name: uifire-ks-<proto>[-persist]
    k=${T#uifire-ks-}; p=${k%-persist}; m=on; [ "$k" != "$p" ] && m=persist
    dd=$(app_data_dir); echo "# app data folder: $dd; kill switch $m on $p" >> "$LOG"; DVPN_DATA_DIR=$dd run bash "$D/split-ui.sh" ks "$p" "$m" ;;
  uifire-install-service) run bash "$D/uifire-install.sh" ;;   # GUI Install service through polkit (non-sudo ddvdesk); never in parallel with pkexec on a lane
  uifire-*) # FLX uifire.sh: click, Confirm, one effect checked from outside the window, undo (topup settle restore-defaults switch browser …)
    c=${T#uifire-}; dd=$(app_data_dir); echo "# app data folder: $dd; uifire $c" >> "$LOG"; DVPN_DATA_DIR=$dd run bash "$D/uifire.sh" "$c" ;;
  route-proof) run bash "$D/route-proof.sh" ;;
  soak) run bash "$D/soak.sh" 120 ;;
  ui-smoke) dd=$(app_data_dir); echo "# app data folder: $dd" >> "$LOG"; DVPN_DATA_DIR=$dd run bash "$D/ui-smoke.sh" dark; DVPN_DATA_DIR=$dd run bash "$D/ui-smoke.sh" light ;;
  reboot) reboot_cell ;;
  archcheck) # ARM64 VMs: the installed package and EVERY bundled binary must be this machine's arch (an x64 build must not pass by emulation)
    want=$(uname -m); n=0
    for f in /usr/local/lib/devnet-dvpn/* /opt/devnet-dvpn/devnet-dvpn-desktop; do
      [ -f "$f" ] && file -bL "$f" | grep -q ELF || continue; n=$((n + 1))
      file -bL "$f" | grep -qiE "$( [ "$want" = aarch64 ] && echo 'aarch64|ARM aarch64' || echo 'x86-64' )" || { echo "FAIL archcheck: $f is not $want: $(file -bL "$f" | cut -c1-80)" >> "$LOG"; rc=95; }
    done
    [ $n -gt 0 ] || { echo "FAIL archcheck: no ELF binaries found (package not installed?)" >> "$LOG"; rc=95; }
    if command -v dpkg >/dev/null; then pa=$(dpkg-query -W -f '${Architecture}' devnet-dvpn-linux 2>/dev/null); [ "$pa" = "$(dpkg --print-architecture)" ] || { echo "FAIL archcheck: package arch '$pa' != host $(dpkg --print-architecture)" >> "$LOG"; rc=95; }; fi
    timeout 20 /usr/local/lib/devnet-dvpn/dvpnd version >> "$LOG" 2>&1 || { echo "FAIL archcheck: bundled dvpnd does not run" >> "$LOG"; rc=95; }
    echo "archcheck: $n ELF binaries checked for $want" >> "$LOG"
    # final-pass effect line (DRIVER/INSTALL shape), from the system: installed version + whether every binary matched
    iv=$(dpkg-query -W -f '${Version}' devnet-dvpn-linux 2>/dev/null || rpm -q --qf '%{VERSION}' devnet-dvpn-linux 2>/dev/null || pacman -Q devnet-dvpn-linux 2>/dev/null | awk '{print $2}')
    echo "info archcheck: package installed version ${iv:-none}, $n binaries arch $want $([ "${rc:-0}" = 0 ] && echo True || echo False)" >> "$LOG" ;;
  *) echo "BLOCK unknown cell type $T"; exit 0 ;;
esac
# Q0174: the cell's own text artifacts (result tables, scenario/errors JSON, diag) go into the log, so the
# copy the cell runner posts to the control host carries them and nobody has to reach the runner to grade. Screenshots stay local.
{ find ~/ui ~/edge ~/matrix ~/split ~/sweep ~/soak ~/egress-diag.log -newer "$T0MARK" -type f \
    \( -name '*.tsv' -o -name '*.json' -o -name '*.csv' -o -name '*.txt' -o -name 'egress-diag.log' \) -size -64k 2>/dev/null \
    | grep -vE '/(money\.jsonl|node_modules)' | head -30 | while read -r f; do
      # "| " on every line: no artifact line can start with FAIL/BLOCK/ok and change the cell's verdict
      echo "== artifact $f ($(wc -c < "$f") bytes)"; head -c 16384 "$f" | sed 's/^/| /'; echo; done; } >> "$LOG" 2>/dev/null
rm -f "$T0MARK"
cat "$LOG"
LBL=$T${CASE:+:$CASE}${PROTO:+:$PROTO}
# ks-end.sh writes its own BLOCK lines into ~/ks-end/<p>.log, not stdout: surface them so a never-ended session is env
[ "$T" = ksend ] && grep -h '^BLOCK' ~/ks-end/*.log 2>/dev/null | head -2 >> "$LOG"
case $T in matrix1|edge1|ksend) grep -Eq 'passed [1-9][0-9]* +failed 0' "$LOG" || rc=97 ;; esac
if grep -Eq '^BLOCK' "$LOG"; then echo "no verdict line for $LBL: a BLOCK above (env, nothing tested)"   # an "ok" here would beat cellrun's BLOCK -> env rule
elif [ $rc -eq 0 ] && ! grep -Eq '^FAIL |passed [0-9]+ +failed [1-9]|failed [1-9][0-9]*$' "$LOG"; then echo "ok $LBL"; else echo "FAIL $LBL (rc=$rc)"; fi
