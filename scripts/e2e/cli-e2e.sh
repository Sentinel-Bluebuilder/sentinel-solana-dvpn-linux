#!/usr/bin/env bash
# ─── CLI end-to-end: every command, in three tiers (run from Git Bash) ───
#   local   no daemon, no chain writes. Scratch data dir; wallet tests use a
#           throwaway DPAPI wallet, never the devnet key.
#   daemon  needs `wsl -d Ubuntu -u root -e bash scripts/e2e/wsl-rig.sh client`
#           (client daemon only; the shared node is not touched). Read-only.
#   spend   needs the FULL rig (`wsl-rig.sh up`, message #1b/#29 first: it moves
#           node 6AaXvh's API) and spends devnet tDVPN from the test wallet.
#           Runs only with --spend. Sequential, 7 s between transactions.
# Nothing here changes Windows networking: no service install, no `daemon set`,
# no real system proxy (only the refusal path is exercised).
#
# Usage: bash scripts/e2e/cli-e2e.sh [local|daemon|all] [--spend]
set -u
cd "$(dirname "$0")/../.."
export MSYS_NO_PATHCONV=1
TIER=${1:-all}
SPEND=0; for a in "$@"; do [ "$a" = --spend ] && SPEND=1; done

CLI="node out/cli/devnet-dvpn.cjs"
SCRATCH="${LOCALAPPDATA:-/tmp}/Temp/devnet-dvpn-cli-e2e"
PASS=0; FAIL=0; FAILED=()

# run <expected-exit> <regex|-> <description> -- <cli args...>
run() {
  local want=$1 re=$2 desc=$3; shift 4
  local out code
  out=$($CLI "$@" 2>&1); code=$?
  if [ "$code" != "$want" ]; then
    FAIL=$((FAIL + 1)); FAILED+=("$desc (exit $code, want $want): $(echo "$out" | head -2 | tr '\n' ' ')"); echo "FAIL $desc"; return 1
  fi
  if [ "$re" != - ] && ! echo "$out" | grep -Eq -- "$re"; then
    FAIL=$((FAIL + 1)); FAILED+=("$desc: output did not match /$re/: $(echo "$out" | head -2 | tr '\n' ' ')"); echo "FAIL $desc"; return 1
  fi
  # A leaked RPC key is a failure anywhere. Positive control: the daemon tier's
  # `daemon settings` reads a config that DOES hold a key and must show <redacted>.
  if echo "$out" | grep -Eq 'api-key=[A-Za-z0-9]'; then
    FAIL=$((FAIL + 1)); FAILED+=("$desc: printed an RPC API key"); echo "FAIL $desc (secret leak)"; return 1
  fi
  PASS=$((PASS + 1)); echo "ok   $desc"
}

npm run -s build:cli >/dev/null || { echo "build failed"; exit 1; }

