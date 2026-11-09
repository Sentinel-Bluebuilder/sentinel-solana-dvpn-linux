#!/usr/bin/env bash
# ─── pkexec admin prompt on a desktop, as a user WITHOUT sudo (run ON the VM, app installed) ───
# A desktop user `ddvdesk` (group dvpn, no sudo) in its own logind session, with Xvfb + a GNOME
# polkit agent on the display, runs `devnet-dvpn daemon set`: the root step goes through pkexec, so
# the agent must show the prompt. Approve with the admin password → "Applied and restarted.";
# Escape → "declined or closed" (exit 1) and the setting unchanged.
# The admin is a throwaway `ddvadmin` (sudo/wheel, random password); both users are removed after.
# Results: ~/pkexec/pkexec.tsv + screenshots. Usage: bash pkexec-gui.sh
set -u
export PATH="$PATH:/usr/sbin:/sbin"
OUT=~/pkexec; mkdir -p "$OUT"; TSV="$OUT/pkexec.tsv"; : > "$TSV"
PASS=0; FAIL=0
rec() { printf '%s\t%s\t%s\n' "$1" "$2" "$(printf '%s' "${3:-}" | tr '\n\t' '  ' | cut -c1-300)" >> "$TSV"; echo "$1 $2"; [ "$1" = PASS ] && PASS=$((PASS + 1)); [ "$1" = FAIL ] && FAIL=$((FAIL + 1)); true; }

# ─── packages: the GNOME polkit agent + X tools ───
if command -v apt-get >/dev/null; then
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y policykit-1-gnome xvfb xdotool imagemagick dbus-x11 >/dev/null 2>&1 \
    || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y polkit-gnome xvfb xdotool imagemagick dbus-x11 >/dev/null 2>&1
  ADMGRP=sudo
elif command -v dnf >/dev/null; then sudo dnf -y install xorg-x11-server-Xvfb xdotool ImageMagick dbus-x11 >/dev/null 2>&1
  # Fedora 44 dropped polkit-gnome; mate-polkit is its fork (same GTK "Authenticate" dialog)
  sudo dnf -y install polkit-gnome >/dev/null 2>&1 || sudo dnf -y install mate-polkit >/dev/null 2>&1; ADMGRP=wheel
else sudo pacman -S --needed --noconfirm polkit-gnome xorg-server-xvfb xdotool imagemagick >/dev/null 2>&1; ADMGRP=wheel; fi
AGENT=$(ls /usr/lib/policykit-1-gnome/polkit-gnome-authentication-agent-1 /usr/libexec/polkit-gnome-authentication-agent-1 \
  /usr/lib/polkit-gnome/polkit-gnome-authentication-agent-1 /usr/libexec/polkit-mate-authentication-agent-1 2>/dev/null | head -1)
[ -n "$AGENT" ] && rec PASS "polkit GTK agent present ($AGENT)" '' || { rec FAIL 'polkit GTK agent present' ''; echo "pkexec: passed $PASS  failed $FAIL"; exit 1; }

# ─── users: desktop user without sudo, throwaway admin with a password ───
APW=$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 16)
id ddvadmin >/dev/null 2>&1 || sudo useradd -m -s /bin/bash -G "$ADMGRP" ddvadmin
echo "ddvadmin:$APW" | sudo chpasswd
# The VM's own user is an admin too, so the agent would show a "Select user…" list instead of a
# password field. For the test only, polkit's admin identity is ddvadmin alone (removed after).
ADMRULE=/etc/polkit-1/rules.d/00-ddvtest-admin.rules
echo 'polkit.addAdminRule(function (action, subject) { return ["unix-user:ddvadmin"]; });' | sudo tee "$ADMRULE" >/dev/null
# polkit 0.105 (Ubuntu 22.04, Debian 12 ships 122) never reads rules.d: its admin list is the
# localauthority config. Without this the 22.04 prompt was a "Select user…" list (u2204b round 8).
ADMCONF=/etc/polkit-1/localauthority.conf.d/99-ddvtest-admin.conf
# polkitd 0.105 reads this only when it starts: restart it (no agent is registered yet).
[ -d /etc/polkit-1/localauthority.conf.d ] && printf '%s\n' '[Configuration]' 'AdminIdentities=unix-user:ddvadmin' | sudo tee "$ADMCONF" >/dev/null && sudo systemctl restart polkit
sleep 2
id ddvdesk >/dev/null 2>&1 || sudo useradd -m -s /bin/bash -G dvpn ddvdesk
sudo -l -U ddvdesk 2>/dev/null | grep -q '(ALL' && rec FAIL 'ddvdesk has no sudo rights' '' || rec PASS 'ddvdesk has no sudo rights (only group dvpn)' ''
# ddvdesk reaches the service socket through group dvpn
sudo -u ddvdesk test -w /var/lib/dvpnd/client/daemon.sock && rec PASS 'ddvdesk can use the service socket (group dvpn)' '' || rec FAIL 'ddvdesk cannot use the service socket' "$(ls -l /var/lib/dvpnd/client/daemon.sock 2>&1)"

