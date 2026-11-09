#!/bin/bash
# ─── Install the VPN service (cb33 sentinel-dvpnd, client instance c0) (F1.5) ───
# Order matters: dvpnd refuses to start until its device key holds a grant, so the app first runs
# `sentinel-dvpnd init --instance c0 --home <staging>` as the user, the owner signs device setup, and
# only then this step runs as root (one prompt) to:
#   1. create the socket group sentinel-dvpn and add the user;
#   2. install root-owned copies of the binaries in /usr/local/lib/devnet-dvpn;
#   3. make /var/lib/sentinel-dvpn/c0 with the device key: the key goes in first, then root runs
#      `init` on the real folder (it keeps a key already there, and gives the folder cb33's own modes
#      and group), then the app's config text replaces init's;
#   4. publish what the app may read NEXT TO the folder (cb33 wants everything inside 0600/0700):
#      c0.device.pub (address only) and c0.config.toml (a copy, root:sentinel-dvpn 0640 + user ACL);
#   5. `sentinel-dvpnd service install --instance c0` (template unit + socket), plus our drop-ins;
#   6. start it, then delete the staging copy (it holds the device secret).
# Upgrade from a pre-cb33 install (--Config given): the old dvpnd-client service is removed, its
# device key becomes c0's operator key (same device, same grant), --Config is the c0 config the app
# rendered with the old settings carried in, and the old home is kept where it was.
# Args: --Dvpnd --Staging --DaemonHome --BinRoot --Group --Service [--User]
#       [--Config --LegacyHome --Owner --Device] --Result
set -uo pipefail
HERE="$(dirname "$(readlink -f "$0")")"
source "$HERE/_lib.sh"
parse_args "$@"
DVPND="${ARG[Dvpnd]:-}"; STAGING="${ARG[Staging]:-}"; HOME_DIR="${ARG[DaemonHome]:-}"
BIN_ROOT="${ARG[BinRoot]:-}"; GROUP="${ARG[Group]:-$DAEMON_GROUP}"; SERVICE="${ARG[Service]:-sentinel-dvpnd@c0}"
USER_NAME="${ARG[User]:-}"; CONFIG="${ARG[Config]:-}"; LEGACY="${ARG[LegacyHome]:-}"; OWNER="${ARG[Owner]:-}"; DEVICE="${ARG[Device]:-}"
B58='^[1-9A-HJ-NP-Za-km-z]{32,44}$'

[ -f "$DVPND" ] && [ -x "$DVPND" ] || die "sentinel-dvpnd not found at $DVPND"
[ "$(basename "$DVPND")" = sentinel-dvpnd ] || die 'unexpected daemon binary name'
[ "$(realpath -m "$HOME_DIR")" = "$STATE_ROOT/c0" ] || die "daemon home must be $STATE_ROOT/c0"
# the unit cb33 writes names this group; any other would leave the socket unreachable
[ "$GROUP" = "$DAEMON_GROUP" ] || die "socket group must be $DAEMON_GROUP"
[ "$SERVICE" = sentinel-dvpnd@c0 ] || die "bad service name $SERVICE"
if [ -n "$USER_NAME" ]; then id -u "$USER_NAME" >/dev/null 2>&1 || die "no such user $USER_NAME"; fi
if [ -n "$CONFIG" ]; then
  [ -f "$CONFIG" ] && [ ! -L "$CONFIG" ] && [ "$(stat -c %s "$CONFIG")" -le 65536 ] || die "bad staged config $CONFIG"
  [ "$(realpath -m "$LEGACY")" = /var/lib/dvpnd/client ] || die 'old service home must be /var/lib/dvpnd/client'
  [[ "$OWNER" =~ $B58 ]] && [[ "$DEVICE" =~ $B58 ]] || die 'owner and device must be Solana addresses'
fi
[ -z "$OWNER" ] || [[ "$OWNER" =~ $B58 ]] || die 'owner must be a Solana address'

# 1. socket group + the desktop user in it (new logins); ACLs below give THIS login access now.
getent group "$GROUP" >/dev/null || groupadd --system "$GROUP" || die "could not create group $GROUP"
[ -n "$USER_NAME" ] && usermod -aG "$GROUP" "$USER_NAME"

