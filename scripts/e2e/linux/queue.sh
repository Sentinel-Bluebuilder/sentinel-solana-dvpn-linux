#!/usr/bin/env bash
# ─── queue: THE PROOF on one test VM, every suite back to back, unattended (run ON the VM) ───
# Each step runs to the end whatever the one before did; ~/queue/queue.tsv gets one line per
# step (DONE/ERR <tab> step <tab> rc <tab> summary) and ~/queue/state the step running now.
# Usage: setsid nohup bash queue.sh <pkg> <AppImage> <step>... > ~/queue/run.out 2>&1 < /dev/null &
# Steps: clean fp-before fp-after dirty installer rig ready local daemon spend cover ui
#        matrix matrix:<case> split splitui edge edge:<case> dhcprenew soak   (default: everything after clean; `ready` before
#        installer, which needs the service installed)
# Env: DVPN_KEYFILE (test wallet), LAN_PEER (another VM ip:port for edge allowlan),
#      ADMIN_IP (keeps SSH from the laptop off the tunnel), SOAK_MIN (default 120).
set -u
export PATH="$PATH:/usr/sbin:/sbin"
PKG=$(readlink -f "${1:?package}"); APPIMAGE=$(readlink -f "${2:?AppImage}"); shift 2
: "${DVPN_KEYFILE:?set DVPN_KEYFILE}"; export DVPN_KEYFILE DVPN_DATA_DIR=${DVPN_DATA_DIR:-$HOME/ddv-data}
E=$(cd "$(dirname "$0")" && pwd)
Q=~/queue; mkdir -p "$Q"; TSV="$Q/queue.tsv"; touch "$TSV"
# rig first (Xvfb, keyring, Chromium: ui, AppImage and the local keyring wallet need them);
# installer-test starts from an installed, running service (dirty leaves the package removed)
STEPS=("$@"); [ ${#STEPS[@]} -gt 0 ] || STEPS=(rig dirty ready installer ready local daemon spend cover ui matrix split splitui edge soak)
if command -v apt-get >/dev/null; then PM=apt; elif command -v dnf >/dev/null; then PM=dnf; else PM=pacman; fi
PKGNAME=devnet-dvpn-linux
pkg_install() { case $PM in apt) sudo DEBIAN_FRONTEND=noninteractive apt-get install --reinstall -y "$PKG" ;; dnf) sudo dnf -y install "$PKG" || sudo dnf -y reinstall "$PKG" ;; pacman) sudo pacman -U --noconfirm "$PKG" ;; esac; }
pkg_purge() { case $PM in apt) sudo DEBIAN_FRONTEND=noninteractive apt-get purge -y $PKGNAME ;; dnf) sudo dnf -y remove $PKGNAME ;; pacman) sudo pacman -Rns --noconfirm $PKGNAME ;; esac; }
# apt only: dnf remove (clean_requirements_on_remove) and pacman -Rns already drop unused deps.
pkg_autoremove() { [ $PM = apt ] || return 0; sudo DEBIAN_FRONTEND=noninteractive apt-get autoremove -y --purge; }
pkg_present() { case $PM in apt) dpkg -s $PKGNAME 2>/dev/null | grep -q 'Status: install ok installed' ;; dnf) rpm -q $PKGNAME >/dev/null ;; pacman) pacman -Q $PKGNAME >/dev/null 2>&1 ;; esac; }

