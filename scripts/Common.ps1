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