# 2. root-owned copies of the binaries the service runs. The app's own folder may be a user's
#    AppImage mount (root cannot read it, and it vanishes when the app quits) or a package dir
#    replaced on upgrade; the service must not depend on either. `service install` writes the
#    path of the binary that runs it into the unit, so it runs from here.
LIB=/usr/local/lib/devnet-dvpn
install -d -m 755 "$LIB" || die "could not create $LIB"
install -m 755 "$DVPND" "$LIB/sentinel-dvpnd.new" && mv -f "$LIB/sentinel-dvpnd.new" "$LIB/sentinel-dvpnd" || die 'could not install sentinel-dvpnd'
# host-firewall.sh runs from the service units, so it lives next to the daemon (an AppImage mount goes away)
install -m 755 "$HERE/host-firewall.sh" "$LIB/host-firewall.sh" || die 'could not install host-firewall.sh'
for d in v2ray xray hysteria2; do
  if [ -n "$BIN_ROOT" ] && [ -d "$BIN_ROOT/$d" ]; then
    rm -rf "$LIB/$d.new" && cp -r "$BIN_ROOT/$d" "$LIB/$d.new" && rm -rf "$LIB/$d" && mv "$LIB/$d.new" "$LIB/$d" || die "could not install $d"
  fi
done
chown -R root:root "$LIB"; chmod -R go-w "$LIB"
# SELinux (Fedora/EL): files under /usr/local/lib are lib_t, and a lib_t program started by
# systemd does not get the normal service domain: dvpnd failed every start with "preflight
# failed: rpc" (Rocky 9.8). Label the folder as programs (bin_t) -> unconfined_service_t, like any
# service binary in /usr/local/bin. A file-context rule survives relabels; chcon when semanage is absent.
if command -v selinuxenabled >/dev/null && selinuxenabled; then
  if command -v semanage >/dev/null; then
    semanage fcontext -a -t bin_t "$LIB(/.*)?" 2>/dev/null || semanage fcontext -m -t bin_t "$LIB(/.*)?" 2>/dev/null
    restorecon -R "$LIB"
  else
    chcon -R -t bin_t "$LIB"
  fi
  # cb33's socket unit listens on <home>/daemon.sock. systemd labels a new socket from the
  # file-context rules (var_lib_t here), and init_t may not create a sock_file of that type, so
  # the socket never appeared: "service started but its control socket did not appear" (Fedora 44,
  # Rocky 9.8, enforcing). var_run_t is what systemd's sockets in /run get. No chcon fallback: a
  # socket does not exist before systemd makes it, so the rule is the only way (the rpm depends on
  # semanage).
  if command -v semanage >/dev/null; then
    semanage fcontext -a -t var_run_t "$STATE_ROOT/[^/]+/daemon\\.sock" 2>/dev/null ||
      semanage fcontext -m -t var_run_t "$STATE_ROOT/[^/]+/daemon\\.sock" 2>/dev/null
  else
    echo 'SELinux is on but semanage is missing (policycoreutils-python-utils): the service socket may be refused' >&2
  fi
fi
DVPND="$LIB/sentinel-dvpnd"

