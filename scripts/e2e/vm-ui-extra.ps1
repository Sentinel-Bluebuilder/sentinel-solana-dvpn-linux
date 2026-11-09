# --- vm-ui-extra - app behaviour around a session it did not start, and a service that stops ---
# NEVER on the owner's laptop. Run detached as the VM user:
#   powershell -File C:\ddv\vm-run.ps1 -Test uiextra-adopt -Script vm-ui-extra.ps1 -ScriptArgs "-Case adopt" -AsUser
# -Case adopt (6774bb8 + de346e3): with the app open and idle, the CLI connects -> the Connect
#   screen shows it; the CLI disconnects -> the deposit stays OPEN 35 s later (the app must not
#   settle a CLI deposit); the CLI connects again -> the SAME deposit is reused; Disconnect pressed
#   in the app -> the app settles it (closing).
# -Case gate (8746241): connected from the app, the service is stopped -> the menu stays and the
#   "not answering" banner shows (not the setup screen); service started -> banner gone, idle.
#   Needs vm-ui-extra-admin.ps1 running at the same time over an admin ssh (stop/start service).
# Kill switch and split stay off. SPENDS small per-GB deposits. ASCII only.
param(
  [ValidateSet('adopt', 'gate')][string]$Case = 'adopt',
  [string]$Node = '8sV25KKBRbYD9kEXVAYX2wmVwEzaSsBtfA8G8LvfTdib',
  [int]$LimitSeconds = 900
)
$ErrorActionPreference = 'Continue'
$App = Join-Path $env:ProgramFiles 'Devnet dVPN\Devnet dVPN.exe'
$cli = Join-Path $env:ProgramFiles 'Devnet dVPN\bin\devnet-dvpn.cmd'
$out = "C:\ddv\ui\extra-$Case"
$sig = 'C:\ddv\sig'
$script:fails = 0
function Check([string]$n, [bool]$ok, [string]$d = '') { if (-not $ok) { $script:fails++ }; Write-Host ('{0}  {1}{2}' -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $n, $(if ($d) { "  ($d)" } else { '' })) }
function Dvpn { ((& $cli @args 2>&1 | ForEach-Object { "$_" } | Where-Object { $_ -notmatch '^\[rpc\]' }) -join "`n").Trim() }
# Deposits on this node: @{ address = state }
function Deposits {
  $h = @{}
  foreach ($l in ((Dvpn channels) -split "`n")) { if ($l -match "^(\w{32,44})\s+(\w+)\s+.*node $Node") { $h[$Matches[1]] = $Matches[2] } }
  return $h
}
function Fmt($h) { (($h.GetEnumerator() | ForEach-Object { "$($_.Key.Substring(0,6)) $($_.Value)" }) -join ', ') }

if ([Security.Principal.WindowsIdentity]::GetCurrent().IsSystem) { Write-Host 'FAIL  run as the VM user, not SYSTEM'; exit 1 }
if (Get-Process -Name 'Devnet dVPN' -ErrorAction SilentlyContinue) { Write-Host 'FAIL  the app is already running (close it first)'; exit 1 }
$env:DVPN_KEYFILE = 'C:\ddv\vm-wallet.json'
$env:DVPN_DATA_DIR = 'C:\ddv\data'
$set = Dvpn daemon settings
Check 'kill switch off before' ($set -notmatch 'kill.?switch\s+(on|persist)') ''
Check 'split off before' ((Dvpn split status) -match '(?m)^Mode\s+off') ''
Write-Host ("INFO  " + ((Dvpn status) -split "`n" | Select-Object -First 4) -join ' | ')
$before = Deposits
Write-Host "INFO  deposits on node before: $(Fmt $before)"
Remove-Item -Recurse -Force -LiteralPath $sig -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $sig | Out-Null

if ($Case -eq 'adopt') {
  $steps = @(
    'nav=Connect', 'wait-text=Not connected:60', 'shot=idle',
    "cli=connect $Node --basis per_gb --yes", 'wait-text=Protected:30', 'shot=adopted',
    'cli=disconnect', 'wait-text=Not connected:30', 'sleep=35', 'signal=chk1', 'await=chk1:90',
    "cli=connect $Node --basis per_gb --yes", 'wait-text=Protected:30', 'signal=chk2', 'await=chk2:90',
    'disconnect', 'sleep=45', 'signal=chk3', 'await=chk3:90'
  ) -join ';'
} else {
  $steps = @(
    "connect=${Node}:per_gb", 'shot=gate-connected',
    'signal=stopsvc', 'await=stopsvc:120',
    'wait-text=The VPN service is not answering:60', 'count=[data-setup-lost=service]:1',
    'count=nav[aria-label="Main"] button:5', 'shot=gate-banner',
    'signal=startsvc', 'await=startsvc:120',
    'gone=[data-setup-lost]:120', 'wait-text=Not connected|Protected:60', 'shot=gate-back'
  ) -join ';'
}

