#!/bin/bash
# ─── The sentinel-dvpn group may start/restart sentinel-dvpnd@c0.service, and nothing else, without a password ───
#   start-right.sh install <polkit rule file>   (root; package postinst + setup-daemon.sh)
#   start-right.sh remove                       (root; uninstall)
# polkit 0.106+ reads JS rules from /etc/polkit-1/rules.d (50-devnet-dvpn.rules). polkit 0.105
# (Ubuntu 22.04, Debian 11) has no JS rules and no per-unit .pkla match, so there the same right is a
# sudoers drop-in naming exactly the two commands; the app runs them with `sudo -n` (found on
# ddv-clean-u2204b 2026-10-22: "Interactive authentication required" after an upgrade).
set -u
RULE=/etc/polkit-1/rules.d/50-devnet-dvpn.rules
SUDO=/etc/sudoers.d/devnet-dvpn
case "${1:-}" in
  install)
    if [ -d /etc/polkit-1/rules.d ]; then
      install -m 644 "${2:?rule file}" "$RULE" || exit 1
      rm -f "$SUDO"
      exit 0
    fi
    [ -d /etc/sudoers.d ] || exit 0
    tmp=$(mktemp) || exit 1
    {
      echo '# Devnet dVPN: polkit here has no JS rules (0.105), so the sentinel-dvpn group starts or restarts'
      echo '# its VPN service through sudo instead: these two commands only. Removed on uninstall.'
      for b in /usr/bin/systemctl /bin/systemctl; do
        echo "%sentinel-dvpn ALL=(root) NOPASSWD: $b start sentinel-dvpnd@c0.service, $b restart sentinel-dvpnd@c0.service"
      done
    } > "$tmp"
    if visudo -cqf "$tmp"; then install -m 440 -o root -g root "$tmp" "$SUDO"; rc=$?; else echo 'start-right: sudoers check failed' >&2; rc=1; fi
    rm -f "$tmp"
    exit $rc ;;
  remove) rm -f "$RULE" "$SUDO" ;;
  *) echo 'usage: start-right.sh install <rule> | remove' >&2; exit 3 ;;
esac
