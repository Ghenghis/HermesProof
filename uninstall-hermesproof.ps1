[CmdletBinding()]
param(
  [string]$ManagedRoot = [IO.Path]::Combine($env:USERPROFILE, ".hermesproof-managed"),
  [switch]$PurgeManagedData,
  [switch]$SkipSystemChanges
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$managed = [IO.Path]::GetFullPath($ManagedRoot)
if ([string]::Equals($managed.TrimEnd("\"), ([IO.Path]::GetPathRoot($managed)).TrimEnd("\"), [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing to uninstall from a filesystem root" }
if ([string]::Equals($managed.TrimEnd("\"), ([IO.Path]::GetFullPath($env:USERPROFILE)).TrimEnd("\"), [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing to uninstall the user profile root" }
if (-not (Test-Path -LiteralPath $managed)) { Write-Host "HermesProof is not installed at $managed"; exit 0 }
$rootItem = Get-Item -LiteralPath $managed -Force
if (($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "ManagedRoot is a link or junction" }

if (-not $SkipSystemChanges) {
  & schtasks.exe /Delete /TN "HermesProof Automatic Update" /F 2>$null | Out-Null
}
$stateRoot = [IO.Path]::Combine($managed, "state")
$activeFile = [IO.Path]::Combine($stateRoot, "active-release.json")
$installFile = [IO.Path]::Combine($stateRoot, "install.json")
if (Test-Path -LiteralPath $activeFile) {
  $active = Get-Content -LiteralPath $activeFile -Raw | ConvertFrom-Json
  $install = if (Test-Path -LiteralPath $installFile) { Get-Content -LiteralPath $installFile -Raw | ConvertFrom-Json } else { $null }
  $restoreSnapshot = if ($null -ne $install -and $null -ne $install.clientSnapshot) { $install.clientSnapshot } else { $active.clientSnapshot }
  if ($null -ne $restoreSnapshot -and $restoreSnapshot.manifestFile) {
    $release = [IO.Path]::Combine($managed, "releases", [string]$active.currentSha)
    $restore = [IO.Path]::Combine($release, "scripts", "restore-client-snapshot.mjs")
    if (Test-Path -LiteralPath $restore) {
      $env:HERMESPROOF_MANAGED_ROOT = $managed
      & node.exe $restore --manifest $restoreSnapshot.manifestFile --sha256 $restoreSnapshot.manifestSha256
      if ($LASTEXITCODE -ne 0) { Write-Warning "Some client files changed after install and were not overwritten; review the snapshot manually." }
    }
  }
}
if (-not $SkipSystemChanges) {
  $binRoot = [IO.Path]::Combine($managed, "bin")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $remaining = @($userPath -split ';' | Where-Object { $_ -and -not [string]::Equals(([IO.Path]::GetFullPath($_)).TrimEnd("\"), $binRoot.TrimEnd("\"), [StringComparison]::OrdinalIgnoreCase) })
  [Environment]::SetEnvironmentVariable("Path", ($remaining -join ';'), "User")
}

if ($PurgeManagedData) {
  Remove-Item -LiteralPath $managed -Recurse -Force
  Write-Host "HermesProof managed releases, evidence, backups, and configuration were purged." -ForegroundColor Yellow
} else {
  Write-Host "HermesProof clients and scheduled update were removed. Managed releases, evidence, and backups remain at $managed." -ForegroundColor Green
  Write-Host "Run again with -PurgeManagedData only if permanent deletion is intended."
}
