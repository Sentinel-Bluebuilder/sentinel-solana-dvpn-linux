#!/usr/bin/env bash
# ─── Dirty machine (#31 ddv-win-b / I4): the user's own VPN, firewall, proxy and DNS stay untouched ───
# Run ON a test VM (sudo -n), detached: nohup bash dirty-test.sh <deb> > ~/dirty/run.out 2>&1 &
# Seeds: own WireGuard link `home-office` (wg-quick, a peer that never answers, AllowedIPs 10.99.0.0/16
# only), own nftables table `inet userfw` with a rule, own GNOME proxy (manual http user.proxy.test:3128),
# own DNS on a dummy link. Then: install → session WITH kill switch → restore-network → session
# with kill switch → disconnect → purge. After each step the user's items must be byte-identical.
# Results: ~/dirty/dirty.tsv. Env: DVPN_KEYFILE, DVPN_DATA_DIR.
set -u
export PATH="$PATH:/usr/sbin:/sbin"
DEB=$(readlink -f "${1:?deb}")
OUT=~/dirty; mkdir -p "$OUT"; TSV="$OUT/dirty.tsv"; : > "$TSV"
CLI=devnet-dvpn
WG=SLVJNn38s5RfqcVW7a7A4hGKqjY7Y1bKkUpG7wrGX5D
HY=E8nefMLBuBzG1CrA4dSDU9mqq6ZNpv69Bt3w9QEtzvPf
. "$(dirname "$0")/nodes.sh"; nodeset_apply   # NODE_SET=node4 → that node set (nodes.sh)
APT="sudo DEBIAN_FRONTEND=noninteractive apt-get"
G="dbus-run-session -- gsettings"
# ─── package shim: Debian/Ubuntu (.deb, apt) or Fedora/EL (.rpm, dnf) ───
PKG=devnet-dvpn-linux
if command -v apt-get >/dev/null; then PM=apt; else PM=dnf; fi
pkg_installed() { if [ $PM = apt ]; then dpkg -s $PKG >/dev/null 2>&1; else rpm -q $PKG >/dev/null 2>&1; fi; }
pkg_install() { if [ $PM = apt ]; then $APT install -y "$@"; else sudo dnf -y install "$@"; fi; }
pkg_purge() { if [ $PM = apt ]; then $APT purge -y $PKG; else sudo dnf -y remove $PKG; fi; }
if command -v pacman >/dev/null && ! command -v apt-get >/dev/null && ! command -v dnf >/dev/null; then   # Arch
  PM=pacman
  pkg_installed() { pacman -Q $PKG >/dev/null 2>&1; }
  pkg_install() { if [ -f "${1:-}" ]; then sudo pacman -U --noconfirm "$@"; else sudo pacman -S --needed --noconfirm "$@"; fi; }
  pkg_purge() { sudo pacman -Rn --noconfirm $PKG; }
fi
# where systemd-resolved is off (EL9) the user's DNS lives in NetworkManager, and the
# user may run firewalld (Fedora/EL default). With neither (Arch on GCE: dhcpcd) it lives in
# /etc/resolv.conf itself.
RESOLVED=0; systemctl is-active -q systemd-resolved 2>/dev/null && RESOLVED=1
NM=0; systemctl is-active -q NetworkManager 2>/dev/null && command -v nmcli >/dev/null && NM=1
# ISC dhclient (Arch GCE image: dhclient@eth0) rewrites /etc/resolv.conf at every lease renewal
# (~24 min), so a user there keeps their DNS in /etc/dhclient.conf, not in resolv.conf
DHC=$(systemctl list-units --state=running --no-legend 'dhclient@*.service' 2>/dev/null | awk '{print $1}' | head -1)
FWD=0; systemctl is-active -q firewalld 2>/dev/null && FWD=1
PASS=0; FAIL=0
rec() { printf '%s\t%s\t%s\n' "$1" "$2" "$(printf '%s' "${3:-}" | tr '\n\t' '  ' | cut -c1-300)" >> "$TSV"; echo "$1 $2"; [ "$1" = PASS ] && PASS=$((PASS + 1)); [ "$1" = FAIL ] && FAIL=$((FAIL + 1)); true; }
cli() { $CLI "$@" 2>&1 | grep -v '^\[rpc\]'; return "${PIPESTATUS[0]}"; }
hold() { sudo touch /run/ddv-deadman.hold 2>/dev/null; true; }
# the user's own state, as text: compared after every step. sudo's own "unable to resolve host"
# warning is not user state: with the kill switch on, GCE's metadata DNS (which resolves the VM's
# own name when /etc/hosts lacks it) is blocked like every other direct path (ddv-plat-arm-u2404).
mine() { mine_raw | grep -v '^sudo: unable to resolve host '; }
mine_raw() {
  echo "## wg home-office"; sudo wg show home-office 2>&1 | grep -vE 'latest handshake|transfer'
  ip -o addr show dev home-office 2>&1 | awk '{print $3, $4}'
  ip route show dev home-office 2>&1
  echo "## nft userfw"; sudo nft list table inet userfw 2>&1
  echo "## proxy"; $G get org.gnome.system.proxy mode; $G get org.gnome.system.proxy.http host; $G get org.gnome.system.proxy.http port
  if [ $RESOLVED = 1 ]; then echo "## dns userdns"; resolvectl dns userdns 2>&1; resolvectl domain userdns 2>&1
  elif [ $NM = 1 ]; then echo "## dns userdns (NetworkManager)"; nmcli -g ipv4.dns,ipv4.dns-search con show userdns 2>&1
  elif [ -n "$DHC" ]; then echo "## dns (/etc/dhclient.conf, the user's lines)"; grep -E 'corp\.example|9\.9\.9\.9' /etc/dhclient.conf 2>&1
  else echo "## dns (/etc/resolv.conf)"; cat /etc/resolv.conf; fi
  if [ $FWD = 1 ]; then echo "## firewalld"; sudo firewall-cmd --list-ports 2>&1; fi
}
same() { # <step>
  local now; now=$(mine)
  if [ "$now" = "$BASE" ]; then rec PASS "$1: the user's own tunnel, firewall, proxy and DNS untouched" ''; else rec FAIL "$1: user state changed" "$(diff <(echo "$BASE") <(echo "$now") | head -12)"; fi
}

