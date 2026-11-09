#!/usr/bin/env bash
# ─── uifire: one critical button FIRED through the real window, its effect checked, then undone ───
# Run ON a Linux test VM with a desktop (Xvfb), like split-ui.sh:
#   bash uifire.sh topup|settle|restore-defaults|switch|browser
# Each case: click the button, click Confirm in its dialog, check ONE concrete effect from outside
# the window (the CLI or the system), undo. The window and this script hand over through
# signal/await (ui-scenario.ts): the script records the "before" value, the window clicks, the
# script reads the "after" value.
# SPENDS small per-GB deposits (topup, settle, switch). Env: DVPN_KEYFILE, DVPN_DATA_DIR.
# PASS/FAIL lines, exit 1 on any FAIL.
set -u
export PATH="$PATH:/usr/sbin:/sbin"
# no braces in the usage text: the first '}' ended the expansion and every case arrived as "topup}" (u24d 14:25Z)
CASE=${1:?usage: uifire.sh topup|settle|restore-defaults|switch|browser|subscribe|export-csv|signout|onboard-create|onboard-backup|onboard-import|onboard-device-setup|onboard-restart|onboard-import-bad|ks-dead-hysteria2|ks-dead-xray|ks-dead-openvpn}
: "${DVPN_KEYFILE:?set DVPN_KEYFILE}"
export DVPN_DATA_DIR="${DVPN_DATA_DIR:-$HOME/ddv-data}"
declare -A NODE=(
  [hysteria2]=E8nefMLBuBzG1CrA4dSDU9mqq6ZNpv69Bt3w9QEtzvPf [v2ray]=Di5V9K2Vt5uptJUk7oVVnkDRXt9qWy5HhLbkEJMxEuM2
  [xray]=E9RG1iZJjsLfEuLfDYTHM4yXCjyFE21jBbJLFvGoL2FD [wireguard]=SLVJNn38s5RfqcVW7a7A4hGKqjY7Y1bKkUpG7wrGX5D
  [amneziawg]=1PwMkSjnyugAZHdHvDsddETzPUAubPkeyWymT7Ercn6 [openvpn]=9EQJ7dBwneFUse9yy8Hg56u2wPiGF5qkjAaA1ZAr64nP
)
NODE_IP=192.0.2.2
. "$(dirname "$0")/nodes.sh"; nodeset_apply   # NODE_SET=node4 → that node set (nodes.sh)
OUT=$HOME/ui/uifire-$CASE; mkdir -p "$HOME/ui"; rm -rf "$OUT"
SIG=${DVPN_UI_SIG_DIR:-/tmp/ddv-sig}; export DVPN_UI_SIG_DIR=$SIG; rm -rf "$SIG"; mkdir -p "$SIG"
# handler data lives OUTSIDE the signal dir: answer() treats every file in $SIG as a signal (deba 18:21, TLX)
ST=$SIG.state; rm -rf "$ST"; mkdir -p "$ST"
FAILS=0
# ABW evidence (2026-10-29): every uifire log ends with "INFO fired:", "INFO effect:", "INFO restore:" lines
FIRED=() VERIFIED=() EFF=() RESTORED=()
check() {
  if [ "$2" = 1 ]; then echo "PASS  $1${3:+  ($3)}"; else echo "FAIL  $1${3:+  ($3)}"; FAILS=$((FAILS + 1)); fi
  case $1 in EFFECT:*) EFF+=("${1#EFFECT: } = $([ "$2" = 1 ] && echo PASS || echo FAIL)${3:+ ($3)}") ;; esac
}
cli() { devnet-dvpn "$@" 2>&1 | grep -v '^\[rpc\]'; }
hold() { sudo touch /run/ddv-deadman.hold 2>/dev/null; true; }
B58='[1-9A-HJ-NP-Za-km-z]{32,44}'
# The session's deposit, from status --json (no node needed).
session_channel() { cli status --json | grep -oE "\"channel[A-Za-z]*\" *: *\"$B58\"" | head -1 | grep -oE "$B58\"$" | tr -d '"'; }
# One deposit's line in `channels`: "<addr>  <status> <basis>  node <n>  deposit <x>  used <y>".
channel_line() { cli channels | grep -E "^$1 " | head -1; }
deposit_of() { channel_line "$1" | sed -nE 's/.* deposit ([0-9.]+).*/\1/p'; }
status_of() { channel_line "$1" | awk '{print $2}'; }

