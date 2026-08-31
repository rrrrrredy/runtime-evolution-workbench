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

function Test-RewMarketplacePresent([string]$Listing, [string]$Name) {
  $escaped = [regex]::Escape($Name)
  return (
    $Listing -match "(?im)^\s*$escaped(?:\s+|$)" -or
    $Listing -match "(?im)^\s*Marketplace\s+\W*$escaped\W*$"
  )
}

function Test-RewPluginInstalled([string]$Listing, [string]$Selector) {
  $escaped = [regex]::Escape($Selector)
  return $Listing -match "(?im)^\s*$escaped\s+installed(?:,|\s|$)"
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