# ─── local ───
if [ "$TIER" = local ] || [ "$TIER" = all ]; then
  SVC_BEFORE=$(sc query dvpnd 2>/dev/null | grep -c RUNNING)
  rm -rf "$SCRATCH"; mkdir -p "$SCRATCH"
  export DVPN_DATA_DIR; DVPN_DATA_DIR=$(cygpath -w "$SCRATCH")
  unset DVPN_KEYFILE DVPN_DAEMON_TARGET
  export DVPN_DAEMON_TARGET=127.0.0.1:1   # nothing listens: daemon commands must fail cleanly
  run 0 'network devnet'        'version'                              -- version
  run 0 'Usage'                 'help'                                 -- help
  run 3 'unknown'               'unknown command is a usage error'     -- teleport
  run 3 '-'                     'wallet import without a file'         -- wallet import
  run 0 'No wallet'             'wallet show with no wallet'           -- wallet show
  run 2 '--yes'                 'wallet create needs --yes'            -- wallet create
  run 0 'Created'               'wallet create (DPAPI, scratch)'       -- wallet create --yes
  run 0 '^[1-9A-HJ-NP-Za-km-z]{32,44}' 'wallet receive prints address + QR' -- wallet receive
  run 2 '--yes'                 'wallet logout needs --yes'            -- wallet logout
  run 2 '--yes'                 'wallet send needs --yes'              -- wallet send --to 11111111111111111111111111111111 --sol 0.001
  run 3 'not a Solana wallet'   'wallet send rejects a bad address'    -- wallet send --to nope --sol 0.001 --yes
  run 3 'Give --tdvpn'           'wallet send needs an amount'          -- wallet send --to AFaCESaEAFHZZCg6uzPvShVALUuACJnSh3i2wBe14kWB
  run 0 'removed'               'wallet logout --yes'                  -- wallet logout --yes
  run 0 'defaultBasis'          'settings get'                         -- settings get
  run 0 'defaultBasis = "per_hour"' 'settings set (allow-listed key)'  -- settings set defaultBasis=per_hour
  run 3 'unknown setting'       'settings set rejects unknown keys'    -- settings set bogus=1
  run 1 'value for defaultGb is not allowed' 'settings set rejects a bad value' -- settings set defaultGb=3
  run 2 'yes'                   'settings reset needs --yes'           -- settings reset
  run 0 'restored to defaults'  'settings reset --yes'                 -- settings reset --yes
  run 0 'defaultBasis +"per_gb"' 'settings reset put per_gb back'      -- settings get
  run 0 'api.devnet'            'rpc state'                            -- rpc state
  run 1 'https'                 'rpc set rejects plain http'           -- rpc set http://example.com
  run 0 '-'                     'nodes list (chain read + probes)'     -- nodes list
  run 0 '-'                     'nodes list --online'                  -- nodes list --online
  run 0 '-'                     'nodes list --country DE --no-probe'   -- nodes list --country DE --no-probe
  run 0 'tDVPN'                 'cost per GB'                          -- cost 6AaXvhWpFDMf8FimxSb2Tb3bKcgPmbZxj4Tdtb31nP8F --units 2
  run 0 'tDVPN'                 'cost per hour'                        -- cost 6AaXvhWpFDMf8FimxSb2Tb3bKcgPmbZxj4Tdtb31nP8F --basis per_hour --units 1
  run 0 'Fav|fav'               'nodes fav toggles a favourite'        -- nodes fav 6AaXvhWpFDMf8FimxSb2Tb3bKcgPmbZxj4Tdtb31nP8F
  run 0 'tDVPN'                 'plans list'                           -- plans list
  run 0 '-'                     'history list (empty)'                 -- history list
  run 0 '-'                     'history export'                       -- history export --out "$(cygpath -w "$SCRATCH/h.csv")"
  run 0 '-'                     'logs'                                 -- logs --lines 5
  run 0 'off|not set'           'proxy status'                         -- proxy status
  run 1 'no SOCKS endpoint'     'proxy on refuses without a SOCKS session' -- proxy on --yes
  run 0 'not reachable'         'status without a daemon says so'      -- status
  run 2 '--yes'                 'connect needs --yes'                  -- connect 6AaXvhWpFDMf8FimxSb2Tb3bKcgPmbZxj4Tdtb31nP8F
  run 2 '--yes'                 'settle run needs --yes'               -- settle run
  run 1 'wallet'                'device setup without a wallet'        -- device setup --yes
  run 1 'device setup'          'daemon install before device setup'   -- daemon install --yes
  run 3 'plans subscribe'       'plans subscribe needs a plan address' -- plans subscribe nope
  # Button audit (docs/UI-CONTROLS.md): every command behind a screen control runs here or on a VM.
  run 1 'No plan nope'          'plans roster: unknown plan says so'   -- plans roster nope
  run 0 '-'                     'history summary'                      -- history summary
  run 0 '-'                     'nodes recent'                         -- nodes recent
  run 0 '-'                     'test history'                         -- test history
  run 1 'No test runs yet'      'test show (no runs yet)'              -- test show
  run 0 '-'                     'test stop with nothing running'       -- test stop
  run 2 '--yes'                 'test run needs --yes'                 -- test run 6AaXvhWpFDMf8FimxSb2Tb3bKcgPmbZxj4Tdtb31nP8F
  run 2 '--yes'                 'channels fund needs --yes'            -- channels fund 11111111111111111111111111111111 --tdvpn 1
  run 0 '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+|off in Settings|could not' 'quality ip' -- quality ip
  run 0 'apps'                  'split apps (Start Menu + running)'    -- split apps
  run 0 'local network'         'version shows the local network'      -- version
  run 0 'answers'               'daemon dns-check (cloudflare answers)' -- daemon dns-check --dns cloudflare
  run 1 'None of these DNS servers answered' 'daemon dns-check: a dead server fails' -- daemon dns-check --dns 192.0.2.1
  run 3 'unknown DNS preset'    'daemon dns-check: unknown preset'     -- daemon dns-check --dns nope
  if [ "$(reg query 'HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings' //v ProxyServer 2>/dev/null | grep -c socks=127)" = 0 ]; then
    PASS=$((PASS + 1)); echo "ok   Windows system proxy untouched"
  else
    FAIL=$((FAIL + 1)); FAILED+=("Windows system proxy points at a SOCKS endpoint"); echo "FAIL proxy"
  fi
  # The laptop service is owner-approved (tiers 1-2, kill switch off). The local suite must not
  # start or stop it, and if it runs, its kill switch must be off.
  SVC_AFTER=$(sc query dvpnd 2>/dev/null | grep -c RUNNING)
  KS=$(node out/cli/devnet-dvpn.cjs daemon settings 2>/dev/null | awk '/^killSwitch/{print $2}')
  if [ "$SVC_AFTER" = "$SVC_BEFORE" ] && { [ "$SVC_AFTER" = 0 ] || [ "$KS" = off ]; }; then
    PASS=$((PASS + 1)); echo "ok   dvpnd service unchanged (running=$SVC_AFTER, kill switch ${KS:-n/a})"
  else
    FAIL=$((FAIL + 1)); FAILED+=("dvpnd service changed or kill switch on (before $SVC_BEFORE after $SVC_AFTER ks $KS)"); echo "FAIL service"
  fi
