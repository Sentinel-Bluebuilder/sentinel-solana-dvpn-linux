#!/usr/bin/env bash
# host-firewall.sh allow|remove|units|remove-units — keep the machine's own firewall from blocking the Hysteria2 tunnel.
#
# Hysteria2's TUN hands each TCP connection to a local listener, so to the kernel it is a NEW inbound
# connection on dvpn-hy2-client. ufw with "deny incoming" (Ubuntu/Debian) or a firewalld zone that
# rejects new inbound (Fedora/RHEL) then drops every TCP connection while Hysteria2 says Connected
# (ddv-clean-deb12 and Fedora 44, 2026-10-22). The interface only carries traffic Hysteria2 injects.
#
# Called by setup-daemon.sh, by the service before each start, and by devnet-dvpn-firewall.path when
# ufw's rules change, so ufw installed or enabled AFTER the app is covered too. Idempotent: it reads
# before it writes, so the path unit does not trigger itself in a loop. Root only.
set -u
# cb33 (sentinel-dvpnd): EVERY protocol uses one link, dvpn-c0, so the link itself is never trusted: that
# would let a node open connections to this machine over a WireGuard/OpenVPN session. Measured on r2
# (0.1.11, 2026-11-07): Hysteria2's NAT traffic is TCP from the tun's own peer address to a listener on
# its own address, both inside the tun's /30 (100.100.100.102 -> .101; the v6 /126 likewise; fixed in
# sentinel-go-sdk hysteria2/templates/client.yaml.tmpl). Under ufw deny-incoming: https 0/3 without a
# rule, 3/3 with only this /30 allowed on dvpn-c0. So only that flow is allowed.
IFACE=dvpn-c0
V4=100.100.100.100/30
V6=2001::ffff:ffff:ffff:fff0/126
LEGACY_IFACE=dvpn-hy2-client # pre-cb33: the whole link was trusted; removed on sight
UFW_RULES=/etc/ufw/user.rules
UFW6_RULES=/etc/ufw/user6.rules
fwd() { command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; }
# firewalld: rich rules (source AND destination in the tun's own range) in the zone the link falls into.
# The destination is only local while the Hysteria2 tun is up, and strict rp_filter drops a spoofed
# source arriving on any other link.
rich4="rule family=\"ipv4\" source address=\"$V4\" destination address=\"$V4\" accept"
rich6="rule family=\"ipv6\" source address=\"$V6\" destination address=\"$V6\" accept"
zone() { firewall-cmd --get-zone-of-interface="$IFACE" 2>/dev/null || firewall-cmd --get-default-zone; }
legacy_remove() {
  if command -v ufw >/dev/null 2>&1 && grep -qs "in_$LEGACY_IFACE" "$UFW_RULES"; then
    ufw delete allow in on "$LEGACY_IFACE" >/dev/null 2>&1 || echo "could not remove the old ufw rule for $LEGACY_IFACE" >&2
  fi
  if fwd; then
    firewall-cmd -q --permanent --zone=trusted --remove-interface="$LEGACY_IFACE" >/dev/null 2>&1
    firewall-cmd -q --zone=trusted --remove-interface="$LEGACY_IFACE" >/dev/null 2>&1
  fi
}

case "${1:-}" in
  allow)
    legacy_remove
    if command -v ufw >/dev/null 2>&1; then
      grep -qsF -- "-A ufw-user-input -i $IFACE -d $V4 -s $V4 -j ACCEPT" "$UFW_RULES" ||
        ufw allow in on "$IFACE" from "$V4" to "$V4" comment 'Devnet dVPN: Hysteria2 tun NAT' >/dev/null 2>&1 ||
        echo "could not add the ufw rule for the Hysteria2 tun ($V4)" >&2
      if [ -f "$UFW6_RULES" ]; then
        grep -qsF -- "-A ufw6-user-input -i $IFACE -d $V6 -s $V6 -j ACCEPT" "$UFW6_RULES" ||
          ufw allow in on "$IFACE" from "$V6" to "$V6" comment 'Devnet dVPN: Hysteria2 tun NAT' >/dev/null 2>&1 ||
          echo "could not add the ufw rule for the Hysteria2 tun ($V6)" >&2
      fi
    fi
    if fwd; then
      z=$(zone)
      for r in "$rich4" "$rich6"; do
        firewall-cmd -q --permanent --zone="$z" --query-rich-rule="$r" ||
          firewall-cmd -q --permanent --zone="$z" --add-rich-rule="$r" ||
          echo "could not add the firewalld rule for the Hysteria2 tun (zone $z, permanent)" >&2
        firewall-cmd -q --zone="$z" --query-rich-rule="$r" ||
          firewall-cmd -q --zone="$z" --add-rich-rule="$r" ||
          echo "could not add the firewalld rule for the Hysteria2 tun (zone $z)" >&2
      done
    fi
    ;;
  remove)
    legacy_remove
    if command -v ufw >/dev/null 2>&1; then
      grep -qsF -- "-i $IFACE -d $V4 -s $V4" "$UFW_RULES" &&
        { ufw delete allow in on "$IFACE" from "$V4" to "$V4" >/dev/null 2>&1 || echo "could not remove the ufw rule ($V4)" >&2; }
      grep -qsF -- "-i $IFACE -d $V6 -s $V6" "$UFW6_RULES" &&
        { ufw delete allow in on "$IFACE" from "$V6" to "$V6" >/dev/null 2>&1 || echo "could not remove the ufw rule ($V6)" >&2; }
    fi
    if fwd; then
      for z in $(firewall-cmd --get-zones); do
        for r in "$rich4" "$rich6"; do
          firewall-cmd -q --permanent --zone="$z" --remove-rich-rule="$r" >/dev/null 2>&1
          firewall-cmd -q --zone="$z" --remove-rich-rule="$r" >/dev/null 2>&1
        done
      done
    fi
    ;;
  units) # write + start the watcher units (setup-daemon.sh, package upgrade)
    self=$(readlink -f "$0")
    cat > /etc/systemd/system/devnet-dvpn-firewall.service <<UNIT
# Written by Devnet dVPN (host-firewall.sh). Removed by its uninstaller.
[Unit]
Description=Devnet dVPN: keep the host firewall open for the Hysteria2 tunnel
# A burst of ufw edits (reset + a few rules) fires the path unit many times: with systemd's default
# start limit the service hit 'start-limit-hit' and the path unit failed for good (r2, 0.1.12). Each
# run is a cheap idempotent read, so no limit.
StartLimitIntervalSec=0

[Service]
Type=oneshot
ExecStart=/bin/bash "$self" allow
UNIT
    cat > /etc/systemd/system/devnet-dvpn-firewall.path <<UNIT
# Written by Devnet dVPN (host-firewall.sh). Removed by its uninstaller.
[Unit]
Description=Devnet dVPN: watch ufw's rules (ufw installed or enabled after the app)

[Path]
PathModified=$UFW_RULES

[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload
    systemctl enable --now devnet-dvpn-firewall.path >/dev/null 2>&1 || echo 'could not watch the ufw rules (devnet-dvpn-firewall.path)' >&2
    /bin/bash "$self" allow
    ;;
  remove-units)
    systemctl disable --now devnet-dvpn-firewall.path >/dev/null 2>&1
    rm -f /etc/systemd/system/devnet-dvpn-firewall.path /etc/systemd/system/devnet-dvpn-firewall.service
    systemctl daemon-reload
    ;;
  *) echo 'usage: host-firewall.sh allow|remove|units|remove-units' >&2; exit 2 ;;
esac
exit 0