# 3. the instance folder
# opkey <home>: the signing key's address in that home ("operator"; "device" in a pre-cb33 home)
opkey() {
  local out; out=$("$DVPND" key list --instance c0 --home "$1" 2>/dev/null)
  for n in operator device; do
    printf '%s' "$out" | grep -oE "\"name\":\"$n\",\"public_key\":\"[1-9A-HJ-NP-Za-km-z]{32,44}\"" | grep -oE '[1-9A-HJ-NP-Za-km-z]{32,44}"$' | tr -d '"' | head -1 | grep . && return 0
  done
  return 0
}
KEY_SRC=""; CFG_SRC=""; WANT=""
if [ -n "$CONFIG" ]; then
  # Upgrade: the old service goes first (it holds the old socket and kill switch).
  # The old daemon kept keys under its role folder: <home>/client/keys (r2: /var/lib/dvpnd/client/client/
  # keys/device.json; same in #31 migrate-home.ts). Same plain format in cb33, so a copy is enough.
  KEY_SRC="$LEGACY/client/keys/device.json"
  [ -f "$KEY_SRC" ] || KEY_SRC="$LEGACY/keys/device.json"
  [ -f "$KEY_SRC" ] || die "the old service home has no device key ($LEGACY/client/keys/device.json)"
  WANT="$DEVICE"; CFG_SRC="$CONFIG"
  if [ "$(systemctl show -p LoadState --value dvpnd-client 2>/dev/null)" = loaded ]; then
    systemctl disable --now dvpnd-client >/dev/null 2>&1
  fi
  rm -f /etc/systemd/system/dvpnd-client.service && rm -rf /etc/systemd/system/dvpnd-client.service.d
  systemctl daemon-reload
  echo "old dvpnd-client service removed; its home stays at $LEGACY" >&2
elif [ -n "$STAGING" ] && [ -f "$STAGING/config.toml" ]; then
  KEY_SRC="$STAGING/keys/operator.json"
  [ -f "$KEY_SRC" ] || die "staging home has no operator key: $STAGING"
  WANT="$(opkey "$STAGING")"; CFG_SRC="$STAGING/config.toml"
  [ -n "$WANT" ] || die 'could not read the staged device key'
  # A wallet switch stages a NEW device key (fleet W1, #31): an existing service home must not win, or the
  # staged key is deleted below while the app shows the new device as ready. Staged key ≠ installed key →
  # stop the service and keep the old home next to it (its deposits can still be settled), then install.
  if [ -f "$HOME_DIR/config.toml" ]; then
    OLD_KEY="$(opkey "$HOME_DIR")"
    if [ "$WANT" != "$OLD_KEY" ]; then
      PREV="$HOME_DIR.prev-$(date -u +%Y%m%dT%H%M%SZ)"
      systemctl stop "$SERVICE.socket" "$SERVICE.service" 2>/dev/null
      mv -- "$HOME_DIR" "$PREV" || die "could not keep the old service home as $PREV"
      echo "new device $WANT staged; the old home (device ${OLD_KEY:-unknown}) is kept at $PREV" >&2
    fi
  fi
fi
if [ ! -f "$HOME_DIR/config.toml" ]; then
  [ -n "$KEY_SRC" ] || die "nothing to install: no staged home and no service home at $HOME_DIR"
  [ -n "$OWNER" ] || OWNER="$(grep -m1 -oE "^owner *= *'[1-9A-HJ-NP-Za-km-z]{32,44}'" "$CFG_SRC" | grep -oE '[1-9A-HJ-NP-Za-km-z]{32,44}')"
  [[ "$OWNER" =~ $B58 ]] || die 'could not tell the wallet that owns this device'
  install -d -m 755 -o root -g root "$STATE_ROOT" && install -d -m 750 "$HOME_DIR" && install -d -m 700 "$HOME_DIR/keys" || die "could not create $HOME_DIR"
  install -m 600 -o root -g root "$KEY_SRC" "$HOME_DIR/keys/operator.json" || die 'could not place the device key'
  # no --home: init on the instance folder itself gives the state root and the folder group sentinel-dvpn
  "$DVPND" init --instance c0 --owner "$OWNER" --plain-key >/dev/null || die 'sentinel-dvpnd init failed for the service home'
  GOT="$(opkey "$HOME_DIR")"
  [ "$GOT" = "$WANT" ] || die "the service home has device ${GOT:-none}, expected $WANT"
  cat "$CFG_SRC" > "$HOME_DIR/config.toml" || die 'could not write the service settings'
