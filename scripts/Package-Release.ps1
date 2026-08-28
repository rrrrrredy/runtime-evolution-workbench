param(
  [string]$Version = "0.1.0",
  [string]$OutputDirectory = ""
)

. (Join-Path $PSScriptRoot "Common.ps1")

& (Join-Path $PSScriptRoot "Check.ps1") -InstallDependencies
if ($LASTEXITCODE -ne 0) { throw "Release checks failed." }

Push-Location $script:RewRoot
try {
  $status = (git status --porcelain=v1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "The checkout is not a Git repository." }
  if ($status.Length -gt 0) { throw "Release packaging requires a clean Git checkout so the archive matches the reviewed commit." }

  $package = Get-Content -LiteralPath (Join-Path $script:RewRoot "package.json") -Raw | ConvertFrom-Json
  if ($package.version -ne $Version) { throw "Requested version $Version does not match package.json version $($package.version)." }

  $outputRoot = if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    Join-Path $script:RewRoot "artifacts"
  } else {
    [System.IO.Path]::GetFullPath($OutputDirectory)
  }
  New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
  $archivePath = Join-Path $outputRoot "runtime-evolution-workbench-$Version.zip"
  $checksumPath = "$archivePath.sha256"
  foreach ($existing in @($archivePath, $checksumPath)) {
    if (Test-Path -LiteralPath $existing -PathType Leaf) { Remove-Item -LiteralPath $existing -Force }
  }

  git archive --format=zip --prefix="runtime-evolution-workbench-$Version/" --output=$archivePath HEAD
  if ($LASTEXITCODE -ne 0) { throw "git archive failed." }
  $checksum = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  [System.IO.File]::WriteAllText($checksumPath, "$checksum  runtime-evolution-workbench-$Version.zip`n")
  Write-Host "Release archive: $archivePath"
  Write-Host "SHA-256: $checksum"
} finally {
  Pop-Location
}
