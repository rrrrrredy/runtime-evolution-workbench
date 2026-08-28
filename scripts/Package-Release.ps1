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
  $manifestPath = Join-Path $outputRoot "runtime-evolution-workbench-$Version.release.json"
  foreach ($existing in @($archivePath, $checksumPath, $manifestPath)) {
    if (Test-Path -LiteralPath $existing -PathType Leaf) { Remove-Item -LiteralPath $existing -Force }
  }

  $temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) "rew-package-$([Guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
  try {
    $folderName = "runtime-evolution-workbench-$Version"
    $sourceArchive = Join-Path $temporaryRoot "source.zip"
    $expanded = Join-Path $temporaryRoot "expanded"
    git archive --format=zip --prefix="$folderName/" --output=$sourceArchive HEAD
    if ($LASTEXITCODE -ne 0) { throw "git archive failed." }
    Expand-Archive -LiteralPath $sourceArchive -DestinationPath $expanded
    $stageRoot = Join-Path $expanded $folderName
    Copy-Item -LiteralPath (Join-Path $script:RewRoot "dist") -Destination (Join-Path $stageRoot "dist") -Recurse -Force

    $tar = Get-Command tar.exe -ErrorAction Stop
    & $tar.Source -a -c -f $archivePath -C $expanded $folderName
    if ($LASTEXITCODE -ne 0) { throw "Release archive creation failed." }
    $listing = (& $tar.Source -tf $archivePath | Out-String)
    foreach ($required in @(
      "$folderName/LICENSE",
      "$folderName/scripts/Install.ps1",
      "$folderName/plugins/runtime-evolution-workbench/.codex-plugin/plugin.json",
      "$folderName/dist/server/index.js",
      "$folderName/dist/web/index.html"
    )) {
      if (-not $listing.Contains($required, [StringComparison]::Ordinal)) {
        throw "Release archive is missing required file: $required"
      }
    }
  } finally {
    if (Test-Path -LiteralPath $temporaryRoot -PathType Container) {
      $resolvedTemporary = (Resolve-Path -LiteralPath $temporaryRoot).Path
      $expectedPrefix = Join-Path ([System.IO.Path]::GetTempPath()) "rew-package-"
      if (-not $resolvedTemporary.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe package cleanup target: $resolvedTemporary"
      }
      Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force
    }
  }

  $checksum = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  [System.IO.File]::WriteAllText($checksumPath, "$checksum  runtime-evolution-workbench-$Version.zip`n")
  $commit = (git rev-parse HEAD | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{40}$') { throw "Could not resolve release commit." }
  $manifest = [ordered]@{
    schema_version = "runtime-evolution-workbench.release.v1"
    version = $Version
    commit = $commit
    protocol_dependency = [string]$package.dependencies.'@agent-run-protocol/core'
    archive = [ordered]@{
      file = [System.IO.Path]::GetFileName($archivePath)
      sha256 = $checksum
      bytes = (Get-Item -LiteralPath $archivePath).Length
    }
    created_at = [DateTime]::UtcNow.ToString("o")
  } | ConvertTo-Json -Depth 5
  [System.IO.File]::WriteAllText($manifestPath, "$manifest`n", [Text.UTF8Encoding]::new($false))
  Write-Host "Release archive: $archivePath"
  Write-Host "SHA-256: $checksum"
} finally {
  Pop-Location
}
