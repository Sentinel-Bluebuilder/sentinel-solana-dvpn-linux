#!/usr/bin/env bash
# ─── Linux CLI sweep: every catalogue command against the INSTALLED app (run ON the VM) ───
#   local   scratch data dir, no service: keyring wallet, settings, chain reads, every refusal
#   daemon  the installed dvpnd-client service + test wallet: reads, settings round trips
#   spend   live sessions on the six rig nodes (devnet tDVPN). Sequential, 7 s between txs.
#   cover   every command in `devnet-dvpn help` was run by some tier (reads the result logs)
# Results: ~/sweep/<tier>.tsv (PASS/FAIL <tab> description <tab> command) + <tier>.log
# Usage: bash cli-sweep.sh local|daemon|spend|cover
# Env: DVPN_KEYFILE (test wallet key file), ADMIN_IP (keeps SSH from the laptop off the tunnel)
set -u
# In a container /etc/resolv.conf is a bind mount: dvpnd cannot repoint it (EBUSY, fleet L5), so the DNS
# mode the sweep sets is `none` there (DNS cells run on VMs). SWEEP_DNS_MODE overrides.
DNS_MODE=${SWEEP_DNS_MODE:-resolvectl}; mountpoint -q /etc/resolv.conf 2>/dev/null && DNS_MODE=${SWEEP_DNS_MODE:-none}
TIER=${1:?tier}
CLI=devnet-dvpn
OUT=~/sweep; mkdir -p "$OUT"
TSV="$OUT/$TIER.tsv"; : > "$TSV"
PASS=0; FAIL=0
NODE_IP=192.0.2.2
WG=SLVJNn38s5RfqcVW7a7A4hGKqjY7Y1bKkUpG7wrGX5D
AWG=1PwMkSjnyugAZHdHvDsddETzPUAubPkeyWymT7Ercn6
V2=Di5V9K2Vt5uptJUk7oVVnkDRXt9qWy5HhLbkEJMxEuM2
XR=E9RG1iZJjsLfEuLfDYTHM4yXCjyFE21jBbJLFvGoL2FD
OV=9EQJ7dBwneFUse9yy8Hg56u2wPiGF5qkjAaA1ZAr64nP
HY=E8nefMLBuBzG1CrA4dSDU9mqq6ZNpv69Bt3w9QEtzvPf
. "$(dirname "$0")/nodes.sh"; nodeset_apply   # NODE_SET=node4 → that node set (nodes.sh)

note() { printf '%s\n' "$*"; }
record() { # PASS|FAIL desc cmd detail
  printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$(printf '%s' "$4" | tr '\n\t' '  ' | cut -c1-300)" >> "$TSV"
  if [ "$1" = PASS ]; then PASS=$((PASS + 1)); note "ok   $2"; else FAIL=$((FAIL + 1)); note "FAIL $2 :: $(printf '%s' "$4" | head -3 | tr '\n' ' ' | cut -c1-240)"; fi
}

