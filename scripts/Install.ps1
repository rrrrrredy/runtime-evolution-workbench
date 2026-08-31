param(
  [switch]$EnableStartup,
  [switch]$NoStart,
  [switch]$Open,
  [switch]$Repair,
  [ValidateRange(1024, 65535)][int]$Port = 43119,
  [string]$DataDir = "",
  [string]$MarketplaceSource = ""
)

. (Join-Path $PSScriptRoot "Common.ps1")

if ($env:OS -ne "Windows_NT") {
  throw "The 0.1 MVP installer supports Windows only."
}

$node = Resolve-RewNode
$codexCommand = Get-Command codex.exe -ErrorAction SilentlyContinue
if ($null -eq $codexCommand) { $codexCommand = Get-Command codex -ErrorAction SilentlyContinue }
if ($null -eq $codexCommand) { throw "Codex CLI is required and was not found on PATH." }

$sourceCandidate = if ([string]::IsNullOrWhiteSpace($MarketplaceSource)) { $script:RewRoot } else { $MarketplaceSource }
$source = [System.IO.Path]::GetFullPath($sourceCandidate).TrimEnd('\')
$resolvedDataDir = Get-RewDataDir $DataDir
$marketplaceName = "runtime-evolution-workbench"
$pluginSelector = "runtime-evolution-workbench@runtime-evolution-workbench"
$expectedPluginPath = [System.IO.Path]::GetFullPath(
  (Join-Path $source "plugins\runtime-evolution-workbench")
).TrimEnd('\')
$pluginManifest = Get-Content -LiteralPath (Join-Path $expectedPluginPath ".codex-plugin\plugin.json") -Raw |
  ConvertFrom-Json
$expectedPluginVersion = [string]$pluginManifest.version
$marketplaceAdded = $false
$pluginAdded = $false
$shortcutCreated = $false
$shortcutWasPresent = $false
$shortcutBackupPath = $null
$serviceWasRunning = $false
$shortcutPath = $null
$marketplaceRemovedForRepair = $false
$pluginRemovedForRepair = $false
$dataRootExisted = Test-Path -LiteralPath $resolvedDataDir
$dataRootCreated = $false

if ($EnableStartup) {
  $shortcutPath = Get-RewStartupShortcutPath
  $shortcutWasPresent = Test-Path -LiteralPath $shortcutPath -PathType Leaf
  Assert-RewStartupShortcutAvailable $shortcutPath
}

Write-Host "Building Runtime Evolution Workbench with Node $(& $node -p 'process.versions.node')..."
& (Join-Path $PSScriptRoot "Check.ps1") -InstallDependencies
if ($LASTEXITCODE -ne 0) { throw "Release checks failed; nothing was installed." }

try {
  Initialize-RewDataRoot $resolvedDataDir
  $dataRootCreated = -not $dataRootExisted
  $existingHealth = Get-RewHealth $Port
  $serviceWasRunning = $null -ne $existingHealth -and $existingHealth.product -eq "runtime-evolution-workbench"
  $marketplaceOutput = (& $codexCommand.Source plugin marketplace list 2>&1 | Out-String)
  $marketplaceRecord = Get-RewMarketplaceRecord $marketplaceOutput $marketplaceName
  $pluginOutput = (& $codexCommand.Source plugin list 2>&1 | Out-String)
  $pluginRecord = Get-RewPluginRecord $pluginOutput $pluginSelector
  Assert-RewCodexOwnership $marketplaceRecord $pluginRecord $source $expectedPluginPath $expectedPluginVersion
  $marketplacePresent = $null -ne $marketplaceRecord
  $pluginPresent = $null -ne $pluginRecord

  if ($Repair -and $pluginPresent) {
    & $codexCommand.Source plugin remove $pluginSelector
    if ($LASTEXITCODE -ne 0) { throw "Could not remove the existing plugin during repair." }
    $pluginRemovedForRepair = $true
    $pluginPresent = $false
  }
  if ($Repair -and $marketplacePresent) {
    & $codexCommand.Source plugin marketplace remove $marketplaceName
    if ($LASTEXITCODE -ne 0) { throw "Could not remove the existing marketplace during repair." }
    $marketplaceRemovedForRepair = $true
    $marketplacePresent = $false
  }

  if (-not $marketplacePresent) {
    & $codexCommand.Source plugin marketplace add $source
    if ($LASTEXITCODE -ne 0) { throw "Could not add the Runtime Evolution Workbench marketplace." }
    $marketplaceAdded = $true
  }
  if (-not $pluginPresent) {
    & $codexCommand.Source plugin add $pluginSelector
    if ($LASTEXITCODE -ne 0) { throw "Codex plugin installation failed." }
    $pluginAdded = $true
  }
  $retainedMarketplace = Get-RewMarketplaceRecord (
    (& $codexCommand.Source plugin marketplace list 2>&1 | Out-String)
  ) $marketplaceName
  $retainedPlugin = Get-RewPluginRecord (
    (& $codexCommand.Source plugin list 2>&1 | Out-String)
  ) $pluginSelector
  Assert-RewCodexOwnership $retainedMarketplace $retainedPlugin $source $expectedPluginPath $expectedPluginVersion
  if ($null -eq $retainedMarketplace -or $null -eq $retainedPlugin) {
    throw "Codex did not retain the exact Runtime Evolution Workbench marketplace and plugin registration."
  }

  if ($EnableStartup) {
    $shortcutCreated = -not $shortcutWasPresent
    if ($shortcutWasPresent) {
      $shortcutBackupPath = Join-Path ([System.IO.Path]::GetTempPath()) "rew-startup-$([Guid]::NewGuid().ToString('N')).lnk"
      Copy-Item -LiteralPath $shortcutPath -Destination $shortcutBackupPath
    }
    $powerShellCommand = Get-Command pwsh.exe -ErrorAction SilentlyContinue
    if ($null -eq $powerShellCommand) { $powerShellCommand = Get-Command powershell.exe -ErrorAction Stop }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $powerShellCommand.Source
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'Start.ps1')`" -Port $Port -DataDir `"$resolvedDataDir`""
    $shortcut.WorkingDirectory = $script:RewRoot
    $shortcut.WindowStyle = 7
    $shortcut.Description = Get-RewStartupShortcutDescription
    $shortcut.Save()
    Write-Host "Enabled current-user startup: $shortcutPath"
  }

  if (-not $NoStart) {
    & (Join-Path $PSScriptRoot "Start.ps1") -Open:$Open -Port $Port -DataDir $resolvedDataDir
  }
  Write-RewInstallationReceipt $resolvedDataDir $source $expectedPluginPath $expectedPluginVersion

  Write-Host "Runtime Evolution Workbench plugin is installed. Restart Codex to load Hooks, MCP tools, and the Skill."
  Write-Host "Uninstall with .\scripts\Uninstall.ps1; Run data is preserved unless -DeleteData is explicitly supplied."
} catch {
  $installationError = $_
  $rollbackErrors = [System.Collections.Generic.List[string]]::new()
  if (-not $serviceWasRunning) {
    $healthAfterFailure = Get-RewHealth $Port
    if ($null -ne $healthAfterFailure -and $healthAfterFailure.product -eq "runtime-evolution-workbench") {
      try { & (Join-Path $PSScriptRoot "Stop.ps1") -Port $Port -DataDir $resolvedDataDir | Out-Null }
      catch { $rollbackErrors.Add("service: $($_.Exception.Message)") }
    }
  }
  if ($null -ne $shortcutPath) {
    try {
      if ($shortcutWasPresent -and $null -ne $shortcutBackupPath -and (Test-Path -LiteralPath $shortcutBackupPath -PathType Leaf)) {
        Copy-Item -LiteralPath $shortcutBackupPath -Destination $shortcutPath -Force
      } elseif ($shortcutCreated -and (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) {
        Remove-Item -LiteralPath $shortcutPath -Force
      }
    } catch { $rollbackErrors.Add("Startup shortcut: $($_.Exception.Message)") }
  }
  if ($pluginAdded) {
    try {
      & $codexCommand.Source plugin remove $pluginSelector 2>$null | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "Codex plugin removal exited with $LASTEXITCODE." }
    } catch { $rollbackErrors.Add("plugin: $($_.Exception.Message)") }
  }
  if ($marketplaceAdded) {
    try {
      & $codexCommand.Source plugin marketplace remove $marketplaceName 2>$null | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "Codex marketplace removal exited with $LASTEXITCODE." }
    } catch { $rollbackErrors.Add("marketplace: $($_.Exception.Message)") }
  }
  if ($marketplaceRemovedForRepair) {
    try {
      & $codexCommand.Source plugin marketplace add $source 2>$null | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "Codex marketplace restoration exited with $LASTEXITCODE." }
    } catch { $rollbackErrors.Add("restore marketplace: $($_.Exception.Message)") }
  }
  if ($pluginRemovedForRepair) {
    try {
      & $codexCommand.Source plugin add $pluginSelector 2>$null | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "Codex plugin restoration exited with $LASTEXITCODE." }
    } catch { $rollbackErrors.Add("restore plugin: $($_.Exception.Message)") }
  }
  if ($dataRootCreated -and (Test-Path -LiteralPath $resolvedDataDir -PathType Container)) {
    try { Remove-RewDataRootCreatedByFailedInstall $resolvedDataDir }
    catch { $rollbackErrors.Add("data root: $($_.Exception.Message)") }
  }
  if ($rollbackErrors.Count -gt 0) {
    throw "Installation failed: $($installationError.Exception.Message) Rollback was incomplete: $($rollbackErrors -join '; ')"
  }
  throw $installationError
} finally {
  if ($null -ne $shortcutBackupPath -and (Test-Path -LiteralPath $shortcutBackupPath -PathType Leaf)) {
    Remove-Item -LiteralPath $shortcutBackupPath -Force -ErrorAction SilentlyContinue
  }
}
