#!/bin/bash
# ─── Upgrade an older preset's DNS list in dvpnd's client config (Q0365, Android a4a57c2) ───
# Settings shows the 2-server Handshake list upgraded to the current preset (Q0267: + 1.1.1.1), but
# dvpnd's own file kept the old pair until the user saved Settings, so the tunnel raced two lossy
# servers with no fallback (u24b lab 10-30). Only the exact old default is replaced, in its order:
# a custom list, a picked preset, another order, one of the pair, or the pair plus another server
# stay as they are. Run by migrate-daemon-config.sh (root, package upgrade and setup).
# Usage: upgrade-dns-list.sh <client/config.toml>   (prints "upgraded" when it changed the file)
set -uo pipefail
source "$(dirname "$(readlink -f "$0")")/_lib.sh"   # atomic_write (D6)
f="${1:-}"
[ -f "$f" ] || exit 0
OLD="^([[:space:]]*dns_servers[[:space:]]*=[[:space:]]*)\\[[[:space:]]*['\"]103\\.196\\.38\\.38['\"][[:space:]]*,[[:space:]]*['\"]103\\.196\\.38\\.39['\"][[:space:]]*,?[[:space:]]*\\][[:space:]]*\$"
grep -qE "$OLD" "$f" || exit 0
tmp=$(mktemp) || { echo "upgrade-dns-list: mktemp failed" >&2; exit 1; }
sed -E "s/$OLD/\\1['103.196.38.38', '103.196.38.39', '1.1.1.1']/" "$f" > "$tmp"
if ! cmp -s "$f" "$tmp"; then
  # D6 (AUDIT-FINAL the Linux app): atomic_write, not `cat >` (a power loss left a cut config); owner, mode and ACL stay
  atomic_write "$tmp" "$f" || { echo "upgrade-dns-list: could not write $f" >&2; rm -f -- "$tmp"; exit 1; }
  echo upgraded
fi
rm -f -- "$tmp"
exit 0
