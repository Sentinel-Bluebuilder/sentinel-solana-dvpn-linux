# --- vm-split-dyn - dynamic split tunnelling: the system proxy while things change (plan L2) ---
# NEVER on the owner's laptop. Run over SSH as the VM's desktop user (the system proxy is per
# user, HKCU), never as SYSTEM:
#   powershell -File vm-split-dyn.ps1 -Proto v2ray|xray [-Case all|toggle|switch-proxy|switch-full|
#                                      user-change|user-pac|service-restart|browser-close|port-taken|
#                                      races|nodedown-a|nodedown-b]
# nodedown-a / nodedown-b are driven from the laptop: a (connect + proxy on), the laptop stops the
# node service on ddv-node-1, then b (checks), then the laptop starts the node again.
# Every case ends with: direct internet, the user's own proxy settings exactly as before, no
# v2ray/xray process left. PASS/FAIL/INFO lines, exit 1 on any FAIL. ASCII only (PowerShell 5.1).
param(
  [ValidateSet('v2ray', 'xray')][string]$Proto = 'v2ray',
  [string]$Case = 'all',
  [string]$NodeIp = '192.0.2.6',
  [string]$Test = ''  # vm-run.ps1 always passes -Test (the run name); unused here
)
$ErrorActionPreference = 'Continue'
$env:DVPN_KEYFILE = 'C:\ddv\vm-wallet.json'
$env:DVPN_DATA_DIR = 'C:\ddv\data'
$cli = Join-Path $env:ProgramFiles 'Devnet dVPN\bin\devnet-dvpn.cmd'
$Nodes = [ordered]@{
  v2ray     = 'DfJukf4RgJ6a1AYcf6qGmNpTvvitsMwCWNKgV6cFQ1K3'
  xray      = 'FFmjhX3aTAUx1Ff2FnHUT5r1Xrq5qfvShvkbxPLwjcgi'
  hysteria2 = '8rwN8HCeqM8WiaemKbckxCAjvGErh1LW8v1zPCBcXJbF'
}
$Other = if ($Proto -eq 'v2ray') { 'xray' } else { 'v2ray' }
$IS = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$Chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
$script:fails = 0; $script:code = 0
function Check([string]$n, [bool]$ok, [string]$d = '') { if (-not $ok) { $script:fails++ }; Write-Host ('{0}  {1}{2}' -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $n, $(if ($d) { "  ($d)" } else { '' })) }
function Info([string]$m) { Write-Host ("INFO  " + $m) }
function Dvpn { $o = & $cli @args 2>&1 | ForEach-Object { "$_" } | Where-Object { $_ -notmatch '^\[rpc\] benched' }; $script:code = $LASTEXITCODE; ($o -join "`n").Trim() }
function Egress([string]$socks = '') { $a = @('-s', '-m', '12'); if ($socks) { $a += @('--socks5-hostname', $socks) }; $ip = & curl.exe @a 'https://api.ipify.org' 2>$null; if ($LASTEXITCODE -eq 0 -and $ip) { "$ip".Trim() } else { 'none' } }
# No Start-Job here: under a non-interactive (S4U) task the job's child process can die and
# Receive-Job/Wait-Job then wait forever (sdv182/sdv183/sdv185/sdv186 all hung after 'toggle').
# Plain processes with output files and a hard kill instead.
function Spawn([string]$file, [string[]]$argv, [string]$out) {
  # Process.Start, not Start-Process: Start-Process itself never returned in the S4U test task
  # once the system proxy was on (sdv192x, sdv-c8: 75 min stuck, no child created). The child
  # writes its own output file (cmd /c ... > out), so nothing here waits on a pipe.
  $quoted = ($argv | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
  $si = New-Object System.Diagnostics.ProcessStartInfo
  $si.FileName = "$env:SystemRoot\System32\cmd.exe"
  $si.Arguments = '/d /s /c "' + $file + ' ' + $quoted + ' > "' + $out + '""'
  $si.UseShellExecute = $false
  $si.CreateNoWindow = $true
  [System.Diagnostics.Process]::Start($si)
}
# Timestamped progress marker: a hang shows as the last step printed.
function Step([string]$m) { Write-Host ('STEP  {0}  {1}' -f (Get-Date).ToUniversalTime().ToString('HH:mm:ss'), $m) }
function Collect($p, [string]$out, [int]$sec) {
  # Poll HasExited with a hard deadline: WaitForExit(ms) never returned here (sdv190 + sdv-c7
  # both stuck over 1 h at the first WinINET probe, 2026-10-22).
  $deadline = (Get-Date).AddSeconds($sec)
  while (-not $p.HasExited -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
  if (-not $p.HasExited) {
    Step "collect: pid $($p.Id) still running after $sec s, killed"
    Get-CimInstance Win32_Process -Filter "ParentProcessId=$($p.Id)" -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    return 'hung'
  }
  $r = (Get-Content -LiteralPath $out -Raw -ErrorAction SilentlyContinue); Remove-Item -LiteralPath $out -ErrorAction SilentlyContinue
  if ($r) { "$r".Trim() } else { '' }
}
# WinINET (system proxy) view, as a proxy-aware app sees it.
function Iwr {
  $o = "C:\ddv\iwr-$PID.txt"
  $p = Spawn 'powershell.exe' @('-NoProfile', '-NonInteractive', '-Command', "try { (Invoke-WebRequest -Uri 'https://api.ipify.org' -UseBasicParsing -TimeoutSec 12).Content.Trim() } catch { 'none' }") $o
  Step "iwr: spawned pid $($p.Id)"
  $r = Collect $p $o 25
  if ($r) { $r } else { 'none' }
}

# The user's proxy state: the four WinINET values plus the auto-detect/PAC flags blob.
function ProxyState {
  $p = Get-ItemProperty $IS
  $blob = (Get-ItemProperty "$IS\Connections" -ErrorAction SilentlyContinue).DefaultConnectionSettings
  # A profile that never had proxy settings has no values and no blob; Windows treats that as
  # proxy off + auto-detect on (flags 9), which is what a restore writes (ddv-win-a sdv185).
  $flags = if ($blob -and $blob.Length -gt 8) { $blob[8] } else { 9 }
  $enable = if ($null -eq $p.ProxyEnable) { 0 } else { $p.ProxyEnable }
  '{0}|{1}|{2}|{3}|flags={4}' -f $enable, $p.ProxyServer, $p.ProxyOverride, $p.AutoConfigURL, $flags
}
function SetUserProxy([int]$enable, [string]$server, [string]$override, [string]$pac) {
  Set-ItemProperty $IS -Name ProxyEnable -Value $enable -Type DWord
  if ($server) { Set-ItemProperty $IS -Name ProxyServer -Value $server } else { Remove-ItemProperty $IS -Name ProxyServer -ErrorAction SilentlyContinue }
  if ($override) { Set-ItemProperty $IS -Name ProxyOverride -Value $override } else { Remove-ItemProperty $IS -Name ProxyOverride -ErrorAction SilentlyContinue }
  if ($pac) { Set-ItemProperty $IS -Name AutoConfigURL -Value $pac } else { Remove-ItemProperty $IS -Name AutoConfigURL -ErrorAction SilentlyContinue }
}
function Connect([string]$p, [switch]$Switch) {
  $a = @('connect', $Nodes[$p], '--basis', 'per_gb', '--units', '1', '--yes'); if ($Switch) { $a += '--switch' }
  $o = Dvpn @a
  $s = if ($o -match 'SOCKS (127\.0\.0\.1:\d+)') { $Matches[1] } else { '' }
  @{ ok = ($script:code -eq 0 -and $o -match 'Connected'); socks = $s; out = (($o -split "`n" | Select-Object -Last 2) -join ' / ') }
}
function Listening([string]$hp) { if (-not $hp) { return $false }; $port = [int]($hp -split ':')[1]; @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue).Count -gt 0 }
function ProxyPort { $p = Get-ItemProperty $IS; if ($p.ProxyEnable -eq 1 -and "$($p.ProxyServer)" -match '127\.0\.0\.1:(\d+)') { $Matches[0] } else { '' } }
function Orphans { @(Get-Process -Name v2ray, xray -ErrorAction SilentlyContinue).Count }

$direct = Egress
$before = ProxyState
if ($before -match '^1\|socks=127\.0\.0\.1:') {
  # Our endpoint is still the user's proxy from an earlier run that was killed (sdv192x): that is
  # not the user's own value. Put the saved one back first so every case compares to the real one.
  $st = Dvpn status
  if ((ProxyState) -match '^1\|socks=127\.0\.0\.1:') { Dvpn proxy off | Out-Null }
  Info "start: our proxy was left from a killed run [$before]; restored to [$(ProxyState)]"
  $before = ProxyState
}
Info ("split-dyn {0} case {1}: direct {2}, node {3}, user proxy before [{4}]" -f $Proto, $Case, $direct, $NodeIp, $before)
Check 'start: direct internet' ($direct -ne 'none' -and $direct -ne $NodeIp) $direct
# These cases are about the SOCKS proxy mode. Since dvpnd ddv8 V2Ray/Xray default to whole-device
# TUN (every app by the node), so switch the service to proxy-only for the run and back at the end.
Dvpn daemon set --kill-switch off --whole-device false --yes | Out-Null
Check 'setup: proxy-only mode (whole-device false)' ($script:code -eq 0)

# Each case ends here: network back, user's proxy exactly as it was when the case started.
function EndCase([string]$name, [string]$want) {
  Dvpn proxy off | Out-Null
  Dvpn disconnect | Out-Null
  Start-Sleep -Seconds 4
  $e = Egress
  if ($e -ne $direct) { Info "$name restore-network: $(Dvpn daemon restore-network)"; Start-Sleep 3; $e = Egress }
  Check "$name end: direct internet" ($e -eq $direct) $e
  $now = ProxyState
  Check "$name end: user proxy exactly as before" ($now -eq $want) "before [$want] now [$now]"
  $orph = Orphans
  Check "$name end: no v2ray/xray process left" ($orph -eq 0) "$orph"
  Start-Sleep -Seconds 7  # chain pacing
}
function Want([string]$c) { $Case -eq 'all' -or $Case -eq $c }

# 1. proxy on/off 10x while a download runs through SOCKS: no stall, no leak, state exact.
if (Want 'toggle') {
  $c = Connect $Proto
  Check "toggle: connect $Proto" ($c.ok -and $c.socks) $c.out
  if ($c.ok) {
    $dlOut = "C:\ddv\dl-$PID.txt"
    $dl = Spawn 'curl.exe' @('-s', '-m', '120', '--limit-rate', '1M', '--socks5-hostname', $c.socks, '-o', 'NUL', '-w', '%{size_download}', 'https://speed.cloudflare.com/__down?bytes=40000000') $dlOut
    $bad = 0
    for ($i = 1; $i -le 10; $i++) {
      Dvpn proxy on --yes | Out-Null
      if ((ProxyPort) -ne $c.socks) { $bad++; Info "toggle $i on: proxy [$(ProxyState)]" }
      Start-Sleep -Milliseconds 700
      Dvpn proxy off | Out-Null
      if ((ProxyState) -ne $before) { $bad++; Info "toggle $i off: proxy [$(ProxyState)]" }
      Start-Sleep -Milliseconds 700
    }
    Check 'toggle: every on pointed at the session, every off restored the user value' ($bad -eq 0) "$bad bad states"
    Step 'toggle: proxy on'
    Dvpn proxy on --yes | Out-Null
    Step 'toggle: WinINET probe'
    $iwr = Iwr
    Check 'toggle: WinINET app follows the proxy after 10 toggles' ($iwr -eq $NodeIp) $iwr
    Step 'toggle: proxy off'
    Dvpn proxy off | Out-Null
    Step 'toggle: collect download'
    $got = Collect $dl $dlOut 150
    Check 'toggle: SOCKS download kept going through the toggles (40 MB)' ("$got" -eq '40000000') "$got bytes"
  }
  EndCase 'toggle' $before
}

# 2. proxy on, then --switch to the other proxy protocol: proxy follows the new endpoint or is restored.
if (Want 'switch-proxy') {
  $c = Connect $Proto
  if ($c.ok) {
    Dvpn proxy on --yes | Out-Null
    $s = Connect $Other -Switch
    Check "switch-proxy: --switch $Proto -> $Other" $s.ok $s.out
    $pp = ProxyPort
    if ($pp) {
      Check 'switch-proxy: system proxy points at a live port' (Listening $pp) $pp
      $iwr = Iwr
      Check 'switch-proxy: WinINET app still goes through the VPN' ($iwr -eq $NodeIp) $iwr
    } else {
      Check 'switch-proxy: proxy restored to the user value (not left dead)' ((ProxyState) -eq $before) (ProxyState)
      Info 'switch-proxy: the proxy did not follow the new session (user must turn it on again)'
    }
  } else { Check "switch-proxy: connect $Proto" $false $c.out }
  EndCase 'switch-proxy' $before
}

# 3. proxy on, then --switch to a full-tunnel protocol: proxy cleared, traffic tunnelled.
if (Want 'switch-full') {
  $c = Connect $Proto
  if ($c.ok) {
    Dvpn proxy on --yes | Out-Null
    $s = Connect 'hysteria2' -Switch
    Check "switch-full: --switch $Proto -> hysteria2" $s.ok $s.out
    Check 'switch-full: system proxy restored (no SOCKS port left set)' ((ProxyState) -eq $before) (ProxyState)
    $e = Egress
    Check 'switch-full: plain traffic now tunnelled' ($e -eq $NodeIp) $e
    $iwr = Iwr
    Check 'switch-full: WinINET app works (not pointed at a dead proxy)' ($iwr -eq $NodeIp) $iwr
  } else { Check "switch-full: connect $Proto" $false $c.out }
  EndCase 'switch-full' $before
}

# 4. the user changes their own proxy mid-session: our disconnect must keep the user's new value.
if (Want 'user-change') {
  $c = Connect $Proto
  if ($c.ok) {
    Dvpn proxy on --yes | Out-Null
    SetUserProxy 1 '10.8.8.8:3128' '<local>' ''
    $userNew = ProxyState
    Dvpn proxy off | Out-Null
    Check 'user-change: proxy off keeps the value the user set mid-session' ((ProxyState) -eq $userNew) "want [$userNew] now [$(ProxyState)]"
    Dvpn disconnect | Out-Null
    Check 'user-change: disconnect keeps it too' ((ProxyState) -eq $userNew) (ProxyState)
  } else { Check "user-change: connect $Proto" $false $c.out }
  EndCase 'user-change' (ProxyState)
  SetUserProxy 0 '' '' ''
  $before = ProxyState
}

# 4b. the user had a PAC + manual proxy before connecting: restored exactly.
if (Want 'user-pac') {
  SetUserProxy 1 '10.9.9.9:8080' '*.corp;<local>' 'http://wpad.example.invalid/proxy.pac'
  $userPac = ProxyState
  $c = Connect $Proto
  if ($c.ok) {
    Dvpn proxy on --yes | Out-Null
    Check 'user-pac: proxy on points at the session' ((ProxyPort) -eq $c.socks) (ProxyState)
  } else { Check "user-pac: connect $Proto" $false $c.out }
  EndCase 'user-pac' $userPac
  SetUserProxy 0 '' '' ''
  $before = ProxyState
}

# 5. service restart with the proxy on: never leave the proxy pointing at a dead port.
if (Want 'service-restart') {
  $c = Connect $Proto
  if ($c.ok) {
    Dvpn proxy on --yes | Out-Null
    Restart-Service -Name dvpnd -Force; Start-Sleep -Seconds 15
    $st = Dvpn status
    Info ("service-restart: status: " + (($st -split "`n" | Where-Object { $_ -match '^(Session|Leftover|Daemon)' }) -join ' | '))
    $pp = ProxyPort
    $ok = (-not $pp) -or (Listening $pp)
    Check 'service-restart: after the next CLI command the proxy is not left on a dead port' $ok "proxy [$(ProxyState)] listening=$(if ($pp) { Listening $pp } else { 'n/a' })"
    $iwr = Iwr
    Check 'service-restart: WinINET apps still reach the internet' ($iwr -ne 'none') $iwr
  } else { Check "service-restart: connect $Proto" $false $c.out }
  EndCase 'service-restart' $before
}

# 6. a "proxy browser" window open, then disconnect: that window fails closed, never direct.
if (Want 'browser-close') {
  if (-not (Test-Path $Chrome)) { Info 'browser-close: Chrome not installed (vm-split-test.ps1 -Test setup); skipped' }
  else {
    $c = Connect $Proto
    if ($c.ok) {
      Dvpn proxy browser --browser chrome --url https://api.ipify.org | Out-Null
      Start-Sleep -Seconds 8
      $n = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -match [regex]::Escape("socks5://$($c.socks)") }).Count
      Check 'browser-close: Chrome opened through the session' ($n -gt 0) "$n processes"
      Dvpn disconnect | Out-Null
      Start-Sleep -Seconds 3
      # Ask the open window to load a page: with the SOCKS port gone it must fail, not go direct.
      & $Chrome --user-data-dir="$env:LOCALAPPDATA\Devnet dVPN\browser-profile" 'https://example.com/?after-disconnect' 2>$null
      Start-Sleep -Seconds 10
      $ids = @(Get-Process chrome -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
      $direct443 = @(Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.OwningProcess -and $_.RemoteAddress -notin '0.0.0.0', '::', '127.0.0.1' -and $_.RemotePort -eq 443 })
      Check 'browser-close: that window makes no direct web connections after disconnect' ($direct443.Count -eq 0) (($direct443 | ForEach-Object { "$($_.RemoteAddress):$($_.RemotePort)" }) -join ' ')
      Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force
    } else { Check "browser-close: connect $Proto" $false $c.out }
    EndCase 'browser-close' $before
  }
}

