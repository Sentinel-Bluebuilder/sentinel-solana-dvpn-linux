# --- vm-win11-suite - the Windows 11 security rows W1-W6 in their only valid order (Phase 11) ---
# NEVER on the owner's laptop. Runs on a Win11 test VM restored to `clean` (nothing installed).
#   1. fetch both installers from -Bucket (gcloud, or the host-mirror shim on nested guests)
#   2. W6: the OTHER CPU type's installer must exit 3 and install nothing (before any install)
#   3. W5: this CPU's installer as the standard autologon user: exactly one elevation; this is
#      also the install the next step needs
#   4. W1-W4 on the installed app (SmartScreen inputs, Smart App Control, Defender, HVCI/drivers)
#   powershell -File C:\ddv\vm-run.ps1 -Test w11suite -Script vm-win11-suite.ps1 -ScriptArgs "-Bucket gs://..." -LimitMinutes 90
# ASCII only (PowerShell 5.1).
param([string]$Test = 'w11suite', [Parameter(Mandatory = $true)][string]$Bucket, [string]$Version = '0.1.0', [string]$Dir = 'C:\ddv\inst')
$ErrorActionPreference = 'Continue'
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ';C:\ddv\bin'
$script:fails = 0
function Check([string]$n, [bool]$ok, [string]$d = '') { if (-not $ok) { $script:fails++ }; Write-Host ('{0}  {1}{2}' -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $n, $(if ($d) { "  ($d)" } else { '' })) }
function Info([string]$m) { Write-Host ('INFO  ' + $m) }

$cpu = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment').PROCESSOR_ARCHITECTURE
$mine = if ($cpu -eq 'ARM64') { 'arm64' } else { 'x64' }
$other = if ($mine -eq 'arm64') { 'x64' } else { 'arm64' }
$os = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
Info ("cpu {0} -> installer {1}; Windows {2} build {3}.{4}" -f $cpu, $mine, $os.DisplayVersion, $os.CurrentBuild, $os.UBR)

New-Item -ItemType Directory -Force $Dir | Out-Null
$sums = Join-Path $Dir 'SHA256SUMS.txt'
& gcloud storage cp "$Bucket/SHA256SUMS.txt" $sums 2>&1 | Out-Null
$want = @{}
foreach ($l in [System.IO.File]::ReadAllLines($sums)) { $h, $n = ($l.Trim() -split '\s+\*?', 2); if ($n) { $want[$n] = $h.ToLowerInvariant() } }
$paths = @{}
foreach ($a in $mine, $other) {
  $name = "Devnet-dVPN-Setup-$Version-$a.exe"
  $p = Join-Path $Dir $name
  & gcloud storage cp "$Bucket/$name" $p 2>&1 | Out-Null
  $got = if (Test-Path $p) { (Get-FileHash -Algorithm SHA256 $p).Hash.ToLowerInvariant() } else { 'missing' }
  Check "fetch $name, sha256 matches SHA256SUMS" ($got -eq $want[$name]) $got.Substring(0, [Math]::Min(12, $got.Length))
  $paths[$a] = $p
}
if ($script:fails -gt 0) { Info 'stopping: an installer could not be fetched'; exit 1 }

$sec = Join-Path $PSScriptRoot 'vm-win11-security.ps1'
foreach ($step in @(
    @{ case = 'wrongarch'; installer = $paths[$other] },
    @{ case = 'uac'; installer = $paths[$mine] },
    @{ case = 'all'; installer = '' })) {
  Info ("--- vm-win11-security -Case {0}" -f $step.case)
  $args2 = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $sec, '-Case', $step.case)
  if ($step.installer) { $args2 += @('-Installer', $step.installer) }
  & powershell.exe @args2 2>&1 | ForEach-Object { Write-Host "$_" }
  if ($LASTEXITCODE -ne 0) { $script:fails++; Info ("vm-win11-security -Case {0} exit {1}" -f $step.case, $LASTEXITCODE) }
}
Info ("{0} step(s) failed" -f $script:fails)
if ($script:fails -gt 0) { exit 1 } else { exit 0 }
