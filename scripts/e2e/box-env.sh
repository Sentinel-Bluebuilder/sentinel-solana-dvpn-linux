# Source from Git Bash after `box-rig.sh tunnel`: CLI/app → the box client (own data dir), devnet wallet used in place.
export DVPN_DATA_DIR="$(cygpath -w "${DVPN_BOX_DATA_DIR:-$LOCALAPPDATA/Temp/devnet-dvpn-box}")"
export DVPN_KEYFILE="${DVPN_KEYFILE:-$(cygpath -w "$HOME/.config/devnet-dvpn/client.json")}"
eval "$(bash "$(dirname "${BASH_SOURCE[0]}")/box-rig.sh" env)"