# Between steps (and between edge cases) the machine must have direct internet. A case that leaves
# it dead (deb12-arm 2026-10-22 23:19: 40 min of edge results were all "network unreachable", and the
# deadman stayed quiet because every step re-touches its hold file) would void everything after it.
# So: check, repair (restore-network, drop the test table, re-run DHCP), and record either way.
net_ok() { curl -4 -s -m 8 -o /dev/null https://1.1.1.1 || curl -4 -s -m 8 -o /dev/null https://www.google.com; }
net_guard() {   # <where>
  net_ok && return 0
  local nic; nic=$(ip -4 route show default | awk '{print $5; exit}'); nic=${nic:-$(ip -o link | awk -F': ' '$2 !~ /^(lo|dvpn|wg|awg|tun|hy2|ovpn)/ {print $2; exit}')}
  { echo "## net_guard before $1 $(date -u +%TZ) (nic $nic)"; ip -o link; ip -4 addr; ip -4 route; ip rule; sudo nft list tables
    systemctl is-active -q systemd-networkd && networkctl status "$nic" --no-pager 2>&1 | sed -n '1,15p'; } >> "$Q/net-guard.log" 2>&1
  devnet-dvpn daemon restore-network >> "$Q/net-guard.log" 2>&1
  sudo nft delete table inet ddvtest 2>/dev/null
  sudo ip link set dev "$nic" up 2>/dev/null
  # 1st try: re-run the host's DHCP client; 2nd try (deb12-arm: networkd kept the NIC address-less
  # after a reconfigure): restart the whole network service
  local try; for try in 1 2; do
    if systemctl is-active -q systemd-networkd; then [ $try = 1 ] && sudo networkctl reconfigure "$nic" || sudo systemctl restart systemd-networkd
    elif systemctl is-active -q NetworkManager; then [ $try = 1 ] && sudo nmcli device reapply "$nic" || sudo systemctl restart NetworkManager
    else sudo systemctl restart "dhclient@$nic" 2>/dev/null || sudo dhcpcd -n "$nic" 2>/dev/null; fi >> "$Q/net-guard.log" 2>&1
    for _ in $(seq 1 9); do sleep 5; net_ok && break 2; done
    echo "try $try did not bring it back" >> "$Q/net-guard.log"
  done
  if net_ok; then printf 'NET-REPAIRED\t%s\t-\t%s\tdirect internet was gone; restore-network + DHCP brought it back (see net-guard.log)\n' "$1" "$(date -u +%TZ)" >> "$TSV"
  else printf 'NET-DEAD\t%s\t-\t%s\tdirect internet still gone after repair (see net-guard.log)\n' "$1" "$(date -u +%TZ)" >> "$TSV"; return 1; fi
}

# summary line of a finished suite (each prints "<name>: passed N  failed M" or similar)
summ() { tail -n 40 "$1" 2>/dev/null | grep -iE 'passed [0-9]+ +failed [0-9]+|PASS [0-9]+|exit=|errors.json' | tail -n 2 | tr '\n' ' '; }
step() {
  local name=$1; shift
  net_guard "$name"
  echo "$name $(date -u +%FT%TZ)" > "$Q/state"
  local out="$Q/$name.out"
  "$@" > "$out" 2>&1 < /dev/null; local rc=$?
  printf '%s\t%s\t%s\t%s\t%s\n' "$([ $rc = 0 ] && echo DONE || echo ERR)" "$name" "$rc" "$(date -u +%TZ)" "$(summ "$out")" >> "$TSV"
  sleep "${PACE_SUITE:-60}"   # suites never back to back on chain (60 s+ between suites)
}

# installed + service up + device ready, whatever state the step before left
ready() {
  pkg_present || pkg_install || return 1
  devnet-dvpn daemon init 2>&1 | tail -n 2
  devnet-dvpn daemon drivers 2>&1 | grep -qiE 'missing|incompatible' && devnet-dvpn daemon repair-drivers --yes 2>&1 | tail -n 3
  devnet-dvpn device show 2>&1 | grep -q 'Ready      yes' || { devnet-dvpn device setup --allowance 50 --yes 2>&1 | tail -n 3; sleep 7; }
  systemctl is-active -q dvpnd-client || devnet-dvpn daemon install --yes 2>&1 | tail -n 3
  for i in $(seq 1 30); do systemctl is-active -q dvpnd-client && devnet-dvpn device show 2>&1 | grep -q 'Ready      yes' && return 0; sleep 2; done
  devnet-dvpn device show 2>&1; return 1
}
rig() {   # desktop bits for ui / splitui / pkexec (after the clean + fingerprint steps)
  case $PM in
    apt) sudo DEBIAN_FRONTEND=noninteractive apt-get install -y xvfb xauth dbus-x11 at-spi2-core gnome-keyring libsecret-tools imagemagick xdotool tcpdump dnsutils jq curl ;;
    dnf) sudo dnf -y install xorg-x11-server-Xvfb xauth dbus-x11 at-spi2-core gnome-keyring libsecret ImageMagick xdotool tcpdump bind-utils jq curl ;;
    pacman) sudo pacman -S --needed --noconfirm xorg-server-xvfb xorg-xauth at-spi2-core gnome-keyring libsecret imagemagick xdotool tcpdump bind jq curl ;;
  esac
  # node (cli-sweep makes its throwaway key with it) + a browser for `proxy browser`
  # (Google Chrome has no Linux arm64 build; Ubuntu ships Chromium only as a snap)
  case $PM in
    apt) sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
         if apt-cache policy chromium 2>/dev/null | grep -q 'Candidate: [0-9]'; then sudo DEBIAN_FRONTEND=noninteractive apt-get install -y chromium; else sudo snap install chromium; fi ;;
    dnf) sudo dnf -y install nodejs chromium ;;
    pacman) sudo pacman -S --needed --noconfirm nodejs chromium ;;
  esac
  # AppImage runtime (FUSE 2). On dnf, fusermount is in "fuse"; with fuse-libs alone the AppImage
  # failed "fuse: failed to exec fusermount" (Fedora 44, exit 127).
  case $PM in apt) sudo DEBIAN_FRONTEND=noninteractive apt-get install -y libfuse2t64 || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y libfuse2 ;; dnf) sudo dnf -y install fuse fuse-libs ;; pacman) sudo pacman -S --needed --noconfirm fuse2 ;; esac
}
# Kept on purpose after purge: the device home /var/lib/dvpnd (on-chain device + its SOL; a
# reinstall reuses it), the dvpn group that owns it (deleting it would leave a dangling gid) and
# the VPN drivers repair-drivers added (docs/INSTALLER.md: kept on remove; AmneziaWG tools + DKMS
# module, awg-quick unit) plus the VPN kernel modules the sessions loaded (ddv-plat-arch fp-after).
# Fedora/EL add: dkms.service (comes with the AmneziaWG DKMS build); on EL9 OpenVPN is not an rpm
# dependency (EPEL only), so repair-drivers installs it and the EPEL repo files, and both stay
# (Rocky 9 run 5). run-p…-i….service (Fedora 44, systemd 259) and run-r<hex>.service (EL9, systemd
# 252: dnf's man-db-cache-update after the purge, Rocky 16.29 run) = transient systemd-run units, not package changes.
FP_KEEP='^[<>] (dvpn:x:[0-9]+:|.*/var/lib/dvpnd|awg(-quick)? |awg-quick@\.service |amneziawg(/| *$)|(wireguard|tun|udp_tunnel|ip6_udp_tunnel) *$|dkms\.service |openvpn |openvpn-(client|server)@\.service |epel[-a-z0-9]*\.repo$|/etc/apt/sources\.list\.d/amnezia-ubuntu-ppa-[a-z]+\.(list|sources)$|run-(p[0-9]+-i[0-9]+|r[0-9a-f]{32})\.service( |$))'
fp_after() {   # full lifecycle done → purge → the machine must look like the stock snapshot
  pkg_present && pkg_purge
  # clean ends with a reinstall, so a purge alone leaves the dependencies the package pulled in
  # (openvpn, packagekit, gsettings schemas … Ubuntu 22.04 final 16.30 Q1b): remove them the way a
  # user would (clean-install-test proves autoremove keeps a working system). Ubuntu's ppa:amnezia
  # list file (repair-drivers, AmneziaWG DKMS) stays with the drivers, like EPEL on EL.
  pkg_autoremove
  bash "$E/fingerprint.sh" snap ~/fp/after.txt || return 1
  bash "$E/fingerprint.sh" diff ~/fp/before.txt ~/fp/after.txt "$FP_KEEP" > ~/fp/diff.txt; local rc=$?
  cat ~/fp/diff.txt; return $rc
}
ui_both() { local rc=0; for t in dark light; do bash "$E/ui-smoke.sh" $t || rc=1; echo "errors.json: $(cat ~/ui/$t/errors.json 2>/dev/null)"; ls ~/ui/$t | grep -c png; done; return $rc; }
matrix_all() { local rc=0; for c in pay-gb pay-hour topup adopt dns ks-on ks-persist split-ks reconnect; do mkdir -p ~/matrix; bash "$E/matrix.sh" $c > ~/matrix/$c.out 2>&1 || rc=1; echo "$c: $(cut -f1 ~/matrix/$c.tsv 2>/dev/null | sort | uniq -c | tr '\n' ' ')"; sleep "${PACE_CASE:-30}"; done; return $rc; }
# ks cases kill the protocol process: user-space tunnels only (WireGuard/AmneziaWG are kernel
# tunnels with no process; matrix ks-on covers them)
splitui_all() { local rc=0; mkdir -p ~/ui; for p in wireguard amneziawg openvpn hysteria2; do bash "$E/split-ui.sh" split $p > ~/ui/split-$p.out 2>&1 || rc=1; echo "split $p: $(tail -n 1 ~/ui/split-$p.out)"; done; for p in openvpn hysteria2; do bash "$E/split-ui.sh" ks $p on > ~/ui/ks-$p.out 2>&1 || rc=1; echo "ks $p: $(tail -n 1 ~/ui/ks-$p.out)"; done; bash "$E/split-ui.sh" ks xray persist > ~/ui/ks-xray.out 2>&1 || rc=1; echo "ks xray persist: $(tail -n 1 ~/ui/ks-xray.out)"; return $rc; }
edge_all() { local rc=0; mkdir -p ~/edge; for c in refusal connfail nicflap rpcdown switch allowlan laninbound lanv6 localnet ufw leaks killdaemon doctor drivers dnspresets proxydyn porttaken netem udpblock mtu races idle confwipe dnsgone ownvpn fuzz; do net_guard "edge:$c"; bash "$E/edge.sh" $c > ~/edge/$c.out 2>&1 || rc=1; echo "$c: $(tail -n 1 ~/edge/$c.out)"; sleep "${PACE_EDGE:-20}"; done; return $rc; }

