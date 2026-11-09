#!/usr/bin/env bash
# ─── settings-e2e — every app option through the CLI, read back, invalid values refused ───
# Safe on the laptop: no tunnel, no chain writes, no service changes, its own data dir
# (deleted at the end). Daemon (service) settings need an admin prompt and restart the
# service, so they are covered by the VM sweep (scripts/e2e/vm-cli-sweep.ps1) instead.
#   bash scripts/e2e/settings-e2e.sh            (needs `npm run build:cli` first)
set -u
cd "$(dirname "$0")/../.."
DIR="$(mktemp -d)"
export DVPN_DATA_DIR="$(cygpath -w "$DIR" 2>/dev/null || echo "$DIR")"
export DVPN_KEYFILE="$(cygpath -w "$HOME/.config/devnet-dvpn/client.json" 2>/dev/null || echo "$HOME/.config/devnet-dvpn/client.json")"
export MSYS_NO_PATHCONV=1
CLI=(node out/cli/devnet-dvpn.cjs)
pass=0; fail=0
ok() { pass=$((pass + 1)); echo "PASS  $1"; }
bad() { fail=$((fail + 1)); echo "FAIL  $1  ($2)"; }
# t <name> <want-exit> <pattern|-> <cli args…>
t() {
  local name="$1" want="$2" pat="$3"; shift 3
  # one run: output and exit code together (a toggle like `nodes fav` must not run twice)
  local raw code out
  raw="$("${CLI[@]}" "$@" 2>&1; echo "::exit=$?")"
  code="${raw##*::exit=}"
  out="$(sed '$d' <<<"$raw" | grep -v '^\[rpc\] benched')"
  if [ "$code" = "$want" ] && { [ "$pat" = "-" ] || grep -qE -- "$pat" <<<"$out"; }; then ok "$name"; else bad "$name" "exit $code want $want; $(head -1 <<<"$out")"; fi
}
json() { "${CLI[@]}" settings get --json 2>/dev/null; }
has() { if json | grep -qF -- "$2"; then ok "$1"; else bad "$1" "settings.json lacks $2"; fi; }

# ─── app settings: every key, valid values read back ───
for kv in defaultBasis=per_hour defaultBasis=per_gb defaultGb=5 defaultGb=1 defaultHours=2 defaultHours=1 \
          preferredCountry=US preferredCountry=null autoConnect=true autoConnect=false startWithOs=false \
          closeToTray=false closeToTray=true thirdPartyChecks=false thirdPartyChecks=true \
          notifications=false notifications=true theme=dark theme=light theme=system language=en \
          allowanceTdvpn=2.5 allowanceTdvpn=50; do
  k="${kv%%=*}"; v="${kv#*=}"
  t "settings set $kv" 0 "$k" settings set "$kv"
  case "$v" in true|false|null|[0-9]) want="\"$k\":$v";; *) want="\"$k\":\"$v\"";; esac
  has "  read back $k=$v" "$want"
done
t 'several keys in one call' 0 'theme' settings set theme=dark defaultGb=5
has '  both stored' '"theme":"dark"'
t 'settings set theme=system defaultGb=1' 0 - settings set theme=system defaultGb=1

# ─── app settings: invalid values refused and left unchanged ───
for kv in defaultBasis=per_year defaultGb=999 defaultHours=0 preferredCountry=usa preferredCountry=us \
          autoConnect=maybe theme=blue language=fr allowanceTdvpn=0 allowanceTdvpn=-1 allowanceTdvpn=1.1234567; do
  t "refused: $kv" 1 'Invalid value' settings set "$kv"
done
has '  theme unchanged after refusals' '"theme":"system"'
t 'refused: unknown key' 3 'unknown setting' settings set bogusKey=1
t 'refused: no =' 3 - settings set theme
# favourites/rpcUrls/poll have their own commands; via settings set they are refused, never corrupted
t 'refused: poll via settings set' 1 'Invalid value' settings set poll=5
has '  poll still an object' '"poll":{"wallet":'

# ─── RPC pool ───
t 'rpc set two https' 0 - rpc set https://api.devnet.solana.com https://devnet.helius-rpc.com
has '  both stored' 'devnet.helius-rpc.com'
t 'rpc set http refused' 1 - rpc set http://example.com
t 'rpc set garbage refused' 1 - rpc set notaurl
t 'rpc state' 0 'http' rpc state
t 'rpc set back to public' 0 - rpc set https://api.devnet.solana.com

# ─── favourites ───
NODE=DfJukf4RgJ6a1AYcf6qGmNpTvvitsMwCWNKgV6cFQ1K3
t 'nodes fav add' 0 - nodes fav $NODE
has '  in favourites' "$NODE"
t 'nodes fav remove' 0 - nodes fav $NODE
if json | grep -qF "$NODE"; then bad '  removed from favourites' 'still there'; else ok '  removed from favourites'; fi
t 'nodes fav bad address refused' 1 - nodes fav notanaddress

# ─── polling: every job set, range enforced, reset, run, watch ───
t 'poll show' 0 'wallet' poll show
for j in wallet:15 nodes:60 plans:60 subscriptions:60 settlements:15 ip:10 dns:5 rpc:15 session:2; do
  t "poll set ${j%%:*}=${j#*:} (minimum)" 0 - poll set "${j%%:*}=${j#*:}"
  has "  read back ${j%%:*}" "\"${j%%:*}\":${j#*:}"
done
for j in wallet:14 nodes:3601 plans:59 ip:601 session:1 dns:abc; do
  t "poll refused ${j%%:*}=${j#*:}" 3 'whole number' poll set "${j%%:*}=${j#*:}"
done
t 'poll refused unknown job' 3 'unknown job' poll set bogus=5
t 'poll reset one' 0 - poll reset wallet
has '  wallet back to 60' '"wallet":60'
t 'poll run wallet rpc dns settlements' 0 'wallet' poll run wallet rpc dns settlements
t 'poll watch 35 s (visible)' 0 'Cadence over' poll watch --seconds 35
t 'poll watch 20 s (hidden)' 0 'paused while hidden' poll watch --seconds 20 --hidden
t 'poll watch bad seconds' 3 - poll watch --seconds 5
t 'poll reset all' 0 - poll reset
has '  all defaults' '"dns":15'

# ─── service settings: refused BEFORE the admin step (no --yes = nothing applied, no UAC) ───
# The Split tunnelling / Kill switch pages run the same validateSettings before Apply enables.
t 'daemon set split mode refused' 3 'off, include or exclude' daemon set --split-mode bogus
t 'daemon set split route refused' 3 'address range' daemon set --split-mode include --split-routes 999.1.1.1/40
t 'daemon set split app refused' 3 'full path' daemon set --split-mode include --split-apps notanexe
t 'daemon set whole-device refused' 3 'true or false' daemon set --whole-device maybe
t 'daemon set kill switch refused' 3 'off, on or persist' daemon set --kill-switch sometimes
t 'daemon set valid split asks first' 2 'administrator prompt' daemon set --split-mode include --split-apps 'C:\Windows\System32\curl.exe'

# ─── restore default settings ───
t 'settings set theme dark' 0 - settings set theme=dark
t 'settings reset asks first' 2 - settings reset
t 'settings reset --yes' 0 'restored to defaults' settings reset --yes
has '  theme back to system' '"theme":"system"'

rm -rf "$DIR"
echo "settings-e2e: $pass passed, $fail failed"
[ "$fail" = 0 ]
