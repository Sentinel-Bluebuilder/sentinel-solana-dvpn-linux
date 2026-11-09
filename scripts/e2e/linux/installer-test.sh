#!/usr/bin/env bash
# ─── Installer proof on Linux (run ON the VM, sudo -n): upgrade, remove, reinstall, AppImage ───
# Each step writes a fingerprint of everything the package or the service can touch, then
# asserts on it. Results: ~/sweep/installer.tsv + installer.log (+ fp-<step>.txt).
# Usage: bash installer-test.sh <path-to.deb|.rpm> <path-to.AppImage>
set -u
DEB=$(readlink -f "${1:?deb}"); APPIMAGE=$(readlink -f "${2:?AppImage}")
# ─── package shim: Debian/Ubuntu (.deb, apt) or Fedora/EL (.rpm, dnf) ───
PKG=devnet-dvpn-linux
if command -v apt-get >/dev/null; then PM=apt; else PM=dnf; fi
APT="sudo DEBIAN_FRONTEND=noninteractive apt-get"
pkg_reinstall() { if [ $PM = apt ]; then $APT install -y --reinstall "$1"; else sudo dnf -y reinstall "$1" || sudo dnf -y install "$1"; fi; }
pkg_install() { if [ $PM = apt ]; then $APT install -y "$1"; else sudo dnf -y install "$1"; fi; }
pkg_remove() { if [ $PM = apt ]; then $APT remove -y $PKG; else sudo dnf -y remove $PKG; fi; }
pkg_query() { if [ $PM = apt ]; then dpkg-query -W -f='${Package} ${Version} ${Status}\n' $PKG 2>/dev/null; else rpm -q $PKG 2>/dev/null; fi; }
pkg_ok() { if [ $PM = apt ]; then dpkg-query -W -f='${Status}' $PKG | grep -q 'install ok installed'; else rpm -q $PKG >/dev/null; fi; }
# Arch: `pacman -U` of the same version reinstalls and runs pre_/post_upgrade (the upgrade hooks)
if command -v pacman >/dev/null && ! command -v apt-get >/dev/null && ! command -v dnf >/dev/null; then
  PM=pacman
  pkg_reinstall() { sudo pacman -U --noconfirm "$1"; }
  pkg_install() { sudo pacman -U --noconfirm "$1"; }
  pkg_remove() { sudo pacman -R --noconfirm $PKG; }
  pkg_query() { pacman -Q $PKG 2>/dev/null; }
  pkg_ok() { pacman -Q $PKG >/dev/null 2>&1; }