# A suite stopped mid-case (VM reset, queue killed) leaves its own test table `inet ddvtest`,
# which drops the node host: every connect after it then fails "Node is not reachable"
# (arm64 Debian 12, 2026-10-22: 16 spend FAILs). It is test-only; nothing else owns it.
sudo nft delete table inet ddvtest 2>/dev/null && echo "removed a leftover nft table inet ddvtest" >> "$TSV"
for s in "${STEPS[@]}"; do
  case $s in
    clean) step clean bash "$E/clean-install-test.sh" "$PKG" ;;
    fp-before) mkdir -p ~/fp; step fp-before bash "$E/fingerprint.sh" snap ~/fp/before.txt ;;
    fp-after) step fp-after fp_after ;;
    dirty) step dirty bash "$E/dirty-test.sh" "$PKG" ;;
    installer) step installer bash "$E/installer-test.sh" "$PKG" "$APPIMAGE" ;;
    rig) step rig rig ;;
    ready) step ready ready ;;
    local|daemon|spend|cover) step "sweep-$s" bash "$E/cli-sweep.sh" "$s" ;;
    ui) step ui ui_both ;;
    matrix) step matrix matrix_all ;;
    matrix:*) mkdir -p ~/matrix; step "matrix-${s#matrix:}" bash "$E/matrix.sh" "${s#matrix:}" ;;   # one case again
    split) step split bash "$E/split-test.sh" ;;
    splitui) step splitui splitui_all ;;
    edge) step edge edge_all ;;
    edge:*) mkdir -p ~/edge; step "edge-${s#edge:}" bash "$E/edge.sh" "${s#edge:}" ;;   # one case again
    dhcprenew) step dhcprenew bash "$E/dhcp-renew.sh" ;;   # resolvconf-mode hosts; skips elsewhere
    soak) step soak bash "$E/soak.sh" "${SOAK_MIN:-120}" ;;
    *) printf 'ERR\t%s\t-\t-\tunknown step\n' "$s" >> "$TSV" ;;
  esac
done
echo "QUEUE-DONE $(date -u +%FT%TZ)" > "$Q/state"