fi

# ─── daemon (client-only rig, read-only) ───
if [ "$TIER" = daemon ] || [ "$TIER" = all ]; then
  # shellcheck disable=SC1091
  . scripts/e2e/rig-env.sh
  if ! $CLI daemon version >/dev/null 2>&1; then
    echo "skip daemon tier: rig not up (wsl -d Ubuntu -u root -e bash scripts/e2e/wsl-rig.sh client)"
  else
    run 0 'network devnet .* OK'  'daemon version (network identity)'  -- daemon version
    run 0 'mandate'               'daemon doctor'                      -- daemon doctor
    run 0 '<redacted>'            'daemon settings shows the RPC URL with its key redacted' -- daemon settings
    run 0 'Recorded device'       'device register reads the home'     -- device register
    run 0 'Ready +yes'            'device show'                        -- device show
    run 0 '-'                     'device plan'                        -- device plan --allowance 2
    run 0 'Wallet|Daemon'         'status'                             -- status
    run 0 '-'                     'sessions'                           -- sessions
    run 0 '-'                     'channels'                           -- channels
    run 0 '-'                     'tickets'                            -- tickets
    run 0 '-'                     'settle list'                        -- settle list
    run 0 '-'                     'plans subscriptions'                -- plans subscriptions
    run 0 '-'                     'wallet show (test wallet, read)'    -- wallet show
    run 0 '[Nn]o (active )?session|Not connected' 'disconnect with no session is a no-op' -- disconnect
    # spend/privileged commands stop at the confirmation step (exit 2) — never given --yes here
    PLAN=$($CLI plans list --json 2>/dev/null | node -e "let t='';process.stdin.on('data',d=>t+=d).on('end',()=>{try{const j=JSON.parse(t);const a=(Array.isArray(j)?j:j.plans||[]).find(p=>p.listed);console.log(a?a.address:'')}catch(e){console.log('')}})")
    run 2 '--yes'                 'plans subscribe stops for --yes'    -- plans subscribe "$PLAN"
    run 2 '--yes'                 'device setup stops for --yes'       -- device setup --allowance 3
    run 2 '--yes'                 'daemon install stops for --yes'     -- daemon install
    run 2 '--yes'                 'daemon set stops for --yes'         -- daemon set --kill-switch on
    run 2 '--yes'                 'device revoke stops for --yes'      -- device revoke
    run 2 '--yes'                 'settle withdraw stops for --yes'    -- settle withdraw
  fi
fi

# ─── spend (full rig, explicit) ───
if [ "$SPEND" = 1 ]; then
  . scripts/e2e/rig-env.sh
  N=6AaXvhWpFDMf8FimxSb2Tb3bKcgPmbZxj4Tdtb31nP8F
  run 0 'Connected|connected'   'connect per GB (voucher)'           -- connect $N --units 1 --yes
  wsl -d Ubuntu -u root -e bash scripts/e2e/wsl-rig.sh pull 3000000 >/dev/null
  sleep 7
  run 0 '-'                     'disconnect'                         -- disconnect
  sleep 7
  run 0 'Connected|connected'   'connect per hour (stream)'          -- connect $N --basis per_hour --units 1 --yes
  sleep 7
  run 0 '-'                     'disconnect stream'                  -- disconnect
  sleep 7
  run 0 '-'                     'settle run (stream closes now; vouchers start closing)' -- settle run --yes
fi

echo
echo "passed $PASS  failed $FAIL"
for f in "${FAILED[@]}"; do echo "  - $f"; done
[ "$FAIL" = 0 ]
