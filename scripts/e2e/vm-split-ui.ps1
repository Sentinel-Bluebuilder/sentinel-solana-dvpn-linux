# --- vm-split-ui - the Split tunnelling PAGE, driven like a person, proven by real exit IPs (U5) ---
# NEVER on the owner's laptop. Run detached as the VM user (HKCU proxy is the user's):
#   powershell -File C:\ddv\vm-run.ps1 -Test splitui -Script vm-split-ui.ps1 -ScriptArgs "-Protocol xray" -AsUser
# The app (DVPN_UI_SCENARIO) chooses Microsoft Edge on the page, presses Apply (service restart),
# connects, and checks where traffic really goes:
#   exclude Edge -> curl.exe (system) exits at the node, a real Edge exits direct
#   include Edge -> Edge exits at the node, curl.exe exits direct
# Then split off again. Proxy-on-connect is turned off first (a system proxy would carry Edge
# whatever the split says). SPENDS two small per-GB deposits. PASS/FAIL lines, exit 1 on FAIL. ASCII only.
# -Case ks: the Kill switch PAGE instead: mode On + Apply, connect, the protocol process is killed
#   (the kill switch must hold: system traffic never exits direct), Restore network on the page,
#   internet direct again, mode Off + Apply. VM ONLY (tier 3). Kill switch on: xray, v2ray, hysteria2.
#   -KsMode persist picks Always on the page (confirm "Use Always") instead of On.
param(
  [ValidateSet('split', 'ks')][string]$Case = 'split',
  [ValidateSet('xray', 'v2ray', 'wireguard', 'amneziawg', 'openvpn', 'hysteria2')][string]$Protocol = 'xray',
  [ValidateSet('on', 'persist')][string]$KsMode = 'on',
  [int]$LimitSeconds = 900
)
$ErrorActionPreference = 'Continue'
$N = @{
  hysteria2 = '8rwN8HCeqM8WiaemKbckxCAjvGErh1LW8v1zPCBcXJbF'
  v2ray     = 'DfJukf4RgJ6a1AYcf6qGmNpTvvitsMwCWNKgV6cFQ1K3'
  xray      = 'FFmjhX3aTAUx1Ff2FnHUT5r1Xrq5qfvShvkbxPLwjcgi'
  wireguard = '8sV25KKBRbYD9kEXVAYX2wmVwEzaSsBtfA8G8LvfTdib'
  amneziawg = 'DrTdBLR3rX3epsqw1gj7JG32s1uskxSfYCdurnKGbcqi'
  openvpn   = 'CZRGDkJc7JUotfRSDrRfLjhtSFuunSMgky5Uk3GH8fXQ'
}
$NodeIp = '192.0.2.6'
$App = Join-Path $env:ProgramFiles 'Devnet dVPN\Devnet dVPN.exe'
$cli = Join-Path $env:ProgramFiles 'Devnet dVPN\bin\devnet-dvpn.cmd'
$out = "C:\ddv\ui\$($Case)ui-$Protocol" + $(if ($Case -eq 'ks') { "-$KsMode" } else { '' })
$script:fails = 0
function Check([string]$n, [bool]$ok, [string]$d = '') { if (-not $ok) { $script:fails++ }; Write-Host ('{0}  {1}{2}' -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $n, $(if ($d) { "  ($d)" } else { '' })) }
function Dvpn { ((& $cli @args 2>&1 | ForEach-Object { "$_" }) -join "`n").Trim() }

