#!/usr/bin/env bash
# ─── uifire install-service: the app's "Install service" button FIRED through pkexec on a desktop ───
# Run ON a Linux test VM (app installed, service set up). The service is stopped, so the app opens on
# the "Install the VPN service" step. A desktop user WITHOUT sudo (ddvdesk, group dvpn) runs the app in
# its own logind session with Xvfb, an unlocked keyring and the GNOME polkit agent (pkexec-gui.sh
# shape). The window clicks Install service; the agent's prompt gets a throwaway admin's password.
# EFFECT: the prompt appeared, the service is active again, the "service missing" warning is gone.
# Needs the final build (Q0305 Install service on the banner): a registered device never sees setup.
# Undo: the service is running (or started by hand if the click failed); throwaway users removed.
# Env: DVPN_KEYFILE (read-only test wallet; a ddvdesk-readable copy is made and removed).
set -u
export PATH="$PATH:/usr/sbin:/sbin"
: "${DVPN_KEYFILE:?set DVPN_KEYFILE}"
OUT=$HOME/ui/uifire-install-service; rm -rf "$OUT"; mkdir -p "$OUT"
FAILS=0
# ABW evidence (2026-10-29): the log ends with "INFO fired:", "INFO effect:", "INFO restore:" lines
FIRED=() EFF=()
check() {
  if [ "$2" = 1 ]; then echo "PASS  $1${3:+  ($3)}"; else echo "FAIL  $1${3:+  ($3)}"; FAILS=$((FAILS + 1)); fi
  case $1 in EFFECT:*) EFF+=("${1#EFFECT: } = $([ "$2" = 1 ] && echo PASS || echo FAIL)${3:+ ($3)}") ;; esac
}
SVC=dvpnd-client

# ─── packages + users (same as pkexec-gui.sh) ───
if command -v apt-get >/dev/null; then
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y policykit-1-gnome xvfb xdotool imagemagick dbus-x11 gnome-keyring >/dev/null 2>&1 \
    || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y polkit-gnome xvfb xdotool imagemagick dbus-x11 gnome-keyring >/dev/null 2>&1
  ADMGRP=sudo
elif command -v dnf >/dev/null; then sudo dnf -y install xorg-x11-server-Xvfb xdotool ImageMagick dbus-x11 gnome-keyring >/dev/null 2>&1
  sudo dnf -y install polkit-gnome >/dev/null 2>&1 || sudo dnf -y install mate-polkit >/dev/null 2>&1; ADMGRP=wheel
else sudo pacman -S --needed --noconfirm polkit-gnome xorg-server-xvfb xdotool imagemagick gnome-keyring >/dev/null 2>&1; ADMGRP=wheel; fi
AGENT=$(ls /usr/lib/policykit-1-gnome/polkit-gnome-authentication-agent-1 /usr/libexec/polkit-gnome-authentication-agent-1 \
  /usr/lib/polkit-gnome/polkit-gnome-authentication-agent-1 /usr/libexec/polkit-mate-authentication-agent-1 2>/dev/null | head -1)
[ -n "$AGENT" ] || { check 'polkit GTK agent present' 0; echo "RESULT uifire install-service: $FAILS FAIL"; exit 1; }
APW=$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 16)
id ddvadmin >/dev/null 2>&1 || sudo useradd -m -s /bin/bash -G "$ADMGRP" ddvadmin
echo "ddvadmin:$APW" | sudo chpasswd
ADMRULE=/etc/polkit-1/rules.d/00-ddvtest-admin.rules
echo 'polkit.addAdminRule(function (action, subject) { return ["unix-user:ddvadmin"]; });' | sudo tee "$ADMRULE" >/dev/null
ADMCONF=/etc/polkit-1/localauthority.conf.d/99-ddvtest-admin.conf
[ -d /etc/polkit-1/localauthority.conf.d ] && printf '%s\n' '[Configuration]' 'AdminIdentities=unix-user:ddvadmin' | sudo tee "$ADMCONF" >/dev/null && sudo systemctl restart polkit
sleep 2
id ddvdesk >/dev/null 2>&1 || sudo useradd -m -s /bin/bash -G dvpn ddvdesk
sudo -l -U ddvdesk 2>/dev/null | grep -q '(ALL' && check 'ddvdesk has no sudo rights' 0 || check 'ddvdesk has no sudo rights (only group dvpn)' 1

# ─── the service goes away: the app must offer Install service ───
sudo systemctl stop "$SVC"; sleep 2
check 'service stopped before the click' "$(systemctl is-active -q "$SVC" && echo 0 || echo 1)"
# final-pass INSTALL lines (FINAL-PASS-EFFECT-SPEC): a BEFORE and an AFTER
svc_line() { echo "INFO  $1 service $SVC unit present $(systemctl cat "$SVC" >/dev/null 2>&1 && echo True || echo False), running $(systemctl is-active -q "$SVC" && echo True || echo False), version $(devnet-dvpn daemon version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1 || true)"; }
svc_line BEFORE

W=/tmp/ddv-uifire-install; sudo rm -rf "$W"; sudo install -d -o ddvdesk -m 700 "$W" "$W/out" "$W/data" "$W/sig"
sudo install -o ddvdesk -m 600 "$DVPN_KEYFILE" "$W/key.json"
cat > "$W/session.sh" <<'EOS'
#!/bin/bash
# runs as ddvdesk in its own login session: X + bus + keyring + polkit agent + the app
W=$1; APW=$2; AGENT=$3; export DISPLAY=:7
Xvfb :7 -screen 0 1440x900x24 >/dev/null 2>&1 & XP=$!; sleep 2
eval "$(dbus-launch --sh-syntax)"
echo -n ddvtest | gnome-keyring-daemon --unlock --components=secrets >/dev/null 2>&1
"$AGENT" >/dev/null 2>&1 & AP=$!; sleep 3
# The prompt: wait for the agent's window, then the admin password (XTEST keys; no window manager).
( for _ in $(seq 1 240); do w=$(xdotool search --name 'Authenticat' 2>/dev/null | head -1); [ -n "$w" ] && break; sleep 0.5; done
  echo "window=${w:-}" > "$W/out/prompt.meta"
  if [ -n "${w:-}" ]; then sleep 2; import -window root "$W/out/prompt.png" 2>/dev/null; xdotool windowfocus --sync "$w" 2>/dev/null; sleep 0.5
    xdotool type --delay 40 "$APW"; sleep 0.3; xdotool key Return; fi ) & PP=$!
