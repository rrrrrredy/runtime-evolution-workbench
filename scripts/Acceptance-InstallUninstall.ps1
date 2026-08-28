param(
  [ValidateRange(1024, 65535)][int]$Port = 53119,
  [string]$EvidencePath = ""
)

. (Join-Path $PSScriptRoot "Common.ps1")

if ($env:OS -ne "Windows_NT") { throw "Installation acceptance requires a fresh Windows environment." }

function Assert-Acceptance([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw "INSTALLATION ACCEPTANCE FAILED: $Message" }
}

function Invoke-CodexText([string[]]$Arguments) {
  $command = Get-Command codex.exe -ErrorAction SilentlyContinue
  if ($null -eq $command) { $command = Get-Command codex -ErrorAction Stop }
  $text = (& $command.Source @Arguments 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) { throw "codex $($Arguments -join ' ') failed:`n$text" }
  return $text
}

function Get-AcceptanceCodexVersion {
  $output = Invoke-CodexText @("--version")
  $lines = @(($output -split "\r?\n") | Where-Object { $_.Trim() -match '^codex-cli\s+\S+$' })
  if ($lines.Count -ne 1) { throw "Could not isolate one Codex CLI version line from command output." }
  return $lines[0].Trim()
}

function Start-AcceptancePortBlocker([string]$Node, [string]$ScriptPath, [int]$ListenPort) {
  $quotedScriptPath = '"' + $ScriptPath.Replace('"', '\"') + '"'
  $process = Start-Process -FilePath $Node -ArgumentList @($quotedScriptPath, [string]$ListenPort) -WindowStyle Hidden -PassThru
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    Start-Sleep -Milliseconds 125
    if ($process.HasExited) { break }
    if (@(Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue).Count -gt 0) { break }
  }
  Assert-Acceptance (-not $process.HasExited) "port blocker failed to start"
  Assert-Acceptance (@(Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue).Count -gt 0) "port blocker did not listen"
  return $process
}