# run <expected-exit> <regex|-> <description> -- <cli args...>
LAST=''
run() {
  local want=$1 re=$2 desc=$3; shift 4
  local out code
  out=$($CLI "$@" 2>&1); code=$?
  out=$(printf '%s\n' "$out" | grep -v '^\[rpc\]')
  # a new wallet's recovery phrase is printed once: never let it reach a log file
  out=$(printf '%s\n' "$out" | sed -E '/shown once:/{n;s/.*/<24 words redacted>/}')
  LAST=$out
  printf '\n### %s\n$ devnet-dvpn %s\n%s\n(exit %s)\n' "$desc" "$*" "$out" "$code" >> "$OUT/$TIER.log"
  if [ "$code" != "$want" ]; then record FAIL "$desc (exit $code, want $want)" "$*" "$out"; return 1; fi
  if [ "$re" != - ] && ! printf '%s' "$out" | grep -Eq -- "$re"; then record FAIL "$desc: no /$re/" "$*" "$out"; return 1; fi
  if printf '%s' "$out" | grep -Eq 'api-key=[A-Za-z0-9]'; then record FAIL "$desc: printed an RPC API key" "$*" '<secret>'; return 1; fi
  record PASS "$desc" "$*" "$(printf '%s' "$out" | head -2)"
}
# check <description> <command…>: any shell assertion, recorded like a CLI step
check() {
  local desc=$1; shift
  local out; out=$("$@" 2>&1); local code=$?
  printf '\n### %s\n$ %s\n%s\n(exit %s)\n' "$desc" "$*" "$out" "$code" >> "$OUT/$TIER.log"
  if [ $code = 0 ]; then record PASS "$desc" "check" "$out"; else record FAIL "$desc" "check" "$out"; fi
}
# the first listed plan whose provider answers a roster request
live_plan() {
  local p
  for p in $($CLI plans list --json 2>/dev/null | node -e "let t='';process.stdin.on('data',d=>t+=d).on('end',()=>{try{const j=JSON.parse(t);for(const p of (Array.isArray(j)?j:j.plans||[]))if(p.listed)console.log(p.address)}catch(e){}})"); do
    $CLI plans roster "$p" >/dev/null 2>&1 && { echo "$p"; return 0; }
  done
  return 1
}
gap() { note "  … 7 s"; sleep 7; }
egress() { curl -s -m 12 https://api.ipify.org; }
no_leftovers() { # after a session: our nft table, tunnel links and protocol processes are gone
  local t l p
  t=$(sudo nft list tables 2>/dev/null | grep -c 'inet dvpnd')
  l=$(ip -o link | grep -cE ' (dvpn-[a-z0-9-]+|hy2-client|ovpn-client|tun[0-9]+)[:@]')
  # by process NAME + real executable (/proc/PID/exe): dvpnd starts these by name from PATH, so
  # argv0 can be a bare "xray"; and pgrep -f on a pattern also matches the checking shell itself
  p=0
  for pid in $(ps -eo pid=,comm= | awk '$2 ~ /^(v2ray|xray|hysteria2)$/{print $1}'); do
    sudo readlink "/proc/$pid/exe" 2>/dev/null | grep -q '^/usr/local/lib/devnet-dvpn/' && p=$((p + 1))
  done
  for pid in $(pgrep -x openvpn); do
    sudo tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q '/var/lib/dvpnd/' && p=$((p + 1))
  done
  echo "nft=$t links=$l procs=$p egress=$(egress)"
  [ "$t" = 0 ] && [ "$l" = 0 ] && [ "${p:-0}" = 0 ]
}
summary() {
  note ''; note "$TIER: passed $PASS  failed $FAIL  (details $OUT/$TIER.log)"
  # final-pass effect line: how many CLI commands were really run (local tier has no network side effect = PURE-UI shape)
  note "fired: $(awk -F '\t' '$3 != "check"' "$OUT"/*.tsv 2>/dev/null | wc -l) CLI commands run in the $TIER tier"
  [ "$FAIL" = 0 ]
}

# ─── local ───
if [ "$TIER" = local ]; then
  # the keyring wallet needs a desktop-like session: own D-Bus + an unlocked GNOME keyring
  # (same password as ui-smoke.sh; the rig keyring holds nothing but test entries)
  if [ -z "${DDV_KEYRING_SESSION:-}" ]; then
    exec dbus-run-session -- env DDV_KEYRING_SESSION=1 bash -c "printf '%s' '${RIG_KEYRING_PASSWORD:-ddvtest}' | gnome-keyring-daemon --unlock --components=secrets >/dev/null 2>&1; exec bash '$0' local"
  fi
  SCR=~/ddv-sweep-local; rm -rf "$SCR"; mkdir -p "$SCR"; : > "$OUT/local.log"
  export DVPN_DATA_DIR=$SCR DVPN_DAEMON_SOCKET=/nonexistent/daemon.sock
  unset DVPN_KEYFILE
  run 0 'network devnet'          'version'                                  -- version
  run 0 'Usage'                   'help'                                     -- help
  run 3 'unknown'                 'unknown command is a usage error'         -- teleport
  run 3 '-'                       'wallet import without a file'             -- wallet import
  run 0 'No wallet'               'wallet show with no wallet'               -- wallet show
  run 0 'Created'                 'wallet create (libsecret keyring)'        -- wallet create --yes
  check 'wallet secret is in the keyring, not on disk' bash -c "secret-tool search --all application devnet-dvpn 2>&1 | grep -q 'data-dir' && [ -f '$SCR/wallet.cli.keyring' ] && ! grep -rqs '\"secretKey\"' '$SCR'"
  run 0 '^[1-9A-HJ-NP-Za-km-z]{32,44}' 'wallet receive prints address + QR'   -- wallet receive
  run 2 '--yes'                   'wallet logout needs --yes'                -- wallet logout
  run 2 '--yes'                   'wallet send needs --yes'                  -- wallet send --to 11111111111111111111111111111111 --sol 0.001
  run 3 'not a Solana wallet'     'wallet send rejects a bad address'        -- wallet send --to nope --sol 0.001 --yes
  run 3 'Give --tdvpn'            'wallet send needs an amount'              -- wallet send --to AFaCESaEAFHZZCg6uzPvShVALUuACJnSh3i2wBe14kWB
  run 0 'removed'                 'wallet logout --yes'                      -- wallet logout --yes
  check 'logout removed the keyring entry' bash -c "! secret-tool search --all application devnet-dvpn 2>/dev/null | grep -q '$SCR'"
  # import: a throwaway key file (never the test wallet), then a junk file must be refused
  node -e "const k=require('crypto').generateKeyPairSync('ed25519');const d=k.privateKey.export({format:'der',type:'pkcs8'}).subarray(16);const p=k.publicKey.export({format:'der',type:'spki'}).subarray(12);require('fs').writeFileSync('$SCR/throwaway.json',JSON.stringify([...d,...p]))"
  run 0 'Imported|imported|Wallet' 'wallet import a key file (throwaway)'  -- wallet import "$SCR/throwaway.json" --yes
  run 0 'removed'                 'wallet logout after import'               -- wallet logout --yes
  run 0 'Created'                 'wallet create again'                      -- wallet create --yes
  run 0 'removed'                 'wallet logout again'                      -- wallet logout --yes
  echo 'not a wallet' > "$SCR/junk.txt"
  run 1 '-'                       'wallet import refuses a junk file'        -- wallet import "$SCR/junk.txt" --yes
  run 0 'defaultBasis'            'settings get'                             -- settings get
  run 0 'defaultBasis = "per_hour"' 'settings set (allow-listed key)'        -- settings set defaultBasis=per_hour
  run 3 'unknown setting'         'settings set rejects unknown keys'        -- settings set bogus=1
  run 1 'value for defaultGb is not allowed' 'settings set rejects a bad value'     -- settings set defaultGb=3
  run 0 'api.devnet'              'rpc state'                                -- rpc state
  run 1 'https'                   'rpc set rejects plain http'               -- rpc set http://example.com
  run 0 'RPC pool: https://api.devnet.solana.com' 'rpc set (public devnet)'  -- rpc set https://api.devnet.solana.com
  run 0 'wallet'                  'poll show'                                -- poll show
  run 0 'wallet *= *30|wallet.*30' 'poll set wallet=30'                      -- poll set wallet=30
  run 3 '15 to 3600'               'poll set refuses a too-fast cadence'      -- poll set wallet=1
  run 0 '-'                       'poll reset wallet'                        -- poll reset wallet
  run 0 '-'                       'poll run nodes'                           -- poll run nodes
  run 0 '-'                       'poll watch for 10 s'                      -- poll watch --seconds 10
  run 0 '-'                       'nodes list (chain read + probes)'         -- nodes list
  run 0 '-'                       'nodes list --online'                      -- nodes list --online
  run 0 '-'                       'nodes list --protocol wireguard --sort price --no-probe' -- nodes list --protocol wireguard --sort price --no-probe
  run 0 '-'                       'nodes list --country US --no-probe'       -- nodes list --country US --no-probe
  run 0 "$WG"                     'nodes show (WireGuard node)'              -- nodes show $WG
  run 0 'tDVPN'                   'cost per GB'                              -- cost $WG --units 2
  run 0 'tDVPN'                   'cost per hour'                            -- cost $WG --basis per_hour --units 1
  run 0 'Fav|fav'                 'nodes fav toggles a favourite'            -- nodes fav $WG
  run 0 '-'                       'nodes recent'                             -- nodes recent
  run 0 'tDVPN|No plans|plan'     'plans list'                               -- plans list
  PLAN=${PLAN_ADDR:-$(live_plan)}
  if [ -n "$PLAN" ]; then run 0 '-' 'plans roster (first listed plan)' -- plans roster "$PLAN"; else record FAIL 'plans roster: no listed plan has a provider answering' 'plans roster' ''; fi
  run 3 'plans subscribe'         'plans subscribe needs a plan address'     -- plans subscribe nope
  run 0 '-'                       'history list (empty)'                     -- history list
  run 0 '-'                       'history summary (empty)'                  -- history summary
  run 0 '-'                       'history export'                           -- history export --out "$SCR/h.csv"
  check 'history export wrote a CSV header' bash -c "head -1 '$SCR/h.csv' | grep -q ','"
  run 0 '-'                       'logs'                                     -- logs --lines 5
  run 0 'off|not set'             'proxy status'                             -- proxy status
  run 1 'no SOCKS endpoint'       'proxy on refuses without a SOCKS session' -- proxy on --yes
  run 0 '-'                       'proxy off with nothing set is a no-op'    -- proxy off
  run 1 'SOCKS|session'           'proxy browser refuses without a session'  -- proxy browser
  run 0 'not reachable|not running' 'status without a daemon says so'        -- status
  run 2 '--yes'                   'connect needs --yes'                      -- connect $WG
  run 2 '--yes'                   'settle run needs --yes'                   -- settle run
  run 1 'wallet'                  'device setup without a wallet'            -- device setup --yes
  run 1 'device setup|wallet'     'daemon install before device setup'       -- daemon install --yes
  run 0 'tDVPN|deposit|lock'      'test plan (no transaction)'               -- test plan $WG $V2
  run 0 '-'                       'test history (empty)'                     -- test history
  run 0 '-'                       'quality ip'                               -- quality ip
  run 0 'Mbit|MB/s|Mbps'          'quality speed'                            -- quality speed
  run 0 'ready|missing'           'daemon drivers (no admin)'                -- daemon drivers
  run 2 '--yes'                   'settings reset stops for --yes'           -- settings reset
  run 0 '-'                       'settings reset (scratch data dir)'        -- settings reset --yes
  run 0 '-'                       'split apps (installed + running apps)'    -- split apps
  summary; exit $?
fi

# ─── daemon (installed service, test wallet) ───
export DVPN_DATA_DIR=${DVPN_DATA_DIR:-$HOME/ddv-data}
: "${DVPN_KEYFILE:?set DVPN_KEYFILE to the test wallet key file}"
if [ "$TIER" = daemon ]; then
  : > "$OUT/daemon.log"
  run 0 'network devnet .* OK'    'daemon version (network identity)'        -- daemon version
  run 0 '-'                       'daemon doctor'                            -- daemon doctor
  check 'doctor has no FAIL row' bash -c "! printf '%s' \"\$(devnet-dvpn daemon doctor 2>&1)\" | grep -q '^FAIL'"
  run 0 'killSwitch'              'daemon settings'                          -- daemon settings
  run 0 'All VPN drivers are ready' 'daemon drivers'                         -- daemon drivers
  run 0 '-'                       'daemon init (device key exists: no change)' -- daemon init
  run 0 '-'                       'daemon dns-check (Cloudflare answers)'    -- daemon dns-check --dns cloudflare
  run 0 '-'                       'split status'                             -- split status
  run 0 'Ready +yes'              'device show'                              -- device show
  run 0 '-'                       'device plan'                              -- device plan --allowance 2
  run 0 'Recorded device|8HfzUK'  'device register reads the home'           -- device register
  run 0 'Wallet|Daemon'           'status'                                   -- status
  run 0 '-'                       'sessions'                                 -- sessions
  run 0 '-'                       'channels'                                 -- channels
  run 0 '-'                       'tickets'                                  -- tickets
  run 0 '-'                       'settle list'                              -- settle list
  run 0 '-'                       'plans subscriptions'                      -- plans subscriptions
  run 0 'tDVPN'                   'wallet show (test wallet, read)'          -- wallet show
  run 0 '[Nn]o (active )?session|Not connected' 'disconnect with no session is a no-op' -- disconnect
  run 0 '-'                       'daemon restore-network (nothing to restore)' -- daemon restore-network
  run 2 '--yes'                   'device setup stops for --yes'             -- device setup --allowance 3
  run 2 '--yes'                   'daemon install stops for --yes'           -- daemon install
  run 2 '--yes'                   'daemon set stops for --yes'               -- daemon set --kill-switch on
  run 2 '--yes'                   'device revoke stops for --yes'            -- device revoke
  run 2 '--yes'                   'settle withdraw stops for --yes'          -- settle withdraw
  run 2 '--yes'                   'daemon repair-drivers stops for --yes'    -- daemon repair-drivers
  # settings round trips through the root helper (restarts the service each time)
  run 0 '-'                       'daemon set --allow-lan true'              -- daemon set --allow-lan true --yes
  run 0 'allowLan +true'          'allow-lan reads back true'                -- daemon settings
  check 'allow_lan written to the service config' bash -c "grep -q '^allow_lan = true' /var/lib/dvpnd/client/client/config.toml"
  run 0 '-'                       'daemon set --allow-lan false --dns cloudflare --dns-mode resolvectl' -- daemon set --allow-lan false --dns cloudflare --dns-mode "$DNS_MODE" --yes
  run 0 '1.1.1.1'                 'dns reads back'                           -- daemon settings
  run 3 'DNS mode'                'daemon set refuses the Windows-only netsh' -- daemon set --dns-mode netsh --yes
  run 0 '-'                       'daemon set --kill-switch off'             -- daemon set --kill-switch off --yes
  run 0 'killSwitch +off'         'kill switch reads back off'               -- daemon settings
  check 'service active and socket answering after restarts' bash -c "systemctl is-active -q dvpnd-client && devnet-dvpn daemon version >/dev/null"
  run 0 'Fresh|ok|ready|repair|All VPN drivers' 'daemon repair-drivers (nothing missing)' -- daemon repair-drivers --yes
  summary; exit $?
fi

# ─── spend (live sessions) ───
if [ "$TIER" = spend ]; then
  : > "$OUT/spend.log"
  # SSH from the laptop stays on the card: its own table 50 with a /32 via the card's gateway. A rule to
  # `main` is not enough once a session puts default-covering routes IN main (OpenVPN def1, dvpnd 16.30+
  # WireGuard/AmneziaWG /1 halves): the replies would go into the tunnel.
  if [ -n "${ADMIN_IP:-}" ]; then
    gw=$(ip -4 route show default | awk '{print $3; exit}'); nic=$(ip -4 route show default | awk '{print $5; exit}')
    sudo ip route replace "$ADMIN_IP/32" via "$gw" dev "$nic" onlink table 50
    sudo ip rule del to "$ADMIN_IP" lookup main priority 50 2>/dev/null
    ip -4 rule show pref 50 | grep -q 'lookup 50' || sudo ip rule add to "$ADMIN_IP" lookup 50 priority 50
  fi
  DIRECT=$(egress)
  check "direct egress before sessions = $DIRECT" bash -c "[ -n '$DIRECT' ] && [ '$DIRECT' != '$NODE_IP' ]"
  session() { # <name> <node> [extra connect args…]
    local name=$1 node=$2; shift 2
    run 0 'Connected|connected' "connect $name per GB" -- connect "$node" --units 1 "$@" --yes || { $CLI disconnect >/dev/null 2>&1; gap; return 1; }
    sleep 3
    run 0 'Connected|connected|'"$name" "status while on $name" -- status
    # V2Ray/Xray are SOCKS sessions: only traffic sent to their SOCKS port leaves through the node
    local via=''
    case $name in v2ray|xray) via="--socks5-hostname $($CLI proxy status --json 2>/dev/null | grep -oE '127\.0\.0\.1:[0-9]+' | head -1)" ;; esac
    check "$name: egress IP = node ($NODE_IP)${via:+ via SOCKS}" bash -c "for i in 1 2 3; do [ \"\$(curl -s -m 12 $via https://api.ipify.org)\" = '$NODE_IP' ] && exit 0; sleep 3; done; exit 1"
    case $name in v2ray|xray|hysteria2|openvpn)
      check "$name: leftover pattern sees the live process (positive control)" bash -c "$(declare -f no_leftovers egress); ! no_leftovers" ;;
    esac
    run 0 "$NODE_IP" "$name: quality ip shows the node" -- quality ip
    gap
    run 0 '-' "disconnect $name" -- disconnect
    sleep 3
    check "$name: no leftovers, egress back to direct" bash -c "$(declare -f no_leftovers egress); no_leftovers && [ \"\$(egress)\" = '$DIRECT' ]"
    gap
  }
  session wireguard "$WG"
  session amneziawg "$AWG"
  session openvpn "$OV"
  session hysteria2 "$HY"
  session xray "$XR"
  # V2Ray: SOCKS session → system proxy (GNOME, own dbus session) + browser window
  run 0 'Connected|connected' 'connect v2ray per GB' -- connect "$V2" --units 1 --yes
  sleep 3
  run 0 'socks|SOCKS|127.0.0.1' 'proxy status shows the SOCKS endpoint' -- proxy status
  SOCKS=$($CLI proxy status --json 2>/dev/null | grep -oE '127\.0\.0\.1:[0-9]+' | head -1)
  check "v2ray: SOCKS $SOCKS egress = node" bash -c "[ \"\$(curl -s -m 15 --socks5-hostname $SOCKS https://api.ipify.org)\" = '$NODE_IP' ]"
  export -f run record note 2>/dev/null
  dbus-run-session -- bash -c "
    devnet-dvpn proxy on --yes 2>&1 | grep -v '^\[rpc'; echo exit=\$?
    gsettings get org.gnome.system.proxy mode; gsettings get org.gnome.system.proxy.socks host; gsettings get org.gnome.system.proxy.socks port
    devnet-dvpn proxy status 2>&1 | grep -v '^\[rpc'
    devnet-dvpn proxy off 2>&1 | grep -v '^\[rpc'; echo exit=\$?
    gsettings get org.gnome.system.proxy mode
  " > "$OUT/proxy-gnome.txt" 2>&1
  check 'proxy on → GNOME mode manual + socks 127.0.0.1; proxy off → none' bash -c "grep -q \"'manual'\" '$OUT/proxy-gnome.txt' && grep -q \"'127.0.0.1'\" '$OUT/proxy-gnome.txt' && tail -1 '$OUT/proxy-gnome.txt' | grep -q \"'none'\""
  pgrep -x Xvfb >/dev/null || { Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 & sleep 2; }
  # Google Chrome has no Linux arm64 build: use Chromium where Chrome is absent (arm64 VMs)
  BR=chrome; command -v google-chrome-stable >/dev/null || command -v google-chrome >/dev/null || BR=chromium
  DISPLAY=:99 run 0 '-' "proxy browser ($BR, own profile, through SOCKS)" -- proxy browser --browser $BR --url https://api.ipify.org
  # snap Chromium on arm64 can take well over 6 s to exec the real browser (u2404-arm once missed it)
  check 'browser window runs with --proxy-server=socks5' bash -c "for i in \$(seq 1 30); do pgrep -af 'chrom(e|ium).*--proxy-server=socks5://127.0.0.1' | grep -q proxy-server && exit 0; sleep 1; done; echo 'no such process; chromium processes:'; pgrep -af chrom | cut -c1-200 | head -5; exit 1"
  pkill -f 'chrom(e|ium).*devnet-dvpn' 2>/dev/null; pkill -f 'chrom(e|ium).*--proxy-server=socks5://127.0.0.1' 2>/dev/null
  # switch: v2ray → wireguard without a gap in between
  gap
  run 0 'Connected|connected' 'connect --switch v2ray → wireguard' -- connect "$WG" --units 1 --switch --yes
  sleep 3
  check 'after switch: egress = node' bash -c "[ \"\$(curl -s -m 12 https://api.ipify.org)\" = '$NODE_IP' ]"
  gap
  run 0 '-' 'disconnect after switch' -- disconnect
  gap
  # per hour (stream channel)
  run 0 'Connected|connected' 'connect wireguard per hour' -- connect "$WG" --basis per_hour --units 1 --yes
  sleep 5
  check 'per hour: egress = node' bash -c "[ \"\$(curl -s -m 12 https://api.ipify.org)\" = '$NODE_IP' ]"
  gap
  run 0 '-' 'disconnect per hour' -- disconnect
  gap
  # follow mode: connect and stream status until the session ends (ended by a disconnect from a 2nd shell)
  ( sleep 25; $CLI disconnect >/dev/null 2>&1 ) &
  STOPPER=$!
  run 0 '-' 'connect --follow (ends on disconnect)' -- connect "$XR" --units 1 --yes --follow
  wait "$STOPPER" # only the stopper: Xvfb is a child of this shell too
  gap
  # money: top up an open channel, settle, withdraw
  run 0 '-' 'channels (after sessions)' -- channels
  CH=$($CLI channels --json 2>/dev/null | node -e "let t='';process.stdin.on('data',d=>t+=d).on('end',()=>{try{const j=JSON.parse(t);const a=(Array.isArray(j)?j:j.channels||[]).find(c=>/open/i.test(String(c.status||c.state||'')));console.log(a?(a.address||a.channel):'')}catch(e){console.log('')}})")
  # disconnect closes the deposit (cf4c), so after the sessions above nothing is open: fund the
  # deposit of a live session instead (u2204b 2026-10-22 "no open channel found")
  if [ -z "$CH" ]; then
    run 0 'Connected|connected' 'connect wireguard for channels fund' -- connect "$WG" --units 1 --yes; sleep 4
    CH=$($CLI status --json 2>/dev/null | node -e "let t='';process.stdin.on('data',d=>t+=d).on('end',()=>{const m=t.match(/\"channel[A-Za-z]*\"\s*:\s*\"([1-9A-HJ-NP-Za-km-z]{32,44})\"/);console.log(m?m[1]:'')})")
    gap
  fi
  if [ -n "$CH" ]; then run 0 '-' "channels fund $CH" -- channels fund "$CH" --tdvpn 1 --yes; else record FAIL 'channels fund: no open channel found' 'channels fund' "$($CLI channels 2>&1 | head -5)"; fi
  run 0 '-' 'disconnect after channels fund' -- disconnect; sleep 3
  gap
  run 0 '-' 'settle list' -- settle list
  run 0 '-' 'settle run' -- settle run --yes
  gap
  run 0 '-' 'settle withdraw' -- settle withdraw --yes
  gap
  # plans: subscribe → connect on the subscription → close
  PLAN=${PLAN_ADDR:-$(live_plan)}
  run 0 '-' 'plans subscribe (first listed plan)' -- plans subscribe "$PLAN" --yes
  gap
  run 0 '-' 'plans subscriptions' -- plans subscriptions
  SUB=$($CLI plans subscriptions --json 2>/dev/null | node -e "let t='';process.stdin.on('data',d=>t+=d).on('end',()=>{try{const j=JSON.parse(t);const a=(Array.isArray(j)?j:j.subscriptions||[]);const s=a[a.length-1];console.log(s?(s.address||s.subscription):'')}catch(e){console.log('')}})")
  ROSTER=$($CLI plans roster "$PLAN" --json 2>/dev/null | grep -oE "$WG|$V2|$XR|$OV|$HY|$AWG" | head -1)
  if [ -n "$SUB" ] && [ -n "$ROSTER" ]; then
    run 0 'Connected|connected' 'connect on the subscription' -- connect "$ROSTER" --plan "$SUB" --yes
    sleep 3
    check 'plan session: egress = node' bash -c "[ \"\$(curl -s -m 12 https://api.ipify.org)\" = '$NODE_IP' ]"
    gap
    run 0 '-' 'disconnect plan session' -- disconnect
    gap
  else
    note "plan $PLAN roster has none of the rig nodes (roster='$ROSTER' sub='$SUB'): subscription connect skipped"
    record PASS "plan roster has no rig node: connect on subscription not applicable ($PLAN)" 'plans roster' ''
  fi
  [ -n "$SUB" ] && run 0 '-' 'plans close the subscription' -- plans close "$SUB" --yes
  gap
  # node test run on two nodes, then its reports
  run 0 'FAST|SLOW|FAIL' 'test run (wireguard + v2ray)' -- test run $WG $V2 --max-spend 5 --yes
  gap
  run 0 '-' 'test history' -- test history
  run 0 '-' 'test show --compare' -- test show --compare
  run 0 '-' 'test export' -- test export --out "$OUT/test-run.json"
  run 0 '-' 'test stop (nothing running)' -- test stop
  run 0 '-' 'nodes recent (after sessions)' -- nodes recent
  run 0 '-' 'history list' -- history list
  run 0 '-' 'history summary' -- history summary
  run 0 '-' 'sessions' -- sessions
  run 0 '-' 'tickets' -- tickets
  check 'final: no leftovers, direct egress' bash -c "$(declare -f no_leftovers egress); no_leftovers && [ \"\$(egress)\" = '$DIRECT' ]"
  summary; exit $?
