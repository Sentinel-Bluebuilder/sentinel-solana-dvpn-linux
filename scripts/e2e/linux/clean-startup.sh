#!/bin/bash
# ─── clean-distro test VM: SSH hardening + network deadman ONLY (GCP startup-script, runs as root every boot) ───
# Idempotent. Client test VM for Devnet dVPN Linux: kernel 6.8 (AmneziaWG DKMS needs it,
# UPSTREAM-GAPS #23), desktop bits for the UI (Xvfb, Xfce, x11vnc), Node 22, build tools.
# A deadman (ddv-deadman.timer) restores the network if a test cuts it.
set -u
MARK=/var/lib/ddv-provisioned
log() { echo "[ddv-startup] $*" | tee -a /var/log/ddv-startup.log; }

# SSH: keys only, cap unauthenticated floods.
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/; s/^#\?MaxStartups.*/MaxStartups 30:50:100/' /etc/ssh/sshd_config
grep -q '^MaxStartups' /etc/ssh/sshd_config || echo 'MaxStartups 30:50:100' >> /etc/ssh/sshd_config
systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null

# Deadman: if the internet is unreachable for 3 checks in a row, release everything a
# test can leave behind (dvpnd kill switch table, tunnel links, protocol processes).
cat > /usr/local/sbin/ddv-deadman <<'DM'
#!/bin/bash
F=/run/ddv-deadman.fails
# A test that blocks egress on purpose touches /run/ddv-deadman.hold (honoured for 4 min).
if [ -f /run/ddv-deadman.hold ] && [ $(( $(date +%s) - $(stat -c %Y /run/ddv-deadman.hold) )) -lt 240 ]; then exit 0; fi
ok=0
for u in https://www.google.com https://1.1.1.1; do curl -s -m 8 -o /dev/null "$u" && ok=1 && break; done
if [ "$ok" = 1 ]; then echo 0 > $F; exit 0; fi
n=$(( $(cat $F 2>/dev/null || echo 0) + 1 )); echo $n > $F
[ "$n" -lt 3 ] && exit 0
logger -t ddv-deadman "network down 3x: releasing dvpnd state"
systemctl stop dvpnd-client 2>/dev/null
pkill -TERM -x hysteria2; pkill -TERM -x v2ray; pkill -TERM -x xray; pkill -TERM -x openvpn
for t in $(nft list tables 2>/dev/null | awk '$3 ~ /^dvpnd/ {print $2":"$3}'); do nft delete table "${t%%:*}" "${t#*:}"; done
for l in $(ip -o link show | awk -F': ' '{print $2}' | cut -d@ -f1 | grep -E '^(dvpn|wg|awg|tun|hy2)'); do ip link del "$l" 2>/dev/null; done
ip rule del table 51820 2>/dev/null; ip -6 rule del table 51820 2>/dev/null
ip rule del not fwmark 51820 table 51820 2>/dev/null
for pr in 8989 8990; do for _ in 1 2 3 4 5 6 7 8; do ip -4 rule del pref $pr 2>/dev/null || break; done; done
for tb in 8990 8991 8992 8993 8994 8995 8996 8997; do ip -4 route flush table $tb 2>/dev/null; done
ip -4 route flush table main proto 241 2>/dev/null
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
exit 0
