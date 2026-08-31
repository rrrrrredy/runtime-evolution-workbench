param(
  [switch]$RequireAbsent,
  [switch]$RequireNoData,
  [ValidateRange(1024, 65535)][int]$Port = 43119,
  [string]$DataDir = ""
)

. (Join-Path $PSScriptRoot "Common.ps1")

$resolvedDataDir = Get-RewDataDir $DataDir
$pluginSelector = "runtime-evolution-workbench@runtime-evolution-workbench"
$marketplaceName = "runtime-evolution-workbench"
$inspectionErrors = [System.Collections.Generic.List[string]]::new()
$pluginInstalled = $null
$marketplaceRegistered = $null
$codexCommand = Get-Command codex.exe -ErrorAction SilentlyContinue
if ($null -eq $codexCommand) { $codexCommand = Get-Command codex -ErrorAction SilentlyContinue }

if ($null -eq $codexCommand) {
  $inspectionErrors.Add("Codex CLI was not found, so plugin and marketplace state cannot be proved.")
} else {
  try {
    $pluginOutput = (& $codexCommand.Source plugin list 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) { throw "codex plugin list exited with $LASTEXITCODE" }
    $pluginInstalled = Test-RewPluginInstalled $pluginOutput $pluginSelector
  } catch { $inspectionErrors.Add("plugin state: $($_.Exception.Message)") }
  try {
    $marketplaceOutput = (& $codexCommand.Source plugin marketplace list 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) { throw "codex plugin marketplace list exited with $LASTEXITCODE" }
    $marketplaceRegistered = Test-RewMarketplacePresent $marketplaceOutput $marketplaceName
  } catch { $inspectionErrors.Add("marketplace state: $($_.Exception.Message)") }
}

$startupDirectory = [Environment]::GetFolderPath("Startup")
$startupShortcutPath = if ([string]::IsNullOrWhiteSpace($startupDirectory)) { $null } else {
  Join-Path $startupDirectory "Runtime Evolution Workbench.lnk"
}
$startupPresent = if ($null -eq $startupShortcutPath) {
  $inspectionErrors.Add("Windows Startup directory could not be resolved.")
  $false
} else {
  Test-RewOwnedStartupShortcut $startupShortcutPath
}
$startupNameCollision = $null -ne $startupShortcutPath -and
  (Test-Path -LiteralPath $startupShortcutPath -PathType Leaf) -and -not $startupPresent
$health = Get-RewHealth $Port
$serviceReachable = $null -ne $health -and $health.product -eq "runtime-evolution-workbench"
$pidFilePresent = Test-Path -LiteralPath (Join-Path $resolvedDataDir "service.pid") -PathType Leaf
$dataPresent = Test-Path -LiteralPath $resolvedDataDir -PathType Container
$installedStatePresent = $serviceReachable -or $pidFilePresent -or $startupPresent -or $pluginInstalled -eq $true -or $marketplaceRegistered -eq $true

$state = [ordered]@{
  schema_version = "product.installation-state.v1"
  product = "runtime-evolution-workbench"
  inspected_at = [DateTimeOffset]::UtcNow.ToString("o")
  inspection_complete = $inspectionErrors.Count -eq 0
  installed_state_present = $installedStatePresent
  data_directory_present = $dataPresent
  checks = [ordered]@{
    service_reachable = $serviceReachable
    pid_file_present = $pidFilePresent
    startup_shortcut_present = $startupPresent
    startup_shortcut_foreign_name_collision = $startupNameCollision
    plugin_installed = $pluginInstalled
    marketplace_registered = $marketplaceRegistered
  }
  errors = @($inspectionErrors)
}
$json = $state | ConvertTo-Json -Depth 5
Write-Output $json

if ($RequireAbsent) {
  if ($inspectionErrors.Count -gt 0) { throw "Installation absence could not be proved: $($inspectionErrors -join '; ')" }
  if ($installedStatePresent) { throw "Runtime Evolution Workbench installation state is still present." }
}
if ($RequireNoData -and $dataPresent) {
  throw "Runtime Evolution Workbench data is still present. Use Uninstall.ps1 -DeleteData only when permanent deletion is intended."
}