# ─── start from a machine without us (the install itself must leave the user's things alone) ───
pkg_installed && pkg_purge >/dev/null 2>&1
pkg_installed && rec FAIL 'precondition: package purged' '' || rec PASS 'precondition: not installed' ''

# ─── seed the user's own things ───
if [ $PM = apt ]; then
  pkg_install wireguard-tools nftables dbus-x11 gsettings-desktop-schemas libglib2.0-bin >/dev/null 2>&1 || pkg_install wireguard-tools nftables >/dev/null 2>&1
elif [ $PM = pacman ]; then
  pkg_install wireguard-tools nftables gsettings-desktop-schemas glib2 dbus >/dev/null 2>&1 || pkg_install wireguard-tools nftables >/dev/null 2>&1
else
  pkg_install wireguard-tools nftables gsettings-desktop-schemas glib2 dbus-daemon >/dev/null 2>&1 || pkg_install wireguard-tools nftables >/dev/null 2>&1
fi
sudo install -d -m 700 /etc/wireguard
K=$(wg genkey); PK=$(wg genkey | wg pubkey)
printf '[Interface]\nPrivateKey = %s\nAddress = 10.99.0.2/32\nTable = off\n\n[Peer]\nPublicKey = %s\nEndpoint = 192.0.2.10:51820\nAllowedIPs = 10.99.0.0/16\n' "$K" "$PK" | sudo tee /etc/wireguard/home-office.conf >/dev/null
sudo chmod 600 /etc/wireguard/home-office.conf
sudo wg-quick up home-office >/dev/null 2>&1; sudo ip route add 10.99.0.0/16 dev home-office 2>/dev/null
sudo nft add table inet userfw; sudo nft 'add chain inet userfw out { type filter hook output priority 0; policy accept; }'; sudo nft add rule inet userfw out ip daddr 198.51.100.7 drop
$G set org.gnome.system.proxy mode manual; $G set org.gnome.system.proxy.http host 'user.proxy.test'; $G set org.gnome.system.proxy.http port 3128
if [ $RESOLVED = 1 ]; then
  sudo ip link add userdns type dummy 2>/dev/null; sudo ip link set userdns up; sudo resolvectl dns userdns 9.9.9.9; sudo resolvectl domain userdns corp.example
elif [ $NM = 1 ]; then
  sudo nmcli con add type dummy ifname userdns con-name userdns ipv4.method manual ipv4.addresses 10.98.0.1/32 ipv4.dns 9.9.9.9 ipv4.dns-search corp.example ipv6.method disabled >/dev/null
  sudo nmcli con up userdns >/dev/null; sleep 2
elif [ -n "$DHC" ]; then
  # the user's DNS where a dhclient user sets it; dhclient then writes it into resolv.conf
  DHC_NEW=0; [ -e /etc/dhclient.conf ] || DHC_NEW=1   # the Arch image has none: remove it again after
  sudo touch /etc/dhclient.conf; sudo cp -p /etc/dhclient.conf /etc/dhclient.conf.ddv-dirty-orig
  printf 'prepend domain-name-servers 9.9.9.9;\nsupersede domain-search "corp.example";\n' | sudo tee -a /etc/dhclient.conf >/dev/null
  sudo systemctl restart "$DHC"
  for _ in $(seq 1 20); do grep -q 9.9.9.9 /etc/resolv.conf && break; sleep 1; done
else
  # the user's own lines at the top of /etc/resolv.conf (kept: the system resolver stays after them)
  sudo cp -p /etc/resolv.conf /etc/resolv.conf.ddv-dirty-orig
  { printf 'search corp.example\nnameserver 9.9.9.9\n'; grep -v '^search ' /etc/resolv.conf.ddv-dirty-orig; } | sudo tee /etc/resolv.conf.ddv-new >/dev/null
  sudo cp /etc/resolv.conf.ddv-new /etc/resolv.conf; sudo rm -f /etc/resolv.conf.ddv-new