export DVPN_KEYFILE=$W/key.json DVPN_DATA_DIR=$W/data DVPN_UI_SIG_DIR=$W/sig DVPN_UI_SMOKE=$W/out DVPN_UI_SMOKE_THEME=dark DVPN_UI_SMOKE_WAIT_MS=6000
# A device already registered on chain (every runner) gets the main window with the "service lost"
# banner, whose button is Install service (Q0305, final build); a never-set-up device gets the setup
# screen's Install service. Click whichever shows, then the warning must go.
I='button[data-install-service], [data-onboarding-step=service] button.btn-primary'
export DVPN_UI_SCENARIO="count=$I:1;shot=service-missing;click=$I;sleep=60;gone=[data-setup-lost=service], [data-onboarding-step=service]:120;sleep=5;nav=Diagnostics;gone=[data-service-missing]:30;shot=after-install"
timeout 600 devnet-dvpn-desktop > "$W/out/app.log" 2>&1
kill $PP $AP $XP 2>/dev/null; kill "$DBUS_SESSION_BUS_PID" 2>/dev/null
echo SESSION-DONE > "$W/out/done"
EOS
chmod 755 "$W/session.sh"
sudo systemd-run --wait --collect --quiet --uid=ddvdesk -p PAMName=login \
  --setenv=PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" /bin/bash "$W/session.sh" "$W" "$APW" "$AGENT" > "$OUT/systemd-run.log" 2>&1
sudo cp -r "$W/out/." "$OUT/"; sudo chown -R "$(id -un)" "$OUT"

# ─── the window's steps, then the EFFECT from outside ───
if [ -f "$OUT/scenario.json" ]; then
  while IFS=$'\t' read -r ok step detail; do
    check "app: $step" "$ok" "$detail"
    [ "$ok" = 1 ] && case $step in click=*) FIRED+=("$step") ;; esac
  done < <(node -e '
    for (const s of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")))
      console.log([s.ok ? 1 : 0, s.step, String(s.detail ?? "").replace(/\s+/g, " ").slice(0, 220)].join("\t"));' "$OUT/scenario.json")
else
  check 'scenario.json written' 0 "$(tail -3 "$OUT/systemd-run.log" "$OUT/app.log" 2>/dev/null | tr '\n' ' ' | cut -c1-300)"
fi
check 'EFFECT: the polkit agent showed the admin prompt' "$(grep -q '^window=[0-9]' "$OUT/prompt.meta" 2>/dev/null && echo 1 || echo 0)" "$(cat "$OUT/prompt.meta" 2>/dev/null)"
check 'EFFECT: the service is active after Install service' "$(systemctl is-active -q "$SVC" && echo 1 || echo 0)" "$(systemctl is-active "$SVC")"
check 'EFFECT: the app reaches the service socket again' "$(devnet-dvpn daemon version >/dev/null 2>&1 && echo 1 || echo 0)"
svc_line AFTER
grep -q '^window=[0-9]' "$OUT/prompt.meta" 2>/dev/null && FIRED+=("polkit prompt answered with the admin password ($(cat "$OUT/prompt.meta"))")

# ─── undo: service running, throwaway users and rules gone ───
systemctl is-active -q "$SVC" || { echo 'INFO  service not running after the click: starting it by hand'; sudo systemctl start "$SVC"; sleep 5; }
sudo loginctl terminate-user ddvdesk 2>/dev/null; sleep 1
sudo rm -f "$ADMRULE" "$ADMCONF"; [ -d /etc/polkit-1/localauthority.conf.d ] && sudo systemctl restart polkit
sudo userdel -r ddvadmin 2>/dev/null; sudo userdel -r ddvdesk 2>/dev/null
sudo rm -rf "$W"
check 'undo: service active, throwaway users removed' "$(systemctl is-active -q "$SVC" && ! id ddvadmin >/dev/null 2>&1 && ! id ddvdesk >/dev/null 2>&1 && echo 1 || echo 0)"

# ─── ABW evidence lines: fired / effect / restore ───
j() { local s; s=$(printf '%s; ' "$@"); s=${s%; }; echo "${s:0:600}"; }
echo "INFO fired: ${#FIRED[@]} control(s) activated: $( [ ${#FIRED[@]} -gt 0 ] && j "${FIRED[@]}" || echo none)"
echo "INFO effect: $( [ ${#EFF[@]} -gt 0 ] && j "${EFF[@]}" || echo 'no EFFECT check')"
echo "INFO restore: service $(systemctl is-active "$SVC"); polkit test rules removed; users ddvadmin/ddvdesk $(id ddvadmin >/dev/null 2>&1 || id ddvdesk >/dev/null 2>&1 && echo 'STILL PRESENT' || echo removed); work dir removed"
check 'FIRED: the Install service button was clicked in the window' "$(printf '%s\n' "${FIRED[@]+"${FIRED[@]}"}" | grep -q '^click=' && echo 1 || echo 0)"
echo "RESULT uifire install-service: $FAILS FAIL"
exit $([ $FAILS = 0 ] && echo 0 || echo 1)
