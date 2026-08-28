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

$existingHealth = Get-RewHealth $Port
if ($null -ne $existingHealth) {
  if ($existingHealth.product -ne "runtime-evolution-workbench") {
    throw "Port $Port is already serving another application."
  }
  $existingUrl = Get-RewSessionUrl $resolvedDataDir $Port
  Write-Host "Runtime Evolution Workbench is already running."
  if ($null -ne $existingUrl) {
    Write-Host $existingUrl
    if ($Open) { Start-Process $existingUrl }
  }
  return
}

New-Item -ItemType Directory -Path $resolvedDataDir -Force | Out-Null
$logsDir = Join-Path $resolvedDataDir "logs"
New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
$pidPath = Join-Path $resolvedDataDir "service.pid"
$stdoutPath = Join-Path $logsDir "service.stdout.log"
$stderrPath = Join-Path $logsDir "service.stderr.log"

$previousDataDir = [Environment]::GetEnvironmentVariable("REW_DATA_DIR", "Process")
$previousPort = [Environment]::GetEnvironmentVariable("REW_PORT", "Process")
$previousHost = [Environment]::GetEnvironmentVariable("REW_HOST", "Process")
[Environment]::SetEnvironmentVariable("REW_DATA_DIR", $resolvedDataDir, "Process")
[Environment]::SetEnvironmentVariable("REW_PORT", [string]$Port, "Process")
[Environment]::SetEnvironmentVariable("REW_HOST", "127.0.0.1", "Process")

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
  [System.IO.File]::WriteAllText($pidPath, "$($serviceProcess.Id)`n")
} finally {
  [Environment]::SetEnvironmentVariable("REW_DATA_DIR", $previousDataDir, "Process")
  [Environment]::SetEnvironmentVariable("REW_PORT", $previousPort, "Process")
  [Environment]::SetEnvironmentVariable("REW_HOST", $previousHost, "Process")
}

$ready = $false
for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
  Start-Sleep -Milliseconds 250
  if ($serviceProcess.HasExited) { break }
  $health = Get-RewHealth $Port
  if ($null -ne $health -and $health.product -eq "runtime-evolution-workbench") {
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
