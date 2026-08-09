[CmdletBinding()]
param(
  [string]$Workspace = (Get-Location).Path,
  [string]$ManagedRoot = [IO.Path]::Combine($env:USERPROFILE, ".hermesproof-managed"),
  [string[]]$Targets = @("kilocode", "vscode", "codex", "windsurf", "lm-studio", "ollama", "claude-desktop", "claude-code", "cursor", "devin"),
  [switch]$AutoUpdate,
  [switch]$Repair,
  [switch]$SkipUserPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$schema = "hermesproof.managed-updater.v1"
$installSchema = "hermesproof.windows-install.v1"
$bundleRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$managed = [IO.Path]::GetFullPath($ManagedRoot)
$workspaceRoot = [IO.Path]::GetFullPath($Workspace)
$manifestFile = [IO.Path]::Combine($bundleRoot, "release-manifest.json")
$clientSnapshot = $null
$controlBackup = $null
$releaseDirectory = $null
$newReleaseInstalled = $false
$transactionFile = $null

function Test-SamePath([string]$Left, [string]$Right) {
  return [string]::Equals([IO.Path]::GetFullPath($Left).TrimEnd("\"), [IO.Path]::GetFullPath($Right).TrimEnd("\"), [StringComparison]::OrdinalIgnoreCase)
}

function Assert-SafeManagedRoot([string]$Root) {
  $full = [IO.Path]::GetFullPath($Root)
  if (Test-SamePath $full ([IO.Path]::GetPathRoot($full))) { throw "ManagedRoot cannot be a filesystem root" }
  if (Test-SamePath $full $env:USERPROFILE) { throw "ManagedRoot cannot be the user profile root" }
  foreach ($candidate in @($full, [IO.Path]::Combine($full, "state"), [IO.Path]::Combine($full, "releases"), [IO.Path]::Combine($full, "staging"), [IO.Path]::Combine($full, "quarantine"), [IO.Path]::Combine($full, "control"))) {
    if (Test-Path -LiteralPath $candidate) {
      $item = Get-Item -LiteralPath $candidate -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "ManagedRoot contains a link or junction: $candidate" }
    }
  }
  return $full
}

function Assert-Contained([string]$Root, [string]$Candidate) {
  $base = [IO.Path]::GetFullPath($Root).TrimEnd("\") + "\"
  $full = [IO.Path]::GetFullPath($Candidate)
  if (-not $full.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) { throw "Path escapes its approved root: $Candidate" }
  return $full
}

function Write-JsonAtomic([string]$File, $Value) {
  $parent = Split-Path -Parent $File
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $temporary = "$File.tmp-$([guid]::NewGuid().ToString('N'))"
  [IO.File]::WriteAllText($temporary, (($Value | ConvertTo-Json -Depth 40) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporary -Destination $File -Force
}

function Read-JsonOrDefault([string]$File, $Default) {
  if (-not (Test-Path -LiteralPath $File)) { return $Default }
  return Get-Content -LiteralPath $File -Raw | ConvertFrom-Json
}

function Verify-ReleaseManifest([string]$Root, $Manifest) {
  if ($Manifest.schema -ne "hermesproof.windows-release.v1") { throw "Unsupported release manifest schema" }
  foreach ($entry in $Manifest.files) {
    $relative = [string]$entry.path
    if ([IO.Path]::IsPathRooted($relative) -or $relative -match '(^|[\\/])\.\.([\\/]|$)') { throw "Unsafe manifest path: $relative" }
    $file = Assert-Contained $Root ([IO.Path]::Combine($Root, $relative.Replace('/', '\')))
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Release file is missing: $relative" }
    $item = Get-Item -LiteralPath $file -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Release file is a link: $relative" }
    if ([int64]$entry.bytes -ne $item.Length) { throw "Release file size mismatch: $relative" }
    $actual = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne ([string]$entry.sha256).ToLowerInvariant()) { throw "Release file hash mismatch: $relative" }
  }
}

function Invoke-Checked([string]$Command, [string[]]$Arguments, [string]$WorkingDirectory) {
  Push-Location $WorkingDirectory
  try {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command exited with code $LASTEXITCODE" }
  } finally { Pop-Location }
}

$managed = Assert-SafeManagedRoot $managed
if (-not (Test-Path -LiteralPath $workspaceRoot -PathType Container)) { throw "Workspace does not exist: $workspaceRoot" }
if (-not (Test-Path -LiteralPath $manifestFile -PathType Leaf)) { throw "release-manifest.json is missing; use the GitLab release bundle" }
$manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
Verify-ReleaseManifest $bundleRoot $manifest
if ([string]$manifest.version -ne "0.9.0-rc.1") { throw "Unexpected release version" }
$sha = [string]$manifest.sourceSha
if ($sha -notmatch '^[0-9a-f]{40,64}$') { throw "Invalid source SHA in release manifest" }
$nodeCommand = (Get-Command node.exe -ErrorAction Stop).Source
$npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
$nodeMajor = [int]((& $nodeCommand -p "Number(process.versions.node.split('.')[0])").Trim())
if ($nodeMajor -lt 20) { throw "Node.js 20 or newer is required" }

$stateRoot = [IO.Path]::Combine($managed, "state")
$releasesRoot = [IO.Path]::Combine($managed, "releases")
$stagingRoot = [IO.Path]::Combine($managed, "staging")
$quarantineRoot = [IO.Path]::Combine($managed, "quarantine")
$controlRoot = [IO.Path]::Combine($managed, "control")
$binRoot = [IO.Path]::Combine($managed, "bin")
foreach ($directory in @($stateRoot, $releasesRoot, $stagingRoot, $quarantineRoot, $binRoot)) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
$activeFile = [IO.Path]::Combine($stateRoot, "active-release.json")
$registryFile = [IO.Path]::Combine($stateRoot, "releases.json")
$installFile = [IO.Path]::Combine($stateRoot, "install.json")
$previousActive = Read-JsonOrDefault $activeFile $null
$previousRegistry = Read-JsonOrDefault $registryFile ([pscustomobject]@{ schema = $schema; releases = @() })
$previousInstall = Read-JsonOrDefault $installFile $null
$transactionFile = [IO.Path]::Combine($stateRoot, "windows-install-transaction.json")
Write-JsonAtomic $transactionFile ([ordered]@{ schema = $installSchema; phase = "staging"; sha = $sha; startedUtc = [DateTime]::UtcNow.ToString("o") })
$staging = [IO.Path]::Combine($stagingRoot, "$sha-$([guid]::NewGuid().ToString('N'))")
New-Item -ItemType Directory -Path $staging | Out-Null

try {
  foreach ($entry in $manifest.files) {
    $relative = ([string]$entry.path).Replace('/', '\')
    $source = Assert-Contained $bundleRoot ([IO.Path]::Combine($bundleRoot, $relative))
    $destination = Assert-Contained $staging ([IO.Path]::Combine($staging, $relative))
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
  }
  Copy-Item -LiteralPath $manifestFile -Destination ([IO.Path]::Combine($staging, "release-manifest.json")) -Force
  Verify-ReleaseManifest $staging $manifest
  Invoke-Checked $npmCommand @("ci", "--no-audit", "--fund=false") $staging

  $coreRaw = & $nodeCommand ([IO.Path]::Combine($staging, "scripts", "updater-candidate-probe.mjs")) --candidate $staging --workspace $workspaceRoot --server hermes3d-locks
  if ($LASTEXITCODE -ne 0) { throw "Core MCP probe failed" }
  $coreProbe = ($coreRaw | Select-Object -Last 1) | ConvertFrom-Json
  if (-not $coreProbe.ok -or [int]$coreProbe.toolCount -ne 121) { throw "Core MCP tool count is not 121" }
  $compositeRaw = & $nodeCommand ([IO.Path]::Combine($staging, "scripts", "updater-candidate-probe.mjs")) --candidate $staging --workspace $workspaceRoot --server hp-mha-serena
  if ($LASTEXITCODE -ne 0) { throw "Composite MCP probe failed" }
  $compositeProbe = ($compositeRaw | Select-Object -Last 1) | ConvertFrom-Json
  if (-not $compositeProbe.ok -or [int]$compositeProbe.toolCount -ne 34) { throw "Composite MCP tool count is not 34" }

  $releaseDirectory = [IO.Path]::Combine($releasesRoot, $sha)
  if (Test-Path -LiteralPath $releaseDirectory) {
    if (-not $Repair) {
      $existingManifest = Get-Content -LiteralPath ([IO.Path]::Combine($releaseDirectory, "release-manifest.json")) -Raw | ConvertFrom-Json
      Verify-ReleaseManifest $releaseDirectory $existingManifest
      Remove-Item -LiteralPath $staging -Recurse -Force
    } else {
      $old = [IO.Path]::Combine($quarantineRoot, "$sha-repair-$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))")
      Move-Item -LiteralPath $releaseDirectory -Destination $old
      Move-Item -LiteralPath $staging -Destination $releaseDirectory
      $newReleaseInstalled = $true
    }
  } else {
    Move-Item -LiteralPath $staging -Destination $releaseDirectory
    $newReleaseInstalled = $true
  }

  $controlNext = [IO.Path]::Combine($managed, "control.next-$([guid]::NewGuid().ToString('N'))")
  foreach ($relative in @("scripts\hermesproof-launch.mjs", "scripts\hermesproof-update-launch.mjs", "src\updater\managed-updater.mjs", "src\updater\path-policy.mjs")) {
    $from = Assert-Contained $releaseDirectory ([IO.Path]::Combine($releaseDirectory, $relative))
    $to = Assert-Contained $controlNext ([IO.Path]::Combine($controlNext, $relative))
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
    Copy-Item -LiteralPath $from -Destination $to -Force
  }
  if (Test-Path -LiteralPath $controlRoot) {
    $controlBackup = [IO.Path]::Combine($managed, "control.previous-$([guid]::NewGuid().ToString('N'))")
    Move-Item -LiteralPath $controlRoot -Destination $controlBackup
  }
  Move-Item -LiteralPath $controlNext -Destination $controlRoot
  $stableLauncher = [IO.Path]::Combine($controlRoot, "scripts", "hermesproof-launch.mjs")
  $targetsCsv = $Targets -join ','
  $env:HERMESPROOF_MANAGED_ROOT = $managed
  $clientJson = & $nodeCommand ([IO.Path]::Combine($releaseDirectory, "scripts", "install-clients.mjs")) --workspace $workspaceRoot --targets $targetsCsv --launcher $stableLauncher --json
  if ($LASTEXITCODE -ne 0) { throw "Client configuration failed" }
  $clientResult = ($clientJson | Select-Object -Last 1) | ConvertFrom-Json
  if (-not $clientResult.ok) { throw "One or more client configurations failed" }
  $clientSnapshot = $clientResult.snapshot
  $uninstallSnapshot = if ($null -ne $previousInstall -and $null -ne $previousInstall.clientSnapshot) { $previousInstall.clientSnapshot } else { $clientSnapshot }
  $installedUtc = if ($null -ne $previousInstall -and $previousInstall.installedUtc) { $previousInstall.installedUtc } else { [DateTime]::UtcNow.ToString("o") }

  $manifestDigest = (Get-FileHash -LiteralPath ([IO.Path]::Combine($releaseDirectory, "release-manifest.json")) -Algorithm SHA256).Hash.ToLowerInvariant()
  $previousSha = if ($null -ne $previousActive) { $previousActive.currentSha } else { $null }
  $generation = if ($null -ne $previousActive) { [int]$previousActive.generation + 1 } else { 1 }
  $registryReleases = @($previousRegistry.releases | Where-Object { $_.sha -ne $sha })
  $registryReleases += [ordered]@{ sha = $sha; state = "known-good"; directory = $releaseDirectory; evidenceDigest = $manifestDigest; recordedUtc = [DateTime]::UtcNow.ToString("o") }
  $active = [ordered]@{ schema = $schema; generation = $generation; currentSha = $sha; previousSha = $previousSha; channel = "stable"; evidenceDigest = $manifestDigest; clientSnapshot = $clientSnapshot; activatedUtc = [DateTime]::UtcNow.ToString("o") }
  Write-JsonAtomic $registryFile ([ordered]@{ schema = $schema; releases = $registryReleases })
  Write-JsonAtomic $activeFile $active
  Write-JsonAtomic $installFile ([ordered]@{ schema = $installSchema; version = $manifest.version; sourceSha = $sha; workspaceRoot = $workspaceRoot; managedRoot = $managed; targets = $Targets; clientSnapshot = $uninstallSnapshot; installedUtc = $installedUtc; lastActivatedUtc = [DateTime]::UtcNow.ToString("o") })

  $updateLauncher = [IO.Path]::Combine($controlRoot, "scripts", "hermesproof-update-launch.mjs")
  $updateCmd = "@echo off`r`n`"$nodeCommand`" `"$updateLauncher`" %*`r`n"
  $serverCmd = "@echo off`r`n`"$nodeCommand`" `"$stableLauncher`" %*`r`n"
  [IO.File]::WriteAllText([IO.Path]::Combine($binRoot, "hermesproof-update.cmd"), $updateCmd, (New-Object Text.UTF8Encoding($false)))
  [IO.File]::WriteAllText([IO.Path]::Combine($binRoot, "hermesproof-launch.cmd"), $serverCmd, (New-Object Text.UTF8Encoding($false)))
  if (-not $SkipUserPath) {
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $pathParts = @($userPath -split ';' | Where-Object { $_ })
    if (-not ($pathParts | Where-Object { Test-SamePath $_ $binRoot })) {
      [Environment]::SetEnvironmentVariable("Path", (($pathParts + $binRoot) -join ';'), "User")
    }
    if (-not (($env:Path -split ';') | Where-Object { Test-SamePath $_ $binRoot })) { $env:Path = "$env:Path;$binRoot" }
  }

  if ($AutoUpdate) {
    & $nodeCommand $updateLauncher auto enable --json
    if ($LASTEXITCODE -ne 0) { throw "Automatic update task installation failed" }
  }
  Remove-Item -LiteralPath $transactionFile -Force
  if ($controlBackup -and (Test-Path -LiteralPath $controlBackup)) { Remove-Item -LiteralPath $controlBackup -Recurse -Force }
  Write-Host "HermesProof $($manifest.version) installed and verified." -ForegroundColor Green
  Write-Host "Core tools: 121 | Composite tools: 34 | Managed root: $managed"
  Write-Host "Open a new terminal, restart MCP clients, then run: hermesproof-update status"
} catch {
  $failure = $_.Exception.Message
  if ($null -ne $clientSnapshot -and $null -ne $releaseDirectory -and (Test-Path -LiteralPath $releaseDirectory)) {
    try { & $nodeCommand ([IO.Path]::Combine($releaseDirectory, "scripts", "restore-client-snapshot.mjs")) --manifest $clientSnapshot.manifestFile --sha256 $clientSnapshot.manifestSha256 | Out-Null } catch { }
  }
  if ($controlBackup -and (Test-Path -LiteralPath $controlBackup)) {
    if (Test-Path -LiteralPath $controlRoot) { Remove-Item -LiteralPath $controlRoot -Recurse -Force }
    Move-Item -LiteralPath $controlBackup -Destination $controlRoot
  }
  if ($null -ne $previousActive) { Write-JsonAtomic $activeFile $previousActive } elseif (Test-Path -LiteralPath $activeFile) { Remove-Item -LiteralPath $activeFile -Force }
  if ($null -ne $previousRegistry) { Write-JsonAtomic $registryFile $previousRegistry }
  if ($newReleaseInstalled -and $releaseDirectory -and (Test-Path -LiteralPath $releaseDirectory)) {
    $failedRelease = [IO.Path]::Combine($quarantineRoot, "$sha-failed-$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))")
    Move-Item -LiteralPath $releaseDirectory -Destination $failedRelease
  }
  if ($staging -and (Test-Path -LiteralPath $staging)) { Remove-Item -LiteralPath $staging -Recurse -Force }
  if ($transactionFile -and (Test-Path -LiteralPath $transactionFile)) { Remove-Item -LiteralPath $transactionFile -Force }
  throw "HermesProof installation rolled back: $failure"
}
