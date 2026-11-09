#!/usr/bin/env bash
# ─── Install the test dead-man on a Linux test VM (any distro: apt, dnf, pacman). Run as root, idempotent ───
# If the internet is unreachable for 3 checks in a row (40 s apart), it releases everything a test can
# leave behind: stops dvpnd-client and any cb33 sentinel-dvpnd, kills protocol processes, deletes dvpnd* /
# sentinel-dvpn* / wg-quick-dvpn* nft tables, tunnel links and the 51820 rules. A test that cuts the network on purpose keeps /run/ddv-deadman.hold fresh (honoured
# 240 s from its last touch); cell.sh renews it every 30 s while the cell runs, so a dead cell stops
# renewing and the VM gets its network back within ~6 min. Callers: vm-startup.sh (GCP), cell.sh
# (self-provisions before a network-cutting cell), the fleet provisioners. Design: the internal network-cutting test runbook (not published).
set -u
[ "$(id -u)" = 0 ] || { echo "deadman-install: run as root" >&2; exit 1; }
cat > /usr/local/sbin/ddv-deadman <<'DM'
#!/bin/bash
F=/run/ddv-deadman.fails
if [ -f /run/ddv-deadman.hold ] && [ $(( $(date +%s) - $(stat -c %Y /run/ddv-deadman.hold) )) -lt 240 ]; then exit 0; fi
ok=0
for u in https://www.google.com https://1.1.1.1; do curl -s -m 8 -o /dev/null "$u" && ok=1 && break; done
if [ "$ok" = 1 ]; then echo 0 > $F; exit 0; fi
n=$(( $(cat $F 2>/dev/null || echo 0) + 1 )); echo $n > $F
[ "$n" -lt 3 ] && exit 0
logger -t ddv-deadman "network down 3x: releasing dvpnd state"
systemctl stop dvpnd-client 2>/dev/null
# cb33092e+ daemons (sentinel-dvpnd, per-instance tables sentinel-dvpn-<tag> / wg-quick-dvpn-<tag>). With
# kill_switch='persist' a stopped daemon KEEPS its table, so the tables go after the daemon is gone.
pkill -TERM -f 'sentinel-dvpnd run' ; for i in 1 2 3 4 5 6 7 8 9 10; do pgrep -f 'sentinel-dvpnd run' >/dev/null || break; sleep 1; done
pkill -KILL -f 'sentinel-dvpnd run'
pkill -TERM -x hysteria2; pkill -TERM -x v2ray; pkill -TERM -x xray; pkill -TERM -x openvpn
for t in $(nft list tables 2>/dev/null | awk '$3 ~ /^(dvpnd|sentinel-dvpn|wg-quick-dvpn)/ {print $2":"$3}'); do nft delete table "${t%%:*}" "${t#*:}"; done
for l in $(ip -o link show | awk -F': ' '{print $2}' | cut -d@ -f1 | grep -E '^(dvpn|wg|awg|tun|hy2)'); do ip link del "$l" 2>/dev/null; done
ip rule del table 51820 2>/dev/null; ip -6 rule del table 51820 2>/dev/null
ip rule del not fwmark 51820 table 51820 2>/dev/null
for p in 8989 8990; do while ip rule del pref $p 2>/dev/null; do :; done; done
echo 0 > $F
DM
chmod 755 /usr/local/sbin/ddv-deadman
cat > /etc/systemd/system/ddv-deadman.service <<'U'
[Unit]
Description=ddv test deadman (restore network)
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/ddv-deadman
U
cat > /etc/systemd/system/ddv-deadman.timer <<'U'
[Unit]
Description=ddv test deadman every 40 s
[Timer]
OnBootSec=60
OnUnitActiveSec=40
AccuracySec=5
[Install]
WantedBy=timers.target
U
systemctl daemon-reload
systemctl enable --now ddv-deadman.timer
systemctl is-active -q ddv-deadman.timer && echo "deadman-install: ddv-deadman.timer active"
