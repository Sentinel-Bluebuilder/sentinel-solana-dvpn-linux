# Source from Git Bash: point the CLI at the WSL rig and the devnet test wallet (used in place).
export DVPN_DATA_DIR="$(cygpath -w "${DVPN_DATA_DIR:-$LOCALAPPDATA/Temp/devnet-dvpn-rig}")"
export DVPN_KEYFILE="${DVPN_KEYFILE:-$(cygpath -w "$HOME/.config/devnet-dvpn/client.json")}"
export DVPN_DAEMON_TARGET=127.0.0.1:50061
export DVPN_NODE_API_OVERRIDES=6AaXvhWpFDMf8FimxSb2Tb3bKcgPmbZxj4Tdtb31nP8F=https://127.0.0.1:18444
export DVPN_DAEMON_HOME=//wsl.localhost/Ubuntu/root/devnet-dvpn-client
export DVPN_PROVIDER_API_OVERRIDES=CdxxwuftRrZVj9EmtLFwNj9yVAgB6WNhC5KVdCH7HLV5=https://127.0.0.1:19443
