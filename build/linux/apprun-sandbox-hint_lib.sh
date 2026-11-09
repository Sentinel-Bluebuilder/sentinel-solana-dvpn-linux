# ─── devnet-dvpn: sandbox hint (inserted into the AppImage's AppRun by scripts/appimage-apprun.mjs) ───
# Ubuntu 24.04+ restricts unprivileged user namespaces through AppArmor. Chromium then falls back
# to its SUID helper, which cannot be setuid inside an AppImage mount, and aborts before any app
# code runs (docs/INSTALLER.md). This only explains the fix. It never turns the sandbox off: the
# app still starts exactly as asked. DVPN_USERNS_SYSCTL / DVPN_NO_SANDBOX_HINT exist for tests.
dvpn_sandbox_hint() {
  local f="${DVPN_USERNS_SYSCTL:-/proc/sys/kernel/apparmor_restrict_unprivileged_userns}" a msg
  [ -n "${DVPN_NO_SANDBOX_HINT:-}" ] && return 0
  for a in "$@"; do [ "$a" = "--no-sandbox" ] && return 0; done
  [ "$(cat "$f" 2>/dev/null)" = 1 ] || return 0
  # Restricted, but this user may still map root in a new user namespace (an AppArmor profile allows it).
  unshare --user --map-root-user true > /dev/null 2>&1 && return 0
  msg="Devnet dVPN: this system blocks the browser sandbox for AppImages (AppArmor setting on Ubuntu 24.04 and later), so the app will stop at once.
Start it with:   \"${APPIMAGE:-$0}\" --no-sandbox
or install the .deb package, which keeps the sandbox on."
  echo "$msg" >&2
  # Started from a desktop (no terminal to read stderr): show the same words in a dialog.
  if [ ! -t 2 ] && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    if [ -x /usr/bin/zenity ]; then
      LD_LIBRARY_PATH="" zenity --warning --no-wrap --text "$msg" 2> /dev/null || true
    elif [ -x /usr/bin/kdialog ]; then
      LD_LIBRARY_PATH="" kdialog --sorry "$msg" 2> /dev/null || true
    fi
  fi
  return 0
}
dvpn_sandbox_hint "${args[@]}"
# ─── end devnet-dvpn sandbox hint ───
