#!/bin/bash
# ─── .deb postinst (electron-builder afterInstall) — runs as root ───
# 1. desktop launcher link + CLI on PATH   2. polkit action for our ONE root helper
# 3. socket group   4. driver report   5. on upgrade: refresh the service's binaries + restart
set -u
APP=/opt/devnet-dvpn
ln -sf "$APP/devnet-dvpn-desktop" /usr/bin/devnet-dvpn-desktop
ln -sf "$APP/bin/devnet-dvpn" /usr/bin/devnet-dvpn
chmod 755 "$APP/bin/devnet-dvpn" "$APP/resources/resources/scripts/dvpn-helper" "$APP/resources/resources/scripts/"*.sh 2>/dev/null
# chrome-sandbox must be setuid root for Electron's sandbox (kernels without user namespaces)
[ -f "$APP/chrome-sandbox" ] && chown root:root "$APP/chrome-sandbox" && chmod 4755 "$APP/chrome-sandbox"
# Ubuntu 24.04+ (apparmor_restrict_unprivileged_userns=1) blocks Chromium's user-namespace sandbox
# unless the binary has an AppArmor profile allowing userns; without it the app dies at launch
# (zygote / GPU process). Same profile Chrome and VS Code ship.
if [ -d /etc/apparmor.d ] && [ -e /etc/apparmor.d/abi/4.0 ]; then
  cat > /etc/apparmor.d/devnet-dvpn <<'AA'
abi <abi/4.0>,
include <tunables/global>

profile devnet-dvpn /opt/devnet-dvpn/devnet-dvpn-desktop flags=(unconfined) {
  userns,
  include if exists <local/devnet-dvpn>
}
AA
  command -v apparmor_parser >/dev/null && apparmor_parser -r -T -W /etc/apparmor.d/devnet-dvpn || true
fi

mkdir -p /usr/share/polkit-1/actions
cat > /usr/share/polkit-1/actions/network.sentinel.devnet-dvpn.policy <<'POL'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE policyconfig PUBLIC "-//freedesktop//DTD PolicyKit Policy Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/PolicyKit/1/policyconfig.dtd">
<policyconfig>
  <vendor>Devnet dVPN</vendor>
  <action id="network.sentinel.devnet-dvpn.helper">
    <description>Change the Devnet dVPN service</description>
    <message>Devnet dVPN needs administrator permission to set up or change its VPN service.</message>
    <icon_name>devnet-dvpn-desktop</icon_name>
    <defaults>
      <allow_any>auth_admin</allow_any>
      <allow_inactive>auth_admin</allow_inactive>
      <allow_active>auth_admin_keep</allow_active>
    </defaults>
    <annotate key="org.freedesktop.policykit.exec.path">/opt/devnet-dvpn/resources/resources/scripts/dvpn-helper</annotate>
  </action>
</policyconfig>
POL

getent group sentinel-dvpn >/dev/null || groupadd --system sentinel-dvpn
mkdir -p /var/lib/devnet-dvpn
/bin/bash "$APP/resources/resources/scripts/install-deps.sh" --CheckOnly 1 --OutDir /var/lib/devnet-dvpn >/dev/null 2>&1 || true

# Upgrade over an installed cb33 service (sentinel-dvpnd@c0): give it the new binaries, update its
# settings, restart it (a clean stop ends any session; a persist kill switch keeps blocking meanwhile).
S="$APP/resources/resources/scripts"
LIB=/usr/local/lib/devnet-dvpn
if [ -f /etc/systemd/system/sentinel-dvpnd@.service ] && [ -f /var/lib/sentinel-dvpn/c0/config.toml ] && [ -d "$LIB" ]; then
  B="$APP/resources/resources/bin"
  install -m 755 "$B/sentinel-dvpnd" "$LIB/sentinel-dvpnd.new" && mv -f "$LIB/sentinel-dvpnd.new" "$LIB/sentinel-dvpnd"
  for d in v2ray xray hysteria2; do [ -d "$B/$d" ] && rm -rf "$LIB/$d" && cp -r "$B/$d" "$LIB/$d"; done
  chown -R root:root "$LIB"; chmod -R go-w "$LIB"
  # SELinux: service binaries are programs (bin_t), as setup-daemon.sh labels them
  command -v selinuxenabled >/dev/null && selinuxenabled && chcon -R -t bin_t "$LIB"
  install -m 755 "$S/host-firewall.sh" "$LIB/host-firewall.sh"
  /bin/bash "$LIB/host-firewall.sh" units || true
  # renamed keys and an "on" kill switch (Q0426) before the new binary starts; then the app's copy
  /bin/bash "$S/migrate-daemon-config.sh" --DaemonHome /var/lib/sentinel-dvpn/c0 || true
  ( source "$S/_lib.sh" && refresh_mirror /var/lib/sentinel-dvpn/c0 ) || true
  /bin/bash "$S/start-right.sh" install "$APP/resources/resources/polkit/50-devnet-dvpn.rules" || true
  systemctl daemon-reload
  systemctl try-restart sentinel-dvpnd@c0.service || true
fi
# A pre-cb33 service (dvpnd-client) is left running on the binary it already has: moving it to c0 needs
# the app (it renders the c0 settings from the old ones), which does it at its next "Install service"
# with one administrator prompt (setup-daemon.sh --Config ...), keeping the same device key.
if [ -f /etc/systemd/system/dvpnd-client.service ]; then
  echo 'Devnet dVPN: open the app and install the service again to move it to the new VPN service (same device).'
fi
command -v update-desktop-database >/dev/null && update-desktop-database -q /usr/share/applications || true
exit 0