fi
# a home from an older build still has the old key names / an "on" kill switch (Q0426)
/bin/bash "$HERE/migrate-daemon-config.sh" --DaemonHome "$HOME_DIR" >/dev/null || die 'could not update the service settings to the new key names'
# dvpnd's Linux default DNS mode is resolvectl (systemd-resolved). Systems without resolved
# (EL9: NetworkManager owns /etc/resolv.conf) use resolvconf mode = dvpnd writes resolv.conf
# for the session and puts the old file back.
CFG="$HOME_DIR/config.toml"
if ! systemctl is-active -q systemd-resolved 2>/dev/null; then
  if grep -qE "^dns_backend *= *['\"]resolvectl['\"]" "$CFG"; then
    sed -i -E "s/^dns_backend *= *['\"]resolvectl['\"]/dns_backend = 'resolvconf'/" "$CFG"
  elif ! grep -q '^dns_backend' "$CFG"; then
    if grep -q '^\[network\]' "$CFG"; then sed -i "/^\[network\]/a dns_backend = 'resolvconf'" "$CFG"
    else printf "\n[network]\ndns_backend = 'resolvconf'\n" >> "$CFG"; fi
  fi
fi
# cb33's modes, exactly (doctor reports anything looser as exposed): state root + folder 0750 group
# sentinel-dvpn, every folder inside 0700, every file 0600, all root. `sed -i` above made a new file.
chown -R root:root "$HOME_DIR"; chgrp "$GROUP" "$STATE_ROOT" "$HOME_DIR"; chmod 750 "$STATE_ROOT" "$HOME_DIR"
find "$HOME_DIR" -mindepth 1 -type d -exec chmod 700 {} +
find "$HOME_DIR" -type f -exec chmod 600 {} +
# SELinux (Fedora/EL): files copied from the user's folder keep its label (user_home_t), and the
# service was refused its own lock file (daemon.lock: permission denied, Rocky 9.8).
command -v restorecon >/dev/null && restorecon -R "$STATE_ROOT" 2>/dev/null

# 4. what the app reads, next to the folder: the device ADDRESS, and a copy of the settings
PUB="$(opkey "$HOME_DIR")"
[ -n "$PUB" ] || die 'could not read the device public key'
printf '%s\n' "$PUB" > "$(pub_path "$HOME_DIR")" && chmod 644 "$(pub_path "$HOME_DIR")"
refresh_mirror "$HOME_DIR" "$USER_NAME" || die 'could not publish the settings copy for the app'
# this login is not in the group until it logs in again: let it through the two 0750 folders now
if [ -n "$USER_NAME" ] && command -v setfacl >/dev/null; then
  setfacl -m "u:$USER_NAME:x" "$STATE_ROOT" "$HOME_DIR" 2>/dev/null
fi

# 5. the service: cb33's own units, then ours as drop-ins (cb33 keeps other files in the drop-in folder)
"$DVPND" service install --instance c0 >/dev/null || die 'sentinel-dvpnd service install failed'
# PATH for the service (EnvironmentFile in cb33's unit): our tool copies FIRST, so a same-named
# program elsewhere on the PATH never runs as root in their place.
SVC_PATH=""
for d in v2ray xray hysteria2; do [ -d "$LIB/$d" ] && SVC_PATH="$SVC_PATH$LIB/$d:"; done
SVC_PATH="${SVC_PATH}/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
install -d -m 755 /etc/sentinel-dvpn
printf '# Written by Devnet dVPN (setup-daemon.sh)\nPATH=%s\n' "$SVC_PATH" > /etc/sentinel-dvpn/c0.env && chmod 644 /etc/sentinel-dvpn/c0.env
# Backoff: cb33 restarts every 5 s forever, and each failed preflight (a device without its grant, a
# busy RPC) spends RPC calls: Rocky 9 hit 118 restarts and the public RPC throttled it. systemd ≥ 254
# grows the gap 5 s → 5 min; older systemd (EL9 252, Ubuntu 22.04 249) ignores that, so a flat 20 s.
SD_VER=$(systemctl --version 2>/dev/null | awk 'NR==1{print $2+0}')
BACKOFF='RestartSteps=8
RestartMaxDelaySec=300'
[ "${SD_VER:-0}" -lt 254 ] && BACKOFF='RestartSec=20'
DROP="/etc/systemd/system/$SERVICE.service.d"
install -d -m 755 "$DROP"
# '+' = outside the unit's ProtectSystem=strict sandbox: host-firewall.sh changes ufw / firewalld.
# data.db needs no chmod any more: sentinel-dvpnd runs with umask 077, so it and -wal/-shm are 0600.
cat > "$DROP/50-devnet-dvpn.conf" <<UNIT
# Written by Devnet dVPN (setup-daemon.sh). Removed by its uninstaller.
[Service]
ExecStartPre=-+/bin/bash $LIB/host-firewall.sh allow
$BACKOFF
UNIT
# The socket is systemd's (cb33's .socket unit, 0660 group sentinel-dvpn): give this login rw on it each
# time systemd creates it. It outlives service restarts, so a crash no longer leaves a socket without the ACL.
SDROP="/etc/systemd/system/$SERVICE.socket.d"
if [ -n "$USER_NAME" ] && SETFACL="$(command -v setfacl)"; then
  install -d -m 755 "$SDROP"
  printf '# Written by Devnet dVPN (setup-daemon.sh). Removed by its uninstaller.\n[Socket]\nExecStartPost=-%s -m u:%s:rw %s/daemon.sock\n' "$SETFACL" "$USER_NAME" "$HOME_DIR" > "$SDROP/50-devnet-dvpn.conf"
