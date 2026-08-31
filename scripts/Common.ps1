Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:RewRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))

function Resolve-RewNode {
  $candidate = $null
  if (-not [string]::IsNullOrWhiteSpace($env:REW_NODE)) {
    if (-not (Test-Path -LiteralPath $env:REW_NODE -PathType Leaf)) {
      throw "REW_NODE does not point to a Node executable: $env:REW_NODE"
    }
    $candidate = [System.IO.Path]::GetFullPath($env:REW_NODE)
  } else {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($null -eq $command) { $command = Get-Command node -ErrorAction SilentlyContinue }
    if ($null -eq $command) {
      throw "Node.js 22 is required. Install Node 22 or set REW_NODE to node.exe."
    }
    $candidate = $command.Source
  }

  $version = (& $candidate -p "process.versions.node").Trim()
  if ($LASTEXITCODE -ne 0) { throw "Could not run Node at $candidate" }
  $major = [int]($version.Split('.')[0])
  if ($major -ne 22) {
    throw "Runtime Evolution Workbench requires Node 22.x; found $version at $candidate. Set REW_NODE to a Node 22 executable."
  }
  return $candidate
}

function Get-RewNpmCli([string]$NodePath) {
  $nodeDirectory = Split-Path -Parent $NodePath
  $npmCli = Join-Path $nodeDirectory "node_modules\npm\bin\npm-cli.js"
  if (-not (Test-Path -LiteralPath $npmCli -PathType Leaf)) {
    throw "npm-cli.js was not found beside Node: $npmCli"
  }
  return $npmCli
}

function Invoke-RewNpm([string[]]$Arguments) {
  $node = Resolve-RewNode
  $npmCli = Get-RewNpmCli $node
  & $node $npmCli @Arguments
  if ($LASTEXITCODE -ne 0) { throw "npm failed with exit code $LASTEXITCODE" }
}

