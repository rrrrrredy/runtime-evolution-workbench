param(
  [switch]$EnableStartup,
  [switch]$NoStart,
  [switch]$Open,
  [switch]$Repair,
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

$source = if ([string]::IsNullOrWhiteSpace($MarketplaceSource)) { $script:RewRoot } else { $MarketplaceSource }
$marketplaceName = "runtime-evolution-workbench"
$pluginSelector = "runtime-evolution-workbench@runtime-evolution-workbench"

Write-Host "Building Runtime Evolution Workbench with Node $(& $node -p 'process.versions.node')..."
& (Join-Path $PSScriptRoot "Check.ps1") -InstallDependencies
if ($LASTEXITCODE -ne 0) { throw "Release checks failed; nothing was installed." }

$marketplaceOutput = (& $codexCommand.Source plugin marketplace list 2>&1 | Out-String)
$marketplacePresent = $marketplaceOutput -match '(?im)^Marketplace\s+\W*runtime-evolution-workbench\W*$'
$pluginOutput = (& $codexCommand.Source plugin list 2>&1 | Out-String)
$pluginPresent = $pluginOutput.Contains($pluginSelector, [StringComparison]::OrdinalIgnoreCase)

if ($Repair -and $pluginPresent) {
  & $codexCommand.Source plugin remove $pluginSelector
  if ($LASTEXITCODE -ne 0) { throw "Could not remove the existing plugin during repair." }
  $pluginPresent = $false
}
if ($Repair -and $marketplacePresent) {
  & $codexCommand.Source plugin marketplace remove $marketplaceName
  if ($LASTEXITCODE -ne 0) { throw "Could not remove the existing marketplace during repair." }
  $marketplacePresent = $false
}

if (-not $marketplacePresent) {
  & $codexCommand.Source plugin marketplace add $source
  if ($LASTEXITCODE -ne 0) { throw "Could not add the Runtime Evolution Workbench marketplace." }
}
if (-not $pluginPresent) {
  try {
    & $codexCommand.Source plugin add $pluginSelector
    if ($LASTEXITCODE -ne 0) { throw "Codex plugin installation failed." }
  } catch {
    if (-not $marketplacePresent) {
      & $codexCommand.Source plugin marketplace remove $marketplaceName 2>$null | Out-Null
    }
    throw
  }
}

if ($EnableStartup) {
  $startupDirectory = [Environment]::GetFolderPath("Startup")
  if ([string]::IsNullOrWhiteSpace($startupDirectory)) { throw "Windows Startup directory could not be resolved." }
  $shortcutPath = Join-Path $startupDirectory "Runtime Evolution Workbench.lnk"
  $powerShellCommand = Get-Command pwsh.exe -ErrorAction SilentlyContinue
  if ($null -eq $powerShellCommand) { $powerShellCommand = Get-Command powershell.exe -ErrorAction Stop }
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $powerShellCommand.Source
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'Start.ps1')`""
  $shortcut.WorkingDirectory = $script:RewRoot
  $shortcut.WindowStyle = 7
  $shortcut.Description = "Start Runtime Evolution Workbench locally at sign-in"
  $shortcut.Save()
  Write-Host "Enabled current-user startup: $shortcutPath"
}

if (-not $NoStart) {
  & (Join-Path $PSScriptRoot "Start.ps1") -Open:$Open
}

Write-Host "Runtime Evolution Workbench plugin is installed. Restart Codex to load Hooks, MCP tools, and the Skill."
Write-Host "Uninstall with .\scripts\Uninstall.ps1; Run data is preserved unless -DeleteData is explicitly supplied."