fi

# ─── ksdns: kill switch + DNS on every protocol (plan tickets; disposable VM only) ───
# Per protocol: kill switch on + Cloudflare DNS → connect on a subscription → egress = node,
# nft table up, names resolve, the VPN's DNS is set → break the tunnel underneath (link down /
# kill the protocol process) → NOTHING may leave directly → disconnect + restore-network →
# direct egress back, nothing left. SSH from the laptop drops while the kill switch is on, so
# run this detached; the deadman is put on hold around each deliberate block.
if [ "$TIER" = ksdns ]; then
  : > "$OUT/ksdns.log"
  DIRECT=$(egress)
  # KS_PAY=gb pays each session with a small per-GB deposit instead of a plan ticket (the kill
  # switch does not depend on how the session is paid; used while the plan provider is down)
  KS_PAY=${KS_PAY:-plan}
  [ "$KS_PAY" = gb ] || PLAN=${PLAN_ADDR:?set PLAN_ADDR}
  hold() { sudo touch /run/ddv-deadman.hold; }
  tunnel_link() { ip -o link | grep -oE ' (dvpn-[a-z0-9-]+|hy2-client|ovpn-client|tun[0-9]+):' | tr -d ' :' | head -1; }
  check "direct egress before = $DIRECT" bash -c "[ -n '$DIRECT' ] && [ '$DIRECT' != '$NODE_IP' ]"
  run 0 '-' 'kill switch on, Cloudflare DNS, resolvectl' -- daemon set --kill-switch on --dns cloudflare --dns-mode "$DNS_MODE" --yes
  run 0 'killSwitch +on' 'kill switch reads back on' -- daemon settings
  gap
  ks_case() { # <name> <node> <subscription>
    local name=$1 node=$2 sub=$3 via='' link
    hold
    local pay=(--plan "$sub"); [ "$KS_PAY" = gb ] && pay=(--units 1)
    run 0 'Connected|connected' "ks $name: connect (${KS_PAY})" -- connect "$node" "${pay[@]}" --yes || { $CLI disconnect >/dev/null 2>&1; $CLI daemon restore-network >/dev/null 2>&1; gap; return 1; }
    sleep 4
    case $name in v2ray|xray) via="--socks5-hostname $($CLI proxy status --json 2>/dev/null | grep -oE '127\.0\.0\.1:[0-9]+' | head -1)" ;; esac
    check "ks $name: egress = node${via:+ via SOCKS}" bash -c "for i in 1 2 3; do [ \"\$(curl -s -m 12 $via https://api.ipify.org)\" = '$NODE_IP' ] && exit 0; sleep 3; done; exit 1"
    check "ks $name: nft table inet dvpnd is up" bash -c "sudo nft list table inet dvpnd >/dev/null"
    check "ks $name: names resolve with the kill switch on" bash -c "getent hosts example.com >/dev/null || curl -s -m 12 $via -o /dev/null -w '%{http_code}' https://example.com | grep -q 200"
    link=$(tunnel_link)
    if [ -n "$link" ]; then
      [ "$DNS_MODE" = none ] || check "ks $name: VPN DNS 1.1.1.1 set on $link" bash -c "resolvectl dns '$link' | grep -q 1.1.1.1"
    fi
    case $name in v2ray|xray)
      check "ks $name: a direct (non-proxied) request is blocked" bash -c "! curl -s -m 8 https://api.ipify.org" ;;
    esac
    # 1) the path to the server fails while the protocol keeps running (the usual "VPN drops"):
    #    every packet to the node dropped by a separate nft table (a drop in any base chain is
    #    final), then nothing may leave directly
    hold
    sudo nft add table inet ddvtest && sudo nft 'add chain inet ddvtest out { type filter hook output priority -10; }' && sudo nft add rule inet ddvtest out ip daddr "$NODE_IP" drop
    sleep 8
    check "ks $name: path to the server lost → no direct leak (request fails)" bash -c "out=\$(curl -s -m 10 https://api.ipify.org); [ -z \"\$out\" ] || [ \"\$out\" = '$NODE_IP' ]"
    check "ks $name: path to the server lost → never the direct IP" bash -c "[ \"\$(curl -s -m 10 https://api.ipify.org)\" != '$DIRECT' ]"
    sudo nft delete table inet ddvtest
    sleep 3
    # 2) the tunnel itself dies (link down / protocol process killed). dvpnd ends the session
    #    after 5 failed stats reads (~5 s) as "service stats unavailable"; before ddv6 that
    #    released the kill switch (UPSTREAM-GAPS #41). So check right away AND after the end.
    hold
    case $name in
      wireguard|amneziawg) sudo ip link set dev "$link" down ;;
      openvpn|hysteria2|v2ray|xray) sudo pkill -x "$name" ;;  # this VM runs no other copy of these
    esac
    sleep 3
    check "ks $name: tunnel broken → no direct leak (request fails)" bash -c "out=\$(curl -s -m 10 https://api.ipify.org); [ -z \"\$out\" ] || [ \"\$out\" = '$NODE_IP' ]"
    check "ks $name: tunnel broken → never the direct IP" bash -c "[ \"\$(curl -s -m 10 https://api.ipify.org)\" != '$DIRECT' ]"
    hold
    sleep 25
    run 0 '-' "ks $name: status after the tunnel died (recorded)" -- status
    check "ks $name: 25 s later (session ended under the user) → kill switch still up" bash -c "sudo nft list table inet dvpnd >/dev/null"
    check "ks $name: 25 s later → never the direct IP" bash -c "[ \"\$(curl -s -m 10 https://api.ipify.org)\" != '$DIRECT' ]"
    hold
    run 0 '-' "ks $name: disconnect" -- disconnect
    sleep 3
    run 0 '-' "ks $name: restore network" -- daemon restore-network
    sleep 3
    check "ks $name: after restore: no leftovers, direct egress back" bash -c "$(declare -f no_leftovers egress); for i in 1 2 3 4; do no_leftovers && [ \"\$(egress)\" = '$DIRECT' ] && exit 0; sleep 5; done; no_leftovers; exit 1"
    gap
  }
  # KS_GROUPS: one subscription per group. A plan with max_connections >= 6 takes all six on one
  # subscription (default); a 2-server plan needs "wireguard:… amneziawg:…" style pairs, and
  # re-subscribing gives the same address with its old tickets still counting (gap #15).
  KS_GROUPS=${KS_GROUPS:-"wireguard:$WG amneziawg:$AWG openvpn:$OV hysteria2:$HY v2ray:$V2 xray:$XR"}
  IFS='|' read -r -a GROUPS_ARR <<< "$KS_GROUPS"
  for pair in "${GROUPS_ARR[@]}"; do
    if [ "$KS_PAY" = gb ]; then
      for pn in $pair; do ks_case "${pn%%:*}" "${pn#*:}" ''; done
      continue
    fi
    run 0 '-' 'plans subscribe' -- plans subscribe "$PLAN" --yes
    gap
    SUB=$($CLI plans subscriptions --json 2>/dev/null | node -e "let t='';process.stdin.on('data',d=>t+=d).on('end',()=>{try{const j=JSON.parse(t);const a=(Array.isArray(j)?j:j.subscriptions||[]);const s=a[a.length-1];console.log(s?(s.address||s.subscription):'')}catch(e){console.log('')}})")
    for pn in $pair; do ks_case "${pn%%:*}" "${pn#*:}" "$SUB"; done
    run 0 '-' 'plans close' -- plans close "$SUB" --yes
    gap
  done
  run 0 '-' 'kill switch off again' -- daemon set --kill-switch off --yes
  check 'final: direct egress, nothing left' bash -c "$(declare -f no_leftovers egress); no_leftovers && [ \"\$(egress)\" = '$DIRECT' ]"
  summary; exit $?