# 7. the SOCKS port is already taken before connect: clear message or another port, nothing half-set.
if (Want 'port-taken') {
  $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 1080)
  try { $l.Start(); Info 'port-taken: holding 127.0.0.1:1080' } catch { Info "port-taken: 1080 already in use: $($_.Exception.Message)" }
  $c = Connect $Proto
  if ($c.ok) {
    Check 'port-taken: session got a different SOCKS port' ($c.socks -and $c.socks -ne '127.0.0.1:1080') $c.socks
    $e = Egress $c.socks
    Check 'port-taken: that port carries VPN traffic' ($e -eq $NodeIp) $e
  } else {
    Check 'port-taken: refused with a plain message (no raw error)' ($c.out -notmatch 'Error: [A-Z_]+:|EADDRINUSE|bind: ' -and $c.out.Length -gt 0) $c.out
    Check 'port-taken: nothing half-set after the refusal' ((ProxyState) -eq $before -and (Orphans) -eq 0) "proxy [$(ProxyState)] orphans $(Orphans)"
  }
  try { $l.Stop() } catch { Info "port-taken: listener stop: $($_.Exception.Message)" }
  EndCase 'port-taken' $before
}

# 9. rapid connect / proxy on / disconnect races.
if (Want 'races') {
  $okRuns = 0
  for ($i = 1; $i -le 8; $i++) {
    $c = Connect $Proto
    if ($c.ok) { $okRuns++ }
    Dvpn proxy on --yes | Out-Null
    Dvpn disconnect | Out-Null
  }
  Info "races: $okRuns/8 connects succeeded"
  Start-Sleep -Seconds 3
  Check 'races: system proxy not left on after the last disconnect' ((ProxyState) -eq $before) (ProxyState)
  EndCase 'races' $before
}