function Get-RewMarketplaceRecord([string]$Listing, [string]$Name) {
  $escaped = [regex]::Escape($Name)
  foreach ($line in ($Listing -split "\r?\n")) {
    if ($line -match "^\s*$escaped\s+(.+?)\s*$") {
      return [pscustomobject]@{
        name = $Name
        root = [System.IO.Path]::GetFullPath($Matches[1].Trim()).TrimEnd('\')
      }
    }
  }
  return $null
}

function Get-RewPluginRecord([string]$Listing, [string]$Selector) {
  $escaped = [regex]::Escape($Selector)
  foreach ($line in ($Listing -split "\r?\n")) {
    if ($line -match "^\s*$escaped\s+installed(?:,\s*[a-z]+)*\s+(\S+)\s+(.+?)\s*$") {
      return [pscustomobject]@{
        selector = $Selector
        version = $Matches[1]
        path = [System.IO.Path]::GetFullPath($Matches[2].Trim()).TrimEnd('\')
      }
    }
  }
  return $null
}

function Test-RewMarketplacePresent([string]$Listing, [string]$Name) {
  return $null -ne (Get-RewMarketplaceRecord $Listing $Name)
}

function Test-RewPluginInstalled([string]$Listing, [string]$Selector) {
  return $null -ne (Get-RewPluginRecord $Listing $Selector)
}

function Test-RewSamePath([string]$Left, [string]$Right) {
  $leftPath = [System.IO.Path]::GetFullPath($Left).TrimEnd('\')
  $rightPath = [System.IO.Path]::GetFullPath($Right).TrimEnd('\')
  return $leftPath.Equals($rightPath, [StringComparison]::OrdinalIgnoreCase)
}

function Assert-RewCodexOwnership(
  $MarketplaceRecord,
  $PluginRecord,
  [string]$Source,
  [string]$PluginPath,
  [string]$Version
) {
  if ($null -ne $MarketplaceRecord -and -not (Test-RewSamePath $MarketplaceRecord.root $Source)) {
    throw "A foreign Codex marketplace already uses the name runtime-evolution-workbench at $($MarketplaceRecord.root). It was not changed."
  }
  if (
    $null -ne $PluginRecord -and
    (-not (Test-RewSamePath $PluginRecord.path $PluginPath) -or [string]$PluginRecord.version -cne $Version)
  ) {
    throw "A foreign or different-version Codex plugin already uses runtime-evolution-workbench. It was not changed."
  }
}

function Get-RewInstallationReceiptPath([string]$DataDir) {
  return Join-Path ([System.IO.Path]::GetFullPath($DataDir)) ".runtime-evolution-workbench-installation.json"
}

function Write-RewInstallationReceipt([string]$DataDir, [string]$Source, [string]$PluginPath, [string]$Version) {
  $receipt = [ordered]@{
    schema_version = "product.installation-ownership.v1"
    product = "runtime-evolution-workbench"
    marketplace_name = "runtime-evolution-workbench"
    marketplace_source = [System.IO.Path]::GetFullPath($Source).TrimEnd('\')
    plugin_selector = "runtime-evolution-workbench@runtime-evolution-workbench"
    plugin_path = [System.IO.Path]::GetFullPath($PluginPath).TrimEnd('\')
    plugin_version = $Version
    recorded_at = [DateTimeOffset]::UtcNow.ToString("o")
  } | ConvertTo-Json -Depth 4
  [System.IO.File]::WriteAllText(
    (Get-RewInstallationReceiptPath $DataDir),
    "$receipt`n",
    [Text.UTF8Encoding]::new($false)
  )
}

function Read-RewInstallationReceipt([string]$DataDir) {
  $path = Get-RewInstallationReceiptPath $DataDir
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
  try { $receipt = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json }
  catch { throw "Runtime Evolution Workbench installation receipt is invalid: $path" }
  if (
    $receipt.schema_version -ne "product.installation-ownership.v1" -or
    $receipt.product -ne "runtime-evolution-workbench"
  ) {
    throw "Runtime Evolution Workbench installation receipt names another product: $path"
  }
  return $receipt
}

function Get-RewStartupShortcutPath {
  $startupDirectory = [Environment]::GetFolderPath("Startup")
  if ([string]::IsNullOrWhiteSpace($startupDirectory)) {
    throw "Windows Startup directory could not be resolved."
  }
  return Join-Path $startupDirectory "Runtime Evolution Workbench.lnk"
}

function Get-RewStartupShortcutDescription {
  return "Runtime Evolution Workbench startup [owner:runtime-evolution-workbench]"
}

function Test-RewOwnedStartupShortcut([string]$ShortcutPath) {
  if (-not (Test-Path -LiteralPath $ShortcutPath -PathType Leaf)) { return $false }
  $shell = $null
  $shortcut = $null
  try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $expectedScript = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "Start.ps1"))
    $expectedWorkingDirectory = [System.IO.Path]::GetFullPath($script:RewRoot).TrimEnd('\')
    $actualWorkingDirectory = [System.IO.Path]::GetFullPath([string]$shortcut.WorkingDirectory).TrimEnd('\')
    $targetName = [System.IO.Path]::GetFileName([string]$shortcut.TargetPath).ToLowerInvariant()
    $scriptArgument = '-File "' + $expectedScript + '"'
    return (
      ([string]$shortcut.Description -ceq (Get-RewStartupShortcutDescription)) -and
      ($targetName -in @("pwsh.exe", "powershell.exe")) -and
      ($actualWorkingDirectory -ceq $expectedWorkingDirectory) -and
      ([string]$shortcut.Arguments).IndexOf($scriptArgument, [StringComparison]::OrdinalIgnoreCase) -ge 0
    )
  } catch {
    return $false
  } finally {
    if ($null -ne $shortcut -and [Runtime.InteropServices.Marshal]::IsComObject($shortcut)) {
      [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) | Out-Null
    }
    if ($null -ne $shell -and [Runtime.InteropServices.Marshal]::IsComObject($shell)) {
      [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) | Out-Null
    }
  }
}

function Assert-RewStartupShortcutAvailable([string]$ShortcutPath) {
  if ((Test-Path -LiteralPath $ShortcutPath -PathType Leaf) -and -not (Test-RewOwnedStartupShortcut $ShortcutPath)) {
    throw "The Startup shortcut name is already used by another application. It was not overwritten: $ShortcutPath"
  }
}

function Remove-RewOwnedStartupShortcut([string]$ShortcutPath) {
  if (Test-RewOwnedStartupShortcut $ShortcutPath) {
    Remove-Item -LiteralPath $ShortcutPath -Force
    return $true
  }
  return $false
}

function Get-RewDataDir([string]$Requested = "") {
  if (-not [string]::IsNullOrWhiteSpace($Requested)) {
    return [System.IO.Path]::GetFullPath($Requested)
  }
  if (-not [string]::IsNullOrWhiteSpace($env:REW_DATA_DIR)) {
    return [System.IO.Path]::GetFullPath($env:REW_DATA_DIR)
  }
  if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    return [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "RuntimeEvolutionWorkbench"))
  }
  return [System.IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath("UserProfile")) ".runtime-evolution-workbench"))
}

function Assert-RewSafeDataPath([string]$DataDir) {
  $resolved = [System.IO.Path]::GetFullPath($DataDir).TrimEnd('\')
  $root = [System.IO.Path]::GetPathRoot($resolved).TrimEnd('\')
  $profile = [System.IO.Path]::GetFullPath([Environment]::GetFolderPath("UserProfile")).TrimEnd('\')
  $localAppData = if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { "" } else {
    [System.IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd('\')
  }
  $documentsFolder = [Environment]::GetFolderPath("MyDocuments")
  $documents = if ([string]::IsNullOrWhiteSpace($documentsFolder)) { "" } else {
    [System.IO.Path]::GetFullPath($documentsFolder).TrimEnd('\')
  }
  if ($resolved.Length -lt 12 -or $resolved -eq $root -or $resolved -eq $profile -or $resolved -eq $localAppData -or $resolved -eq $documents) {
    throw "Refusing to use an unsafe Runtime Evolution Workbench data path: $resolved"
  }
  $checkout = [System.IO.Path]::GetFullPath($script:RewRoot).TrimEnd('\')
  $dataInsideCheckout = $resolved.Equals($checkout, [StringComparison]::OrdinalIgnoreCase) -or
    $resolved.StartsWith(($checkout + "\"), [StringComparison]::OrdinalIgnoreCase)
  $checkoutInsideData = $checkout.StartsWith(($resolved + "\"), [StringComparison]::OrdinalIgnoreCase)
  if ($dataInsideCheckout -or $checkoutInsideData) {
    throw "Refusing a data path that overlaps the Runtime Evolution Workbench source checkout: $resolved"
  }
  return $resolved
}

function Get-RewDataMarkerPath([string]$DataDir) {
  return Join-Path ([System.IO.Path]::GetFullPath($DataDir)) ".runtime-evolution-workbench-data.json"
}

function Assert-RewDataRoot([string]$DataDir) {
  $resolved = Assert-RewSafeDataPath $DataDir
  $item = Get-Item -LiteralPath $resolved -Force -ErrorAction Stop
  if (-not $item.PSIsContainer -or ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
    throw "Runtime Evolution Workbench data root must be a real directory, not a file or reparse point: $resolved"
  }
  $markerPath = Get-RewDataMarkerPath $resolved
  if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
    throw "Refusing to treat an unmarked directory as Runtime Evolution Workbench data: $resolved"
  }
  try { $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json }
  catch { throw "Runtime Evolution Workbench data marker is invalid: $markerPath" }
  if ($marker.schema_version -ne "product.data-root.v1" -or $marker.product -ne "runtime-evolution-workbench") {
    throw "Runtime Evolution Workbench data marker names another product: $markerPath"
  }
  return $resolved
}

function Initialize-RewDataRoot([string]$DataDir) {
  $resolved = Assert-RewSafeDataPath $DataDir
  if (Test-Path -LiteralPath $resolved) {
    $item = Get-Item -LiteralPath $resolved -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
      throw "Runtime Evolution Workbench data root must be a real directory, not a file or reparse point: $resolved"
    }
    $markerPath = Get-RewDataMarkerPath $resolved
    if (Test-Path -LiteralPath $markerPath -PathType Leaf) {
      Assert-RewDataRoot $resolved | Out-Null
      return
    }
    throw "DataDir already exists but has no Runtime Evolution Workbench marker: $resolved"
  } else {
    New-Item -ItemType Directory -Path $resolved | Out-Null
  }
  $marker = [ordered]@{
    schema_version = "product.data-root.v1"
    product = "runtime-evolution-workbench"
    created_at = [DateTimeOffset]::UtcNow.ToString("o")
  } | ConvertTo-Json -Depth 3
  [System.IO.File]::WriteAllText((Get-RewDataMarkerPath $resolved), "$marker`n", [Text.UTF8Encoding]::new($false))
  Assert-RewDataRoot $resolved | Out-Null
}

function Remove-RewDataRootCreatedByFailedInstall([string]$DataDir) {
  $resolved = Assert-RewDataRoot $DataDir
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

function Get-RewHealth([int]$Port) {
  try {
    return Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -Method Get -TimeoutSec 2
  } catch {
    return $null
  }
}

function Get-RewSessionUrl([string]$DataDir, [int]$Port) {
  $tokenPath = Join-Path $DataDir "session-token"
  if (-not (Test-Path -LiteralPath $tokenPath -PathType Leaf)) { return $null }
  $token = (Get-Content -LiteralPath $tokenPath -Raw).Trim()
  if ($token.Length -lt 32) { return $null }
  return "http://127.0.0.1:$Port/session/$token"
}
