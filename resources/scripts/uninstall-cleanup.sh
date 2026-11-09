#!/bin/bash
# ─── Uninstall: leave networking exactly as it was before the app (root) ───
# Run by the package's prerm (and available as a dvpn-helper step):
#   1. every user's desktop system proxy back, if ours is still set (proxy-backup.json)
#   2. the service stopped gracefully (a clean stop ends the session and releases the kill
#      switch and DNS), disabled and its unit removed; its binary copies removed
#   3. anything a dead session left (remove-tunnels.sh)
# Kept: /var/lib/sentinel-dvpn/c0 and a pre-cb33 /var/lib/dvpnd (device key: on-chain permission + SOL; a reinstall picks it up again).
# Args: [--Result]
set -uo pipefail
here="$(dirname "$(readlink -f "$0")")"
source "$here/_lib.sh"
parse_args "$@"
log() { echo "uninstall-cleanup: $*"; }

# 1. system proxy, per user, through that user's own session bus when they are logged in
while IFS=: read -r user _ uid _ _ home _; do
  [ "$uid" -ge 1000 ] 2>/dev/null || continue
  b="$home/.config/Devnet dVPN/proxy-backup.json"
  [ -f "$b" ] || continue
  bus="/run/user/$uid/bus"
  # The backup holds the exact previous values (gsettings text form); restore only if still ours.
  if command -v python3 >/dev/null; then
    python3 - "$b" "$user" "$uid" "$bus" <<'PY'
import json, os, subprocess, sys
path, user, uid, bus = sys.argv[1:5]
saved = json.load(open(path))
st = saved.get('state') or {}
ours = saved.get('ours', '').replace('socks ', '')
host, _, port = ours.partition(':')
env = {'HOME': os.path.dirname(os.path.dirname(os.path.dirname(path))), 'PATH': '/usr/bin:/bin'}
if os.path.exists(bus): env['DBUS_SESSION_BUS_ADDRESS'] = 'unix:path=' + bus
def gs(*a):
    pre = ['runuser', '-u', user, '--'] + ([] if 'DBUS_SESSION_BUS_ADDRESS' in env else ['dbus-run-session', '--'])
    return subprocess.run(pre + ['gsettings', *a], env=env, capture_output=True, text=True).stdout.strip()
if st.get('backend') == 'gnome':
    if gs('get', 'org.gnome.system.proxy', 'mode') == "'manual'" and gs('get', 'org.gnome.system.proxy.socks', 'host') == f"'{host}'" and gs('get', 'org.gnome.system.proxy.socks', 'port') == port:
        vals = st.get('values', {})
        for k in sorted(vals, key=lambda k: k.endswith(' mode')):
            schema, key = k.rsplit(' ', 1)
            gs('set', schema, key, vals[k])
        print('uninstall-cleanup: system proxy restored for', user)
elif st.get('backend') == 'kde':
    # KDE keeps it in ~/.config/kioslaverc [Proxy Settings]; same "still ours" rule as the app.
    import shutil
    def tool(kind):
        for v in ('6', '5', ''):
            t = shutil.which(f'k{kind}config{v}')
            if t: return t
        return None
    rd, wr = tool('read'), tool('write')
    def kr(k):
        return subprocess.run(['runuser', '-u', user, '--', rd, '--file', 'kioslaverc', '--group', 'Proxy Settings', '--key', k], env=env, capture_output=True, text=True).stdout.strip()
    if rd and wr and kr('ProxyType') == '1' and kr('socksProxy') == f'socks://{host} {port}':
        for k, v in (st.get('values') or {}).items():
            args = ['--file', 'kioslaverc', '--group', 'Proxy Settings', '--key', k] + (['--delete'] if v == '' else [v])
            subprocess.run(['runuser', '-u', user, '--', wr, *args], env=env, capture_output=True, text=True)
        print('uninstall-cleanup: KDE system proxy restored for', user)
os.remove(path)
PY
  fi
done < /etc/passwd

