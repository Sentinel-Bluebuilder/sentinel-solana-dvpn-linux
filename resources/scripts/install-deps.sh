#!/bin/bash
# ─── VPN drivers / tools (F1, F17) — check or install ───
# What dvpnd needs on Linux (sentinel-solana docs 25 §7): wg + wg-quick (WireGuard),
# awg + awg-quick + the amneziawg kernel module (AmneziaWG), openvpn, nft (kill switch),
# resolvectl (DNS). V2Ray / Xray / Hysteria2 ship inside the app.
# --CheckOnly 1  : no root needed, installs nothing, writes the report (exit 2 = something missing)
# otherwise      : root; the distribution's package manager installs what is missing:
#                  apt (Debian/Ubuntu; AmneziaWG from the amnezia PPA on Ubuntu),
#                  dnf (Fedora; EL9 turns on EPEL for openvpn), pacman (Arch).
#                  AmneziaWG falls back to the pinned source build everywhere.
# Args: [--CheckOnly 1] [--OutDir dir] [--Result]
set -uo pipefail
# Debian gives normal users no sbin in PATH, and openvpn / nft live there: the check-only report said
# both were "missing" on a working Debian 12 install (2026-10-23). dvpnd's service PATH has them.
export PATH="$PATH:/usr/local/sbin:/usr/sbin:/sbin"
source "$(dirname "$(readlink -f "$0")")/_lib.sh"
parse_args "$@"
CHECK="${ARG[CheckOnly]:-0}"
OUT="${ARG[OutDir]:-/var/lib/devnet-dvpn}"
# Package manager of this system: apt | dnf | pacman | '' (unknown: check-only report still works)
PM=''
for p in apt-get:apt dnf:dnf pacman:pacman; do command -v "${p%%:*}" >/dev/null && { PM=${p#*:}; break; }; done
OS_ID=$(. /etc/os-release 2>/dev/null; echo "${ID:-}")
OS_LIKE=$(. /etc/os-release 2>/dev/null; echo "${ID_LIKE:-}")
is_el() { [[ " $OS_ID $OS_LIKE " =~ \ (rhel|centos|rocky|almalinux)\  ]] && [ "$OS_ID" != fedora ]; }

row() { printf '{"name":%s,"wanted":%s,"found":%s,"status":%s,"detail":%s}' "$(json_str "$1")" "$(json_str "$2")" "$(json_str "$3")" "$(json_str "$4")" "$(json_str "$5")"; }
ver() { "$@" 2>&1 | head -1 | grep -oE '[0-9]+(\.[0-9]+)+' | head -1; }
probe() { # name → "found|status|detail"
  case "$1" in
    wireguard)
      if command -v wg >/dev/null && command -v wg-quick >/dev/null; then echo "$(ver wg --version)|present|"; else echo "|missing|wg / wg-quick not found (package wireguard-tools)"; fi ;;
    amneziawg)
      if ! command -v awg >/dev/null || ! command -v awg-quick >/dev/null; then echo "|missing|awg / awg-quick not found (package amneziawg-tools)";
      # tools from before AmneziaWG 1.5 call themselves wireguard-tools and refuse current node
      # configs ("Line unrecognized: S3=1", the EPEL 9 Copr build): repair replaces them
      elif ! awg --version 2>/dev/null | grep -q '^amneziawg-tools'; then echo "$(ver awg --version)|missing|awg is too old for current servers (needs amneziawg-tools 1.5 or later)";
      # Loaded, or built for THIS kernel. Just "modinfo finds it" is not enough: after a kernel update
      # EL9 links the old kernel's DKMS module into the new one's weak-updates, modinfo finds it, but
      # it does not load, and repair skipped the rebuild (Q0308, Rocky 9.8: built 687.56.1, running 687.60.1).
      elif ! lsmod 2>/dev/null | grep -q '^amneziawg' && [ "$(modinfo -F vermagic amneziawg 2>/dev/null | awk '{print $1}')" != "$(uname -r)" ]; then
        local built; built=$(modinfo -F vermagic amneziawg 2>/dev/null | awk '{print $1}')
        echo "$(ver awg --version)|missing|kernel module amneziawg not built for $(uname -r)${built:+ (built for $built)} (package amneziawg; repair drivers builds it; if it will not build for this kernel, boot an older one - the other protocols still work)";
      else echo "$(ver awg --version)|present|"; fi ;;
    openvpn)
      if command -v openvpn >/dev/null; then echo "$(openvpn --version 2>/dev/null | head -1 | awk '{print $2}')|present|"; else echo "|missing|openvpn not found"; fi ;;
    nftables)
      if command -v nft >/dev/null; then echo "$(ver nft --version)|present|"; else echo "|missing|nft not found (kill switch needs it)"; fi ;;
    resolvectl)
      # dvpnd's resolvconf mode writes /etc/resolv.conf itself (backup + restore), no program needed:
      # that is how EL9 works (NetworkManager owns resolv.conf, no systemd-resolved)
      if command -v resolvectl >/dev/null && systemctl is-active -q systemd-resolved 2>/dev/null; then echo "$(ver resolvectl --version)|present|";
      elif [ -f /etc/resolv.conf ]; then echo "resolv.conf|present|systemd-resolved not running; the service writes /etc/resolv.conf during a session (DNS mode resolvconf)";
      else echo "|missing|no systemd-resolved and no /etc/resolv.conf: the VPN's DNS cannot be applied"; fi ;;
    linux)
      case "$(uname -m)" in
        x86_64|aarch64) echo "$(uname -r)|present|" ;;
        *) echo "$(uname -m)|incompatible|64-bit only: x86_64 (Intel/AMD) or aarch64 (ARM, e.g. Raspberry Pi 4/5 with a 64-bit OS)" ;;
      esac ;;
  esac
}
# AmneziaWG from upstream source when no package is available. Pinned to the commits the amnezia
# PPA builds (tools ee0f0a9 = v3.1.20260812, module 4569c4c = v3.1.20260906; the rig nodes run
# these) and checked by sha256. The module builds against the kernel headers through DKMS, so it
# is rebuilt on kernel updates like the PPA's amneziawg-dkms.
AWG_TOOLS_SHA=ee0f0a9aa34ff0a0da4b3433b9512781cfe02843
AWG_TOOLS_SUM=22438f231d39ea27e4bdc69707ec3103357f3cecc9ad3eecba18a61e5b39c9b9
AWG_KMOD_SHA=4569c4c67f3a57414969260cafbbd04694fbaae0
AWG_KMOD_SUM=6d7608935adbcdd4c6e9fed705951e2ee85311ac212a8e8f1274abcf9b06f83e
awg_from_source() {
  local t; t=$(mktemp -d) || return 1
  echo "### AmneziaWG from source (tools $AWG_TOOLS_SHA, module $AWG_KMOD_SHA)" >> "$LOG"
  build_deps || return 1
  fetch() { # <repo> <commit> <sha256> <out>
    curl -fsSL --retry 3 -m 120 -o "$4" "https://github.com/amnezia-vpn/$1/archive/$2.tar.gz" >> "$LOG" 2>&1 &&
      echo "$3  $4" | sha256sum -c - >> "$LOG" 2>&1
  }
  fetch amneziawg-tools "$AWG_TOOLS_SHA" "$AWG_TOOLS_SUM" "$t/tools.tgz" || { rm -rf "$t"; return 1; }
  fetch amneziawg-linux-kernel-module "$AWG_KMOD_SHA" "$AWG_KMOD_SUM" "$t/kmod.tgz" || { rm -rf "$t"; return 1; }
  tar -xzf "$t/tools.tgz" -C "$t" && tar -xzf "$t/kmod.tgz" -C "$t" || { rm -rf "$t"; return 1; }
  local tools="$t/amneziawg-tools-$AWG_TOOLS_SHA/src" kmod="$t/amneziawg-linux-kernel-module-$AWG_KMOD_SHA/src" rc=0
  # Kernel 7.0 fix (gap L2): compat.h wraps setup_udp_tunnel_sock() for kernels < 7.1.5, but
  # distro 7.0 kernels (Ubuntu 7.0.0-1014-gcp) already take a struct sock *, so the wrapper
  # breaks the build. Decide per kernel from its own header, at every (DKMS) build.
  sed -i 's|^#define setup_udp_tunnel_sock(net, sk, sock_cfg) setup_udp_tunnel_sock(net, sk->sk_socket, sock_cfg)$|#ifndef AWG_UDP_TUNNEL_TAKES_SOCK\n&\n#endif|' "$kmod/compat/compat.h"
  # (no "(" in the grep pattern: make counts parentheses inside $(shell ...))
  printf '%s\n' "ccflags-y += \$(shell grep -qs 'setup_udp_tunnel_sock.struct net .net, struct sock .sk' \$(srctree)/include/net/udp_tunnel.h && echo -DAWG_UDP_TUNNEL_TAKES_SOCK)" >> "$kmod/Kbuild"
  grep -q '^#ifndef AWG_UDP_TUNNEL_TAKES_SOCK' "$kmod/compat/compat.h" || echo 'kernel 7 compat edit did not apply (upstream changed compat.h)' >> "$LOG"
  # EL9 fix: RHEL 9.8's 5.14 kernel carries the 6.16 timer rename (timer_container_of, no
  # from_timer); compat.h maps the new name to the old one by version number alone and the build
  # failed (Rocky 9.8, 2026-10-22). Map it only where the kernel lacks the new name.
  sed -i 's|^#define timer_container_of from_timer$|#ifndef timer_container_of\n&\n#endif|' "$kmod/compat/compat.h"
  grep -q '^#ifndef timer_container_of' "$kmod/compat/compat.h" || echo 'EL9 timer compat edit did not apply (upstream changed compat.h)' >> "$LOG"
  {
    make -C "$tools" &&
      make -C "$tools" install PREFIX=/usr WITH_WGQUICK=yes WITH_SYSTEMDUNITS=yes WITH_BASHCOMPLETION=no || rc=1
    if [ $rc = 0 ]; then
      # a half-registered earlier attempt would make "dkms add" refuse
      dkms status -m amneziawg -v 1.0.0 2>/dev/null | grep -q . && dkms remove -m amneziawg -v 1.0.0 --all
      make -C "$kmod" dkms-install &&
        dkms add -m amneziawg -v 1.0.0 && dkms build -m amneziawg -v 1.0.0 && dkms install -m amneziawg -v 1.0.0 || rc=1
    fi
  } >> "$LOG" 2>&1
  rm -rf "$t"
  return $rc
}
NAMES=(linux wireguard amneziawg openvpn nftables resolvectl)
installed=(); why=''
if [ "$CHECK" != 1 ]; then
  # apt output is kept (not thrown away) so a failure can say why
  mkdir -p "$OUT"; LOG="$OUT/install-deps.log"; : > "$LOG"
  apt_q() { echo "$ apt-get $*" >> "$LOG"; apt-get "$@" >> "$LOG" 2>&1; }
  dnf_q() { echo "$ dnf $*" >> "$LOG"; dnf "$@" >> "$LOG" 2>&1; }
  pacman_q() { echo "$ pacman $*" >> "$LOG"; pacman "$@" >> "$LOG" 2>&1; }
  [ "$(id -u)" = 0 ] || die 'installing drivers needs root'
  [ -n "$PM" ] || die 'no supported package manager (apt, dnf or pacman): install wireguard-tools, openvpn and nftables yourself, then re-check'
  export DEBIAN_FRONTEND=noninteractive
  # EL9 (Rocky/Alma/RHEL): openvpn and dkms live in EPEL. Turned on only when something needs it.
  epel_on() {
    is_el || return 0
    dnf repolist --enabled 2>/dev/null | grep -qi '^epel ' && return 0
    if ! rpm -q epel-release >/dev/null 2>&1; then
      if [ "$OS_ID" = rhel ]; then
        dnf_q install -y "https://dl.fedoraproject.org/pub/epel/epel-release-latest-$(. /etc/os-release; echo "${VERSION_ID%%.*}").noarch.rpm"
      else
        dnf_q install -y epel-release
      fi
    fi
    # installed but switched off (by the user or an earlier setup): switch the main EPEL repo on
    dnf repolist --enabled 2>/dev/null | grep -qi '^epel ' && return 0
    dnf_q config-manager --set-enabled epel || sed -i '/^\[epel\]/,/^\[/ s/^enabled=0/enabled=1/' /etc/yum.repos.d/epel.repo
  }
  # compiler + DKMS + headers for the RUNNING kernel (AmneziaWG source build)
  build_deps() {
    case $PM in
      apt) apt_q install -y build-essential dkms curl ca-certificates "linux-headers-$(uname -r)" ;;
      dnf)
        # dkms wants kernel-devel-matched; left to dnf that resolves to the NEWEST one, which installs a
        # newer kernel the next boot runs (Rocky 9.8 2026-10-24: 687.59.1 added, Fedora the same).
        # Name the matched package of the RUNNING kernel and skip weak deps: the kernel stays as it is.
        epel_on
        local kv kbefore matched=(); kv=$(uname -r); kbefore=$(rpm -q kernel-core 2>/dev/null | sort)
        dnf -q list --showduplicates "kernel-devel-matched-$kv" >/dev/null 2>&1 && matched=("kernel-devel-matched-$kv")
        dnf_q install -y --setopt=install_weak_deps=False gcc make dkms curl ca-certificates tar elfutils-libelf-devel \
          "kernel-devel-$kv" "${matched[@]}"
        [ "$(rpm -q kernel-core 2>/dev/null | sort)" = "$kbefore" ] \
          || echo "WARNING: the driver build installed another kernel: $(rpm -q kernel-core | tr '\n' ' ')" >> "$LOG" ;;
      pacman)
        local kpkg; kpkg=$(pacman -Qoq "/usr/lib/modules/$(uname -r)/vmlinuz" 2>/dev/null)
        pacman_q -S --noconfirm --needed base-devel dkms curl ca-certificates "${kpkg:-linux}-headers" ;;
    esac
  }
  need=()
  for n in wireguard openvpn nftables; do [ "$(probe $n | cut -d'|' -f2)" = present ] || need+=("$n"); done
  pkgs=()
  # the three package names are the same on Debian, Fedora/EL and Arch
  for n in "${need[@]}"; do case $n in wireguard) pkgs+=(wireguard-tools) ;; openvpn) pkgs+=(openvpn) ;; nftables) pkgs+=(nftables) ;; esac; done
  if [ ${#pkgs[@]} -gt 0 ]; then
    case $PM in
      apt) apt_q update -y; apt_q install -y "${pkgs[@]}" && installed+=("${need[@]}") ;;
      dnf) [[ " ${pkgs[*]} " == *' openvpn '* ]] && epel_on; dnf_q install -y "${pkgs[@]}" && installed+=("${need[@]}") ;;
      pacman) pacman_q -Sy --noconfirm --needed "${pkgs[@]}" && installed+=("${need[@]}") ;;
    esac
  fi
  if [ "$(probe amneziawg | cut -d'|' -f2)" != present ] && [ "$PM" != apt ]; then
    # Fedora/EL and Arch: the pinned source build (tools + DKMS module). Not the amnezia Copr: its
    # EPEL 9 amneziawg-tools (1.0.20240201) cannot read current node configs ("Line unrecognized:
    # S3=1", Rocky 9.8 2026-10-22), and it has no build for new Fedora releases.
    if [[ " ${installed[*]:-} " != *' amneziawg '* ]]; then
      if awg_from_source; then installed+=(amneziawg)
      else why="AmneziaWG: no package for this release and the build from source failed (see $LOG); if its kernel module will not build for $(uname -r), boot an older kernel"; fi
    fi
    modprobe amneziawg 2>/dev/null
  fi
  if [ "$(probe amneziawg | cut -d'|' -f2)" != present ] && [ "$PM" = apt ]; then
    # the PPA is for Ubuntu only; elsewhere (Debian) go straight to the source build
    if [ "$(. /etc/os-release; echo "$ID")" = ubuntu ] && ! grep -rqs 'amnezia/ppa' /etc/apt/sources.list.d/; then
      apt_q install -y software-properties-common
      add-apt-repository -y ppa:amnezia/ppa >> "$LOG" 2>&1
    fi
    apt_q update -y
    apt_q install -y "linux-headers-$(uname -r)"
    codename=$(. /etc/os-release; echo "${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}")
    if apt-cache policy amneziawg-tools 2>/dev/null | grep -q 'Candidate: [0-9]' && apt_q install -y amneziawg amneziawg-tools; then
      installed+=(amneziawg)
    elif awg_from_source; then
      # No PPA package (Launchpad down, or not Ubuntu): the same upstream commits the PPA ships
      installed+=(amneziawg)
    else
      why="AmneziaWG: no package from ppa:amnezia for ${codename:-this release} and the build from source failed (see $LOG); if its kernel module will not build for $(uname -r), boot an older kernel"
    fi
    modprobe amneziawg 2>/dev/null
  fi
fi
rows=(); ok=true; missing=()
for n in "${NAMES[@]}"; do
  IFS='|' read -r found status detail <<< "$(probe "$n")"
  [ "$status" = present ] && [[ " ${installed[*]:-} " == *" $n "* ]] && status=installed
  if [ "$status" != present ] && [ "$status" != installed ]; then ok=false; missing+=("$n"); fi
  rows+=("$(row "$n" any "$found" "$status" "$detail")")
done
report="{\"at\":\"$(date -u +%FT%TZ)\",\"ok\":$ok,\"rebootRequired\":false,\"deps\":[$(IFS=,; echo "${rows[*]}")]}"
mkdir -p "$OUT" && printf '%s\n' "$report" > "$OUT/install-deps.json"
if [ "$CHECK" = 1 ]; then [ "$ok" = true ] && exit 0 || exit 2; fi
if [ "$ok" = true ]; then write_result ok "${installed[*]:-nothing to install}"; else die "still missing after install: ${missing[*]}${why:+. $why}"; fi
