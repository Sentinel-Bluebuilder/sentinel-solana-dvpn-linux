#!/bin/bash
# ─── prerm (.deb prerm / .rpm %preun, fpm --before-remove) — runs as root while the app files still exist ───
# On remove/purge (NOT on upgrade): put networking back exactly as before the app.
# dpkg: remove|purge (upgrade = anything else); rpm: 0 = removed, 1+ = upgrade;
# pacman (pre_remove, only ever called on a removal — upgrades use pre_upgrade): the old version.
set -u
case "${1:-remove}" in remove|purge|0|*.*) ;; *) exit 0 ;; esac
/bin/bash /opt/devnet-dvpn/resources/resources/scripts/uninstall-cleanup.sh --Result '' || true
exit 0
