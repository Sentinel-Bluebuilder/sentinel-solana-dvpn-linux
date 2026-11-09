#!/bin/bash
# ─── postrm (.deb postrm / .rpm %postun, electron-builder afterRemove) — runs as root ───
# Cleanup of networking ran in prerm (before-remove.sh). Here: the links and the polkit action.
# The device key home /var/lib/dvpnd is kept (on-chain permission + SOL; a reinstall reuses it).
# dpkg passes a word (remove|purge|upgrade|...); rpm passes how many copies stay installed
# (0 = removed, 1+ = upgrade: the new package's files are already in place, keep them);
# pacman passes the old version (post_remove runs only on a removal), e.g. 1.2.0-1 = removed.
set -u
case "${1:-remove}" in upgrade|failed-upgrade) exit 0 ;; *.*) ;; [1-9]*) exit 0 ;; esac
rm -f /usr/bin/devnet-dvpn /usr/bin/devnet-dvpn-desktop /usr/share/polkit-1/actions/network.sentinel.devnet-dvpn.policy /etc/polkit-1/rules.d/50-devnet-dvpn.rules /etc/sudoers.d/devnet-dvpn
if [ -f /etc/apparmor.d/devnet-dvpn ]; then
  command -v apparmor_parser >/dev/null && apparmor_parser -R /etc/apparmor.d/devnet-dvpn 2>/dev/null
  rm -f /etc/apparmor.d/devnet-dvpn
fi
# the rpm (fpm) does not own its folders: rpm removed the files and left 46 empty folders under
# /opt/devnet-dvpn (Rocky 9 + Fedora 44). Only EMPTY folders go; anything a user put there stays.
[ -d /opt/devnet-dvpn ] && find /opt/devnet-dvpn -depth -type d -empty -delete 2>/dev/null
exit 0