# ─── the desktop session script, run as ddvdesk inside a real logind session ───
cat > /tmp/ddv-pk-session.sh <<'EOS'
#!/bin/bash
# runs as ddvdesk in its own login session: X + bus + polkit agent, then the two prompts
OUT=$1; APW=$2; AGENT=$3; export DISPLAY=:7
Xvfb :7 -screen 0 1280x800x24 >/dev/null 2>&1 & XP=$!; sleep 2
eval "$(dbus-launch --sh-syntax)"
"$AGENT" >/dev/null 2>&1 & AP=$!; sleep 3
loginctl show-session "$XDG_SESSION_ID" -p Type -p Active -p Remote > "$OUT/session.txt" 2>&1
pk() {   # <name> approve|decline
  devnet-dvpn daemon set --dns "$3" --yes > "$OUT/$1.log" 2>&1 & local cp=$!
  local w=''; for _ in $(seq 1 40); do w=$(xdotool search --name 'Authenticat' 2>/dev/null | head -1); [ -n "$w" ] && break; sleep 0.5; done
  echo "window=$w" >> "$OUT/$1.log.meta"
  [ -n "$w" ] && { sleep 2; import -window root "$OUT/$1-dialog.png" 2>/dev/null; xdotool getwindowname "$w" >> "$OUT/$1.log.meta"; }
  # no window manager on Xvfb: focus the dialog explicitly; keys go by XTEST (GTK ignores the
  # synthetic events of `xdotool --window`)
  if [ -n "$w" ]; then xdotool windowfocus --sync "$w" 2>/dev/null; sleep 0.5; fi
  if [ -n "$w" ] && [ "$2" = approve ]; then xdotool type --delay 40 "$APW"; sleep 0.3; xdotool key Return
  elif [ -n "$w" ]; then xdotool key Escape; sleep 2; xdotool search --name Authenticat >/dev/null 2>&1 && { xdotool windowfocus --sync "$w" 2>/dev/null; xdotool key Escape; }; fi
  wait $cp; echo "exit=$?" >> "$OUT/$1.log.meta"
}
pk approve approve cloudflare
sleep 5
pk decline decline handshake
kill $AP $XP 2>/dev/null; kill "$DBUS_SESSION_BUS_PID" 2>/dev/null
echo SESSION-DONE > "$OUT/done"
EOS
chmod 755 /tmp/ddv-pk-session.sh
sudo rm -rf /tmp/ddv-pk-out; sudo install -d -o ddvdesk /tmp/ddv-pk-out
DNS_BEFORE=$(sudo grep -h '^dns' /var/lib/dvpnd/client/client/config.toml 2>/dev/null | tr '\n' ' ')
# PAMName=login gives ddvdesk its own logind session (polkit binds the agent to that session).
# Started via /bin/bash: on EL9 (SELinux enforcing) a service may not EXECUTE a user_tmp_t file in /tmp
# (Rocky 10-24: the session never started, 20 s, no logs); reading it through bash is allowed everywhere.
sudo systemd-run --wait --collect --quiet --uid=ddvdesk -p PAMName=login \
  --setenv=PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" /bin/bash /tmp/ddv-pk-session.sh /tmp/ddv-pk-out "$APW" "$AGENT" > "$OUT/systemd-run.log" 2>&1
