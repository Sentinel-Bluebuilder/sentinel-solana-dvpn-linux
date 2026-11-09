# --- vm-ui-extra-admin - the admin half of vm-ui-extra.ps1 -Case gate ---
# Run over an ADMIN ssh on the VM at the same time as the gate case. Answers the scenario's
# stopsvc / startsvc hand-off files by stopping and starting the dvpnd service. ASCII only.
param([int]$LimitSeconds = 900)
$sig = 'C:\ddv\sig'
$deadline = (Get-Date).AddSeconds($LimitSeconds)
$done = @{}
while ((Get-Date) -lt $deadline -and $done.Count -lt 2) {
  if ((Test-Path "$sig\stopsvc") -and -not $done.stop) {
    Stop-Service dvpnd -Force -ErrorAction SilentlyContinue
    $s = (Get-Service dvpnd).Status
    Write-Host "stopsvc: $s"
    Set-Content -LiteralPath "$sig\stopsvc.ack" -Value "service $s" -Encoding ascii
    $done.stop = $true
  }
  if ((Test-Path "$sig\startsvc") -and -not $done.start) {
    Start-Service dvpnd -ErrorAction SilentlyContinue
    (Get-Service dvpnd).WaitForStatus('Running', [TimeSpan]::FromSeconds(60))
    $s = (Get-Service dvpnd).Status
    Write-Host "startsvc: $s"
    Set-Content -LiteralPath "$sig\startsvc.ack" -Value "service $s" -Encoding ascii
    $done.start = $true
  }
  Start-Sleep -Milliseconds 500
}
if ((Get-Service dvpnd).Status -ne 'Running') { Start-Service dvpnd; Write-Host 'service started at exit' }
Write-Host "admin half done: $($done.Keys -join ',')"