else
  rm -rf "$SDROP"
fi
# the sentinel-dvpn group may start/restart this unit only (the app starts it after device setup)
RULE_SRC="$HERE/../polkit/50-devnet-dvpn.rules"
# (polkit 0.105 has no JS rules: start-right.sh writes the same right as a sudoers drop-in there)
if [ -f "$RULE_SRC" ]; then
  /bin/bash "$HERE/start-right.sh" install "$RULE_SRC" || die 'could not install the right to start the service'
fi
# Host firewall (ufw / firewalld) must not block the Hysteria2 tunnel: see host-firewall.sh. Applied
# now, before every service start (ExecStartPre above), and whenever ufw's rules change.
/bin/bash "$LIB/host-firewall.sh" units
systemctl daemon-reload

# 6. start. L7: the first start can hit a busy public RPC (429 on the websocket dial / preflight) and
# exit; systemd restarts it and it is up seconds later. Wait for ACTIVE + socket, and retry 5/10/20 s
# while the journal of THIS start shows the RPC failure (same pattern as apply-daemon-config.sh).
up() { for _ in $(seq 1 150); do [ -S "$HOME_DIR/daemon.sock" ] && systemctl is-active -q "$SERVICE.service" && return 0; sleep 0.2; done; return 1; }
RPC_FAIL='preflight failed: rpc|connecting rpc: '
t0=$(date +%s)
ok=0
systemctl restart "$SERVICE.socket" && systemctl restart "$SERVICE.service" && up && ok=1
for wait in 5 10 20; do
  [ $ok = 1 ] && break
  journalctl -u "$SERVICE.service" --since "@$t0" --no-pager -o cat 2>/dev/null | grep -qE "$RPC_FAIL" || break
  echo "service start: RPC check failed (endpoint busy?); retrying in ${wait}s" >&2
  sleep "$wait"
  # systemd may already have restarted it by itself: only restart when it is not coming up
  up && { ok=1; break; }
  systemctl restart "$SERVICE.service" && up && ok=1
done
if [ $ok = 0 ]; then
  if journalctl -u "$SERVICE.service" --since "@$t0" --no-pager -o cat 2>/dev/null | grep -qE "$RPC_FAIL"; then
    die "the VPN service could not reach the Solana RPC endpoint to start (busy or down). Try again in a minute, or set another RPC endpoint."
  fi
  if [ -S "$HOME_DIR/daemon.sock" ]; then
    die "service failed to start: $(journalctl -u "$SERVICE.service" -n 5 --no-pager -o cat 2>/dev/null | tail -3)"
  fi
  die "service started but its control socket did not appear: $(journalctl -u "$SERVICE.service" -n 5 --no-pager -o cat 2>/dev/null | tail -3)"
fi
[ -n "$STAGING" ] && [ -d "$STAGING" ] && rm -rf -- "$STAGING"
[ -n "$CONFIG" ] && rm -f -- "$CONFIG"
write_result ok 'service installed and running'