echo "systemd-run exit=$?" >> "$OUT/systemd-run.log"
sudo cp -r /tmp/ddv-pk-out/. "$OUT/"; sudo chown -R "$(id -un)" "$OUT"
# no session.txt = the desktop session never started: keep why (Rocky 16.30 run: 20 s, no logs)
[ -s "$OUT/session.txt" ] || { rec INFO 'ddvdesk session did not start' "$(tr '\n' ' ' < "$OUT/systemd-run.log")"
  sudo journalctl -q --since '-3 min' -o short-iso 2>/dev/null | grep -iE 'ddvdesk|ddv-pk|pam|run-u|avc' | tail -30 > "$OUT/session-journal.txt"; }
grep -q 'Type=' "$OUT/session.txt" 2>/dev/null && rec INFO "ddvdesk session: $(tr '\n' ' ' < "$OUT/session.txt")" ''

# ─── judge ───
grep -q '^window=[0-9]' "$OUT/approve.log.meta" 2>/dev/null && rec PASS 'approve: the polkit agent showed the prompt' "$(sed -n 2p "$OUT/approve.log.meta")" || rec FAIL 'approve: no prompt window' "$(cat "$OUT/approve.log" 2>/dev/null)"
grep -q 'Applied and restarted' "$OUT/approve.log" 2>/dev/null && grep -q '^exit=0' "$OUT/approve.log.meta" && rec PASS 'approve: admin password → "Applied and restarted." (exit 0)' '' || rec FAIL 'approve: not applied' "$(cat "$OUT/approve.log" "$OUT/approve.log.meta" 2>/dev/null)"
DNS_MID=$(sudo grep -h '^dns' /var/lib/dvpnd/client/client/config.toml 2>/dev/null | tr '\n' ' ')
grep -q '^window=[0-9]' "$OUT/decline.log.meta" 2>/dev/null && rec PASS 'decline: the prompt showed again' '' || rec FAIL 'decline: no prompt window' "$(cat "$OUT/decline.log" 2>/dev/null)"
grep -qi 'declined or closed' "$OUT/decline.log" 2>/dev/null && grep -q '^exit=1' "$OUT/decline.log.meta" && rec PASS 'decline: Escape → "declined or closed" (exit 1)' '' || rec FAIL 'decline: wrong outcome' "$(cat "$OUT/decline.log" "$OUT/decline.log.meta" 2>/dev/null)"
DNS_AFTER=$(sudo grep -h '^dns' /var/lib/dvpnd/client/client/config.toml 2>/dev/null | tr '\n' ' ')
[ "$DNS_AFTER" = "$DNS_MID" ] && rec PASS 'decline: setting unchanged' '' || rec FAIL 'decline changed the setting' "$DNS_MID → $DNS_AFTER"
echo "dns before: $DNS_BEFORE | after approve: $DNS_MID | after decline: $DNS_AFTER" >> "$OUT/dns.txt"
# final-pass effect line (PURE-UI shape): which prompts were really driven, and the setting each one left
nw=$(cat "$OUT/approve.log.meta" "$OUT/decline.log.meta" 2>/dev/null | grep -c '^window=[0-9]')
rec INFO "fired: $nw of 2 polkit prompts driven (approve = password + Return, decline = Escape); dns ${DNS_BEFORE:-?} -> ${DNS_MID:-?} -> ${DNS_AFTER:-?}" ''

# ─── cleanup: throwaway users gone, DNS back to the default preset ───
sudo loginctl terminate-user ddvdesk 2>/dev/null; sleep 1
sudo rm -f "$ADMRULE" "$ADMCONF"
[ -d /etc/polkit-1/localauthority.conf.d ] && sudo systemctl restart polkit
sudo userdel -r ddvadmin 2>/dev/null; sudo userdel -r ddvdesk 2>/dev/null
sudo rm -rf /tmp/ddv-pk-out /tmp/ddv-pk-session.sh
devnet-dvpn daemon set --dns handshake --yes >/dev/null 2>&1
{ id ddvadmin || id ddvdesk || sudo test -e "$ADMRULE" || sudo test -e "$ADMCONF"; } >/dev/null 2>&1 && rec FAIL 'throwaway users + admin rule removed' '' || rec PASS 'throwaway users + admin rule removed' ''
echo "pkexec: passed $PASS  failed $FAIL  (details $TSV)"
[ $FAIL = 0 ]
