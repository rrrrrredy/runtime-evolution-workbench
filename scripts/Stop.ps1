param(
  [ValidateRange(1024, 65535)][int]$Port = 43119,
  [string]$DataDir = ""
)

. (Join-Path $PSScriptRoot "Common.ps1")

$resolvedDataDir = Get-RewDataDir $DataDir
$pidPath = Join-Path $resolvedDataDir "service.pid"
if (-not (Test-Path -LiteralPath $pidPath -PathType Leaf)) {
  $health = Get-RewHealth $Port
  if ($null -ne $health -and $health.product -eq "runtime-evolution-workbench") {
    throw "The service is reachable but its PID file is missing. Refusing to guess which process to stop."
  }
  Write-Host "Runtime Evolution Workbench is not running."
  return
}

$rawProcessId = (Get-Content -LiteralPath $pidPath -Raw).Trim()
$serviceProcessId = 0
if (-not [int]::TryParse($rawProcessId, [ref]$serviceProcessId) -or $serviceProcessId -le 0) {
  throw "Invalid service PID file: $pidPath"
}

$serviceProcessInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $serviceProcessId" -ErrorAction SilentlyContinue
if ($null -eq $serviceProcessInfo) {
  Remove-Item -LiteralPath $pidPath -Force
  Write-Host "Removed a stale PID file; the service was not running."
  return
}

$expectedServer = [System.IO.Path]::GetFullPath((Join-Path $script:RewRoot "dist\server\index.js"))
$commandLine = [string]$serviceProcessInfo.CommandLine
if ($serviceProcessInfo.Name -notmatch '^node(?:\.exe)?$' -or $commandLine.IndexOf($expectedServer, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
  throw "PID $serviceProcessId does not belong to this Runtime Evolution Workbench checkout. Refusing to stop it."
}

Stop-Process -Id $serviceProcessId
for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
  Start-Sleep -Milliseconds 125
  if ($null -eq (Get-Process -Id $serviceProcessId -ErrorAction SilentlyContinue)) { break }
}
if ($null -ne (Get-Process -Id $serviceProcessId -ErrorAction SilentlyContinue)) {
  throw "Service process $serviceProcessId did not stop."
}
Remove-Item -LiteralPath $pidPath -Force
Write-Host "Runtime Evolution Workbench stopped. Local Run data was preserved."
