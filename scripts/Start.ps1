param(
  [switch]$Foreground,
  [switch]$Open,
  [ValidateRange(1024, 65535)][int]$Port = 43119,
  [string]$DataDir = ""
)

. (Join-Path $PSScriptRoot "Common.ps1")

$node = Resolve-RewNode
$resolvedDataDir = Get-RewDataDir $DataDir
$serverPath = Join-Path $script:RewRoot "dist\server\index.js"
if (-not (Test-Path -LiteralPath $serverPath -PathType Leaf)) {
  throw "The production build is missing. Run scripts\Build.ps1 first."
}

$pidPath = Join-Path $resolvedDataDir "service.pid"
$existingHealth = Get-RewHealth $Port
if ($null -ne $existingHealth) {
  if ($existingHealth.product -ne "runtime-evolution-workbench") {
    throw "Port $Port is already serving another application."
  }
  if (-not (Test-Path -LiteralPath $resolvedDataDir -PathType Container)) {
    throw "A Runtime Evolution Workbench service is reachable, but this data directory does not exist. Refusing to adopt it."
  }
  Assert-RewDataRoot $resolvedDataDir | Out-Null
  if (-not (Test-Path -LiteralPath $pidPath -PathType Leaf)) {
    throw "A Runtime Evolution Workbench service is reachable, but this data directory has no service ownership record. Refusing to adopt it."
  }
  try { $serviceRecord = Get-Content -LiteralPath $pidPath -Raw | ConvertFrom-Json }
  catch { throw "Invalid service ownership record: $pidPath" }
  $expectedRepository = [System.IO.Path]::GetFullPath($script:RewRoot)
  $expectedServer = [System.IO.Path]::GetFullPath($serverPath)
  if (
    $serviceRecord.schema_version -ne "product.windows-service.v2" -or
    $serviceRecord.product -ne "runtime-evolution-workbench" -or
    [int]$serviceRecord.port -ne $Port -or
    -not ([System.IO.Path]::GetFullPath([string]$serviceRecord.repository_root)).Equals($expectedRepository, [StringComparison]::OrdinalIgnoreCase) -or
    -not ([System.IO.Path]::GetFullPath([string]$serviceRecord.server_path)).Equals($expectedServer, [StringComparison]::OrdinalIgnoreCase) -or
    [string]$serviceRecord.process_token -notmatch '^[a-f0-9]{64}$' -or
    [string]$existingHealth.instance_id -cne [string]$serviceRecord.process_token
  ) {
    throw "The reachable Runtime Evolution Workbench service did not prove ownership by this checkout and data directory. Refusing to adopt it."
  }
  $existingUrl = Get-RewSessionUrl $resolvedDataDir $Port
  Write-Host "Runtime Evolution Workbench is already running."
  if ($null -ne $existingUrl) {
    Write-Host $existingUrl
    if ($Open) { Start-Process $existingUrl }
  }
  return
}

Initialize-RewDataRoot $resolvedDataDir
$logsDir = Join-Path $resolvedDataDir "logs"
New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
$stdoutPath = Join-Path $logsDir "service.stdout.log"
$stderrPath = Join-Path $logsDir "service.stderr.log"
$processToken = "$([Guid]::NewGuid().ToString('N'))$([Guid]::NewGuid().ToString('N'))"

$previousDataDir = [Environment]::GetEnvironmentVariable("REW_DATA_DIR", "Process")
$previousPort = [Environment]::GetEnvironmentVariable("REW_PORT", "Process")
$previousHost = [Environment]::GetEnvironmentVariable("REW_HOST", "Process")
$previousProcessToken = [Environment]::GetEnvironmentVariable("REW_PROCESS_TOKEN", "Process")
[Environment]::SetEnvironmentVariable("REW_DATA_DIR", $resolvedDataDir, "Process")
[Environment]::SetEnvironmentVariable("REW_PORT", [string]$Port, "Process")
[Environment]::SetEnvironmentVariable("REW_HOST", "127.0.0.1", "Process")
[Environment]::SetEnvironmentVariable("REW_PROCESS_TOKEN", $processToken, "Process")

try {
  if ($Foreground) {
    Push-Location $script:RewRoot
    try { & $node $serverPath } finally { Pop-Location }
    return
  }

  $quotedServerPath = '"' + $serverPath.Replace('"', '\"') + '"'
  $serviceProcess = Start-Process `
    -FilePath $node `
    -ArgumentList $quotedServerPath `
    -WorkingDirectory $script:RewRoot `
    -WindowStyle Hidden `
    -PassThru `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath
  $serviceRecord = [ordered]@{
    schema_version = "product.windows-service.v2"
    product = "runtime-evolution-workbench"
    pid = $serviceProcess.Id
    port = $Port
    repository_root = $script:RewRoot
    server_path = [System.IO.Path]::GetFullPath($serverPath)
    process_token = $processToken
    started_at = [DateTimeOffset]::UtcNow.ToString("o")
  } | ConvertTo-Json -Depth 4
  [System.IO.File]::WriteAllText($pidPath, "$serviceRecord`n", [Text.UTF8Encoding]::new($false))
} finally {
  [Environment]::SetEnvironmentVariable("REW_DATA_DIR", $previousDataDir, "Process")
  [Environment]::SetEnvironmentVariable("REW_PORT", $previousPort, "Process")
  [Environment]::SetEnvironmentVariable("REW_HOST", $previousHost, "Process")
  [Environment]::SetEnvironmentVariable("REW_PROCESS_TOKEN", $previousProcessToken, "Process")
}

$ready = $false
for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
  Start-Sleep -Milliseconds 250
  if ($serviceProcess.HasExited) { break }
  $health = Get-RewHealth $Port
  if (
    $null -ne $health -and
    $health.product -eq "runtime-evolution-workbench" -and
    [string]$health.instance_id -ceq $processToken
  ) {
    $ready = $true
    break
  }
}

if (-not $ready) {
  if (-not $serviceProcess.HasExited) { Stop-Process -Id $serviceProcess.Id -Force }
  if (Test-Path -LiteralPath $pidPath -PathType Leaf) { Remove-Item -LiteralPath $pidPath -Force }
  $errorTail = if (Test-Path -LiteralPath $stderrPath -PathType Leaf) {
    (Get-Content -LiteralPath $stderrPath -Tail 30) -join "`n"
  } else { "No service error log was created." }
  throw "Runtime Evolution Workbench did not become healthy on port $Port.`n$errorTail"
}

$sessionUrl = Get-RewSessionUrl $resolvedDataDir $Port
Write-Host "Runtime Evolution Workbench is running as process $($serviceProcess.Id)."
Write-Host "Data: $resolvedDataDir"
if ($null -ne $sessionUrl) {
  Write-Host $sessionUrl
  if ($Open) { Start-Process $sessionUrl }
} else {
  Write-Warning "The service is healthy, but its one-time session URL is not available yet."
}