fi
export PM PKG APT; export -f pkg_ok
AA=0; command -v aa-status >/dev/null && AA=1
DEV0=$(cat /var/lib/dvpnd/client/device.pub 2>/dev/null)
OUT=~/sweep; mkdir -p "$OUT"; TSV="$OUT/installer.tsv"; : > "$TSV"; : > "$OUT/installer.log"
: "${DVPN_KEYFILE:?set DVPN_KEYFILE}"; export DVPN_DATA_DIR=${DVPN_DATA_DIR:-$HOME/ddv-data}
PASS=0; FAIL=0
check() {
  local desc=$1; shift
  local out; out=$("$@" 2>&1); local code=$?
  printf '\n### %s\n$ %s\n%s\n(exit %s)\n' "$desc" "$*" "$out" "$code" >> "$OUT/installer.log"
  if [ $code = 0 ]; then PASS=$((PASS + 1)); echo "ok   $desc"; printf 'PASS\t%s\tcheck\t\n' "$desc" >> "$TSV";
  else FAIL=$((FAIL + 1)); echo "FAIL $desc :: $(echo "$out" | head -3 | tr '\n' ' ')"; printf 'FAIL\t%s\tcheck\t%s\n' "$desc" "$(echo "$out" | head -2 | tr '\n\t' '  ')" >> "$TSV"; fi
}
# A launch "ran" only if it was still running at the timeout (124) AND Chromium logged no fatal error:
# its "GPU process isn't usable. Goodbye." usually still ends in 124 (TLX arm-deb12 Q0246: FATAL in 9 of
# 10 logs, only 1 exited 133), so the exit code alone misses most crashes.
ran_clean() { # <exit code> <output file>
  local f
  f=$(grep -m2 -E ":FATAL:|GPU process isn't usable" "$2" 2>/dev/null)
  if [ -n "$f" ]; then echo "fatal in the output (exit $1): $f"; return 1; fi
  [ "$1" = 124 ] || { echo "exit $1, not 124 (still running after 20 s)"; return 1; }
}
ran_clean_attached() { # <exit code> <output file>: ran clean AND the app reached the service
  ran_clean "$1" "$2" || return 1
  grep -q 'daemon attached' "$2" || { echo "no 'daemon attached' in the output"; return 1; }
}
fingerprint() { # <name>
  {
    echo "== package";   pkg_query || echo 'not installed'
    echo "== files";     ls -d /opt/devnet-dvpn /usr/bin/devnet-dvpn /usr/bin/devnet-dvpn-desktop /usr/local/lib/devnet-dvpn /etc/apparmor.d/devnet-dvpn /usr/share/polkit-1/actions/network.sentinel.devnet-dvpn.policy /etc/systemd/system/dvpnd-client.service /var/lib/dvpnd/client /var/lib/devnet-dvpn 2>/dev/null
    echo "== service";   systemctl is-active dvpnd-client 2>/dev/null; systemctl is-enabled dvpnd-client 2>/dev/null
    echo "== apparmor";  sudo aa-status 2>/dev/null | grep -c devnet-dvpn
    echo "== group";     getent group dvpn
    echo "== nft";       sudo nft list tables
    echo "== links";     ip -o link | grep -E ' (dvpn-|hy2-client|ovpn-client|tun[0-9])' || true
    echo "== rules";     ip rule list | grep -vE 'lookup (local|main|default)' || true
    echo "== procs";     pgrep -xa 'dvpnd|v2ray|xray|hysteria2|openvpn' || true
    echo "== egress";    curl -s -m 12 https://api.ipify.org; echo
  } > "$OUT/fp-$1.txt" 2>&1
  cat "$OUT/fp-$1.txt" >> "$OUT/installer.log"
}
has() { grep -q -- "$2" "$OUT/fp-$1.txt"; }
# final-pass effect spec (DRIVER/INSTALL): a BEFORE and an AFTER state line, read from the system, not from our checks
state_line() { # <PHASE>
  local inst=False ver='' unit=False
  pkg_ok 2>/dev/null && inst=True
  ver=$(pkg_query 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+[^ ]*' | head -1)
  [ "$(systemctl show -p LoadState --value dvpnd-client 2>/dev/null)" = loaded ] && unit=True
  echo "info $1: package installed $inst, version ${ver:-none}, service unit present $unit"
}
DIRECT=$(curl -s -m 12 https://api.ipify.org)

# 1. upgrade over a running service: same unit keeps running, its binaries are refreshed
fingerprint before; state_line BEFORE
check 'before: service active' has before '^active$'
pkg_reinstall "$DEB" >> "$OUT/installer.log" 2>&1
fingerprint upgrade; state_line AFTER-upgrade
check 'upgrade: service still active' has upgrade '^active$'
check 'upgrade: service dvpnd = packaged dvpnd' bash -c "[ \"\$(sha256sum < /usr/local/lib/devnet-dvpn/dvpnd)\" = \"\$(sha256sum < /opt/devnet-dvpn/resources/resources/bin/dvpnd)\" ]"
# the package installs its AppArmor profile only where userns is restricted (Ubuntu 24.04+, ABI 4.0);
# Debian 12 runs AppArmor 3 with userns open, so no profile there (arm64 Debian 12, 2026-10-22)
[ $AA = 1 ] && [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = 1 ] && check 'upgrade: AppArmor profile loaded' bash -c "sudo aa-status | grep -q devnet-dvpn"
[ $PM = dnf ] && check 'upgrade (rpm): CLI link + polkit action survive the %postun of the old package' bash -c "test -L /usr/bin/devnet-dvpn && test -f /usr/share/polkit-1/actions/network.sentinel.devnet-dvpn.policy"
check 'upgrade: CLI answers' bash -c "devnet-dvpn daemon version | grep -q 'network devnet'"
check 'upgrade: config keys are the cf4c372 names (escrow_base_units, dns_backend, endpoint)' bash -c "sudo grep -q '^escrow_base_units' /var/lib/dvpnd/client/client/config.toml && sudo grep -q '^dns_backend' /var/lib/dvpnd/client/client/config.toml && sudo grep -q '^endpoint' /var/lib/dvpnd/client/config.toml && ! sudo grep -qE '^(escrow|dns|pipe) =' /var/lib/dvpnd/client/config.toml /var/lib/dvpnd/client/client/config.toml"
# backoff: systemd 254+ grows the delay to 5 min; older systemd (Debian 12 252, EL9, Ubuntu 22.04)
# ignores that, so setup-daemon uses a flat RestartSec=20 there (ed02e3b)
SDV=$(systemctl --version | awk 'NR==1{print $2+0}')
if [ "${SDV:-0}" -ge 254 ]; then BACKOFF='-p RestartMaxDelayUSec --value)" = 5min'; else BACKOFF='-p RestartUSec --value)" = 20s'; fi
# polkit 0.106+: the JS rule; polkit 0.105 (Ubuntu 22.04): the same right as /etc/sudoers.d/devnet-dvpn,
# proven with ddvplain (in dvpn, no sudo rights: the VM's own user has passwordless sudo anyway).
# One retry: where polkitd is started on demand (Arch), the first request can land while it is
# still loading its rules and is refused (ddv-plat-arch 2026-10-22; a second start passed)
check "upgrade: start right (polkit rule or sudoers on polkit 0.105) + restart backoff in place (systemd $SDV)" bash -c "{ sudo test -f /etc/polkit-1/rules.d/50-devnet-dvpn.rules || sudo test -f /etc/sudoers.d/devnet-dvpn; } && [ \"\$(systemctl show dvpnd-client $BACKOFF ]"
check 'upgrade: the user starts the service without a password' bash -c "{ id ddvplain >/dev/null 2>&1 || sudo useradd -M -s /bin/bash ddvplain; }; sudo usermod -aG dvpn ddvplain; sudo systemctl stop dvpnd-client && if sudo test -d /etc/polkit-1/rules.d; then systemctl start --no-ask-password dvpnd-client || { sleep 3; systemctl start --no-ask-password dvpnd-client; }; else sudo -u ddvplain sudo -n systemctl start dvpnd-client.service; fi && systemctl is-active -q dvpnd-client"

# 2. remove: networking exactly as before the app; the device key home is kept on purpose
pkg_remove >> "$OUT/installer.log" 2>&1
fingerprint removed; state_line AFTER-remove
check 'remove: service unit gone'          bash -c "[ \"\$(systemctl show -p LoadState --value dvpnd-client)\" != loaded ]"
check 'remove: no dvpnd process'           bash -c "! pgrep -x dvpnd"
check 'remove: app files and links gone'   bash -c "! ls -d /opt/devnet-dvpn /usr/bin/devnet-dvpn /usr/bin/devnet-dvpn-desktop /usr/local/lib/devnet-dvpn 2>/dev/null | grep -q ."
check 'remove: polkit action + rule, AppArmor, unit drop-ins gone' bash -c "[ ! -e /usr/share/polkit-1/actions/network.sentinel.devnet-dvpn.policy ] && ! sudo test -e /etc/polkit-1/rules.d/50-devnet-dvpn.rules && [ ! -e /etc/systemd/system/dvpnd-client.service.d ] && [ ! -e /etc/apparmor.d/devnet-dvpn ] && ! sudo aa-status | grep -q devnet-dvpn"
check 'remove: no nft table, link or rule of ours' bash -c "! sudo nft list tables | grep -q dvpnd && ! ip -o link | grep -qE ' (dvpn-|hy2-client|ovpn-client)' && ! ip rule list | grep -q 51820"
check "remove: direct egress ($DIRECT)"    bash -c "[ \"\$(curl -s -m 12 https://api.ipify.org)\" = '$DIRECT' ]"
check 'remove: device key home kept (on-chain permission + SOL)' bash -c "sudo test -f /var/lib/dvpnd/client/client/keys/device.json"

# 3. reinstall: the kept home is reused, one root step brings the service back
pkg_install "$DEB" >> "$OUT/installer.log" 2>&1
check 'reinstall: package installed'       pkg_ok
# keep the real output: grep -q hid 'Run "device setup --yes" first' on deb12-arm64 (Q0173)
check 'reinstall: daemon install --yes'    bash -c 'o=$(devnet-dvpn daemon install --yes 2>&1); echo "$o"; grep -q "installed and running" <<<"$o"'
fingerprint reinstalled; state_line AFTER-reinstall
check 'reinstall: service active + enabled' bash -c "systemctl is-active -q dvpnd-client && systemctl is-enabled -q dvpnd-client"
check "reinstall: same device as before the test (${DEV0:-none})" bash -c "[ -n '$DEV0' ] && [ \"\$(cat /var/lib/dvpnd/client/device.pub)\" = '$DEV0' ]"
check 'reinstall: doctor has no FAIL'      bash -c "! devnet-dvpn daemon doctor 2>&1 | grep -q '^FAIL'"

# 3b. remove while "Always" is armed with a live session, then reinstall (#31 #84, UPSTREAM-GAPS L22):
#     the kept config re-armed the whole block at the first service start and cut the machine off.
#     Now the uninstall steps "Always" down to "On" and dvpnd releases a block the setting no longer asks for.
KS0=$(sudo grep -oP "^kill_switch = '\K[a-z]+" /var/lib/dvpnd/client/client/config.toml 2>/dev/null); KS0=${KS0:-off}
# the WireGuard node of the active NODE_SET (lib.sh + nodes.sh), not the first one written in lib.sh:
# that is the NODE_SET=sg block (another operator's node), which the test dialled by mistake (M6b 15:09Z)
WG=$(bash -c 'set +u; . "$0" >/dev/null 2>&1; echo "${NODE[wireguard]}"' "$(dirname "$(readlink -f "$0")")/lib.sh")
check 'always: kill switch set to Always'  bash -c "devnet-dvpn daemon set --kill-switch persist --yes 2>&1 | grep -qi 'applied'"
sleep 7
check "always: connect ($WG)"              bash -c "devnet-dvpn connect '$WG' --units 1 --yes 2>&1 | grep -q '^Connected'"
check 'always: block in the kernel while connected' bash -c "sudo nft list table inet dvpnd >/dev/null 2>&1"
pkg_remove >> "$OUT/installer.log" 2>&1
check "always → remove: direct egress ($DIRECT)" bash -c "[ \"\$(curl -s -m 12 https://api.ipify.org)\" = '$DIRECT' ]"
check 'always → remove: no nft table of ours' bash -c "! sudo nft list tables | grep -q dvpnd"
check "always → remove: kept config says 'on', not 'persist'" bash -c "sudo grep -q \"^kill_switch = 'on'\" /var/lib/dvpnd/client/client/config.toml"
pkg_install "$DEB" >> "$OUT/installer.log" 2>&1
check 'always → reinstall: daemon install --yes' bash -c 'o=$(devnet-dvpn daemon install --yes 2>&1); echo "$o"; grep -q "installed and running" <<<"$o"'
sleep 15
check "always → reinstall: not blocked, direct egress ($DIRECT)" bash -c "[ \"\$(curl -s -m 12 https://api.ipify.org)\" = '$DIRECT' ]"
check 'always → reinstall: no block re-armed (no inet dvpnd table)' bash -c "! sudo nft list table inet dvpnd >/dev/null 2>&1"
check 'always → reinstall: no session' bash -c "devnet-dvpn status 2>&1 | grep -q '^Session  Not connected'"
devnet-dvpn daemon set --kill-switch "$KS0" --yes >> "$OUT/installer.log" 2>&1
echo "kill switch back to $KS0" >> "$OUT/installer.log"

# 4. AppImage on Ubuntu 24.04 (no AppArmor profile can name a random FUSE mount path).
#    The classic type-2 runtime needs libfuse2 (24.04 ships only fuse3 → the user installs libfuse2t64);
#    the static type2-runtime (arm64 builds) needs none.
chmod +x "$APPIMAGE"
if ! ldconfig -p | grep -q 'libfuse.so.2'; then
  # Two runtimes (TLX 10-30, arm64 AppImage 0dfc4da5): the classic runtime dlopens libfuse.so.2 and
  # stops with "AppImages require FUSE"; the static type2-runtime carries FUSE itself and needs no
  # libfuse2. The runtime ELF sits uncompressed at the head of the file, so its strings say which.
  # --appimage-mount exercises only the runtime (no app, no licence prompt, no display) and stays
  # mounted until killed: 124 = mounted and still running.
  timeout 10 "$APPIMAGE" --appimage-mount > "$OUT/appimage-nofuse2.txt" 2>&1; NF=$?
  echo "exit $NF" >> "$OUT/appimage-nofuse2.txt"
  if head -c 2000000 "$APPIMAGE" | grep -aq 'libfuse.so.2'; then
    check "AppImage without libfuse2 says what is missing (classic runtime, exit $NF)" grep -q 'AppImages require FUSE' "$OUT/appimage-nofuse2.txt"
  else
    check "AppImage without libfuse2 mounts (static runtime needs no libfuse2, exit $NF; 124 = mounted)" \
      bash -c "[ $NF = 124 ] && grep -qE '/\.mount_' '$OUT/appimage-nofuse2.txt'"
  fi
  if [ $PM = apt ]; then $APT install -y libfuse2t64 >> "$OUT/installer.log" 2>&1 || $APT install -y libfuse2 >> "$OUT/installer.log" 2>&1
  elif [ $PM = pacman ]; then sudo pacman -S --needed --noconfirm fuse2 >> "$OUT/installer.log" 2>&1
  else sudo dnf -y install fuse fuse-libs >> "$OUT/installer.log" 2>&1; fi
fi
pgrep -x Xvfb >/dev/null || { Xvfb :99 -screen 0 1440x900x24 >/dev/null 2>&1 & sleep 2; }
# First run asks the user to accept the licence (AppRun shows it with zenity/kdialog when one is
# installed) and waits for Agree. Rocky's desktop has zenity, so the app never started (exit 124,
# empty log). Show that the prompt appears, then accept it the way AppRun records an Agree.
EULA=${XDG_CONFIG_HOME:-$HOME/.config}/devnet-dvpn-desktop/eulaAccepted
if [ -x /usr/bin/zenity ]; then
  rm -f "$EULA"; DISPLAY=:99 timeout 15 "$APPIMAGE" > /dev/null 2>&1 & EULA_PID=$!; sleep 10
  check 'AppImage first run asks to accept the licence (zenity)' pgrep -f 'license.txt --ok-label=Agree'
  pkill -f 'license.txt --ok-label=Agree' 2>/dev/null; pkill -x devnet-dvpn-des 2>/dev/null; wait "$EULA_PID" 2>/dev/null
fi
mkdir -p "${EULA%/*}" && touch "$EULA"
DISPLAY=:99 timeout 20 "$APPIMAGE" > "$OUT/appimage-default.txt" 2>&1; AI=$?
pkill -x devnet-dvpn-des 2>/dev/null  # comm is cut to 15 chars; pkill -f would match this shell
if [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = 1 ]; then
  # Ubuntu 24.04+: userns sandbox blocked by AppArmor, SUID helper cannot be setuid in a FUSE
  # mount → Chromium aborts before any app code runs (all Electron AppImages; docs/INSTALLER.md).
  check "AppImage, restricted userns: sandboxed launch stops with Chromium's SUID message (documented)" grep -q 'SUID sandbox helper binary was found, but is not configured correctly' "$OUT/appimage-default.txt"
else
  check "AppImage starts with the sandbox on (exit $AI; 124 = still running after 20 s)" ran_clean "$AI" "$OUT/appimage-default.txt"
fi
# AppRun hint (Q0220, from 0.1.10): restricted userns -> AppRun names the --no-sandbox / .deb way out first; never otherwise
AIV=$(basename "$APPIMAGE" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [ -n "$AIV" ] && [ "$(printf '%s\n0.1.10\n' "$AIV" | sort -V | head -1)" = 0.1.10 ]; then
  if [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = 1 ]; then
    check "AppImage, restricted userns: AppRun prints the sandbox hint ($AIV)" grep -q 'blocks the browser sandbox' "$OUT/appimage-default.txt"
  else
    check "AppImage, unrestricted: no sandbox hint ($AIV)" bash -c "! grep -q 'blocks the browser sandbox' '$OUT/appimage-default.txt'"
  fi
fi
DISPLAY=:99 timeout 20 "$APPIMAGE" --no-sandbox > "$OUT/appimage-nosandbox.txt" 2>&1; AN=$?
pkill -x devnet-dvpn-des 2>/dev/null
check "AppImage --no-sandbox runs and attaches the service (exit $AN)" ran_clean_attached "$AN" "$OUT/appimage-nosandbox.txt"
echo; echo "installer: passed $PASS  failed $FAIL  (details $OUT/installer.log)"
[ "$FAIL" = 0 ]