if ([Security.Principal.WindowsIdentity]::GetCurrent().IsSystem) { Write-Host 'FAIL  run as the VM user, not SYSTEM'; exit 1 }
if (Get-Process -Name 'Devnet dVPN' -ErrorAction SilentlyContinue) { Write-Host 'FAIL  the app is already running (close it first)'; exit 1 }
$env:DVPN_KEYFILE = 'C:\ddv\vm-wallet.json'
$env:DVPN_DATA_DIR = 'C:\ddv\data'
$direct = (& curl.exe -s -m 12 https://api.ipify.org)
Write-Host "INFO  direct $direct"
Write-Host ("INFO  before:`n" + (Dvpn split status))
$ksBefore = Dvpn daemon settings
Check 'kill switch off before (this test never turns it on)' ($ksBefore -match 'kill.?switch\s+off' -or $ksBefore -notmatch 'kill.?switch\s+(on|persist)') ''

$node = $N[$Protocol]
$steps = @(
  'nav=Split tunnelling', 'check=[data-proxy-on-connect]:off', 'check=[data-whole-device]:on',
  'split-mode=exclude', 'split-app=Microsoft Edge:on', 'shot=exclude-chosen', 'split-apply',
  "count=[data-split-protocol=$Protocol][data-split-ok=yes]:1",
  "connect=${node}:per_gb", 'coverage=split-exclude', 'egress=node', 'egress-edge=direct',
  'nav=Split tunnelling', 'count=[data-split-live=live]:1', 'expect=Microsoft Edge', 'shot=exclude-live', 'disconnect',
  'split-mode=include', 'split-apply',
  "connect=${node}:per_gb", 'coverage=split-include', 'egress=direct', 'egress-edge=node',
  'nav=Split tunnelling', 'shot=include-live', 'disconnect',
  'split-app=Microsoft Edge:off', 'split-mode=off', 'split-apply', 'egress=direct', 'egress-edge=direct'
) -join ';'
if ($Case -eq 'ks') {
  $proc = @{ xray = 'xray'; v2ray = 'v2ray'; hysteria2 = 'hysteria2' }[$Protocol]
  if (-not $proc) { Write-Host "FAIL  kill switch on is not offered for $Protocol"; exit 1 }
  $steps = @(
    'nav=Kill switch', 'count=[data-ks-protocol] [data-protocol-mark]:6', "ks-mode=$KsMode", 'ks-state=standby', 'shot=ks-standby',
    "connect=${node}:per_gb", 'ks-state=armed', 'egress=node', 'shot=ks-armed',
    "kill-proc=$proc", 'ks-state=blocking', 'expect=Blocking internet', 'shot=ks-after-kill',
    'restore', 'egress=direct', 'ks-mode=off', 'ks-state=off', 'shot=ks-off', 'egress=direct'
  ) -join ';'
}

Remove-Item -Recurse -Force -LiteralPath $out -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $out | Out-Null
$env:DVPN_UI_SMOKE = $out
$env:DVPN_UI_SCENARIO = $steps
$env:DVPN_UI_EXPECT_NODE_IP = $NodeIp
$env:DVPN_UI_DIRECT_IP = $direct
$env:DVPN_UI_SMOKE_WAIT_MS = '6000'
$p = Start-Process -FilePath $App -PassThru
if (-not $p.WaitForExit($LimitSeconds * 1000)) {
  Check 'app finished the scenario in time' $false "$LimitSeconds s"
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
}
Remove-Item Env:DVPN_UI_SMOKE, Env:DVPN_UI_SCENARIO, Env:DVPN_UI_EXPECT_NODE_IP, Env:DVPN_UI_DIRECT_IP, Env:DVPN_UI_SMOKE_WAIT_MS -ErrorAction SilentlyContinue

$json = Join-Path $out 'scenario.json'
if (Test-Path -LiteralPath $json) {
  foreach ($s in (Get-Content -Raw -LiteralPath $json | ConvertFrom-Json)) { $d = ("" + $s.detail) -replace '\s+', ' '; Check ("app: " + $s.step) ([bool]$s.ok) $d.Substring(0, [Math]::Min(220, $d.Length)) }
} else { Check 'scenario.json written' $false $out }
$errs = Join-Path $out 'errors.json'
if (Test-Path -LiteralPath $errs) { $e = Get-Content -Raw -LiteralPath $errs; Check 'no UI errors' ($e.Trim() -eq '[]') $e.Substring(0, [Math]::Min(300, $e.Length)) }

# After: the CLI reads what the page saved, no session, internet direct. If the scenario stopped
# half way, put split back to off from the CLI so the VM is left clean.
$after = Dvpn split status
Write-Host ("INFO  after:`n" + $after)
if ($after -notmatch '(?m)^Mode\s+off') {
  Write-Host 'INFO  split still on: turning it off from the CLI'
  Write-Host (Dvpn daemon set --split-mode off --split-apps none --split-routes none --yes)
  $after = Dvpn split status
}
Check 'CLI split status: off after' ($after -match '(?m)^Mode\s+off') ''
$ksAfter = Dvpn daemon settings
if ($ksAfter -match 'kill.?switch\s+(on|persist)') { Write-Host 'INFO  kill switch still on: turning it off from the CLI'; Write-Host (Dvpn daemon set --kill-switch off --yes); $ksAfter = Dvpn daemon settings }
Check 'CLI: kill switch off after' ($ksAfter -notmatch 'kill.?switch\s+(on|persist)') ''
Check 'CLI split apps lists Microsoft Edge' ((Dvpn split apps --search edge) -match 'msedge\.exe') ''
$st = Dvpn status
$line = "" + (($st -split "`n") | Where-Object { $_ -match '^Session' } | Select-Object -First 1)
Check 'CLI status: no session' ($line -and $line -notmatch ' node ') $line
$now = (& curl.exe -s -m 12 https://api.ipify.org)
Check 'internet direct after' ($now -eq $direct) $now
Write-Host ("RESULT {0}ui {1}: {2} FAIL" -f $Case, $Protocol, $script:fails)
exit $(if ($script:fails) { 1 } else { 0 })