Remove-Item -Recurse -Force -LiteralPath $out -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $out | Out-Null
$env:DVPN_UI_SMOKE = $out
$env:DVPN_UI_SCENARIO = $steps
$env:DVPN_UI_SMOKE_WAIT_MS = '6000'
$p = Start-Process -FilePath $App -PassThru
Remove-Item Env:DVPN_UI_SMOKE, Env:DVPN_UI_SCENARIO, Env:DVPN_UI_SMOKE_WAIT_MS -ErrorAction SilentlyContinue

# Answer the scenario's checkpoints (adopt) while the app runs. stopsvc/startsvc are answered by
# vm-ui-extra-admin.ps1 (needs admin).
$first = $null
$deadline = (Get-Date).AddSeconds($LimitSeconds)
while (-not $p.HasExited -and (Get-Date) -lt $deadline) {
  foreach ($c in 'chk1', 'chk2', 'chk3') {
    if ((Test-Path "$sig\$c") -and -not (Test-Path "$sig\$c.ack")) {
      $now = Deposits
      $new = @($now.Keys | Where-Object { -not $before.ContainsKey($_) })
      $open = @($now.Keys | Where-Object { $now[$_] -eq 'open' })
      switch ($c) {
        'chk1' {
          $first = if ($new.Count -eq 1) { $new[0] } else { $null }
          Check 'CLI connect while the app is open made one deposit' ($new.Count -eq 1) (Fmt $now)
          Check 'that deposit is still OPEN 35 s after a CLI disconnect (app did not settle it)' ($first -and $now[$first] -eq 'open') (Fmt $now)
        }
        'chk2' {
          Check 'second CLI connect reused the same deposit (no new one)' ($first -and $new.Count -eq 1 -and $new[0] -eq $first -and $now[$first] -eq 'open') (Fmt $now)
        }
        'chk3' {
          Check 'Disconnect pressed in the app settles it (closing)' ($first -and $now[$first] -in @('closing', 'closed')) (Fmt $now)
        }
      }
      Set-Content -LiteralPath "$sig\$c.ack" -Value (Fmt $now) -Encoding ascii
    }
  }
  Start-Sleep -Milliseconds 700
}
if (-not $p.HasExited) { Check 'app finished the scenario in time' $false "$LimitSeconds s"; Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }

$json = Join-Path $out 'scenario.json'
if (Test-Path -LiteralPath $json) {
  foreach ($s in (Get-Content -Raw -LiteralPath $json | ConvertFrom-Json)) { $d = ("" + $s.detail) -replace '\s+', ' '; Check ("app: " + $s.step) ([bool]$s.ok) $d.Substring(0, [Math]::Min(220, $d.Length)) }
} else { Check 'scenario.json written' $false $out }
$errs = Join-Path $out 'errors.json'
if (Test-Path -LiteralPath $errs) {
  # The gate case stops the service on purpose: the app's own "not answering" logs are expected there.
  $e = @((Get-Content -Raw -LiteralPath $errs | ConvertFrom-Json) | Where-Object { $_ -notmatch '^scenario ' })
  Check 'no UI errors' ($e.Count -eq 0) (($e -join ' | ') -replace '\s+', ' ').Substring(0, [Math]::Min(300, (($e -join ' | ')).Length))
}

$st = Dvpn status
if ($st -match '(?m)^Session\s+(?!\s|Not connected)') { Write-Host 'INFO  a session is still up: disconnecting'; Write-Host (Dvpn disconnect) }
$line = "" + (((Dvpn status) -split "`n") | Where-Object { $_ -match '^Session' } | Select-Object -First 1)
Check 'CLI status: no session after' ($line -match 'Not connected') $line
Write-Host "INFO  deposits on node after: $(Fmt (Deposits))"
Write-Host ("RESULT uiextra {0}: {1} FAIL" -f $Case, $script:fails)
exit $(if ($script:fails) { 1 } else { 0 })