fi
[ $FWD = 1 ] && sudo firewall-cmd -q --add-port=39999/tcp
RESOLV_BASE=$(cat /etc/resolv.conf)
BASE=$(mine)
echo "$BASE" > "$OUT/base.txt"
grep -q 'home-office' <<<"$BASE" && grep -q 'userfw' <<<"$BASE" && grep -q user.proxy.test <<<"$BASE" && grep -q 9.9.9.9 <<<"$BASE" && rec PASS 'seeded: own WireGuard tunnel, nft table, proxy, DNS' '' || rec FAIL 'seed' "$BASE"
DIRECT=$(curl -4 -s -m 12 https://api.ipify.org)

# ─── install + first run ───
if pkg_install "$DEB" > "$OUT/apt-install.log" 2>&1; then rec PASS 'install over a dirty machine' ''; else rec FAIL 'install' "$(tail -5 "$OUT/apt-install.log")"; fi
same 'after install'
if ! systemctl is-active -q dvpnd-client; then
  # wallet = DVPN_KEYFILE (key-file wallet); documented order: init → drivers → device setup → install
  cli daemon init >/dev/null 2>&1
  cli daemon repair-drivers --yes > "$OUT/drivers.log" 2>&1
  same 'after repair-drivers (apt pulled VPN tools)'
  cli device setup --allowance 50 --yes >/dev/null 2>&1; sleep 7
  cli daemon install --yes >/dev/null 2>&1; sleep 5
fi
systemctl is-active -q dvpnd-client && rec PASS 'service running' '' || rec FAIL 'service running' "$(systemctl status dvpnd-client 2>&1 | tail -5)"
same 'after first run'

# ─── kill switch session: the user's own tunnel and table must survive it and restore-network ───
cli daemon set --kill-switch on --yes >/dev/null; sleep 6
for n in "$WG" "$HY"; do
  hold
  if o=$(cli connect "$n" --units 1 --yes); then
    sleep 5
    e=$(curl -4 -s -m 12 https://api.ipify.org)
    [ "$e" != "$DIRECT" ] && [ -n "$e" ] && rec PASS "session with kill switch: egress $e" '' || rec FAIL 'session egress' "$e"
    same 'during a kill-switch session'
    sleep 7; hold; cli disconnect >/dev/null; sleep 3
    cli daemon restore-network >/dev/null; sleep 3
    same 'after disconnect + restore network'
    # without resolved the service writes /etc/resolv.conf for the session: it must come back exactly
    if [ $RESOLVED = 0 ]; then [ "$(cat /etc/resolv.conf)" = "$RESOLV_BASE" ] && rec PASS 'resolv.conf restored byte for byte' '' || rec FAIL 'resolv.conf not restored' "$(diff <(echo "$RESOLV_BASE") /etc/resolv.conf | head -8)"; fi
  else
    rec FAIL 'connect' "$o"
  fi
  sleep 7
done
cli daemon set --kill-switch off --yes >/dev/null; sleep 6
same 'kill switch off again'
[ "$(curl -4 -s -m 12 https://api.ipify.org)" = "$DIRECT" ] && rec PASS 'direct internet' '' || rec FAIL 'direct internet' ''

# ─── purge ───
if pkg_purge > "$OUT/apt-purge.log" 2>&1; then rec PASS 'purge' ''; else rec FAIL 'purge' "$(tail -5 "$OUT/apt-purge.log")"; fi
same 'after purge'
sudo nft list tables | grep -q 'inet dvpnd' && rec FAIL 'our nft table left after purge' '' || rec PASS 'no nft table of ours left' ''
ip -o link | grep -qE ' (dvpn-|hy2-client|ovpn-client)' && rec FAIL 'our links left after purge' "$(ip -o link | grep -E 'dvpn-|hy2|ovpn')" || rec PASS 'no tunnel links of ours left' ''
systemctl list-unit-files | grep -q dvpnd-client && rec FAIL 'unit left after purge' '' || rec PASS 'no service unit left' ''

# ─── put the machine back ───
sudo wg-quick down home-office >/dev/null 2>&1; sudo rm -f /etc/wireguard/home-office.conf
sudo nft delete table inet userfw
if [ $RESOLVED = 1 ]; then sudo ip link del userdns; elif [ $NM = 1 ]; then sudo nmcli con delete userdns >/dev/null
elif [ -n "$DHC" ]; then
  if [ "${DHC_NEW:-0}" = 1 ]; then sudo rm -f /etc/dhclient.conf; else sudo cp /etc/dhclient.conf.ddv-dirty-orig /etc/dhclient.conf; fi
  sudo rm -f /etc/dhclient.conf.ddv-dirty-orig; sudo systemctl restart "$DHC"
else sudo cp /etc/resolv.conf.ddv-dirty-orig /etc/resolv.conf && sudo rm -f /etc/resolv.conf.ddv-dirty-orig; fi
[ $FWD = 1 ] && sudo firewall-cmd -q --remove-port=39999/tcp
$G set org.gnome.system.proxy mode none
echo "dirty: passed $PASS failed $FAIL"; echo DONE >> "$OUT/run.out"