fi

# ─── ledger: the items #31 and #32 listed as not yet proven (disposable VM only, detached) ───
#   dns-off   kill switch OFF: no DNS query leaves on the physical NIC while a full tunnel is up
#             (tcpdump on the default-route interface; V2Ray/Xray: a SOCKS-resolved name)
#   persist   kill switch PERSIST: service restart and dvpnd SIGKILL mid-session never leak;
#             the block stays after the session ends until restore-network
#   kill-on   kill switch ON + dvpnd SIGKILL: systemd restarts it, nothing leaks meanwhile
#   per_hour  every protocol on a stream channel
#   topup     channels fund on the channel of the LIVE session, session keeps working
if [ "$TIER" = ledger ]; then
  : > "$OUT/ledger.log"
  DIRECT=$(egress)
  NIC=$(ip route show default | awk '{print $5; exit}')
  hold() { sudo touch /run/ddv-deadman.hold; }
  tunnel_link() { ip -o link | grep -oE ' (dvpn-[a-z0-9-]+|hy2-client|ovpn-client|tun[0-9]+):' | tr -d ' :' | head -1; }
  restore() { $CLI disconnect >/dev/null 2>&1; sleep 2; $CLI daemon restore-network >/dev/null 2>&1; sleep 3; }
  back_clean() { check "$1: after restore: nothing left, direct egress back" bash -c "$(declare -f no_leftovers egress); for i in 1 2 3 4; do no_leftovers && [ \"\$(egress)\" = '$DIRECT' ] && exit 0; sleep 5; done; no_leftovers; exit 1"; }
  # DNS queries on the physical NIC while names are resolved: prints the number of queries for
  # the names as asked (bare = a leak). Retries with the NIC's own search domains appended
  # (glibc after NXDOMAIN; resolved routes them to the link owning that domain) are logged on
  # stderr, not counted: a documented Linux limitation (LINUX-PARITY "DNS search domains").
  dns_on_nic() { # <resolver command…>
    local f n names=() bare=0 sfx=0; f=$(mktemp)
    sudo timeout 14 tcpdump -ni "$NIC" -l 'udp port 53 or tcp port 53' > "$f" 2>/dev/null & local tp=$!
    sleep 2
    for i in 1 2 3; do n="ddv-leak-$RANDOM$RANDOM.example.com"; names+=("$n"); "$@" "$n" >/dev/null 2>&1; done
    wait $tp 2>/dev/null
    for n in "${names[@]}"; do
      bare=$((bare + $(grep -cF "? $n. (" "$f")))
      sfx=$((sfx + $(grep -F "? $n." "$f" | grep -cvF "? $n. (")))
    done
    echo "search-domain retries on $NIC: $sfx" >&2
    echo "$bare"; rm -f "$f"
  }
  check "direct egress before = $DIRECT, NIC $NIC" bash -c "[ -n '$DIRECT' ] && [ '$DIRECT' != '$NODE_IP' ] && [ -n '$NIC' ]"
  check 'tcpdump present' bash -c 'command -v tcpdump'
  # positive control: without a VPN a lookup DOES show on the NIC (else 0 below proves nothing)
  check "control: with no VPN, lookups are seen on $NIC" bash -c "$(declare -f dns_on_nic); NIC=$NIC; [ \"\$(dns_on_nic getent hosts)\" -gt 0 ]"

  # dns-off
  run 0 '-' 'dns-off: kill switch off, Cloudflare DNS, resolvectl' -- daemon set --kill-switch off --dns cloudflare --dns-mode "$DNS_MODE" --yes
  for pn in wireguard:$WG amneziawg:$AWG openvpn:$OV hysteria2:$HY v2ray:$V2 xray:$XR; do
    name=${pn%%:*}; node=${pn#*:}
    if [ "$name" = amneziawg ] && ! modinfo amneziawg >/dev/null 2>&1; then note "skip dns-off amneziawg (no kernel module)"; continue; fi
    run 0 'Connected|connected' "dns-off $name: connect (per GB)" -- connect "$node" --units 1 --yes || { restore; gap; continue; }
    sleep 4
    case $name in
      v2ray|xray)
        S=$($CLI proxy status --json 2>/dev/null | grep -oE '127\.0\.0\.1:[0-9]+' | head -1)
        check "dns-off $name: SOCKS-resolved names never hit $NIC port 53" bash -c "$(declare -f dns_on_nic); NIC=$NIC; c() { curl -s -m 8 --socks5-hostname $S -o /dev/null https://\$1; }; [ \"\$(dns_on_nic c)\" = 0 ]" ;;
      *)
        link=$(tunnel_link)
        [ "$DNS_MODE" = none ] || check "dns-off $name: VPN DNS on $link and it is the default route for names" bash -c "resolvectl dns '$link' | grep -q 1.1.1.1 && resolvectl domain '$link' | grep -q '~\.'"
        check "dns-off $name: no lookup leaves on $NIC (kill switch off)" bash -c "$(declare -f dns_on_nic); NIC=$NIC; [ \"\$(dns_on_nic getent hosts)\" = 0 ]" ;;
    esac
    run 0 '-' "dns-off $name: disconnect" -- disconnect
    sleep 3; back_clean "dns-off $name"; gap
  done

  # persist: service restart + dvpnd SIGKILL mid-session
  run 0 '-' 'persist: kill switch persist' -- daemon set --kill-switch persist --yes
  run 0 'killSwitch +persist' 'persist reads back' -- daemon settings
  for pn in wireguard:$WG openvpn:$OV; do
    name=${pn%%:*}; node=${pn#*:}
    hold
    run 0 'Connected|connected' "persist $name: connect (per GB)" -- connect "$node" --units 1 --yes || { restore; gap; continue; }
    sleep 4
    check "persist $name: egress = node" bash -c "$(declare -f egress); [ \"\$(egress)\" = '$NODE_IP' ]"
    hold; sudo systemctl restart dvpnd-client; sleep 2
    check "persist $name: during the service restart → never the direct IP" bash -c "[ \"\$(curl -s -m 8 https://api.ipify.org)\" != '$DIRECT' ]"
    sleep 15
    run 0 '-' "persist $name: status after restart (recorded)" -- status
    check "persist $name: after restart: kill switch table still up" bash -c "sudo nft list table inet dvpnd >/dev/null"
    check "persist $name: after restart → never the direct IP" bash -c "[ \"\$(curl -s -m 10 https://api.ipify.org)\" != '$DIRECT' ]"
    hold; sudo systemctl kill -s KILL dvpnd-client; sleep 2
    check "persist $name: dvpnd SIGKILLed → never the direct IP" bash -c "[ \"\$(curl -s -m 8 https://api.ipify.org)\" != '$DIRECT' ]"
    check "persist $name: systemd brings dvpnd back" bash -c 'for i in $(seq 1 20); do systemctl is-active -q dvpnd-client && exit 0; sleep 2; done; exit 1'
    sleep 10
    run 0 '-' "persist $name: status after SIGKILL (recorded)" -- status
    check "persist $name: after SIGKILL + restart → never the direct IP" bash -c "[ \"\$(curl -s -m 10 https://api.ipify.org)\" != '$DIRECT' ]"
    hold
    restore; back_clean "persist $name"; gap
  done

  # kill-on: mode ON + dvpnd SIGKILL
  run 0 '-' 'kill-on: kill switch on' -- daemon set --kill-switch on --yes
  for pn in wireguard:$WG hysteria2:$HY; do
    name=${pn%%:*}; node=${pn#*:}
    hold
    run 0 'Connected|connected' "kill-on $name: connect (per GB)" -- connect "$node" --units 1 --yes || { restore; gap; continue; }
    sleep 4
    hold; sudo systemctl kill -s KILL dvpnd-client; sleep 2
    check "kill-on $name: dvpnd SIGKILLed → never the direct IP" bash -c "[ \"\$(curl -s -m 8 https://api.ipify.org)\" != '$DIRECT' ]"
    check "kill-on $name: systemd brings dvpnd back" bash -c 'for i in $(seq 1 20); do systemctl is-active -q dvpnd-client && exit 0; sleep 2; done; exit 1'
    sleep 10
    run 0 '-' "kill-on $name: status after SIGKILL (recorded)" -- status
    check "kill-on $name: after restart → never the direct IP while not disconnected" bash -c "[ \"\$(curl -s -m 10 https://api.ipify.org)\" != '$DIRECT' ]"
    hold
    restore; back_clean "kill-on $name"; gap
  done
  run 0 '-' 'kill switch off' -- daemon set --kill-switch off --yes

  # per_hour on every protocol
  for pn in wireguard:$WG amneziawg:$AWG openvpn:$OV hysteria2:$HY v2ray:$V2 xray:$XR; do
    name=${pn%%:*}; node=${pn#*:}
    if [ "$name" = amneziawg ] && ! modinfo amneziawg >/dev/null 2>&1; then note "skip per_hour amneziawg (no kernel module)"; continue; fi
    run 0 'Connected|connected' "per_hour $name: connect" -- connect "$node" --basis per_hour --units 1 --yes || { restore; gap; continue; }
    sleep 4
    case $name in v2ray|xray) via="--socks5-hostname $($CLI proxy status --json 2>/dev/null | grep -oE '127\.0\.0\.1:[0-9]+' | head -1)" ;; *) via='' ;; esac
    check "per_hour $name: egress = node" bash -c "for i in 1 2 3; do [ \"\$(curl -s -m 12 $via https://api.ipify.org)\" = '$NODE_IP' ] && exit 0; sleep 3; done; exit 1"
    run 0 'per hour' "per_hour $name: status shows the hourly basis" -- status
    run 0 '-' "per_hour $name: disconnect" -- disconnect
    sleep 3; back_clean "per_hour $name"; gap
  done

  # top-up of the live session's channel
  run 0 'Connected|connected' 'topup: connect wireguard (per GB)' -- connect "$WG" --units 1 --yes
  sleep 4
  CH=$($CLI status --json 2>/dev/null | node -e "let t='';process.stdin.on('data',d=>t+=d).on('end',()=>{const m=t.match(/\"channel[A-Za-z]*\"\s*:\s*\"([1-9A-HJ-NP-Za-km-z]{32,44})\"/);console.log(m?m[1]:'')})")
  gap
  if [ -n "$CH" ]; then run 0 '-' "topup: channels fund $CH during the session" -- channels fund "$CH" --tdvpn 1 --yes; else record FAIL 'topup: no channel in status --json' 'status --json' "$($CLI status --json 2>&1 | head -c 400)"; fi
  sleep 5
  check 'topup: session still up, egress = node' bash -c "$(declare -f egress); [ \"\$(egress)\" = '$NODE_IP' ]"
  run 0 'Connected|connected|wireguard' 'topup: status still connected' -- status
  run 0 '-' 'topup: disconnect' -- disconnect
  sleep 3; back_clean 'topup'
  check 'final: kill switch off, direct egress, nothing left' bash -c "$(declare -f no_leftovers egress); no_leftovers && [ \"\$(egress)\" = '$DIRECT' ]"
  summary; exit $?
fi

# ─── cover ───
if [ "$TIER" = cover ]; then
  # proven = PASSED in some tier run (spend-run1.tsv = the run before the 2026-10-21 12:37 UTC program redeploy)
  ran=$(cat "$OUT"/*.tsv | awk -F '\t' '$1 == "PASS" && $3 != "check" { print $3 }')
  missing=0
  while read -r key; do
    if printf '%s\n' "$ran" | grep -Eq "^$key( |$)"; then echo "ran     $key"; else echo "MISSING $key"; missing=$((missing + 1)); fi
  done < <($CLI help 2>/dev/null | grep -E '^  [a-z]' | sed -E 's/^  //; s/ (<|\[|--|\||…).*//' | awk '{ if ($2 ~ /^[a-z-]+$/) print $1" "$2; else print $1 }' | sort -u)
  echo "missing $missing"
  [ "$missing" = 0 ]
fi
