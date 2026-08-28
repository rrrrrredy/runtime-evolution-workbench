param(
  [switch]$DeleteData,
  [ValidateRange(1024, 65535)][int]$Port = 43119,
  [string]$DataDir = ""
)

. (Join-Path $PSScriptRoot "Common.ps1")

$resolvedDataDir = Get-RewDataDir $DataDir
$pluginSelector = "runtime-evolution-workbench@runtime-evolution-workbench"
$marketplaceName = "runtime-evolution-workbench"

try {
  & (Join-Path $PSScriptRoot "Stop.ps1") -Port $Port -DataDir $resolvedDataDir
} catch {
  Write-Warning "Service stop needs attention: $($_.Exception.Message)"
}

$startupDirectory = [Environment]::GetFolderPath("Startup")
if (-not [string]::IsNullOrWhiteSpace($startupDirectory)) {
  $shortcutPath = Join-Path $startupDirectory "Runtime Evolution Workbench.lnk"
  if (Test-Path -LiteralPath $shortcutPath -PathType Leaf) {
    Remove-Item -LiteralPath $shortcutPath -Force
    Write-Host "Removed current-user startup shortcut."
  }
}

$codexCommand = Get-Command codex.exe -ErrorAction SilentlyContinue
if ($null -eq $codexCommand) { $codexCommand = Get-Command codex -ErrorAction SilentlyContinue }
if ($null -ne $codexCommand) {
  $pluginOutput = (& $codexCommand.Source plugin list 2>&1 | Out-String)
  if (Test-RewPluginInstalled $pluginOutput $pluginSelector) {
    & $codexCommand.Source plugin remove $pluginSelector
    if ($LASTEXITCODE -ne 0) { throw "Codex could not remove $pluginSelector." }
  }
  $marketplaceOutput = (& $codexCommand.Source plugin marketplace list 2>&1 | Out-String)
  if (Test-RewMarketplacePresent $marketplaceOutput $marketplaceName) {
    & $codexCommand.Source plugin marketplace remove $marketplaceName
    if ($LASTEXITCODE -ne 0) { throw "Codex could not remove marketplace $marketplaceName." }
  }
} else {
  Write-Warning "Codex CLI was not found; plugin configuration could not be inspected."
}

if ($DeleteData -and (Test-Path -LiteralPath $resolvedDataDir -PathType Container)) {
  $dataFullPath = Assert-RewDataRoot $resolvedDataDir
  Remove-Item -LiteralPath $dataFullPath -Recurse -Force
  Write-Host "Deleted local Runtime Evolution Workbench data: $dataFullPath (not recoverable by this uninstaller)."
} else {
  Write-Host "Preserved local Run data: $resolvedDataDir"
}

& (Join-Path $PSScriptRoot "Inspect-Installation.ps1") -RequireAbsent -RequireNoData:$DeleteData -Port $Port -DataDir $resolvedDataDir | Out-Null
Write-Host "Runtime Evolution Workbench is uninstalled. The source checkout was not deleted."
