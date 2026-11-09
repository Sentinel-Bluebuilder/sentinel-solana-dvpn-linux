#!/usr/bin/env bash
# ─── What a machine's networking looks like, for installer before/after diffs (#31 vm-fingerprint.ps1) ───
#   bash fingerprint.sh snap <file>          write a snapshot
#   bash fingerprint.sh diff <a> <b> [allow-regex]   print every difference not matching allow; exit 1 if any
# Covers: links, addresses, routes (all tables), ip rules, nft tables, resolved DNS per link,
# resolv.conf, systemd units + timers, dkms modules, loaded VPN modules, polkit/sudoers/apparmor
# files of ours, groups, PATH binaries, /usr/local/lib + /opt dirs, GNOME + KDE proxy, autostart;
# Fedora/EL: dnf repos, firewalld zones + direct rules, SELinux local modules/contexts/booleans,
# NetworkManager connections.
set -u
snap() {
  {
    echo '## links'; ip -o link | awk '{print $2, $3}' | sed -E 's/@[^:]*//'
    echo '## addrs'; ip -o addr | awk '{print $2, $3, $4}' | grep -v ' fe80:'
    echo '## routes'; ip route show table all | grep -vE '^(local|broadcast|multicast) |fe80::|proto kernel' | sort
    echo '## rules'; ip rule | sort; ip -6 rule | sort
    echo '## nft'; sudo nft list tables | sort
    echo '## dns'; resolvectl dns 2>/dev/null | sort; resolvectl domain 2>/dev/null | sort
    echo '## resolv.conf'; grep -v '^#' /etc/resolv.conf
    echo '## units'; systemctl list-unit-files --no-legend --type=service,timer,path,socket | awk '{print $1, $2}' | sort
    echo '## active'; systemctl list-units --no-legend --state=running --type=service | awk '{print $1}' | grep -vE '^(user@|session-|getty@)' | sort
    echo '## dkms'; dkms status 2>/dev/null | sort
    echo '## modules'; lsmod | awk 'NR>1{print $1}' | grep -E 'wireguard|amneziawg|tun|nf_tables' | sort
    echo '## files'; sudo ls -d /etc/polkit-1/rules.d/* /usr/share/polkit-1/actions/*dvpn* /etc/sudoers.d/* /etc/apparmor.d/*dvpn* /etc/apt/sources.list.d/* /usr/local/lib/devnet-dvpn /opt/devnet-dvpn /var/lib/dvpnd 2>/dev/null | sort
    echo '## groups'; getent group dvpn
    echo '## bins'; for b in devnet-dvpn dvpnd awg awg-quick wg wg-quick openvpn hysteria2 v2ray xray; do printf '%s %s\n' "$b" "$(command -v $b || echo -)"; done
    echo '## gnome-proxy'; for k in mode autoconfig-url; do printf '%s %s\n' "$k" "$(dbus-run-session -- gsettings get org.gnome.system.proxy $k 2>/dev/null)"; done
    for s in http https socks; do printf '%s %s:%s\n' "$s" "$(dbus-run-session -- gsettings get org.gnome.system.proxy.$s host 2>/dev/null)" "$(dbus-run-session -- gsettings get org.gnome.system.proxy.$s port 2>/dev/null)"; done
    echo '## kde-proxy'; grep -A8 '^\[Proxy Settings\]' ~/.config/kioslaverc 2>/dev/null
    echo '## autostart'; ls ~/.config/autostart 2>/dev/null
    # Fedora / EL: package repos (EPEL, Copr), firewalld, SELinux local changes, NetworkManager
    echo '## dnf-repos'; ls /etc/yum.repos.d 2>/dev/null | sort
    echo '## firewalld'; sudo firewall-cmd --state 2>/dev/null && { sudo firewall-cmd --list-all-zones 2>/dev/null | grep -vE '^\s*$'; sudo firewall-cmd --direct --get-all-rules 2>/dev/null; }
    echo '## selinux'; getenforce 2>/dev/null; sudo semodule -l 2>/dev/null | grep -iE 'dvpn|openvpn_local|local' ; sudo semanage fcontext -l -C 2>/dev/null | grep -v '^SELinux'; sudo semanage boolean -l -C 2>/dev/null | grep -v '^SELinux'
    echo '## nm-connections'; nmcli -t -f NAME,TYPE,DEVICE con show 2>/dev/null | grep -vE ':(tun|wireguard):(dvpn|hy2|ovpn|tun)' | sort
  } 2>/dev/null
}
case ${1:?snap|diff} in
  snap) snap > "${2:?file}"; echo "wrote $2 ($(wc -l < "$2") lines)" ;;
  diff)
    d=$(diff <(cat "${2:?a}") <(cat "${3:?b}") | grep -E '^[<>]' | grep -Ev "${4:-^$}")
    if [ -z "$d" ]; then echo 'no differences'; else echo "$d"; exit 1; fi ;;
esac