# 2. service
# "Always" (persist) steps down to "on" first: the config stays in the kept home, and a reinstall's
# first service start re-applied the whole block from it, cutting the machine off before any setup
# (#31 #84 / 7d58e2d, dvpnd 45574d5 releases the row once the setting no longer asks for it).
# cb33 home: /var/lib/sentinel-dvpn/c0/config.toml; pre-cb33: /var/lib/dvpnd/client/client/config.toml.
for c in /var/lib/sentinel-dvpn/c0/config.toml /var/lib/dvpnd/*/client/config.toml; do
  [ -f "$c" ] || continue
  if grep -Eq "^kill_switch = ['\"]persist['\"]" "$c"; then
    # cat, not sed -i: the file keeps its owner and mode (cb33 wants 0600)
    sed -E "s/^kill_switch = ['\"]persist['\"]/kill_switch = 'on'/" "$c" > "$c.ks" && cat "$c.ks" > "$c" && rm -f "$c.ks" &&
      log "kill switch 'Always' stepped down to 'on' in $c"
    # keep it 'on' for the reinstall's first start too: migrate-daemon-config.sh would move it back to
    # persist. The marker sits next to that config.toml's home (0600: cb33 checks every file in c0).
    h="${c%/config.toml}"; h="${h%/client}"
    install -m 600 /dev/null "$h/.ks-stepped-down"
  fi
done
# cb33 service (sentinel-dvpnd@c0): its own uninstall disables it and removes its drop-in; ours go too.
# The template units stay while another instance (a node on this machine) is still enabled.
CB33=/usr/local/lib/devnet-dvpn/sentinel-dvpnd
if [ "$(systemctl show -p LoadState --value sentinel-dvpnd@c0.service 2>/dev/null)" = loaded ]; then
  if [ -x "$CB33" ]; then "$CB33" service uninstall --instance c0 >/dev/null 2>&1 || systemctl disable --now sentinel-dvpnd@c0.service sentinel-dvpnd@c0.socket 2>/dev/null
  else systemctl disable --now sentinel-dvpnd@c0.service sentinel-dvpnd@c0.socket 2>/dev/null; fi
  rm -rf /etc/systemd/system/sentinel-dvpnd@c0.service.d /etc/systemd/system/sentinel-dvpnd@c0.socket.d /etc/sentinel-dvpn/c0.env
  rmdir /etc/sentinel-dvpn 2>/dev/null
  others=$(find /etc/systemd/system -path '*.wants/sentinel-dvpnd@*' ! -name 'sentinel-dvpnd@c0.*' 2>/dev/null | head -1)
  if [ -z "$others" ] && grep -qs "$CB33" /etc/systemd/system/sentinel-dvpnd@.service; then
    rm -f /etc/systemd/system/sentinel-dvpnd@.service /etc/systemd/system/sentinel-dvpnd@.socket
  fi
  # setup-daemon's SELinux rule for the instance sockets: every instance uses it, so it goes with the last one
  if [ -z "$others" ] && command -v semanage >/dev/null && semanage fcontext -l -C 2>/dev/null | grep -qF "$STATE_ROOT/[^/]+/daemon\\.sock"; then
    semanage fcontext -d "$STATE_ROOT/[^/]+/daemon\\.sock" 2>/dev/null
  fi
  systemctl daemon-reload
  log 'service stopped and removed'
fi
# LoadState, not "systemctl cat" with its output thrown away: systemd 259 (Fedora 44) exits 141 there and the service was left behind
if [ "$(systemctl show -p LoadState --value dvpnd-client 2>/dev/null)" = loaded ]; then
  systemctl stop dvpnd-client 2>/dev/null; systemctl disable dvpnd-client 2>/dev/null
  rm -f /etc/systemd/system/dvpnd-client.service
  rm -rf /etc/systemd/system/dvpnd-client.service.d
  systemctl daemon-reload
  log 'old (pre-cb33) service stopped and removed'
fi
rm -rf /usr/local/lib/devnet-dvpn
# the SELinux file-context rule setup-daemon added for that folder (Fedora/EL)
command -v semanage >/dev/null && semanage fcontext -l -C 2>/dev/null | grep -q '^/usr/local/lib/devnet-dvpn' && semanage fcontext -d '/usr/local/lib/devnet-dvpn(/.*)?' 2>/dev/null
rm -f /etc/polkit-1/rules.d/50-devnet-dvpn.rules /etc/sudoers.d/devnet-dvpn
# the ufw rule / firewalld binding and the watcher units setup-daemon added for the Hysteria2 interface
/bin/bash "$here/host-firewall.sh" remove-units
/bin/bash "$here/host-firewall.sh" remove

# 3. leftovers of a dead session
/bin/bash "$here/remove-tunnels.sh" >/dev/null 2>&1 || true
write_result ok 'networking restored; service removed; device key kept in /var/lib/sentinel-dvpn/c0'
exit 0