function Remove-TestRoot([string]$Path, [string]$AllowedParent) {
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return }
  $resolved = (Resolve-Path -LiteralPath $Path).Path.TrimEnd('\')
  $parent = [System.IO.Path]::GetFullPath($AllowedParent).TrimEnd('\') + '\'
  if (-not $resolved.StartsWith($parent, [StringComparison]::OrdinalIgnoreCase) -or
      -not ([System.IO.Path]::GetFileName($resolved)).StartsWith("rew-install-acceptance-", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove an unsafe acceptance directory: $resolved"
  }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

function Get-AcceptanceSourceEvidence {
  $releaseSourcePath = Join-Path $script:RewRoot "release-source.json"
  if (Test-Path -LiteralPath $releaseSourcePath -PathType Leaf) {
    $releaseSource = Get-Content -LiteralPath $releaseSourcePath -Raw | ConvertFrom-Json
    $expectedVersion = (Get-Content -LiteralPath (Join-Path $script:RewRoot "package.json") -Raw | ConvertFrom-Json).version
    Assert-Acceptance ($releaseSource.schema_version -eq "product.release-source.v1") "release-source.json has an unsupported schema"
    Assert-Acceptance ($releaseSource.product -eq "runtime-evolution-workbench") "release-source.json names another product"
    Assert-Acceptance ($releaseSource.version -eq $expectedVersion) "release-source.json version does not match package.json"
    Assert-Acceptance ([string]$releaseSource.commit -match '^[0-9a-f]{40}$') "release-source.json has an invalid commit"
    return [pscustomobject]@{
      kind = "release_archive"
      commit = [string]$releaseSource.commit
      dirty = $null
    }
  }

  $git = Get-Command git -ErrorAction Stop
  $commit = (& $git.Source -C $script:RewRoot rev-parse HEAD | Out-String).Trim()
  Assert-Acceptance ($LASTEXITCODE -eq 0 -and $commit -match '^[0-9a-f]{40}$') "source checkout commit cannot be resolved"
  $dirty = -not [string]::IsNullOrWhiteSpace((& $git.Source -C $script:RewRoot status --porcelain | Out-String).Trim())
  Assert-Acceptance ($LASTEXITCODE -eq 0) "source checkout status cannot be resolved"
  return [pscustomobject]@{
    kind = "git_checkout"
    commit = $commit
    dirty = $dirty
  }
}

$tempParent = if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) {
  [System.IO.Path]::GetTempPath()
} else {
  [System.IO.Path]::GetFullPath($env:RUNNER_TEMP)
}
$acceptanceRoot = Join-Path $tempParent "rew-install-acceptance-$([Guid]::NewGuid().ToString('N'))"
$acceptanceCodexHome = Join-Path $acceptanceRoot "codex-home"
$acceptanceData = Join-Path $acceptanceRoot "product-data"
$selector = "runtime-evolution-workbench@runtime-evolution-workbench"
$marketplace = "runtime-evolution-workbench"
$startupDirectory = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupDirectory "Runtime Evolution Workbench.lnk"
$environmentNames = @("CODEX_HOME", "REW_DATA_DIR", "REW_PORT")
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
  $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}
$ownsStartupShortcut = $false
$installationAttempted = $false
$blockerProcess = $null
$startedAt = [DateTimeOffset]::UtcNow

try {
  Assert-Acceptance (-not (Test-Path -LiteralPath $shortcutPath)) "the fresh user already has the product Startup shortcut"
  New-Item -ItemType Directory -Path $acceptanceCodexHome -Force | Out-Null
  [Environment]::SetEnvironmentVariable("CODEX_HOME", $acceptanceCodexHome, "Process")
  [Environment]::SetEnvironmentVariable("REW_DATA_DIR", $acceptanceData, "Process")
  [Environment]::SetEnvironmentVariable("REW_PORT", [string]$Port, "Process")

  $initialPlugins = Invoke-CodexText @("plugin", "list")
  $initialMarketplaces = Invoke-CodexText @("plugin", "marketplace", "list")
  Assert-Acceptance (-not (Test-RewPluginInstalled $initialPlugins $selector)) "isolated Codex home is not plugin-clean"
  Assert-Acceptance (-not (Test-RewMarketplacePresent $initialMarketplaces $marketplace)) "isolated Codex home is not marketplace-clean"

  $blockerPath = Join-Path $acceptanceRoot "port-blocker.mjs"
  $blockerSource = @'
import { createServer } from "node:http";
const port = Number.parseInt(process.argv[2], 10);
createServer((_request, response) => {
  response.statusCode = 503;
  response.end("occupied");
}).listen(port, "127.0.0.1");
'@
  [System.IO.File]::WriteAllText($blockerPath, $blockerSource, [Text.UTF8Encoding]::new($false))
  $blockerProcess = Start-AcceptancePortBlocker (Resolve-RewNode) $blockerPath $Port
  $rollbackFailure = $null
  try {
    & (Join-Path $PSScriptRoot "Install.ps1") -EnableStartup -Port $Port -DataDir $acceptanceData
  } catch {
    $rollbackFailure = $_
  }
  Assert-Acceptance ($null -ne $rollbackFailure) "installer unexpectedly succeeded with its service port occupied"
  Assert-Acceptance ($rollbackFailure.Exception.Message -match "did not become healthy|already serving another application") "failure injection did not reach service startup"
  Assert-Acceptance (-not (Test-RewPluginInstalled (Invoke-CodexText @("plugin", "list")) $selector)) "failed install left the plugin installed"
  Assert-Acceptance (-not (Test-RewMarketplacePresent (Invoke-CodexText @("plugin", "marketplace", "list")) $marketplace)) "failed install left the marketplace registered"
  Assert-Acceptance (-not (Test-Path -LiteralPath $shortcutPath)) "failed install left a Startup shortcut"
  Assert-Acceptance (-not (Test-Path -LiteralPath $acceptanceData)) "failed install left its newly created data root"
  Stop-Process -Id $blockerProcess.Id
  $blockerProcess.WaitForExit()
  $blockerProcess = $null
  & (Join-Path $PSScriptRoot "Uninstall.ps1") -DeleteData -Port $Port -DataDir $acceptanceData
  Assert-Acceptance (-not (Test-Path -LiteralPath $acceptanceData)) "failed-install cleanup left product data"

  $installationAttempted = $true
  & (Join-Path $PSScriptRoot "Install.ps1") -EnableStartup -Port $Port -DataDir $acceptanceData
  $ownsStartupShortcut = Test-Path -LiteralPath $shortcutPath -PathType Leaf
  Assert-Acceptance $ownsStartupShortcut "installer did not create the requested Startup shortcut"
  $health = Get-RewHealth $Port
  Assert-Acceptance ($null -ne $health -and $health.product -eq "runtime-evolution-workbench") "installed service is not healthy"
  $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop)
  Assert-Acceptance ($listeners.Count -gt 0) "service has no listening socket"
  Assert-Acceptance (@($listeners | Where-Object { $_.LocalAddress -notin @("127.0.0.1", "::1") }).Count -eq 0) "service is listening beyond loopback"
  $installedPlugins = Invoke-CodexText @("plugin", "list")
  $installedMarketplaces = Invoke-CodexText @("plugin", "marketplace", "list")
  Assert-Acceptance (Test-RewPluginInstalled $installedPlugins $selector) "plugin was not installed"
  Assert-Acceptance (Test-RewMarketplacePresent $installedMarketplaces $marketplace) "marketplace was not registered"
  $sentinel = Join-Path $acceptanceData "preserve-me.txt"
  [System.IO.File]::WriteAllText($sentinel, "installation acceptance sentinel`n")

  $shortcutHash = (Get-FileHash -LiteralPath $shortcutPath -Algorithm SHA256).Hash
  & (Join-Path $PSScriptRoot "Stop.ps1") -Port $Port -DataDir $acceptanceData | Out-Null
  $blockerProcess = Start-AcceptancePortBlocker (Resolve-RewNode) $blockerPath $Port
  $repairFailure = $null
  try {
    & (Join-Path $PSScriptRoot "Install.ps1") -Repair -EnableStartup -Port $Port -DataDir $acceptanceData
  } catch {
    $repairFailure = $_
  }
  Assert-Acceptance ($null -ne $repairFailure) "repair unexpectedly succeeded with its service port occupied"
  Assert-Acceptance ($repairFailure.Exception.Message -match "did not become healthy|already serving another application") "repair failure injection did not reach service startup"
  Assert-Acceptance (Test-RewPluginInstalled (Invoke-CodexText @("plugin", "list")) $selector) "failed repair did not restore the plugin"
  Assert-Acceptance (Test-RewMarketplacePresent (Invoke-CodexText @("plugin", "marketplace", "list")) $marketplace) "failed repair did not restore the marketplace"
  Assert-Acceptance ((Get-FileHash -LiteralPath $shortcutPath -Algorithm SHA256).Hash -eq $shortcutHash) "failed repair did not restore the previous Startup shortcut"
  Assert-Acceptance (Test-Path -LiteralPath $sentinel -PathType Leaf) "failed repair damaged existing product data"
  Stop-Process -Id $blockerProcess.Id
  $blockerProcess.WaitForExit()
  $blockerProcess = $null
  & (Join-Path $PSScriptRoot "Start.ps1") -Port $Port -DataDir $acceptanceData
  $restartedHealth = Get-RewHealth $Port
  Assert-Acceptance ($null -ne $restartedHealth -and $restartedHealth.product -eq "runtime-evolution-workbench") "service did not restart after failed repair"

  & (Join-Path $PSScriptRoot "Uninstall.ps1") -Port $Port -DataDir $acceptanceData
  $ownsStartupShortcut = $false
  Assert-Acceptance ($null -eq (Get-RewHealth $Port)) "service remained reachable after uninstall"
  Assert-Acceptance (Test-Path -LiteralPath $sentinel -PathType Leaf) "default uninstall did not preserve product data"
  Assert-Acceptance (-not (Test-Path -LiteralPath $shortcutPath)) "Startup shortcut remained after uninstall"
  Assert-Acceptance (-not (Test-RewPluginInstalled (Invoke-CodexText @("plugin", "list")) $selector)) "plugin remained installed after uninstall"
  Assert-Acceptance (-not (Test-RewMarketplacePresent (Invoke-CodexText @("plugin", "marketplace", "list")) $marketplace)) "marketplace remained after uninstall"
  & (Join-Path $PSScriptRoot "Inspect-Installation.ps1") -RequireAbsent -Port $Port -DataDir $acceptanceData | Out-Null

  & (Join-Path $PSScriptRoot "Install.ps1") -NoStart -Port $Port -DataDir $acceptanceData
  Assert-Acceptance (Test-Path -LiteralPath $sentinel -PathType Leaf) "reinstall did not preserve existing data"
  & (Join-Path $PSScriptRoot "Uninstall.ps1") -DeleteData -Port $Port -DataDir $acceptanceData
  Assert-Acceptance (-not (Test-Path -LiteralPath $acceptanceData)) "explicit data deletion left the acceptance data directory behind"
  Assert-Acceptance (-not (Test-Path -LiteralPath $shortcutPath)) "final uninstall left a Startup shortcut"
  Assert-Acceptance (-not (Test-RewPluginInstalled (Invoke-CodexText @("plugin", "list")) $selector)) "final uninstall left the plugin installed"
  Assert-Acceptance (-not (Test-RewMarketplacePresent (Invoke-CodexText @("plugin", "marketplace", "list")) $marketplace)) "final uninstall left the marketplace registered"
  & (Join-Path $PSScriptRoot "Inspect-Installation.ps1") -RequireAbsent -RequireNoData -Port $Port -DataDir $acceptanceData | Out-Null

  $sourceEvidence = Get-AcceptanceSourceEvidence
  $evidence = [ordered]@{
    schema_version = "product.installation-acceptance.v2"
    product = "runtime-evolution-workbench"
    product_version = (Get-Content -LiteralPath (Join-Path $script:RewRoot "package.json") -Raw | ConvertFrom-Json).version
    tested_commit = $sourceEvidence.commit
    source_kind = $sourceEvidence.kind
    worktree_dirty = $sourceEvidence.dirty
    started_at = $startedAt.ToString("o")
    completed_at = [DateTimeOffset]::UtcNow.ToString("o")
    os = (Get-CimInstance Win32_OperatingSystem).Caption
    os_version = [Environment]::OSVersion.VersionString
    node_version = (& (Resolve-RewNode) -p "process.versions.node").Trim()
    codex_version = Get-AcceptanceCodexVersion
    checks = [ordered]@{
      clean_isolated_codex_home = $true
      failed_install_rolled_back = $true
      failed_repair_restored_existing_install = $true
      service_started = $true
      loopback_only = $true
      plugin_installed_enabled = $true
      marketplace_registered = $true
      startup_created_and_removed = $true
      default_uninstall_preserved_data = $true
      reinstall_preserved_data = $true
      explicit_delete_removed_data = $true
      final_plugin_absent = $true
      final_marketplace_absent = $true
      final_service_absent = $true
      installation_state_audit_passed = $true
    }
  }
  $json = $evidence | ConvertTo-Json -Depth 6
  if (-not [string]::IsNullOrWhiteSpace($EvidencePath)) {
    $fullEvidencePath = [System.IO.Path]::GetFullPath($EvidencePath)
    $evidenceDirectory = Split-Path -Parent $fullEvidencePath
    New-Item -ItemType Directory -Path $evidenceDirectory -Force | Out-Null
    [System.IO.File]::WriteAllText($fullEvidencePath, "$json`n")
    Write-Host "Installation evidence: $fullEvidencePath"
  }
  Write-Output $json
} finally {
  if ($null -ne $blockerProcess -and -not $blockerProcess.HasExited) {
    Stop-Process -Id $blockerProcess.Id -Force -ErrorAction SilentlyContinue
  }
  try {
    if ($installationAttempted) {
      & (Join-Path $PSScriptRoot "Uninstall.ps1") -DeleteData -Port $Port -DataDir $acceptanceData 2>$null | Out-Null
    }
  } catch {
    Write-Warning "Fallback uninstall needs attention: $($_.Exception.Message)"
  }
  foreach ($name in $environmentNames) {
    [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], "Process")
  }
  Remove-TestRoot $acceptanceRoot $tempParent
}