# 8. node dies with the proxy on (laptop stops/starts the node between a and b).
if ($Case -eq 'nodedown-a') {
  $c = Connect $Proto
  Check "nodedown-a: connect $Proto" ($c.ok -and $c.socks) $c.out
  if ($c.ok) { Dvpn proxy on --yes | Out-Null; Check 'nodedown-a: proxy on' ((ProxyPort) -eq $c.socks) (ProxyState) }
  Set-Content -LiteralPath C:\ddv\nodedown.txt -Value $before -Encoding ascii
}
if ($Case -eq 'nodedown-b') {
  $want = (Get-Content C:\ddv\nodedown.txt -ErrorAction SilentlyContinue | Select-Object -First 1)
  $st = Dvpn status
  Info ("nodedown-b: status: " + (($st -split "`n" | Where-Object { $_ -match '^(Session|Leftover)' }) -join ' | '))
  $pp = ProxyPort
  Check 'nodedown-b: proxy not pointing at a dead port' ((-not $pp) -or (Listening $pp)) (ProxyState)
  $iwr = Iwr
  Check 'nodedown-b: WinINET apps reach the internet (direct or via a live session)' ($iwr -ne 'none') $iwr
  EndCase 'nodedown' $(if ($want) { $want } else { $before })
}

Dvpn daemon set --whole-device true --yes | Out-Null
Info "restored whole-device true -> exit $script:code"
Info ("{0} check(s) failed" -f $script:fails)
if ($script:fails) { exit 1 } else { exit 0 }