DIRECT=$(curl -4 -s -m 12 https://api.ipify.org)
echo "INFO  uifire $CASE on $(. /etc/os-release; echo "$PRETTY_NAME") $(uname -r), direct $DIRECT"
s=$(cli daemon settings); echo "$s" | grep -qiE 'kill.?switch +(on|persist)' && { echo 'INFO  kill switch on before: turning it off'; cli daemon set --kill-switch off --yes >/dev/null; sleep 5; }
cli settings set proxyOnConnect=false >/dev/null 2>&1

# ─── the harness side of signal/await: <name> appears → run on_<name> → write <name>.ack ───
declare -A NOTE=()
answer() {   # runs in the background while the window works
  local n f
  while :; do
    for f in "$SIG"/*; do
      [ -e "$f" ] || continue; n=$(basename "$f"); case $n in *.ack|*.tmp) continue ;; esac
      [ -e "$SIG/$n.ack" ] && continue
      # The .ack appears only when complete: "> $n.ack" created it empty BEFORE the handler ran, so
      # the window's await went on at once and the read was cut off (u24d switch 17:41, TLX).
      "on_$n" > "$SIG/$n.ack.tmp" 2>&1 || echo "handler on_$n failed" >> "$SIG/$n.ack.tmp"
      mv -f "$SIG/$n.ack.tmp" "$SIG/$n.ack"
    done
    sleep 1
  done
}
on_noop() { echo ok; }

DIALOG_OK='click=[role="dialog"] button.btn-primary'
DIALOG_DANGER='click=[role="dialog"] button.btn-danger'
WG=${NODE[wireguard]}

case $CASE in
  topup)
    # Activity → Top up on an open deposit → Confirm: that deposit on chain grows by 1 tDVPN.
    # A wallet with many open deposits lists them all and the click takes the first row, which is
    # not always the live session's (u24d had 12): so every open deposit is read before and after,
    # and exactly one must have grown by 1 tDVPN (the step engine cannot aim at the live row on RC3).
    # A read on the rate-limited public RPC can fail or come back partial (arch 16:01Z: the top-up landed
    # on a deposit the before-read had missed). A failed read prints nothing and returns 1; before =
    # two identical good reads in a row; after = a good read that differs (up to ~60 s).
    deposits() { local o; o=$(cli channels 2>&1) || return 1
      awk '$2 ~ /^(open|in-use)$/ { for (i = 1; i < NF; i++) if ($i == "deposit") print $1, $(i + 1) }' <<< "$o"; }
    on_pre() { local k p=""; for k in 1 2 3 4 5 6; do deposits > "$ST/deposits.pre" || { sleep 5; continue; }
        [ -n "$p" ] && [ "$p" = "$(cat "$ST/deposits.pre")" ] && break; p=$(cat "$ST/deposits.pre"); sleep 5; done
      echo "open deposits $(wc -l < "$ST/deposits.pre") (read $k)"; }
    on_post() { local k; for k in 1 2 3 4 5 6 7; do deposits > "$ST/deposits.post" && ! cmp -s "$ST/deposits.pre" "$ST/deposits.post" && break; sleep 9; done
      echo "open deposits $(wc -l < "$ST/deposits.post") (read $k)"; }
    STEPS="connect=$WG:per_gb;sleep=4;signal=pre;await=pre:90;nav=Activity;sleep=3;count=[data-refunds=open] [data-refund] button:1;\
click=[data-refunds=open] [data-refund] button;count=[role=dialog]:1;shot=topup-dialog;$DIALOG_OK;gone=[role=dialog]:90;sleep=8;\
signal=post;await=post:90;shot=topup-after;disconnect"
    ;;
  settle)
    # A closed session leaves its deposit open; Activity → Settle now → Settle: the open deposits
    # start closing. Settle now settles ALL of them (no channel), and the live session's channel was
    # not always in status 4 s after connect (u24d: empty), so every deposit is read after the
    # disconnect and again after the click: at least one open one must have started closing.
    # As topup's deposits(): a failed read on the public RPC prints nothing and returns 1, so it can
    # never pass for "0 open" (deb12 18:02Z: 0 -> 0). before = two identical good reads in a row.
    states() { local o; o=$(cli channels 2>&1) || return 1
      # no {32,44}: Debian's mawk has no interval expressions, so it matched nothing (deb12 "0 of 0")
      awk 'length($1) >= 32 && length($1) <= 44 && $1 !~ /[^1-9A-HJ-NP-Za-km-z]/ { print $1, $2 }' <<< "$o"; }
    on_pre() { local k p=""; for k in 1 2 3 4 5 6; do states > "$ST/states.pre" || { sleep 5; continue; }
        [ -n "$p" ] && [ "$p" = "$(cat "$ST/states.pre")" ] && break; p=$(cat "$ST/states.pre"); sleep 5; done
      echo "open $(awk '$2 ~ /^(open|in-use)$/' "$ST/states.pre" | wc -l) of $(wc -l < "$ST/states.pre") deposits (read $k)"; }
    # Something to settle: no open deposit after the connect/disconnect (deba 18:21 "open 0 of 9") has
    # no Settle dialog by design, so that run cannot test the button: BLOCK, never a product FAIL.
    # The session's OWN deposit is left out: the app settles it by itself 15 s after Disconnect
    # (settleChannelSoon), so its move proves nothing about the button (deba 18:47: it was already
    # closing at the before-read). Only the wallet's OTHER open deposits count.
    on_live() { local k c=""; for k in 1 2 3 4 5 6 7 8 9 10; do c=$(session_channel); [ -n "$c" ] && break; sleep 3; done
      echo "$c" > "$ST/live"; echo "live deposit ${c:-unknown} (read $k)"; }
    # Fixture (TLX): a CLI session on ANOTHER node leaves its deposit OPEN after `disconnect` (the
    # CLI process exits before its 15 s auto-settle fires, and prints "Run settle run --yes"), so
    # Settle now always has one non-session deposit to close, on any wallet. Another node, so the
    # window's connect cannot reuse it. One small deposit, 7 s between the chain steps.
    FIX_NODE=${NODE[amneziawg]}
    cli connect "$FIX_NODE" --units 1 --yes >/dev/null; sleep 7
    FIXCH=""; for _ in 1 2 3 4 5 6 7 8 9 10; do FIXCH=$(session_channel); [ -n "$FIXCH" ] && break; sleep 3; done
    cli disconnect >/dev/null; sleep 7
    echo "$FIXCH" > "$ST/fixture"; echo "INFO  fixture deposit ${FIXCH:-none} (CLI session on ${FIX_NODE:0:8}…, left open)"
    precheck() {
      [ -s "$ST/live" ] && [ -n "$(cat "$ST/live")" ] || { echo "the session's own deposit could not be read, so a move cannot be told from the app's auto-settle"; return; }
      local fx; fx=$(cat "$ST/fixture" 2>/dev/null)
      [ -n "$fx" ] || { echo "the fixture deposit was not created (CLI connect on ${FIX_NODE:0:8}… gave no channel)"; return; }
      awk -v fx="$fx" '$1 == fx && $2 ~ /^(open|in-use)$/ { f = 1 } END { exit !f }' "$ST/states.pre" 2>/dev/null ||
        echo "the fixture deposit ${fx:0:8}… was not open before Settle now ($(cat "$SIG/pre.ack" 2>/dev/null))"; }
    on_post() { local k; for k in 1 2 3 4 5 6 7; do states > "$ST/states.post" && ! cmp -s "$ST/states.pre" "$ST/states.post" && break; sleep 9; done
      echo "open $(awk '$2 ~ /^(open|in-use)$/' "$ST/states.post" | wc -l) of $(wc -l < "$ST/states.post") deposits (read $k)"; }
    STEPS="connect=$WG:per_gb;sleep=4;signal=live;await=live:60;disconnect;sleep=10;signal=pre;await=pre:90;nav=Activity;sleep=5;\
wait-text=Settle now:30;click=text:Settle now;count=[role=dialog]:1;shot=settle-dialog;$DIALOG_OK;gone=[role=dialog]:180;sleep=10;\
signal=post;await=post:120;shot=settle-after"
    ;;
  restore-defaults)
    # Settings changed away from the defaults by the CLI → Restore default settings → Confirm: they are back.
    cli settings set defaultGb=3 defaultBasis=per_hour notifications=false >/dev/null
    BEFORE=$(cli settings get --json | tr -d ' \n')
    echo "INFO  before: $(grep -oE '"(defaultGb|defaultBasis|notifications)":[^,}]+' <<<"$BEFORE" | paste -sd' ')"
    STEPS="nav=Settings;sleep=3;click=[data-settings-reset];count=[role=dialog]:1;shot=reset-dialog;$DIALOG_OK;gone=[role=dialog]:30;sleep=3;shot=reset-after"
    ;;
  switch)
    # Connected over WireGuard → Servers → an AmneziaWG server → Switch: the session is the new one.
    # the whole status, one line: the protocol can sit on its own line, not on "Session" (u24d 16:15Z: empty detail)
    on_post() { local s; s=$(cli status 2>&1); echo "${s:-[cli status printed nothing]}" | tr -s ' ' | paste -sd'|' | cut -c1-400; }
    # While connected, the connect step's "done" check (a Disconnect button) is met at once by the OLD
    # session, so it returned before the switch ran: the egress check landed mid-switch (direct, by
    # design) and the closing disconnect stopped the new AmneziaWG session 5 s after it came up (u24d).
    # Wait until the Connect screen names the new protocol, then check.
    STEPS="connect=$WG:per_gb;sleep=4;egress=node;connect=${NODE[amneziawg]}:per_gb;wait-text=amneziawg:150;sleep=6;egress=node;signal=post;await=post:60;shot=switch-after;disconnect"
    ;;
  subscribe)
    # Plans → Subscribe → Pay: a new active subscription on chain; then its Cancel → Cancel subscription:
    # gone again. Active ones from earlier runs are closed first, so the Cancel button is the new one's.
    active_subs() { cli plans subscriptions | grep -c 'expires in'; }
    for id in $(cli plans subscriptions | grep 'expires in' | awk '{print $1}'); do echo "INFO  closing earlier subscription $id"; cli plans close "$id" --yes >/dev/null; sleep 7; done
    on_pre() { echo "active $(active_subs)"; }
    on_mid() { echo "active $(active_subs)"; }
    on_post() { echo "active $(active_subs)"; }
    STEPS="nav=Plans;sleep=5;signal=pre;await=pre:90;wait-text=Subscribe:60;click=text:Subscribe;count=[role=dialog]:1;shot=subscribe-dialog;$DIALOG_OK;\
gone=[role=dialog]:120;sleep=8;signal=mid;await=mid:90;nav=Plans;sleep=4;click=text:Cancel;count=[role=dialog]:1;shot=cancel-dialog;$DIALOG_DANGER;\
gone=[role=dialog]:120;sleep=8;signal=post;await=post:90;shot=plans-after"
    ;;
  export-csv)
    # Activity → Export CSV: the history file is written with a header and one row per past session.
    # Needs an app with the DVPN_UI_SAVE_PATH test hook (ipc HISTORY_EXPORT, after 0.1.10): the
    # save dialog cannot be driven under Xvfb.
    export DVPN_UI_SAVE_PATH=$OUT-history.csv; rm -f "$DVPN_UI_SAVE_PATH"
    HIST=$(cli history list --json | grep -oE '"started[A-Za-z]*"' | wc -l)
    echo "INFO  history entries (CLI): $HIST"
    STEPS="nav=Activity;sleep=4;wait-text=Export CSV:30;click=text:Export CSV;sleep=4;shot=export-after"
    ;;
  signout)
    # A fresh app data folder, no read-only test wallet: Import a key file (the test wallet, through
    # the test-only open path, so the key never passes through the scenario) → the encrypted
    # wallet.secret exists → Wallet → Sign out of this wallet → Sign out: wallet.secret is gone and
    # the setup screen is back. Needs an app with DVPN_UI_OPEN_PATH (after 0.1.10).
    export DVPN_DATA_DIR=$HOME/ui/uifire-signout-data; rm -rf "$DVPN_DATA_DIR"; mkdir -p "$DVPN_DATA_DIR"
    export DVPN_UI_NO_KEYFILE=1 DVPN_UI_OPEN_PATH=$DVPN_KEYFILE
    on_mid() { [ -f "$DVPN_DATA_DIR/wallet.secret" ] && echo 'wallet.secret present' || echo 'wallet.secret missing'; }
    STEPS="count=[data-import-keyfile]:1;click=[data-import-keyfile];sleep=8;signal=mid;await=mid:60;shot=imported;\
sleep=4;nav=Wallet;sleep=3;click=text:Sign out of this wallet;count=[role=dialog]:1;shot=signout-dialog;$DIALOG_DANGER;\
sleep=5;count=[data-onboarding-step]:1;shot=signed-out"
    ;;
  onboard-*)
    # ACCOUNT CREATION on a FRESH profile (owner order): an empty app data folder, no read-only test
    # wallet, the real keyring. Needs an app with the onboarding data-* hooks (after 0.1.10).
    export DVPN_DATA_DIR=$HOME/ui/uifire-onboard-data; rm -rf "$DVPN_DATA_DIR"; mkdir -p "$DVPN_DATA_DIR"
    export DVPN_UI_NO_KEYFILE=1
    LAST=$HOME/ui/uifire-onboard-last-address
    created() { grep -h 'wallet: created' "$DVPN_DATA_DIR"/logs/app.log 2>/dev/null | grep -oE "$B58" | tail -1; }
    CREATE="count=[data-wallet-create]:1;click=[data-wallet-create];sleep=5;count=[data-phrase-saved]:1"
    case ${CASE#onboard-} in
      # No screenshot while the phrase or the word check is on screen: a recovery phrase never goes to disk.
      create)   STEPS="$CREATE;phrase-check=right;sleep=3;gone=[data-phrase-saved]:10;shot=after-create" ;;
      backup)   STEPS="$CREATE;count=[data-phrase-word]:24;phrase-check=wrong;phrase-check=right;sleep=3;gone=[data-phrase-saved]:10;shot=after-saved" ;;
      import)   # the key file of the test wallet, through the test-only open path
                export DVPN_UI_OPEN_PATH=$DVPN_KEYFILE
                WANT=$(DVPN_DATA_DIR=$HOME/ddv-data cli status --json | grep -oE "\"owner\" *: *\"$B58\"" | head -1 | grep -oE "$B58")
                STEPS="count=[data-import-keyfile]:1;click=[data-import-keyfile];sleep=8;count=[data-onboarding-step]:1;shot=imported" ;;
      restart)  STEPS="$CREATE;phrase-check=right;sleep=3;gone=[data-phrase-saved]:10"
                STEPS2="sleep=3;count=[data-welcome-continue]:1;shot=welcome-back" ;;
      device-setup)
                # A DEDICATED funded wallet (one per runner family, never the runner's own): this
                # machine's device key gets a spending permission from it, then Remove permission
                # takes it away again (the second fired button, and the undo). A wallet imported in
                # this run skips the welcome screen, so the permission step comes straight up.
                UW=${UIFIRE_WALLET:-$HOME/uifire-wallet.json}
                [ -s "$UW" ] || { echo "FAIL  dedicated uifire wallet missing: $UW (stage ~/vault/flx-uifire/<family>.json)"; exit 1; }
                export DVPN_UI_OPEN_PATH=$UW
                grant() { DVPN_KEYFILE=$UW cli device show --json | tr -d ' \n' | grep -oE '"ready":(true|false)' | head -1; }
                on_pre() { echo "before $(grant)"; }
                on_mid() { echo "after-sign $(grant)"; }
                STEPS="signal=pre;await=pre:90;count=[data-import-keyfile]:1;click=[data-import-keyfile];sleep=8;\
count=[data-onboarding-step=permission]:1;sleep=10;shot=permission;click=[data-onboarding-step=permission] button.btn-primary;\
count=[role=dialog]:1;shot=sign-dialog;$DIALOG_OK;gone=[data-onboarding-step]:180;sleep=8;signal=mid;await=mid:120;\
nav=Wallet;sleep=5;click=text:Remove permission;count=[role=dialog]:1;shot=remove-dialog;$DIALOG_DANGER;gone=[role=dialog]:120;sleep=10;shot=removed" ;;
      import-bad) STEPS="count=[data-wallet-import]:1;click=[data-wallet-import];fill=Wallet to import:not a wallet key at all 123;\
click=[data-import-submit];sleep=4;count=[data-import-submit]:1;shot=import-refused" ;;
      *) echo "FAIL  unknown onboarding case $CASE"; exit 1 ;;
    esac
    ;;
  browser)
    # V2Ray session → Split tunnelling → Open browser through VPN: a browser runs with our SOCKS proxy.
    cli settings set proxyOnConnect=true >/dev/null 2>&1
    STEPS="connect=${NODE[v2ray]}:per_gb;sleep=4;egress-socks=node;browser;shot=browser-open;disconnect"
    ;;
  ks-dead-*)
    # Q0304: kill switch Always on, a VPN process dies mid-session → "Blocking internet" within 15 s
    # of the kill (was never, for Hysteria2: dvpnd only noticed through its 60 s stats tick).
    # The kill does not sample first (noleakcheck), so the 15 s count from the kill itself; the
    # leak check is egress=none right after. Undo: Restore network, kill switch off.
    P=${CASE#ks-dead-}; N=${NODE[$P]:-}; [ -n "$N" ] || { echo "FAIL  no node for $P"; exit 1; }
    STEPS="nav=Kill switch;ks-mode=persist;ks-state=standby;connect=$N:per_gb;ks-state=armed;sleep=4;shot=ks-armed;\
kill-proc=$P:noleakcheck;ks-state=blocking:15;expect=Blocking internet;egress=none;shot=ks-blocking;\
restore;egress=direct;ks-mode=off;ks-state=off;egress=direct"
    ;;
  *) echo "FAIL  unknown case $CASE"; exit 1 ;;
esac

hold
( while sleep 60; do sudo touch /run/ddv-deadman.hold 2>/dev/null; done ) & HOLDER=$!
answer & ANSWER=$!
# One app launch per step list; STEPS2 (onboard-restart) = the same profile started again.
launch() {   # <steps> <out-dir> <label>
  DVPN_UI_SCENARIO="$1" DVPN_UI_EXPECT_NODE_IP=$NODE_IP DVPN_UI_DIRECT_IP=$DIRECT DVPN_UI_SMOKE_WAIT_MS=6000 \
    UI_TIMEOUT=1200 bash "$(dirname "$0")/ui-smoke.sh" dark "$2" > "$2.launch" 2>&1
  # A case's precondition (precheck prints why it cannot be tested) is judged BEFORE any step line,
  # so a BLOCK never follows FAIL lines that cellrun would count (deba 18:47, TLX).
  if declare -F precheck >/dev/null; then BLOCKED=$(precheck); [ -n "$BLOCKED" ] && return 0; fi
  if [ -f "$2/scenario.json" ]; then
    while IFS=$'\t' read -r ok step detail; do
      check "app$3: $step" "$ok" "$detail"
      [ "$ok" = 1 ] || continue
      case $step in   # a real control activated vs a state read from the window/system
        click=*|connect=*|disconnect|ks-mode=*|restore|browser|phrase-check=*|fill=*) FIRED+=("$step") ;;
        egress*|ks-state=*|expect=*) VERIFIED+=("$step${detail:+ ($detail)}") ;;
      esac
    done < <(node -e '
      for (const s of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")))
        console.log([s.ok ? 1 : 0, s.step, String(s.detail ?? "").replace(/\s+/g, " ").slice(0, 220)].join("\t"));' "$2/scenario.json")
  else
    check "scenario.json written$3" 0 "$(tail -3 "$2.launch" | tr '\n' ' ')"
  fi
  local e; e=$(cat "$2/errors.json" 2>/dev/null || echo missing); check "no UI errors$3" "$([ "$(echo "$e" | tr -d ' \n')" = '[]' ] && echo 1 || echo 0)" "${e:0:200}"
}
launch "$STEPS" "$OUT" ''
if [ -n "${STEPS2:-}" ]; then
  SECRET_SUM=$(sha256sum "$DVPN_DATA_DIR/wallet.secret" 2>/dev/null | cut -c1-16); ADDR1=$(created)
  launch "$STEPS2" "$OUT-2" ' (restart)'
fi
kill $HOLDER $ANSWER 2>/dev/null
if [ -n "${BLOCKED:-}" ]; then
  cli disconnect >/dev/null 2>&1; cli proxy off >/dev/null 2>&1; cli settings set proxyOnConnect=false >/dev/null 2>&1
  echo "BLOCK uifire $CASE: $BLOCKED"
  exit 3
fi

# ─── the effect, read from outside the window ───
pre=$(cat "$SIG/pre.ack" 2>/dev/null); post=$(cat "$SIG/post.ack" 2>/dev/null)
case $CASE in
  topup)
    # deposits that changed: "<channel> <before> <after>"; exactly one, and by +1 tDVPN
    grew=$(awk 'NR == FNR { a[$1] = $2; next } ($1 in a) && $2 != a[$1] { print $1, a[$1], $2 }' "$ST/deposits.pre" "$ST/deposits.post" 2>/dev/null)
    n=$(grep -c . <<<"$grew"); [ -z "$grew" ] && n=0
    check 'EFFECT: one deposit grew by 1 tDVPN on chain' "$([ "$n" = 1 ] && awk '{exit !($3 - $2 >= 0.999 && $3 - $2 <= 1.001)}' <<<"$grew" && echo 1 || echo 0)" \
      "${n} changed of $(wc -l < "$ST/deposits.pre" 2>/dev/null || echo ?) open: ${grew:-none}"
    # final-pass CHAIN line (FINAL-PASS-EFFECT-SPEC): before -> after per changed deposit
    [ -n "$grew" ] && awk '{ printf "INFO  deposit %s %s -> %s tDVPN\n", $1, $2, $3 }' <<<"$grew"
    live=$(session_channel 2>/dev/null); [ -n "$grew" ] && [ -n "$live" ] && { grep -q "^$live " <<<"$grew" && echo 'INFO  it was the live session'"'"'s deposit' || echo 'INFO  it was another open deposit of this wallet (the first row)'; }
    ;;
  settle)
    # open (or in-use) before → closing / closed / ready / settled / gone after; never the session's
    # own deposit (the app's auto-settle moves that one by itself)
    LIVE=$(cat "$ST/live" 2>/dev/null)
    moved=$(awk -v live="$LIVE" 'NR == FNR { b[$1] = $2; next } { a[$1] = $2 } END { for (c in b) if (c != live && b[c] ~ /^(open|in-use)$/ && (!(c in a) || a[c] ~ /^(closing|closed|ready|settled)$/)) print c, (c in a ? a[c] : "gone") }' \
      "$ST/states.pre" "$ST/states.post" 2>/dev/null)
    n=$(grep -c . <<<"$moved"); [ -z "$moved" ] && n=0
    FX=$(cat "$ST/fixture" 2>/dev/null)
    check "EFFECT: the fixture deposit ${FX:0:8}… went open -> closing (or closed) after Settle now" \
      "$([ -n "$FX" ] && grep -q "^$FX " <<<"$moved" && echo 1 || echo 0)" "$(grep "^$FX " "$ST/states.post" 2>/dev/null || echo "${FX:-none} not in the after-read")"
    check 'EFFECT: open deposits (not the session'"'"'s own) started closing (or closed)' "$([ "$n" -ge 1 ] && echo 1 || echo 0)" \
      "$n of $(awk -v live="$LIVE" '$1 != live && $2 ~ /^(open|in-use)$/' "$ST/states.pre" 2>/dev/null | wc -l) open moved (own ${LIVE:0:8}… left out): $(head -3 <<<"$moved" | paste -sd' ')"
    # final-pass CHAIN line: open count before -> after, then each moved deposit
    echo "INFO  deposit count open $(awk '$2 == "open"' "$ST/states.pre" 2>/dev/null | wc -l) -> $(awk '$2 == "open"' "$ST/states.post" 2>/dev/null | wc -l) after Settle now"
    [ -n "$moved" ] && awk '{ printf "INFO  deposit %s open -> %s\n", $1, $2 }' <<<"$moved"
    ;;
  restore-defaults)
    AFTER=$(cli settings get --json | tr -d ' \n')
    ok=1; for kv in '"defaultGb":1' '"defaultBasis":"per_gb"' '"notifications":true'; do grep -qF "$kv" <<<"$AFTER" || ok=0; done
    check 'EFFECT: defaultGb 1, per GB, notifications on again' "$ok" "$(grep -oE '"(defaultGb|defaultBasis|notifications)":[^,}]+' <<<"$AFTER" | paste -sd' ')"
    ;;
  switch)
    check 'EFFECT: after Switch the session is AmneziaWG' "$(grep -qi amneziawg <<<"$post" && echo 1 || echo 0)" "$post"
    ;;
  subscribe)
    a=$(awk '{print $2}' <<<"$pre"); m=$(awk '{print $2}' <<<"$(cat "$SIG/mid.ack" 2>/dev/null)"); b=$(awk '{print $2}' <<<"$post")
    check 'EFFECT: Subscribe added an active subscription on chain' "$([ "${a:-x}" = 0 ] && [ "${m:-x}" = 1 ] && echo 1 || echo 0)" "active before ${a:-?}, after Pay ${m:-?}"
    check 'EFFECT: Cancel subscription removed it' "$([ "${m:-x}" = 1 ] && [ "${b:-x}" = 0 ] && echo 1 || echo 0)" "active after Cancel ${b:-?}"
    ;;
  export-csv)
    f=$DVPN_UI_SAVE_PATH; rows=$([ -f "$f" ] && tail -n +2 "$f" | grep -c . || echo 0)
    check 'EFFECT: Export CSV wrote the history file (header + rows)' "$([ -f "$f" ] && head -1 "$f" | grep -qi 'started' && [ "$rows" -ge 1 ] && echo 1 || echo 0)" "file $([ -f "$f" ] && echo present || echo missing), $rows rows, CLI history ${HIST}"
    rm -f "$f"
    ;;
  signout)
    mid=$(cat "$SIG/mid.ack" 2>/dev/null)
    check 'EFFECT: the imported wallet was stored encrypted (wallet.secret)' "$(grep -q present <<<"$mid" && echo 1 || echo 0)" "$mid"
    check 'EFFECT: Sign out removed wallet.secret from this computer' "$([ -f "$DVPN_DATA_DIR/wallet.secret" ] && echo 0 || echo 1)" "$(ls "$DVPN_DATA_DIR" 2>/dev/null | paste -sd' ')"
    rm -rf "$DVPN_DATA_DIR"
    ;;
  onboard-create|onboard-backup)
    a=$(created); prev=$(cat "$LAST" 2>/dev/null)
    check 'EFFECT: a new wallet address was created' "$([ -n "$a" ] && echo 1 || echo 0)" "${a:-none in app.log}"
    check 'EFFECT: it is saved encrypted (wallet.secret)' "$([ -s "$DVPN_DATA_DIR/wallet.secret" ] && echo 1 || echo 0)"
    [ "$CASE" = onboard-create ] && check 'EFFECT: it differs from the last run'"'"'s address' "$([ -n "$a" ] && [ "$a" != "$prev" ] && echo 1 || echo 0)" "now $a, last ${prev:-none}"
    [ -n "$a" ] && echo "$a" > "$LAST"
    # The phrase is never written anywhere by the test: the 24-word count is checked in the window.
    # onboard-backup: the wrong-word refusal and the right-word pass are the app steps phrase-check=wrong / =right (Q0297).
    ;;
  onboard-import)
    got=$(grep -h 'wallet: imported\|wallet: saved' "$DVPN_DATA_DIR"/logs/app.log 2>/dev/null | grep -oE "$B58" | tail -1)
    check 'EFFECT: the imported wallet is saved encrypted (wallet.secret)' "$([ -s "$DVPN_DATA_DIR/wallet.secret" ] && echo 1 || echo 0)"
    check 'EFFECT: same address as the key file' "$([ -n "$WANT" ] && [ "$got" = "$WANT" ] && echo 1 || echo 0)" "imported ${got:-?}, key file ${WANT:-?}"
    ;;
  onboard-restart)
    n=$(grep -c 'wallet: created' "$DVPN_DATA_DIR"/logs/app.log 2>/dev/null || echo 0)
    check 'EFFECT: after a restart no new wallet was created' "$([ "$n" = 1 ] && echo 1 || echo 0)" "$n 'wallet: created' lines, address ${ADDR1:-?}"
    check 'EFFECT: the stored wallet is unchanged' "$([ -n "$SECRET_SUM" ] && [ "$(sha256sum "$DVPN_DATA_DIR/wallet.secret" 2>/dev/null | cut -c1-16)" = "$SECRET_SUM" ] && echo 1 || echo 0)"
    ;;
  onboard-device-setup)
    pre=$(cat "$SIG/pre.ack" 2>/dev/null); mid=$(cat "$SIG/mid.ack" 2>/dev/null); now=$(grant)
    check 'EFFECT: before Sign the dedicated wallet had no permission on this device' "$(grep -q 'ready":false' <<<"$pre" && echo 1 || echo 0)" "$pre"
    check 'EFFECT: after Sign the device is ready on chain (permission + token approval + fee SOL)' "$(grep -q 'ready":true' <<<"$mid" && echo 1 || echo 0)" "$mid"
    check 'EFFECT: after Remove permission the device is no longer ready' "$(grep -q 'ready":false' <<<"$now" && echo 1 || echo 0)" "now $now"
    # undo when the Remove click did not take: the permission must not stay on a shared runner
    grep -q 'ready":true' <<<"$now" && { echo 'INFO  undo: removing the permission from the command line'; DVPN_KEYFILE=$UW cli device revoke --yes | tail -1; }
    ;;
  onboard-import-bad)
    check 'EFFECT: a bad key stores nothing' "$([ -f "$DVPN_DATA_DIR/wallet.secret" ] && echo 0 || echo 1)"
    check 'EFFECT: the app logged why it refused' "$(grep -qiE 'import failed|not a (valid )?(key|wallet|phrase)|invalid' "$DVPN_DATA_DIR"/logs/app.log 2>/dev/null && echo 1 || echo 0)" "$(grep -iE 'import|invalid' "$DVPN_DATA_DIR"/logs/app.log 2>/dev/null | tail -1 | cut -c1-160)"
    ;;
  browser) ;;   # the browser step checks it: a browser process carries our proxy flag
esac

# ─── undo: leave the VM as it was ───
pkill -f -- '--proxy-server=socks5://127.0.0.1' 2>/dev/null
cli disconnect >/dev/null 2>&1
cli proxy off >/dev/null 2>&1
cli settings set proxyOnConnect=false >/dev/null 2>&1
line=$(cli status | grep -m1 '^Session')
check 'CLI status: no session after' "$(echo "$line" | grep -q ' node ' && echo 0 || echo 1)" "$line"
now=$(curl -4 -s -m 12 https://api.ipify.org)
check 'internet direct after' "$([ "$now" = "$DIRECT" ] && echo 1 || echo 0)" "$now"
RESTORED+=("disconnect, proxy off, proxyOnConnect=false: session after '${line:-none}', egress $now (direct $DIRECT)")
case $CASE in
  signout) RESTORED+=('test app data folder removed') ;;
  export-csv) RESTORED+=('exported CSV removed') ;;
  onboard-device-setup) RESTORED+=('device permission removed (Remove permission, else CLI revoke)') ;;
  onboard-import-bad) RESTORED+=('nothing stored by the refused key (read-only)') ;;
  ks-dead-*) RESTORED+=('Restore network + kill switch Off on the page') ;;
esac

# ─── ABW evidence lines: fired / effect / restore (a PASS without all three is not proof) ───
j() { local s; s=$(printf '%s; ' "$@"); s=${s%; }; echo "${s:0:600}"; }
echo "INFO fired: ${#FIRED[@]} control(s) activated in the window: $( [ ${#FIRED[@]} -gt 0 ] && j "${FIRED[@]}" || echo none)"
echo "INFO effect: $( [ ${#EFF[@]} -gt 0 ] && j "${EFF[@]}" || echo 'no EFFECT check')$( [ ${#VERIFIED[@]} -gt 0 ] && echo " | verified in the app: $(j "${VERIFIED[@]}")")"
echo "INFO restore: $(j "${RESTORED[@]}")"
check 'FIRED: at least one control activated in the window' "$([ ${#FIRED[@]} -gt 0 ] && echo 1 || echo 0)"
check 'EFFECT CHECK RAN: an EFFECT check or an app-side state check' "$([ $(( ${#EFF[@]} + ${#VERIFIED[@]} )) -gt 0 ] && echo 1 || echo 0)"
echo "RESULT uifire $CASE: $FAILS FAIL"
exit $([ $FAILS = 0 ] && echo 0 || echo 1)
